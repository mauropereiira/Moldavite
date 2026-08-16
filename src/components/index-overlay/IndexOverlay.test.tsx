import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderInfo, NoteFile } from '@/types';
import {
  useFolderStore,
  useNoteStore,
  useOverlayStore,
  useSettingsStore,
  useTagStore,
} from '@/stores';
import { ChromeShortcutHost } from '@/components/ChromeShortcutHost';
import { EditorNavigation } from '@/components/layout/EditorNavigation';
import { IndexOverlay } from './IndexOverlay';

const ipc = vi.hoisted(() => ({
  notesAvailable: true,
  notes: [] as NoteFile[],
  folders: [] as FolderInfo[],
  noteContent: new Map<string, string>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case 'list_folders':
        return ipc.folders;
      case 'list_notes':
        return ipc.notesAvailable ? ipc.notes : undefined;
      case 'list_forges':
        return [];
      case 'list_trash':
        return [];
      case 'cleanup_old_trash':
        return 0;
      case 'read_note': {
        const filename = String(args?.filename ?? '');
        return {
          content: ipc.noteContent.get(filename) ?? '',
          color: null,
          contentHash: `hash-${filename}`,
        };
      }
      case 'write_note':
        return { contentHash: `hash-${String(args?.filename ?? '')}`, conflictCopy: null };
      default:
        return undefined;
    }
  }),
}));

function buildVault(): { notes: NoteFile[]; folders: FolderInfo[] } {
  const folders: FolderInfo[] = [
    { name: 'Projects', path: 'projects', children: [] },
    { name: 'Reference', path: 'reference', children: [] },
    { name: 'Archive', path: 'archive', children: [] },
  ];
  const dailyNotes = Array.from({ length: 111 }, (_, index): NoteFile => {
    const day = String((index % 28) + 1).padStart(2, '0');
    const month = String((Math.floor(index / 28) % 12) + 1).padStart(2, '0');
    const date = `2025-${month}-${day}`;
    return {
      name: `${date}.md`,
      path: `daily/${date}.md`,
      isDaily: true,
      isWeekly: false,
      date,
      isLocked: false,
    };
  });
  const weeklyNotes = Array.from({ length: 4 }, (_, index): NoteFile => {
    const week = `2025-W${String(index + 1).padStart(2, '0')}`;
    return {
      name: `${week}.md`,
      path: `weekly/${week}.md`,
      isDaily: false,
      isWeekly: true,
      week,
      isLocked: false,
    };
  });
  const standaloneNotes = Array.from({ length: 53 }, (_, index): NoteFile => {
    const folder = index < 5 ? undefined : folders[(index - 5) % folders.length].path;
    const name = `Note ${String(index + 1).padStart(2, '0')}.md`;
    return {
      name,
      path: folder ? `notes/${folder}/${name}` : `notes/${name}`,
      isDaily: false,
      isWeekly: false,
      isLocked: false,
      folderPath: folder,
    };
  });

  return { notes: [...dailyNotes, ...weeklyNotes, ...standaloneNotes], folders };
}

