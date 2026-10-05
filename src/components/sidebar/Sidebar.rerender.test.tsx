import { Profiler } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useFolderStore, useNoteStore, useSettingsStore } from '@/stores';
import type { FolderInfo, Note, NoteFile } from '@/types';
import { Sidebar } from './Sidebar';

vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  isMobilePlatform: () => false,
  isTabletPlatform: () => false,
}));

const folder: FolderInfo = { name: 'Projects', path: 'Projects', children: [] };

const noteFile = (name: string, folderPath?: string): NoteFile => ({
  name: `${name}.md`,
  path: `notes/${folderPath ? `${folderPath}/` : ''}${name}.md`,
  isDaily: false,
  isWeekly: false,
  isLocked: false,
  folderPath,
});

const notes = [
  noteFile('Note 10'),
  noteFile('Note 2'),
  noteFile('Plan 10', 'Projects'),
  noteFile('Plan 2', 'Projects'),
];

const openNote: Note = {
  id: 'notes/Note 2.md',
  title: 'Note 2',
  content: '<p>x</p>',
  isDaily: false,
  isWeekly: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

beforeEach(() => {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'list_folders') return [folder];
    if (command.startsWith('list_') || command === 'cleanup_old_trash') return [];
    return undefined;
  });
  useSettingsStore.setState({
    showFoldersSection: true,
    tagsEnabled: false,
    sortOption: 'name-asc',
  });
  useFolderStore.setState({
    folders: [folder],
    expandedFolders: ['Projects'],
    sectionsCollapsed: { notes: false, folders: false, daily: true, tags: true, backlinks: true },
  });
  useNoteStore.setState({ openTabs: [], activeTabId: null, currentNote: null });
  act(() => {
    useNoteStore.getState().setNotes(notes);
    useNoteStore.getState().openTab(openNote);
  });
});

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe('Sidebar re-renders', () => {
  it('skips content-only edits but follows note-list changes', async () => {
    let commits = 0;
    render(
      <Profiler id="sidebar" onRender={() => (commits += 1)}>
        <Sidebar />
      </Profiler>
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    const before = commits;
    act(() => {
      for (let i = 0; i < 10; i++) {
        useNoteStore.getState().updateNoteContent(`<p>x${i}</p>`, openNote.id);
      }
    });
    expect(commits).toBe(before);

    act(() => {
      useNoteStore.getState().markNoteSaved(openNote.id, '<p>x9</p>');
    });
    expect(commits).toBeGreaterThan(before);
  });

  it('lists unfiled and folder notes in title order', async () => {
    render(<Sidebar />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    const shown = screen.getAllByText(/^(Note|Plan) \d+$/).map((element) => element.textContent);
    expect(shown).toEqual(['Note 2', 'Note 10', 'Plan 2', 'Plan 10']);
  });
});
