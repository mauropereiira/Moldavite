import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  dispatchPluginCall,
  PermissionDeniedError,
  setPluginAppVersion,
  getPluginAppVersion,
  getPluginApiVersion,
} from './api';

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
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
  });

  const ALL = ['editor', 'ui'];

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
    await expect(dispatchPluginCall('demo', ALL, 'ui.toast', [{ not: 'a string' }])).rejects.toThrow(
      /string/
    );
  });

  it('exposes app version + apiVersion via helpers', () => {
    setPluginAppVersion('1.5.0');
    expect(getPluginAppVersion()).toBe('1.5.0');
    expect(getPluginApiVersion()).toBe(1);
  });
});