function resetStores(notes: NoteFile[] = [], folders: FolderInfo[] = [], notesAvailable = true) {
  ipc.notesAvailable = notesAvailable;
  ipc.notes = notes;
  ipc.folders = folders;
  const currentFile = notes.find((note) => !note.isDaily && !note.isWeekly);
  const currentNote = currentFile
    ? {
        id: currentFile.path,
        title: currentFile.name.replace(/\.md$/, ''),
        content: '<p>Current note</p>',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
        isDaily: false,
        isWeekly: false,
      }
    : null;
  ipc.noteContent = new Map(
    notes.map((note, index) => [
      note.folderPath ? `${note.folderPath}/${note.name}` : note.name,
      `${index % 2 === 0 ? '#project #moldavite' : '#reference'}${
        currentNote && index % 5 === 0 ? ` [[${currentNote.title}]]` : ''
      }`,
    ])
  );
  useNoteStore.setState({
    notes,
    openTabs: currentNote ? [currentNote] : [],
    activeTabId: currentNote?.id ?? null,
    currentNote,
    isLoading: false,
    isSaving: false,
    unlockedNotes: new Set(),
    externallyChanged: new Map(),
  });
  useFolderStore.setState({
    folders,
    expandedFolders: folders.map((folder) => folder.path),
    sectionsCollapsed: {
      notes: false,
      folders: false,
      daily: false,
      tags: false,
      backlinks: false,
    },
  });
  useTagStore.setState({
    allTags: new Map([
      ['project', 84],
      ['moldavite', 84],
      ['reference', 84],
    ]),
    selectedTags: [],
    selectedTag: null,
    tagSearchQuery: '',
  });
  useSettingsStore.getState().resetToDefaults();
  useOverlayStore.setState({
    activeOverlay: null,
    isSidebarHidden: false,
    isRightPanelHidden: false,
  });
}

function IndexNavigationHarness() {
  const activeOverlay = useOverlayStore((state) => state.activeOverlay);
  const closeOverlay = useOverlayStore((state) => state.closeOverlay);
  const indexMode = useSettingsStore((state) => state.indexMode);
  return (
    <>
      <EditorNavigation />
      <ChromeShortcutHost />
      <IndexOverlay
        isOpen={activeOverlay === 'index' && indexMode === 'overlay'}
        onClose={closeOverlay}
      />
    </>
  );
}

