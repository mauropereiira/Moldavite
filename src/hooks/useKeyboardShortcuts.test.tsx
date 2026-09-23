import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteStore } from '@/stores/noteStore';

const invokeMock = vi.fn();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useKeyboardShortcuts } from './useKeyboardShortcuts';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'read_note') {
      return { content: '', color: null, contentHash: 'h' };
    }
    return undefined;
  });
  useNoteStore.setState({ notes: [], currentNote: null, openTabs: [], activeTabId: null });
});

describe('useKeyboardShortcuts template creation', () => {
  it('addresses a template note created with no note open by its notes/ path', async () => {
    const hook = renderHook(() => useKeyboardShortcuts({ editor: null }));

    await act(() => hook.result.current.handleTemplateSelect('template-1'));

    const all = useNoteStore.getState().notes;
    const created = all[all.length - 1];
    expect(created).toBeDefined();
    // Standalone notes are addressed by their notes/-relative path everywhere
    // else (useNotes.createNote, listNotes, the Forge watcher). A bare filename
    // leaves the open tab unmatchable by external-change reconciliation.
    expect(created?.path).toBe(`notes/${created?.name}`);
    expect(useNoteStore.getState().currentNote?.id).toBe(`notes/${created?.name}`);
  });
});

describe('useKeyboardShortcuts on a view-only note', () => {
  const lockedNote = {
    id: 'notes/Diary.md',
    title: 'Diary',
    content: '<p>secret</p>',
    isDaily: false,
    isWeekly: false,
  };

  function viewOnlyEditor() {
    return {
      isEditable: false,
      commands: { setContent: vi.fn() },
    } as unknown as Parameters<typeof useKeyboardShortcuts>[0]['editor'];
  }

  function press(key: string) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true }));
    });
  }

  beforeEach(() => {
    useNoteStore.setState({
      currentNote: lockedNote as never,
      unlockedNotes: new Set([lockedNote.id]),
    });
  });

  it('opens no template picker and applies no template', async () => {
    const editor = viewOnlyEditor();
    const hook = renderHook(() => useKeyboardShortcuts({ editor }));

    press('t');
    expect(hook.result.current.showTemplatePicker).toBe(false);

    await act(() => hook.result.current.handleTemplateSelect('template-1'));
    expect(editor?.commands.setContent).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('does not open the link dialog', () => {
    const onInsertLink = vi.fn();
    renderHook(() => useKeyboardShortcuts({ editor: viewOnlyEditor(), onInsertLink }));

    press('k');
    expect(onInsertLink).not.toHaveBeenCalled();
  });
});
