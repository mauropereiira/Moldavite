import { act, render, screen, waitFor, within } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteFile } from '@/types';

const safeInvoke = vi.hoisted(() => vi.fn());
const footerWidth = vi.hoisted(() => ({ current: 1200 as number | null }));
const platform = vi.hoisted(() => ({ mobile: false }));

vi.mock('@/lib/ipc', () => ({ safeInvoke: (...args: unknown[]) => safeInvoke(...args) }));
vi.mock('@/hooks/useElementWidth', () => ({ useElementWidth: () => footerWidth.current }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('./WordPressMenu', () => ({ WordPressMenu: () => <div data-testid="wordpress-menu" /> }));
vi.mock('@/lib/platform', () => ({
  isMobilePlatform: () => platform.mobile,
  isTabletPlatform: () => false,
}));
vi.mock('@/lib/autosaveFlush', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/autosaveFlush')>()),
  flushPendingAutosave: vi.fn().mockResolvedValue(undefined),
  getPendingAutosaveNoteId: () => null,
}));

import { save } from '@tauri-apps/plugin-dialog';
import { EditorFooter } from './EditorFooter';
import {
  useNoteColorsStore,
  useNoteStore,
  useQuickSwitcherStore,
  useSettingsStore,
} from '@/stores';

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

function renderFooter({ readOnly = false } = {}) {
  return render(
    <EditorFooter
      editor={null}
      readOnly={readOnly}
      onDelete={vi.fn()}
      onRenameNote={vi.fn().mockResolvedValue(undefined)}
    />
  );
}

beforeEach(() => {
  platform.mobile = false;
  footerWidth.current = 1200;
  useQuickSwitcherStore.setState({ pinnedNoteIds: [] });
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

    await user.click(screen.getByRole('button', { name: 'Change note background colour' }));
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

const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

describe('EditorFooter menus after an action', () => {
  // The folded Actions menu stayed open after a choice in one of its menus,
  // with the toast the action raised painted over it.
  it('closes the folded Actions menu once an action has run', async () => {
    footerWidth.current = 400;
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pin to the top bar' }));

    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the folded Actions menu once a colour is chosen', async () => {
    footerWidth.current = 400;
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('button', { name: 'Change note background colour' }));
    await user.click(screen.getByRole('button', { name: 'Honey' }));

    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
  });
});

describe('EditorFooter on a view-only note', () => {
  // A locked note opened with its password exists in plaintext only in
  // memory: nothing may rename, copy or export it.
  it('offers no editing, copying or exporting', async () => {
    const user = userEvent.setup();
    renderFooter({ readOnly: true });

    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(menuItems()).toEqual([
      'Pin to the top bar',
      'Copy URL to note',
      'Note info',
      'Delete note',
    ]);

    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(menuItems()).toEqual(['Copy wiki link']);
  });
});

describe('EditorFooter on a phone', () => {
  beforeEach(() => {
    platform.mobile = true;
  });

  it('leaves the desktop-only and duplicate items out of More', async () => {
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'More options' }));

    expect(menuItems()).toEqual([
      'Duplicate note',
      'Rename note…',
      'Export as Markdown',
      'Save as template',
      'Note info',
      'Delete note',
    ]);
  });

  it('shares the note through the system share sheet', async () => {
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(menuItems()).toEqual(['Share note…', 'Copy wiki link', 'Export as plain text']);
    await user.click(screen.getByRole('menuitem', { name: 'Share note…' }));

    await waitFor(() =>
      expect(safeInvoke).toHaveBeenCalledWith('share_mobile_note', {
        path: 'notes/Projects/plan.md',
      })
    );
  });

  it('keeps only Delete and Note info in More on a view-only note', async () => {
    const user = userEvent.setup();
    renderFooter({ readOnly: true });

    await user.click(screen.getByRole('button', { name: 'More options' }));

    expect(menuItems()).toEqual(['Note info', 'Delete note']);
  });
});