describe('IndexOverlay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
    resetStores([], [], false);
  });

  it('renders a realistic vault without throwing', async () => {
    const vault = buildVault();
    resetStores(vault.notes, vault.folders);

    render(<IndexOverlay isOpen onClose={vi.fn()} />);

    const overlay = screen.getByRole('region', { name: 'Index' });
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveStyle({
      position: 'absolute',
      display: 'flex',
      minHeight: '0',
      overflow: 'hidden',
    });
    expect(screen.getByRole('button', { name: /Notes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Folders/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Daily/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tags/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Backlinks/i })).toBeInTheDocument();
    await waitFor(() => expect(useTagStore.getState().allTags.size).toBeGreaterThan(0));
  });

  it('renders with empty stores when Tauri IPC is unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation((message) => {
      if (message !== '[useNotes] Failed to initialize:') {
        throw new Error(`Unexpected console.error: ${String(message)}`);
      }
    });
    render(<IndexOverlay isOpen onClose={vi.fn()} />);

    await act(async () => {});

    expect(screen.getByRole('region', { name: 'Index' })).toBeInTheDocument();
    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
    expect(screen.getByText('No folders yet.')).toBeInTheDocument();
    expect(screen.getByText('No daily notes yet. Today starts one.')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      '[useNotes] Failed to initialize:',
      expect.objectContaining({ message: 'Invalid response from list_notes' })
    );
    consoleError.mockRestore();
  });

  it('opens and closes repeatedly without throwing', async () => {
    resetStores();
    const view = render(<IndexOverlay isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Index' })).not.toBeInTheDocument();

    view.rerender(<IndexOverlay isOpen onClose={vi.fn()} />);
    expect(await screen.findByRole('region', { name: 'Index' })).toBeInTheDocument();

    view.rerender(<IndexOverlay isOpen={false} onClose={vi.fn()} />);
    await waitFor(
      () => expect(screen.queryByRole('region', { name: 'Index' })).not.toBeInTheDocument(),
      { timeout: 500 }
    );

    await act(async () => {
      view.rerender(<IndexOverlay isOpen onClose={vi.fn()} />);
    });
    expect(await screen.findByRole('region', { name: 'Index' })).toBeInTheDocument();
  });

  it('opens from both the footer link and keyboard shortcut', async () => {
    const vault = buildVault();
    resetStores(vault.notes, vault.folders);
    render(
      <StrictMode>
        <IndexNavigationHarness />
      </StrictMode>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Index' }));
    expect(await screen.findByRole('region', { name: 'Index' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    await waitFor(
      () => expect(screen.queryByRole('region', { name: 'Index' })).not.toBeInTheDocument(),
      { timeout: 500 }
    );

    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    expect(await screen.findByRole('region', { name: 'Index' })).toBeInTheDocument();
  });

  it('uses a clicked trigger as the overlay transform origin', async () => {
    resetStores([], [], true);
    const surfaceRect = {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute('aria-label') === 'Index') return surfaceRect;
      return {
        ...surfaceRect,
        x: 80,
        y: 180,
        left: 80,
        top: 180,
        right: 120,
        bottom: 200,
        width: 40,
        height: 20,
      };
    });

    render(<IndexNavigationHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Index' }));

    const overlay = await screen.findByRole('region', { name: 'Index' });
    expect(overlay.style.getPropertyValue('--impact-x')).not.toBe('50%');
    expect(overlay.style.getPropertyValue('--impact-y')).not.toBe('50%');
  });

  it('reuses one preview tab across plain sidebar note clicks after active state drifts', async () => {
    const notes: NoteFile[] = ['Alpha', 'Beta', 'Gamma'].map((title) => ({
      name: `${title}.md`,
      path: `notes/${title}.md`,
      isDaily: false,
      isWeekly: false,
      isLocked: false,
    }));
    resetStores(notes, []);
    useNoteStore.setState({
      activeTabId: 'notes/missing-active-tab.md',
      currentNote: null,
    });

    render(<IndexOverlay isOpen onClose={vi.fn()} />);

    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}(?:\\s|$)`) }));
      await waitFor(() => expect(useNoteStore.getState().activeTabId).toBe(`notes/${title}.md`));
    }

    expect(useNoteStore.getState().openTabs).toHaveLength(1);
    expect(useNoteStore.getState().openTabs[0].id).toBe('notes/Gamma.md');
  });

  it('reuses the existing preview when sidebar navigation returns through a pinned tab', async () => {
    const notes: NoteFile[] = ['Pinned', 'Beta', 'Gamma', 'Delta'].map((title) => ({
      name: `${title}.md`,
      path: `notes/${title}.md`,
      isDaily: false,
      isWeekly: false,
      isLocked: false,
    }));
    resetStores(notes, []);
    useNoteStore.setState((state) => ({
      openTabs: state.openTabs.map((tab) => ({ ...tab, isPinned: true })),
      currentNote: state.currentNote ? { ...state.currentNote, isPinned: true } : null,
    }));

    render(<IndexOverlay isOpen onClose={vi.fn()} />);

    for (const title of ['Beta', 'Pinned', 'Gamma', 'Pinned', 'Delta']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}(?:\\s|$)`) }));
      await waitFor(() => expect(useNoteStore.getState().activeTabId).toBe(`notes/${title}.md`));
    }

    const state = useNoteStore.getState();
    expect(state.openTabs.map((tab) => tab.id)).toEqual(['notes/Pinned.md', 'notes/Delta.md']);
  });

  // Got this wrong twice by positioning the two independently: first 32px
  // apart, which read as one crowded object; then with the hint at top-left,
  // where it landed on top of the Forge name in the sidebar's own header.
  // Keeping them in one container is what makes overlap impossible — absolute
  // coordinates only ever move the collision somewhere else.
  it('keeps the shortcut hint and the close button in one row', () => {
    render(<IndexOverlay isOpen onClose={() => {}} />);

    const close = screen.getByRole('button', { name: 'Close Index' });
    const hint = screen.getByText(/Esc closes/i);

    // Siblings under a single positioned parent, not two floating elements.
    expect(close.parentElement).toBe(hint.parentElement);
    expect(close.parentElement).toHaveStyle({ display: 'flex' });

    // Neither carries its own absolute position any more.
    expect(close).not.toHaveStyle({ position: 'absolute' });
    expect(hint).not.toHaveStyle({ position: 'absolute' });
  });
});
