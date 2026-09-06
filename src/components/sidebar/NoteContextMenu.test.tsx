import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NoteFile } from '@/types';
import { NoteContextMenu } from './NoteContextMenu';

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
      expect(screen.queryByRole('button', { name: /Move to Folder/ })).not.toBeInTheDocument();
    }
  );

  it('offers a move for an unlocked standalone note', () => {
    const { current, onMoveToFolder } = menu();
    fireEvent.click(screen.getByRole('button', { name: /Move to Folder/ }));
    expect(onMoveToFolder).toHaveBeenCalledWith(current);
  });
});
