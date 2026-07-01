import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPluginAPI } from './api';
import { usePluginCommandStore } from '@/stores/pluginCommandStore';

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock('@/stores/noteStore', () => ({
  useNoteStore: { getState: () => ({ currentNote: { title: 'N', content: '<p>hi there</p>' } }) },
}));
const insertTextAtCursor = vi.fn((_t: string) => true);
vi.mock('@/stores/editorHandleStore', () => ({
  editorHandle: { insertTextAtCursor: (t: string) => insertTextAtCursor(t) },
}));

describe('buildPluginAPI', () => {
  beforeEach(() => {
    usePluginCommandStore.getState().clear();
    addToast.mockClear();
    insertTextAtCursor.mockClear();
    insertTextAtCursor.mockReturnValue(true);
  });

  it('namespaces command ids by plugin', () => {
    buildPluginAPI('demo').commands.add({ id: 'insert', label: 'Insert', handler: () => {} });
    expect(usePluginCommandStore.getState().commands[0].id).toBe('demo:insert');
  });

  it('exposes version + apiVersion', () => {
    const api = buildPluginAPI('demo');
    expect(api.app.apiVersion).toBe(1);
    expect(typeof api.app.version).toBe('string');
  });

  it('getActiveNote returns title + content', () => {
    expect(buildPluginAPI('demo').editor.getActiveNote()).toEqual({
      title: 'N',
      content: '<p>hi there</p>',
    });
  });

  it('insertText routes to the editor handle', () => {
    buildPluginAPI('demo').editor.insertText('x');
    expect(insertTextAtCursor).toHaveBeenCalledWith('x');
  });

  it('insertText toasts an error when no editor is available', () => {
    insertTextAtCursor.mockReturnValueOnce(false);
    buildPluginAPI('demo').editor.insertText('x');
    expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('No active editor'));
  });

  it('toast maps info to success', () => {
    buildPluginAPI('demo').ui.toast('hey', 'info');
    expect(addToast).toHaveBeenCalledWith('success', 'hey');
  });
});
