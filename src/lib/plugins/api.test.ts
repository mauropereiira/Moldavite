/** Host-boundary tests for plugin permissions, argument validation, fetch, and secrets. */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  dispatchPluginCall,
  PermissionDeniedError,
  setPluginAppVersion,
  getPluginAppVersion,
  getPluginApiVersion,
} from './api';
import { getPluginDialogSnapshot, resolvePluginDialog } from './dialogs';
import { usePluginStore } from '@/stores/pluginStore';

const addToast = vi.fn();
const listNotes = vi.fn();
const readNote = vi.fn();
const secretValues = new Map<string, string>();
// Command return values vary by command (secrets return strings; net.fetch
// returns a PluginFetchResponse), so this mock is typed loosely and each test
// narrows it with mockResolvedValueOnce/mockRejectedValueOnce as needed.
const safeInvoke = vi.fn(
  async (command: string, args: Record<string, unknown>): Promise<unknown> => {
    const account = `${args.pluginId}:${args.key}`;
    if (command === 'plugin_secret_get') return secretValues.get(account) ?? null;
    if (command === 'plugin_secret_set') secretValues.set(account, args.value as string);
    if (command === 'plugin_secret_delete') secretValues.delete(account);
    return null;
  }
);
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => safeInvoke(...(args as [string, Record<string, unknown>])),
}));
vi.mock('@/lib/fileSystem', () => ({
  listNotes: () => listNotes(),
  noteFileBackendPath: (note: { name: string; folderPath?: string }) =>
    note.folderPath ? `${note.folderPath}/${note.name}` : note.name,
  readNote: (...args: unknown[]) => readNote(...args),
}));
vi.mock('@/stores/noteStore', () => ({
  useNoteStore: {
    getState: () => ({
      currentNote: { id: 'notes/N.md', title: 'N', content: '<p>hi there</p>' },
    }),
  },
}));
const insertTextAtCursor = vi.fn((_t: string) => true);
vi.mock('@/stores/editorHandleStore', () => ({
  editorHandle: { insertTextAtCursor: (t: string) => insertTextAtCursor(t) },
}));

