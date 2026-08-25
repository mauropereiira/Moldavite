import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSidebarDnd } from './useSidebarDnd';
import { DraggableNoteItem } from '@/components/sidebar/DraggableNoteItem';
import { FolderItem } from '@/components/sidebar/FolderItem';
import type { FolderInfo, NoteFile } from '@/types';

function dropEvent(data: Record<string, string>) {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types: Object.keys(data),
      dropEffect: 'none',
      getData: (type: string) => data[type] ?? '',
    },
  } as unknown as React.DragEvent;
}

describe('useSidebarDnd', () => {
  it('ignores external plain text dropped on the Notes root', async () => {
    const moveNoteToFolder = vi.fn();
    const { result } = renderHook(() =>
      useSidebarDnd({ moveNoteToFolder, moveFolderToFolder: vi.fn() })
    );
    const event = dropEvent({ 'text/plain': 'Projects/real-note.md' });

    await act(() => result.current.onRootDrop(event));

    expect(moveNoteToFolder).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores a forged note MIME payload without a live sidebar drag', async () => {
    const moveNoteToFolder = vi.fn();
    const { result } = renderHook(() =>
      useSidebarDnd({ moveNoteToFolder, moveFolderToFolder: vi.fn() })
    );
    const event = dropEvent({ 'application/x-note-path': 'Projects/note.md' });

    await act(() => result.current.onRootDrop(event));

    expect(moveNoteToFolder).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('moves only a live internal nested note and contains a handled rejection', async () => {
    const moveNoteToFolder = vi.fn().mockRejectedValue(new Error('move failed'));
    const { result } = renderHook(() =>
      useSidebarDnd({ moveNoteToFolder, moveFolderToFolder: vi.fn() })
    );
    const note: NoteFile = {
      name: 'note.md',
      path: 'notes/Projects/note.md',
      folderPath: 'Projects',
      isDaily: false,
      isWeekly: false,
      isLocked: false,
    };
    render(
      <DraggableNoteItem note={note} isActive={false} onClick={vi.fn()} onContextMenu={vi.fn()} />
    );
    const dragData = new Map<string, string>();
    const sourceTransfer = {
      types: [] as string[],
      effectAllowed: '',
      setData(type: string, value: string) {
        dragData.set(type, value);
        if (!this.types.includes(type)) this.types.push(type);
      },
      getData: (type: string) => dragData.get(type) ?? '',
    };
    const source = screen.getByRole('button', { name: 'note' }).parentElement as HTMLElement;
    fireEvent.dragStart(source, { dataTransfer: sourceTransfer });
    const event = dropEvent(Object.fromEntries(dragData));

    await act(() => result.current.onRootDrop(event));

    expect(moveNoteToFolder).toHaveBeenCalledWith('Projects/note.md', undefined);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    fireEvent.dragEnd(source, { dataTransfer: sourceTransfer });
  });

  it('ignores a forged folder MIME payload at the folders root', async () => {
    const moveFolderToFolder = vi.fn();
    const { result } = renderHook(() =>
      useSidebarDnd({ moveNoteToFolder: vi.fn(), moveFolderToFolder })
    );
    const event = dropEvent({ 'application/x-folder-path': 'Projects/Archive' });

    await act(() => result.current.onFoldersRootDrop(event));

    expect(moveFolderToFolder).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('moves a live nested folder to the folders root', async () => {
    const moveFolderToFolder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSidebarDnd({ moveNoteToFolder: vi.fn(), moveFolderToFolder })
    );
    const folder: FolderInfo = { name: 'Archive', path: 'Projects/Archive', children: [] };
    render(
      <FolderItem
        folder={folder}
        level={1}
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
    const dragData = new Map<string, string>();
    const sourceTransfer = {
      types: [] as string[],
      effectAllowed: '',
      setData(type: string, value: string) {
        dragData.set(type, value);
        if (!this.types.includes(type)) this.types.push(type);
      },
      getData: (type: string) => dragData.get(type) ?? '',
    };
    const source = screen.getByText('Archive').closest('.folder-row') as HTMLElement;
    fireEvent.dragStart(source, { dataTransfer: sourceTransfer });
    const event = dropEvent(Object.fromEntries(dragData));

    await act(() => result.current.onFoldersRootDrop(event));

    expect(moveFolderToFolder).toHaveBeenCalledWith(folder.path, undefined);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    fireEvent.dragEnd(source, { dataTransfer: sourceTransfer });
  });
});
