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
const safeInvoke = vi.fn(async (command: string, args: Record<string, string>) => {
  const account = `${args.pluginId}:${args.key}`;
  if (command === 'plugin_secret_get') return secretValues.get(account) ?? null;
  if (command === 'plugin_secret_set') secretValues.set(account, args.value);
  if (command === 'plugin_secret_delete') secretValues.delete(account);
  return null;
});
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => safeInvoke(...(args as [string, Record<string, string>])),
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
    vi.unstubAllGlobals();
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

  it('ui.prompt returns host-rendered values without a manifest permission', async () => {
    const pending = dispatchPluginCall(
      'demo',
      [],
      'ui.prompt',
      [{ title: 'Configure', fields: [{ name: 'site', label: 'Site', type: 'url' }] }],
      [],
      2,
      'Demo Plugin'
    );
    expect(getPluginDialogSnapshot()).toMatchObject({
      kind: 'prompt',
      pluginName: 'Demo Plugin',
    });
    resolvePluginDialog({ site: 'https://example.com' });
    await expect(pending).resolves.toEqual({ site: 'https://example.com' });
  });

  it('ui.prompt returns null on cancel and refuses to stack a second prompt', async () => {
    const options = { title: 'First', fields: [{ name: 'value', label: 'Value', type: 'text' }] };
    const first = dispatchPluginCall('demo', [], 'ui.prompt', [options]);
    await expect(dispatchPluginCall('other', [], 'ui.prompt', [options])).resolves.toBeNull();
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

  it('net.fetch rejects HTTP and non-allowlisted hosts before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
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
    expect(fetchMock).not.toHaveBeenCalled();
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
      );
    vi.stubGlobal('fetch', fetchMock);

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

  it('net.fetch re-reads approved hosts before following each redirect', async () => {
    usePluginStore.getState().grant('demo', '1.0.0', 'hash');
    usePluginStore.getState().approveHost('demo', 'site.example.com');
    const fetchMock = vi.fn().mockImplementationOnce(() => {
      usePluginStore.getState().revokeHost('demo', 'site.example.com');
      return Promise.resolve(
        new Response('', {
          status: 302,
          headers: { location: 'https://site.example.com/after-revoke' },
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      dispatchPluginCall(
        'demo',
        ALL,
        'net.fetch',
        ['https://site.example.com/start'],
        ['api.example.com']
      )
    ).rejects.toThrow(/allowedHosts/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('net.fetch manually follows allowlisted redirects and rejects an off-list redirect', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('', { status: 302, headers: { location: 'https://evil.example.com/steal' } })
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      dispatchPluginCall(
        'demo',
        ALL,
        'net.fetch',
        ['https://api.example.com/start'],
        ['api.example.com']
      )
    ).rejects.toThrow(/allowedHosts/);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('net.fetch keeps only minimal headers on a cross-origin redirect', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', { status: 307, headers: { location: 'https://uploads.example.com/post' } })
      )
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    await dispatchPluginCall(
      'demo',
      ALL,
      'net.fetch',
      [
        'https://api.example.com/start',
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'accept-language': 'en-US',
            'content-type': 'application/json',
            authorization: 'Bearer secret',
            cookie: 'session=secret',
            'x-api-key': 'secret',
            'x-custom': 'drop-me',
          },
          body: '{}',
        },
      ],
      ['api.example.com', 'uploads.example.com']
    );

    const secondOptions = fetchMock.mock.calls[1][1] as {
      headers: Headers;
      body?: unknown;
    };
    expect(Object.fromEntries(secondOptions.headers.entries())).toEqual({
      accept: 'application/json',
      'accept-language': 'en-US',
      'content-type': 'application/json',
    });
    expect(secondOptions.body).toBe('{}');
  });

  it('net.fetch drops content-type when a cross-origin redirect drops the body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', { status: 302, headers: { location: 'https://other.example.com/get' } })
      )
      .mockResolvedValueOnce(
        new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    await dispatchPluginCall(
      'demo',
      ALL,
      'net.fetch',
      [
        'https://api.example.com/start',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/plain' },
          body: '{}',
        },
      ],
      ['api.example.com', 'other.example.com']
    );

    const secondOptions = fetchMock.mock.calls[1][1] as {
      headers: Headers;
      method?: string;
      body?: unknown;
    };
    expect(Object.fromEntries(secondOptions.headers.entries())).toEqual({
      accept: 'text/plain',
    });
    expect(secondOptions.method).toBe('GET');
    expect(secondOptions.body).toBeUndefined();
  });

  it('net.fetch returns a capped response with only safe headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json', etag: 'abc', 'set-cookie': 'secret=1' },
        })
      )
    );
    await expect(
      dispatchPluginCall(
        'demo',
        ALL,
        'net.fetch',
        ['https://api.example.com/data'],
        ['api.example.com']
      )
    ).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'application/json', etag: 'abc' },
      bodyText: '{"ok":true}',
    });
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
