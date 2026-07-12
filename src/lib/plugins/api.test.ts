import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  dispatchPluginCall,
  PermissionDeniedError,
  setPluginAppVersion,
  getPluginAppVersion,
  getPluginApiVersion,
} from './api';

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
  useNoteStore: { getState: () => ({ currentNote: { title: 'N', content: '<p>hi there</p>' } }) },
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
    vi.unstubAllGlobals();
  });

  const ALL = ['editor', 'ui', 'notes.read', 'net.fetch', 'secrets'];

  it('editor.getActiveNote returns title + content when editor is permitted', async () => {
    const v = await dispatchPluginCall('demo', ALL, 'editor.getActiveNote', []);
    expect(v).toEqual({ title: 'N', content: '<p>hi there</p>' });
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