describe('EditorFooter note in a folder', () => {
  beforeEach(() => {
    safeInvoke.mockImplementation(async (command: string) => {
      if (command === 'read_note') return { content: 'Plan', color: null, contentHash: 'hash' };
      if (command === 'duplicate_note') return 'Projects/plan (copy).md';
      return undefined;
    });
  });

  it('exports it as Markdown by its path', async () => {
    vi.mocked(save).mockResolvedValueOnce('/tmp/plan.md');
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export as Markdown' }));

    await waitFor(() =>
      expect(safeInvoke).toHaveBeenCalledWith('export_single_note', {
        filename: 'Projects/plan.md',
        destination: '/tmp/plan.md',
        isDaily: false,
        isWeekly: false,
      })
    );
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'plan.md' }));
  });

  it('exports it as plain text by its path', async () => {
    vi.mocked(save).mockResolvedValueOnce('/tmp/plan.txt');
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export as plain text' }));

    await waitFor(() =>
      expect(safeInvoke).toHaveBeenCalledWith(
        'read_note',
        expect.objectContaining({ filename: 'Projects/plan.md' })
      )
    );
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'plan.txt' }));
  });

  it('duplicates it beside the original, as the Index does', async () => {
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate note' }));

    await waitFor(() =>
      expect(safeInvoke).toHaveBeenCalledWith('duplicate_note', {
        filename: 'Projects/plan.md',
        isDaily: false,
        isWeekly: false,
      })
    );
    await waitFor(() =>
      expect(useNoteStore.getState().notes.map((n) => n.path)).toContain(
        'notes/Projects/plan (copy).md'
      )
    );
    expect(safeInvoke).not.toHaveBeenCalledWith('create_note', expect.anything());
  });
});

describe('EditorFooter wiki link', () => {
  it('copies a complete wiki link to the note', async () => {
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy wiki link' }));

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('[[plan]]'));
  });

  it('targets the file when the title differs from it', async () => {
    useNoteStore.setState({ currentNote: { ...note, title: 'Q3 plan' } });
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy wiki link' }));

    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe('[[Q3 plan|plan]]')
    );
  });
});

describe('EditorFooter publishing', () => {
  it('offers WordPress publishing on an ordinary note', () => {
    renderFooter();
    expect(screen.getByTestId('wordpress-menu')).toBeInTheDocument();
  });

  it('does not offer WordPress publishing on a view-only note', () => {
    renderFooter({ readOnly: true });
    expect(screen.queryByTestId('wordpress-menu')).toBeNull();
  });
});

describe('EditorFooter word count', () => {
  it('follows the editor content', () => {
    useSettingsStore.setState({ showWordCount: true });
    const editor = new Editor({ extensions: [StarterKit], content: '<p>one two</p>' });
    const { unmount } = render(
      <EditorFooter
        editor={editor}
        onDelete={vi.fn()}
        onRenameNote={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(screen.getByText('2 words')).toBeInTheDocument();

    act(() => {
      editor.commands.setContent('<p>one two three four five</p>');
    });

    expect(screen.getByText('5 words')).toBeInTheDocument();
    unmount();
    editor.destroy();
    useSettingsStore.setState({ showWordCount: false });
  });

  it('counts a replacement editor once the old one is destroyed', () => {
    useSettingsStore.setState({ showWordCount: true });
    const props = {
      onDelete: vi.fn(),
      onRenameNote: vi.fn().mockResolvedValue(undefined),
    };
    const first = new Editor({ extensions: [StarterKit], content: '<p>one two</p>' });
    const { rerender, unmount } = render(<EditorFooter editor={first} {...props} />);
    const second = new Editor({ extensions: [StarterKit], content: '<p>one two three</p>' });
    first.destroy();

    rerender(<EditorFooter editor={second} {...props} />);

    expect(screen.getByText('3 words')).toBeInTheDocument();
    unmount();
    second.destroy();
    useSettingsStore.setState({ showWordCount: false });
  });
});

describe('EditorFooter on a file outside the Forge', () => {
  const looseNote: Note = {
    id: 'loose:0123456789abcdef0123456789abcdef',
    title: 'Read me.md',
    content: '<p>Outside</p>',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    isDaily: false,
    isWeekly: false,
    loose: {
      looseId: '0123456789abcdef0123456789abcdef',
      name: 'Read me.md',
      dir: '~/Desktop',
      readOnly: false,
    },
  };

  beforeEach(() => {
    useNoteStore.setState({ notes: [file], currentNote: looseNote, openTabs: [looseNote] });
  });

  it('offers only what works on the file itself, and says it is not in the Forge', async () => {
    const user = userEvent.setup();
    renderFooter();

    expect(screen.getByText('Not in Forge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change note background colour' })).toBeNull();
    expect(screen.queryByTestId('wordpress-menu')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(menuItems()).toEqual([
      expect.stringMatching(/^Show in (Finder|Explorer|folder)$/),
      'Add to Forge',
      'Save a copy…',
      'Export as PDF…',
    ]);

    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(menuItems()).toEqual(['Export as plain text']);
  });

  it('reveals the file by its session id', async () => {
    const user = userEvent.setup();
    renderFooter();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: /^Show in / }));

    expect(safeInvoke).toHaveBeenCalledWith('reveal_loose_file', {
      id: '0123456789abcdef0123456789abcdef',
    });
  });
});
