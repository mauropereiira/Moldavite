import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FolderInfo, TrashedNote } from '@/types';
import { FolderItem } from './FolderItem';
import { MoveToFolderModal } from './MoveToFolderModal';
import { TrashPopover } from './TrashPopover';

const folder: FolderInfo = {
  name: 'Projects',
  path: 'Projects',
  children: [{ name: 'Archive', path: 'Projects/Archive', children: [] }],
};

const trashedNote: TrashedNote = {
  id: 'trash-1',
  filename: 'Deleted.md',
  originalPath: 'notes/Deleted.md',
  isDaily: false,
  isWeekly: false,
  isFolder: false,
  containedFiles: [],
  trashedAt: 0,
  daysRemaining: 7,
};

describe('nested row actions', () => {
  it('opens Folder options with Enter without toggling the folder row', () => {
    const onToggle = vi.fn();
    const onContextMenu = vi.fn();
    render(
      <FolderItem
        folder={folder}
        level={0}
        isExpanded={false}
        onToggle={onToggle}
        onContextMenu={onContextMenu}
        onNoteDrop={vi.fn()}
        onFolderDrop={vi.fn()}
        notes={[]}
        isNoteActive={() => false}
        onNoteClick={vi.fn()}
        onNoteContextMenu={vi.fn()}
      />
    );

    const options = screen.getByRole('button', { name: 'Folder options' });
    fireEvent.keyDown(options, { key: 'Enter' });
    fireEvent.click(options);

    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('expands a Move destination with Enter without selecting it', () => {
    render(
      <MoveToFolderModal
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
        folders={[folder]}
        noteFilename="Note.md"
      />
    );
    expect(screen.getByRole('dialog', { name: 'Move Note' })).toHaveAttribute('aria-modal', 'true');

    const expand = screen.getByRole('button', { name: 'Expand Projects' });
    const destination = expand.closest('[role="button"]');
    expect(destination).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(expand, { key: 'Enter' });
    fireEvent.click(expand);

    expect(screen.getByText('Archive')).toBeInTheDocument();
    expect(destination).toHaveAttribute('aria-pressed', 'false');
  });

  it('restores with Enter without opening the trash preview', async () => {
    const onRestore = vi.fn();
    const onPreview = vi.fn();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    render(
      <TrashPopover
        isOpen
        anchor={anchor}
        trashedNotes={[trashedNote]}
        onClose={vi.fn()}
        onRestore={onRestore}
        onPermanentDelete={vi.fn()}
        onEmptyTrash={vi.fn()}
        onPreview={onPreview}
      />
    );

    const restore = await screen.findByRole('button', { name: 'Restore' });
    fireEvent.keyDown(restore, { key: 'Enter' });
    fireEvent.click(restore);

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(trashedNote.id));
    expect(onPreview).not.toHaveBeenCalled();
    anchor.remove();
  });

  it('reveals sidebar Options controls when they receive keyboard focus', () => {
    render(
      <FolderItem
        folder={folder}
        level={0}
        isExpanded={false}
        onToggle={vi.fn()}
        onContextMenu={vi.fn()}
        onNoteDrop={vi.fn()}
        onFolderDrop={vi.fn()}
        notes={[]}
        isNoteActive={() => false}
        onNoteClick={vi.fn()}
        onNoteContextMenu={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Folder options' })).toHaveClass(
      'focus-visible:opacity-100'
    );
  });
});