describe('dispatchPluginCall (host-side RPC handler)', () => {
  beforeEach(() => {
    addToast.mockClear();
    insertTextAtCursor.mockClear();
    insertTextAtCursor.mockReturnValue(true);
    listNotes.mockReset();
    readNote.mockReset();
    safeInvoke.mockClear();
    secretValues.clear();
    usePluginStore.setState({ grants: {} });
    if (getPluginDialogSnapshot()) resolvePluginDialog(null);
  });

  const ALL = ['editor', 'ui', 'notes.read', 'net.fetch', 'secrets'];

  it('editor.getActiveNote returns path + title + content when editor is permitted', async () => {
    const v = await dispatchPluginCall('demo', ALL, 'editor.getActiveNote', []);
    expect(v).toEqual({ path: 'notes/N.md', title: 'N', content: '<p>hi there</p>' });
  });

  it('editor.insertText routes to the editor handle when editor is permitted', async () => {
    await dispatchPluginCall('demo', ALL, 'editor.insertText', ['x']);
    expect(insertTextAtCursor).toHaveBeenCalledWith('x');
  });

  it('editor.insertText toasts an error when no active editor is available', async () => {
    insertTextAtCursor.mockReturnValueOnce(false);
    await dispatchPluginCall('demo', ALL, 'editor.insertText', ['x']);
    expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('No active editor'));
  });

  it('ui.toast maps info to success when ui is permitted', async () => {
    await dispatchPluginCall('demo', ALL, 'ui.toast', ['hey', 'info']);
    expect(addToast).toHaveBeenCalledWith('success', 'hey');
  });

  it('ui.toast preserves the error kind', async () => {
    await dispatchPluginCall('demo', ALL, 'ui.toast', ['boom', 'error']);
    expect(addToast).toHaveBeenCalledWith('error', 'boom');
  });

  it('ui.prompt requires the ui manifest permission before rendering', async () => {
    const pending = dispatchPluginCall(
      'demo',
      [],
      'ui.prompt',
      [{ title: 'Configure', fields: [{ name: 'site', label: 'Site', type: 'url' }] }],
      [],
      2,
      'Demo Plugin'
    );
    const dialog = getPluginDialogSnapshot();
    if (dialog) resolvePluginDialog(null);
    const result = await pending.then(
      () => null,
      (error: unknown) => error
    );
    expect(dialog).toBeNull();
    expect(result).toBeInstanceOf(PermissionDeniedError);
  });

  it('ui.prompt returns null on cancel and refuses to stack a second prompt', async () => {
    const options = { title: 'First', fields: [{ name: 'value', label: 'Value', type: 'text' }] };
    const first = dispatchPluginCall('demo', ['ui'], 'ui.prompt', [options]);
    await expect(dispatchPluginCall('other', ['ui'], 'ui.prompt', [options])).resolves.toBeNull();
    resolvePluginDialog(null);
    await expect(first).resolves.toBeNull();
  });

  it('editor calls throw PermissionDeniedError without the permission', async () => {
    await expect(dispatchPluginCall('demo', [], 'editor.insertText', ['x'])).rejects.toBeInstanceOf(
      PermissionDeniedError
    );
    await expect(
      dispatchPluginCall('demo', ['ui'], 'editor.getActiveNote', [])
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('ui.toast throws PermissionDeniedError without the permission', async () => {
    await expect(dispatchPluginCall('demo', [], 'ui.toast', ['x'])).rejects.toBeInstanceOf(
      PermissionDeniedError
    );
  });

  it('rejects malformed args instead of coercing them', async () => {
    await expect(dispatchPluginCall('demo', ALL, 'editor.insertText', [42])).rejects.toThrow(
      /string/
    );
    await expect(
      dispatchPluginCall('demo', ALL, 'ui.toast', [{ not: 'a string' }])
    ).rejects.toThrow(/string/);
  });

  it('exposes app version + apiVersion via helpers', () => {
    setPluginAppVersion('1.5.0');
    expect(getPluginAppVersion()).toBe('1.5.0');
    expect(getPluginApiVersion()).toBe(2);
  });

  it('host rejects v2 RPC methods from a v1 runtime', async () => {
    await expect(
      dispatchPluginCall('legacy', ['notes.read'], 'notes.list', [], [], 1)
    ).rejects.toThrow(/API v1/);
  });

  it('notes.list returns only curated metadata and notes.read returns Markdown', async () => {
    listNotes.mockResolvedValue([
      {
        name: 'hello.md',
        path: 'notes/Work/hello.md',
        folderPath: 'Work',
        isDaily: false,
        isWeekly: false,
        isLocked: false,
        modifiedAt: 123,
      },
    ]);
    readNote.mockResolvedValue('# Hello');
    await expect(dispatchPluginCall('demo', ALL, 'notes.list', [])).resolves.toEqual([
      { path: 'notes/Work/hello.md', title: 'hello', kind: 'standalone', folder: 'Work' },
    ]);
    await expect(
      dispatchPluginCall('demo', ALL, 'notes.read', ['notes/Work/hello.md'])
    ).resolves.toBe('# Hello');
    expect(readNote).toHaveBeenCalledWith('Work/hello.md', false, false);
  });

  it('notes.read refuses locked notes', async () => {
    listNotes.mockResolvedValue([
      {
        name: 'secret.md',
        path: 'notes/secret.md',
        isDaily: false,
        isWeekly: false,
        isLocked: true,
      },
    ]);
    await expect(
      dispatchPluginCall('demo', ALL, 'notes.read', ['notes/secret.md'])
    ).rejects.toThrow(/locked/);
    expect(readNote).not.toHaveBeenCalled();
  });

  it.each([
    ['notes.list', 'notes.read'],
    ['net.fetch', 'net.fetch'],
    ['secrets.get', 'secrets'],
  ] as const)('%s is rejected without its host-side permission', async (method, permission) => {
    await expect(dispatchPluginCall('demo', [], method, [])).rejects.toThrow(permission);
  });

  it('net.fetch rejects HTTP and non-allowlisted hosts before invoking the backend', async () => {
    await expect(
      dispatchPluginCall('demo', ALL, 'net.fetch', ['http://api.example.com'], ['api.example.com'])
    ).rejects.toThrow(/https/);
    await expect(
      dispatchPluginCall(
        'demo',
        ALL,
        'net.fetch',
        ['https://evil.example.com'],
        ['api.example.com']
      )
    ).rejects.toThrow(/allowedHosts/);
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', 'intranet', 'api.localhost', '*.example.com', 'Example.com'])(
    'net.requestHostAccess rejects invalid host %s',
    async (host) => {
      await expect(
        dispatchPluginCall('demo', ALL, 'net.requestHostAccess', [host])
      ).rejects.toThrow(/allowedHosts/);
      expect(getPluginDialogSnapshot()).toBeNull();
    }
  );

  it('net.requestHostAccess persists approval and returns false without error on denial', async () => {
    usePluginStore.getState().grant('demo', '1.0.0', 'hash');
    const approved = dispatchPluginCall(
      'demo',
      ALL,
      'net.requestHostAccess',
      ['site.example.com'],
      ['api.example.com'],
      2,
      'Demo Plugin'
    );
    expect(getPluginDialogSnapshot()).toMatchObject({
      kind: 'host-access',
      pluginName: 'Demo Plugin',
      host: 'site.example.com',
    });
    resolvePluginDialog(true);
    await expect(approved).resolves.toBe(true);
    expect(usePluginStore.getState().approvedHosts('demo')).toEqual(['site.example.com']);

    const denied = dispatchPluginCall('demo', ALL, 'net.requestHostAccess', ['other.example.com']);
    resolvePluginDialog(false);
    await expect(denied).resolves.toBe(false);
    expect(usePluginStore.getState().approvedHosts('demo')).toEqual(['site.example.com']);
  });

  it('net.fetch enforces manifest plus approved-host union and revoke immediately', async () => {
    usePluginStore.getState().grant('demo', '1.0.0', 'hash');
    usePluginStore.getState().approveHost('demo', 'site.example.com');
    safeInvoke.mockResolvedValueOnce({ status: 200, headers: {}, bodyText: 'ok' });

    await expect(
      dispatchPluginCall(
        'demo',
        ALL,
        'net.fetch',
        ['https://site.example.com/wp-json'],
        ['api.example.com']
      )
    ).resolves.toMatchObject({ status: 200 });

    usePluginStore.getState().revokeHost('demo', 'site.example.com');
    await expect(
      dispatchPluginCall(
        'demo',
        ALL,
        'net.fetch',
        ['https://site.example.com/wp-json'],
        ['api.example.com']
      )
    ).rejects.toThrow(/allowedHosts/);
  });

  // The redirect chain itself (host re-validation per hop, cross-origin header
  // stripping, size cap, timeout) now runs entirely inside the `plugin_fetch`
  // Rust command in a single IPC call — see plugin_net.rs's own unit tests.
  // What's left to verify here is the TS-to-backend contract: the effective
  // `allowedHosts` union is a snapshot taken when the call starts, request
  // details cross the boundary unmodified, and a backend rejection propagates.

  it('net.fetch snapshots the effective allowedHosts (manifest + approved) into the backend call', async () => {
    usePluginStore.getState().grant('demo', '1.0.0', 'hash');
    usePluginStore.getState().approveHost('demo', 'site.example.com');
    safeInvoke.mockResolvedValueOnce({ status: 200, headers: {}, bodyText: 'ok' });

    await dispatchPluginCall(
      'demo',
      ALL,
      'net.fetch',
      ['https://site.example.com/start'],
      ['api.example.com']
    );

    expect(safeInvoke).toHaveBeenCalledWith(
      'plugin_fetch',
      expect.objectContaining({ allowedHosts: ['api.example.com', 'site.example.com'] })
    );
  });

  it('net.fetch forwards method, headers, and body to the backend unmodified', async () => {
    safeInvoke.mockResolvedValueOnce({ status: 200, headers: {}, bodyText: '{}' });

    await dispatchPluginCall(
      'demo',
      ALL,
      'net.fetch',
      [
        'https://api.example.com/start',
        {
          method: 'post',
          headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
          body: '{}',
        },
      ],
      ['api.example.com']
    );

    expect(safeInvoke).toHaveBeenCalledWith('plugin_fetch', {
      url: 'https://api.example.com/start',
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: '{}',
      allowedHosts: ['api.example.com'],
    });
  });

  it('net.fetch propagates a backend rejection (e.g. an off-allowlist redirect target)', async () => {
    safeInvoke.mockRejectedValueOnce(
      new Error('net.fetch: host "evil.example.com" is not in this plugin\'s allowedHosts')
    );
    await expect(
      dispatchPluginCall(
        'demo',
        ALL,
        'net.fetch',
        ['https://api.example.com/start'],
        ['api.example.com']
      )
    ).rejects.toThrow(/allowedHosts/);
  });

  it('net.fetch returns the backend response unchanged', async () => {
    const backendResponse = {
      status: 200,
      headers: { 'content-type': 'application/json', etag: 'abc' },
      bodyText: '{"ok":true}',
    };
    safeInvoke.mockResolvedValueOnce(backendResponse);
    await expect(
      dispatchPluginCall(
        'demo',
        ALL,
        'net.fetch',
        ['https://api.example.com/data'],
        ['api.example.com']
      )
    ).resolves.toEqual(backendResponse);
  });

  it('secrets are isolated by the host-injected plugin id', async () => {
    await dispatchPluginCall('one', ALL, 'secrets.set', ['token', 'alpha']);
    await dispatchPluginCall('two', ALL, 'secrets.set', ['token', 'beta']);
    await expect(dispatchPluginCall('one', ALL, 'secrets.get', ['token'])).resolves.toBe('alpha');
    await expect(dispatchPluginCall('two', ALL, 'secrets.get', ['token'])).resolves.toBe('beta');
    await dispatchPluginCall('one', ALL, 'secrets.delete', ['token']);
    await expect(dispatchPluginCall('one', ALL, 'secrets.get', ['token'])).resolves.toBeNull();
    await expect(dispatchPluginCall('two', ALL, 'secrets.get', ['token'])).resolves.toBe('beta');
  });
});
