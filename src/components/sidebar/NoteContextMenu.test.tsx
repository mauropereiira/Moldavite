import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteFile } from '@/types';
import { isMobilePlatform } from '@/lib/platform';
import { NoteContextMenu } from './NoteContextMenu';

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => false) }));

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

  it('offers a move for an unlocked standalone note', () => {
    const { current, onMoveToFolder } = menu();
    fireEvent.click(screen.getByRole('button', { name: /Move to folder/ }));
    expect(onMoveToFolder).toHaveBeenCalledWith(current);
  });
});

describe('menu wording', () => {
  afterEach(() => {
    vi.mocked(isMobilePlatform).mockReturnValue(false);
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

  it('offers no new tab on a phone, which has no tab bar', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    menu();
    expect(screen.queryByRole('button', { name: 'Open in new tab' })).not.toBeInTheDocument();
  });
});
