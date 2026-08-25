import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { FolderInfo, NoteFile } from '@/types';
import { DraggableNoteItem } from './DraggableNoteItem';
import { FolderItem } from './FolderItem';

const sourceNote: NoteFile = {
  name: 'Source.md',
  path: 'notes/Inbox/Source.md',
  folderPath: 'Inbox',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

function createDataTransfer(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const types = [...data.keys()];
  return {
    data,
    types,
    dropEffect: 'none',
    effectAllowed: '',
    setData(type: string, value: string) {
      data.set(type, value);
      if (!types.includes(type)) types.push(type);
    },
    getData(type: string) {
      return data.get(type) ?? '';
    },
  };
}

function folderRow(name: string): HTMLElement {
  return screen.getByText(name).closest('.folder-row') as HTMLElement;
}

function folderItem(folder: FolderInfo, onNoteDrop: (path: string) => Promise<void>) {
  return (
    <FolderItem
      folder={folder}
      level={0}
      isExpanded={false}
      onToggle={vi.fn()}
      onContextMenu={vi.fn()}
      onNoteDrop={onNoteDrop}
      onFolderDrop={vi.fn()}
      notes={[]}
      isNoteActive={() => false}
      onNoteClick={vi.fn()}
      onNoteContextMenu={vi.fn()}
    />
  );
}

function renderDragTarget({
  folder = { name: 'Projects', path: 'Projects', children: [] },
  onNoteDrop = vi.fn().mockResolvedValue(undefined),
  renderChildren,
}: {
  folder?: FolderInfo;
  onNoteDrop?: (path: string) => Promise<void>;
  renderChildren?: ReactNode;
} = {}) {
  const view = render(
    <>
      <DraggableNoteItem
        note={sourceNote}
        isActive={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />
      <FolderItem
        folder={folder}
        level={0}
        isExpanded={renderChildren !== undefined}
        onToggle={vi.fn()}
        onContextMenu={vi.fn()}
        onNoteDrop={onNoteDrop}
        onFolderDrop={vi.fn()}
        notes={[]}
        isNoteActive={() => false}
        onNoteClick={vi.fn()}
        onNoteContextMenu={vi.fn()}
        renderChildren={renderChildren}
      />
    </>
  );

  const source = screen.getByRole('button', { name: 'Source' }).parentElement as HTMLElement;
  const dataTransfer = createDataTransfer();
  fireEvent.dragStart(source, { dataTransfer });
  return { ...view, dataTransfer, onNoteDrop, source };
}

describe('FolderItem note drag feedback', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('marks only the direct valid destination, not its ancestor', () => {
    const child = { name: 'Archive', path: 'Projects/Archive', children: [] };
    const parent = { name: 'Projects', path: 'Projects', children: [child] };
    const onNoteDrop = vi.fn().mockResolvedValue(undefined);
    const childItem = folderItem(child, onNoteDrop);
    const { dataTransfer, source } = renderDragTarget({
      folder: parent,
      onNoteDrop,
      renderChildren: childItem,
    });

    fireEvent.dragEnter(folderRow('Archive'), { dataTransfer });

    expect(folderRow('Archive')).toHaveClass('folder-row-note-drop-target');
    expect(folderRow('Projects')).not.toHaveClass('folder-row-note-drop-target');
    fireEvent.dragLeave(folderRow('Archive'), { dataTransfer, relatedTarget: document.body });
    expect(folderRow('Archive')).not.toHaveClass('folder-row-note-drop-target');
    fireEvent.dragEnd(source, { dataTransfer });
  });

  it('does not mark or accept same-folder and plain-text drags', () => {
    const onNoteDrop = vi.fn().mockResolvedValue(undefined);
    const sameFolder = { name: 'Inbox', path: 'Inbox', children: [] };
    const { dataTransfer, source } = renderDragTarget({ folder: sameFolder, onNoteDrop });
    const row = folderRow('Inbox');

    fireEvent.dragEnter(row, { dataTransfer });
    fireEvent.dragOver(row, { dataTransfer });
    expect(row).not.toHaveClass('folder-row-note-drop-target');
    expect(dataTransfer.dropEffect).toBe('none');
    fireEvent.drop(row, { dataTransfer });

    const plainText = createDataTransfer({ 'text/plain': 'Elsewhere.md' });
    fireEvent.dragEnter(row, { dataTransfer: plainText });
    fireEvent.drop(row, { dataTransfer: plainText });
    expect(row).not.toHaveClass('folder-row-note-drop-target');
    expect(onNoteDrop).not.toHaveBeenCalled();
    fireEvent.dragEnd(source, { dataTransfer });
  });

  it('shows impact only after the move promise resolves, then cleans it up', async () => {
    let resolveMove!: () => void;
    const move = new Promise<void>((resolve) => {
      resolveMove = resolve;
    });
    const onNoteDrop = vi.fn(() => move);
    const view = renderDragTarget({ onNoteDrop });
    const row = folderRow('Projects');

    fireEvent.drop(row, { dataTransfer: view.dataTransfer });
    expect(onNoteDrop).toHaveBeenCalledWith('Inbox/Source.md');
    expect(view.container.querySelector('.folder-note-drop-impact')).not.toBeInTheDocument();

    await act(async () => resolveMove());
    const impact = await waitFor(() => {
      const element = view.container.querySelector('.folder-note-drop-impact');
      expect(element).toBeInTheDocument();
      return element as HTMLElement;
    });

    fireEvent.animationEnd(impact);
    await waitFor(() =>
      expect(view.container.querySelector('.folder-note-drop-impact')).not.toBeInTheDocument()
    );
  });

  it('does not show impact when the move rejects', async () => {
    const onNoteDrop = vi.fn(() => Promise.reject(new Error('move failed')));
    const view = renderDragTarget({ onNoteDrop });

    await act(async () => {
      fireEvent.drop(folderRow('Projects'), { dataTransfer: view.dataTransfer });
      await Promise.resolve();
    });

    expect(onNoteDrop).toHaveBeenCalledOnce();
    expect(view.container.querySelector('.folder-note-drop-impact')).not.toBeInTheDocument();
  });

  it('skips impact when reduced motion is preferred', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
    const onNoteDrop = vi.fn().mockResolvedValue(undefined);
    const view = renderDragTarget({ onNoteDrop });

    await act(async () => {
      fireEvent.drop(folderRow('Projects'), { dataTransfer: view.dataTransfer });
      await Promise.resolve();
    });

    expect(onNoteDrop).toHaveBeenCalledOnce();
    expect(view.container.querySelector('.folder-note-drop-impact')).not.toBeInTheDocument();
  });

  it('contains a nested folder dropped onto itself', () => {
    const rootDrop = vi.fn();
    const child = { name: 'Archive', path: 'Projects/Archive', children: [] };
    render(
      <div onDrop={rootDrop}>
        <FolderItem
          folder={child}
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
      </div>
    );
    const dataTransfer = createDataTransfer({
      'application/x-folder-path': child.path,
      'text/plain': child.path,
    });

    fireEvent.drop(folderRow('Archive'), { dataTransfer });

    expect(rootDrop).not.toHaveBeenCalled();
  });

  it('contains a rejected nested folder move', async () => {
    const onFolderDrop = vi.fn().mockRejectedValue(new Error('move failed'));
    const folder = { name: 'Projects', path: 'Projects', children: [] };
    render(
      <FolderItem
        folder={folder}
        level={0}
        isExpanded={false}
        onToggle={vi.fn()}
        onContextMenu={vi.fn()}
        onNoteDrop={vi.fn()}
        onFolderDrop={onFolderDrop}
        notes={[]}
        isNoteActive={() => false}
        onNoteClick={vi.fn()}
        onNoteContextMenu={vi.fn()}
      />
    );
    const dataTransfer = createDataTransfer({
      'application/x-folder-path': 'Archive',
      'text/plain': 'Archive',
    });

    await act(async () => fireEvent.drop(folderRow('Projects'), { dataTransfer }));

    expect(onFolderDrop).toHaveBeenCalledWith('Archive');
  });
});
