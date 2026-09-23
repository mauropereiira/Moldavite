import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteFile } from '@/types';

const safeInvoke = vi.hoisted(() => vi.fn());
const footerWidth = vi.hoisted(() => ({ current: 1200 as number | null }));

vi.mock('@/lib/ipc', () => ({ safeInvoke: (...args: unknown[]) => safeInvoke(...args) }));
vi.mock('@/hooks/useElementWidth', () => ({ useElementWidth: () => footerWidth.current }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('./WordPressMenu', () => ({ WordPressMenu: () => null }));

import { EditorFooter } from './EditorFooter';
import { useNoteColorsStore, useNoteStore } from '@/stores';

const file: NoteFile = {
  name: 'plan.md',
  path: 'notes/Projects/plan.md',
  folderPath: 'Projects',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};
const note: Note = {
  id: file.path,
  title: 'plan',
  content: '<p>Plan</p>',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
};

function renderFooter() {
  return render(
    <EditorFooter
      editor={null}
      onDelete={vi.fn()}
      isSaving={false}
      showSaveSuccess={false}
      onRenameNote={vi.fn().mockResolvedValue(undefined)}
    />
  );
}

beforeEach(() => {
  footerWidth.current = 1200;
  safeInvoke.mockReset().mockResolvedValue(undefined);
  useNoteColorsStore.setState({ colors: {} });
  useNoteStore.setState({ notes: [file], currentNote: note, openTabs: [note] });
});

describe('EditorFooter colour', () => {
  // Colours are keyed by the note's Forge-relative path. The footer used to
  // prefix it a second time ("notes/notes/..."), so the backend answered
  // "Note not found" and the swatch silently reverted.
  it('writes the colour to the note it belongs to', async () => {
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'Change note background color' }));
    await user.click(screen.getByRole('button', { name: 'Honey' }));

    expect(safeInvoke).toHaveBeenCalledWith('set_note_color', {
      notePath: 'notes/Projects/plan.md',
      colorId: 'honey',
    });
    expect(useNoteColorsStore.getState().colors).toEqual({ 'notes/Projects/plan.md': 'honey' });
  });
});

describe('EditorFooter folded Actions menu', () => {
  // The folded Actions menu keeps its entry transform, which made it the
  // containing block of the fixed dialogs opened from inside it.
  it('opens Rename outside the menu and keeps it open while it is used', async () => {
    footerWidth.current = 400;
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename note…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Rename note' });
    expect(document.querySelector('.editor-footer')?.contains(dialog)).toBe(false);

    const input = within(dialog).getByRole('textbox', { name: 'Note title' });
    await user.click(input);
    await user.type(input, ' two');

    expect(screen.getByRole('dialog', { name: 'Rename note' })).toBeInTheDocument();
    expect(input).toHaveValue('plan two');
  });

  it('still closes the menu on a press outside it', async () => {
    footerWidth.current = 400;
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
    await user.click(document.body);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'More options' })).toBeNull());
  });
});
