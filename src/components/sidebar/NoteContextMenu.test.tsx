import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteFile } from '@/types';
import { isMobilePlatform, isTabletPlatform } from '@/lib/platform';
import { useSettingsStore } from '@/stores';
import { save } from '@tauri-apps/plugin-dialog';
import { exportNoteAsPlaintext, exportSingleNote } from '@/lib';
import { NoteContextMenu } from './NoteContextMenu';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));

vi.mock('@/lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib')>()),
  exportSingleNote: vi.fn(),
  exportNoteAsPlaintext: vi.fn(),
}));

vi.mock('@/lib/platform', () => ({
  isMobilePlatform: vi.fn(() => false),
  isTabletPlatform: vi.fn(() => false),
}));

const note: NoteFile = {
  name: 'Example.md',
  path: 'notes/Example.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

function menu(overrides: Partial<NoteFile> = {}) {
  const onMoveToFolder = vi.fn();
  const onClose = vi.fn();
  const current = { ...note, ...overrides };
  render(
    <NoteContextMenu
      note={current}
      position={{ x: 20, y: 20 }}
      onOpenInNewTab={vi.fn()}
      onDuplicate={vi.fn()}
      onRename={vi.fn()}
      onLock={vi.fn()}
      onUnlock={vi.fn()}
      onPermanentUnlock={vi.fn()}
      onMoveToFolder={onMoveToFolder}
      onDelete={vi.fn()}
      onClose={onClose}
    />
  );
  return { current, onMoveToFolder };
}

describe('moving notes from the context menu', () => {
  it.each([{ isLocked: true }, { isDaily: true }, { isWeekly: true }])(
    'does not offer an unsupported move for %j',
    (flags) => {
      menu(flags);
      expect(screen.queryByRole('button', { name: /Move to folder/ })).not.toBeInTheDocument();
    }
  );

  it.each([{ isDaily: true }, { isWeekly: true }])(
    'does not offer a duplicate, which would be an undated copy, for %j',
    (flags) => {
      menu(flags);
      expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    }
  );

  it('offers a move for an unlocked standalone note', () => {
    const { current, onMoveToFolder } = menu();
    fireEvent.click(screen.getByRole('button', { name: /Move to folder/ }));
    expect(onMoveToFolder).toHaveBeenCalledWith(current);
  });
});

describe('menu wording', () => {
  afterEach(() => {
    vi.mocked(isMobilePlatform).mockReturnValue(false);
    vi.mocked(isTabletPlatform).mockReturnValue(false);
    useSettingsStore.setState({ indexMode: 'pinned' });
  });

  it('labels its actions in sentence case, like the other menus', () => {
    menu();
    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Lock note',
        'Open in new tab',
        'Rename…',
        'Export as plain text',
        'Move to folder…',
        'Delete note',
      ])
    );
  });

  it('offers no new tab on a phone, where the Index covers the tab bar', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    useSettingsStore.setState({ indexMode: 'overlay' });
    menu();
    expect(screen.queryByRole('button', { name: 'Open in new tab' })).not.toBeInTheDocument();
  });

  it('offers a new tab on an iPad whose Index sits beside the note and its tab bar', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    vi.mocked(isTabletPlatform).mockReturnValue(true);
    useSettingsStore.setState({ indexMode: 'pinned' });
    menu();
    expect(screen.getByRole('button', { name: 'Open in new tab' })).toBeInTheDocument();
  });

  it('offers no new tab on an iPad in a narrow Split View, where the Index is an overlay', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    vi.mocked(isTabletPlatform).mockReturnValue(true);
    useSettingsStore.setState({ indexMode: 'overlay' });
    menu();
    expect(screen.queryByRole('button', { name: 'Open in new tab' })).not.toBeInTheDocument();
  });
});

describe('exporting a note inside a folder', () => {
  const inFolder = { name: 'Plan.md', path: 'notes/Work/Plan.md', folderPath: 'Work' };

  it.each([
    ['Export as Markdown', exportSingleNote],
    ['Export as plain text', exportNoteAsPlaintext],
  ] as const)('%s addresses the note by its folder path', async (label, exporter) => {
    vi.mocked(save).mockResolvedValue('/tmp/out');
    menu(inFolder);
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(exporter).toHaveBeenCalled());
    expect(vi.mocked(exporter).mock.calls[0][0]).toBe('Work/Plan.md');
  });
});
