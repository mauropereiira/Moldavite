import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import process from 'node:process';
import { invoke } from '@tauri-apps/api/core';
import { useFolderStore, useNoteColorsStore, useNoteStore, useSettingsStore } from '@/stores';
import { useToastStore } from '@/stores/toastStore';
import type { FolderInfo, NoteFile } from '@/types';
import { Sidebar } from './Sidebar';

vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  isMobilePlatform: () => false,
  isTabletPlatform: () => false,
}));

const folder: FolderInfo = { name: 'Projects', path: 'Projects', children: [] };
const failing = new Set(['create_folder', 'rename_folder', 'trash_folder']);

function unhandledRejections() {
  let count = 0;
  const record = () => {
    count += 1;
  };
  process.on('unhandledRejection', record);
  return {
    count: () => count,
    stop: () => process.off('unhandledRejection', record),
  };
}

async function respondToCommand(command: string): Promise<unknown> {
  if (failing.has(command)) throw 'Folder operation refused';
  if (command === 'list_folders') return [folder];
  if (command === 'cleanup_old_trash') return [];
  if (command.startsWith('list_') || command === 'get_all_tags') return [];
  return undefined;
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

beforeEach(() => {
  vi.mocked(invoke).mockImplementation(respondToCommand);
  useFolderStore.setState({
    folders: [folder],
    sectionsCollapsed: {
      notes: false,
      folders: false,
      daily: true,
      tags: false,
      backlinks: false,
    },
  });
  useSettingsStore.setState({ showFoldersSection: true });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

function lastToast() {
  const toasts = useToastStore.getState().toasts;
  return toasts[toasts.length - 1];
}

describe('folder modals when the backend refuses', () => {
  it('reports a failed create without an unhandled rejection', async () => {
    const rejections = unhandledRejections();
    render(<Sidebar />);
    fireEvent.click(screen.getAllByTitle('New folder')[0]);
    fireEvent.change(screen.getByPlaceholderText('Folder name...'), {
      target: { value: 'Ideas' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(lastToast()).toMatchObject({ type: 'error' }));
    await settle();
    rejections.stop();
    expect(rejections.count()).toBe(0);
  });

  it('reports a failed rename without an unhandled rejection', async () => {
    const rejections = unhandledRejections();
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByText('Projects'));
    fireEvent.click(screen.getByRole('button', { name: /Rename/ }));
    fireEvent.change(screen.getByPlaceholderText('Folder name...'), {
      target: { value: 'Archive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(lastToast()).toMatchObject({ type: 'error' }));
    await settle();
    rejections.stop();
    expect(rejections.count()).toBe(0);
  });

  it('closes the delete confirmation after a failed delete', async () => {
    const rejections = unhandledRejections();
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByText('Projects'));
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(lastToast()).toMatchObject({ type: 'error' }));
    await settle();
    rejections.stop();
    expect(rejections.count()).toBe(0);
    expect(screen.queryByText(/and all its contents/)).not.toBeInTheDocument();
  });
});

describe('duplicating a note', () => {
  it('shows the copy in the colour of the note it was made from', async () => {
    const note: NoteFile = {
      name: 'Plan.md',
      path: 'notes/Plan.md',
      isDaily: false,
      isWeekly: false,
      isLocked: false,
    };
    const colors: Record<string, string> = { 'notes/Plan.md': 'cosmos' };
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'duplicate_note') {
        colors['notes/Plan (copy).md'] = 'cosmos';
        return 'Plan (copy).md';
      }
      if (command === 'get_all_note_colors') return { ...colors };
      if (command === 'read_note') return '# Plan';
      return respondToCommand(command);
    });
    useNoteStore.setState({ notes: [note] });
    useNoteColorsStore.setState({ colors: { ...colors }, isLoading: false });
    render(<Sidebar />);

    fireEvent.contextMenu(screen.getByText('Plan'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

    await waitFor(() => expect(lastToast()).toMatchObject({ message: 'Note duplicated' }));
    expect(useNoteColorsStore.getState().colors['notes/Plan (copy).md']).toBe('cosmos');
  });
});

describe('the search shortcut on a Mac', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('focuses search on ⌘F only, leaving ⌘K to Insert link and Ctrl to the text', async () => {
    render(<Sidebar />);
    const search = screen.getByPlaceholderText(/Search notes/i);

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(search).not.toHaveFocus();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(search).not.toHaveFocus();
    fireEvent.keyDown(window, { key: 'f', metaKey: true, altKey: true });
    expect(search).not.toHaveFocus();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(search).toHaveFocus();
  });
});
