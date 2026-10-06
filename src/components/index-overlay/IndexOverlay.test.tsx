import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderInfo, NoteFile } from '@/types';
import {
  useFolderStore,
  useNoteStore,
  useOverlayStore,
  useQuickSwitcherStore,
  useSettingsStore,
  useTagStore,
} from '@/stores';
import { ChromeShortcutHost } from '@/components/ChromeShortcutHost';
import { EditorNavigation } from '@/components/layout/EditorNavigation';
import { IndexOverlay } from './IndexOverlay';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({
  isMobilePlatform: () => platform.mobile,
  isTabletPlatform: () => false,
}));

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
      case 'create_note':
        return `${String(args?.title)}.md`;
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
  useQuickSwitcherStore.setState({ pinnedNoteIds: [] });
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
    platform.mobile = false;
    localStorage.clear();
    resetStores([], [], false);
  });

  // The phone used to ask for a title, then show a template page, then land
  // back on the Index with the note hidden behind it.
  it('opens a new note straight away on the phone and leaves the Index', async () => {
    platform.mobile = true;
    const onClose = vi.fn();
    render(<IndexOverlay isOpen onClose={onClose} />);

    fireEvent.click(
      within(document.querySelector('.sidebar-footer') as HTMLElement).getByRole('button', {
        name: 'New',
      })
    );

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'New Note' })).not.toBeInTheDocument();
    await waitFor(() => expect(useNoteStore.getState().currentNote?.id).toBe('notes/Untitled.md'));
    expect(screen.queryByText(/Choose a template/)).not.toBeInTheDocument();
  });

  // A link, the graph or Search opens the Index only to host the password
  // prompt. Cancelling it used to leave you on the Index instead of the note.
  it('closes again when an unlock it was opened for is cancelled', async () => {
    const locked: NoteFile = {
      name: 'Secret.md',
      path: 'notes/Secret.md',
      isDaily: false,
      isWeekly: false,
      isLocked: true,
    };
    useNoteStore.getState().requestUnlock(locked, true);
    const onClose = vi.fn();
    render(<IndexOverlay isOpen onClose={onClose} />);

    const dialog = await screen.findByRole('dialog', { name: 'Unlock note' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when an unlock asked from the Index itself is cancelled', async () => {
    const locked: NoteFile = {
      name: 'Secret.md',
      path: 'notes/Secret.md',
      isDaily: false,
      isWeekly: false,
      isLocked: true,
    };
    useNoteStore.getState().requestUnlock(locked, false);
    const onClose = vi.fn();
    render(<IndexOverlay isOpen onClose={onClose} />);

    const dialog = await screen.findByRole('dialog', { name: 'Unlock note' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('still asks for the title first on the desktop', () => {
    const onClose = vi.fn();
    render(<IndexOverlay isOpen onClose={onClose} />);

    fireEvent.click(
      within(document.querySelector('.sidebar-footer') as HTMLElement).getByRole('button', {
        name: 'New',
      })
    );

    expect(screen.getByRole('dialog', { name: 'New Note' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
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

  // Direction C: each section is a card whose filled band holds the toggle,
  // a count chip and the section's actions.
  it('shows every section as a card with its band, count and actions', async () => {
    const vault = buildVault();
    resetStores(vault.notes, vault.folders);
    const { container } = render(<IndexOverlay isOpen onClose={vi.fn()} />);

    const cards = Array.from(container.querySelectorAll('.app-index-grid > .app-overlay-section'));
    const names = cards.map((card) => card.querySelector('.section-title')?.textContent);
    expect(names).toEqual(['Notes', 'Folders', 'Daily', 'Tags', 'Backlinks']);
    for (const card of cards) {
      const band = card.querySelector('.section-band');
      expect(band).not.toBeNull();
      expect(band?.querySelector('.section-toggle')).toHaveAttribute('aria-expanded', 'true');
    }

    const notes = within(cards[0] as HTMLElement);
    expect(cards[0].querySelector('.section-count')).toHaveTextContent('5');
    expect(notes.getByRole('button', { name: 'New' })).toBeInTheDocument();
    expect(
      within(cards[1] as HTMLElement).getByRole('button', { name: 'New' })
    ).toBeInTheDocument();
    expect(cards[2].querySelector('.section-count')).toHaveTextContent('111');
    expect(within(cards[2] as HTMLElement).getByText('Today')).toBeInTheDocument();
    await waitFor(() => expect(useTagStore.getState().allTags.size).toBeGreaterThan(0));
  });

  it('folds a card to its band, keeping the count and hiding the list and actions', () => {
    const vault = buildVault();
    resetStores(vault.notes, vault.folders);
    const { container } = render(<IndexOverlay isOpen onClose={vi.fn()} />);
    const card = container.querySelectorAll('.app-index-grid > .app-overlay-section')[1];
    const folders = within(card as HTMLElement);

    expect(folders.getByText('Projects')).toBeVisible();
    fireEvent.click(folders.getByRole('button', { name: 'Folders' }));

    expect(useFolderStore.getState().sectionsCollapsed.folders).toBe(true);
    expect(folders.getByRole('button', { name: 'Folders' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(folders.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();
    expect(card.querySelector('.section-count')).toHaveTextContent('3');
    expect(folders.queryByText('Projects')).not.toBeVisible();
  });

  // The Index is fixed to the window: rows of cards share its height, and a
  // row of folded cards takes only its bands.
  it('lays the cards out from the measured width and folds rows to their bands', () => {
    const observed: Array<() => void> = [];
    let width = 1500;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: (entries: Array<{ contentRect: { width: number } }>) => void) {}
        observe() {
          const fire = () => this.cb([{ contentRect: { width } }]);
          observed.push(fire);
          fire();
        }
        disconnect() {}
      }
    );
    const vault = buildVault();
    resetStores(vault.notes, vault.folders);
    useNoteStore.setState({ currentNote: null });
    const { container } = render(<IndexOverlay isOpen onClose={vi.fn()} />);
    const grid = container.querySelector('.app-index-grid') as HTMLElement;

    expect(grid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    expect(grid.style.gridTemplateRows).toBe('minmax(var(--index-card-min-height), 1fr)');

    width = 800;
    act(() => observed.forEach((fire) => fire()));
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    act(() => {
      useFolderStore.setState((state) => ({
        sectionsCollapsed: { ...state.sectionsCollapsed, tags: true },
      }));
    });
    expect(grid.style.gridTemplateRows).toBe('minmax(var(--index-card-min-height), 1fr) auto');

    width = 360;
    act(() => observed.forEach((fire) => fire()));
    expect(grid).toHaveAttribute('data-stacked');
    expect(grid.style.display).toBe('flex');
    vi.unstubAllGlobals();
  });

  it('renders with empty stores when Tauri IPC is unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<IndexOverlay isOpen onClose={vi.fn()} />);

    await act(async () => {});

    expect(screen.getByRole('region', { name: 'Index' })).toBeInTheDocument();
    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
    expect(screen.getByText('No folders yet.')).toBeInTheDocument();
    expect(screen.getByText('No daily notes yet. Today starts one.')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
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
      // The overlay exit is a real 200 ms timer; a loaded CI runner needs more than 500 ms.
      { timeout: 2000 }
    );

    await act(async () => {
      view.rerender(<IndexOverlay isOpen onClose={vi.fn()} />);
    });
    expect(await screen.findByRole('region', { name: 'Index' })).toBeInTheDocument();
  });

  it('opens from both the footer link and keyboard shortcut', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
    );
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
      // The overlay exit is a real 200 ms timer; a loaded CI runner needs more than 500 ms.
      { timeout: 2000 }
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
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/Pinned.md'] });

    render(<IndexOverlay isOpen onClose={vi.fn()} />);

    for (const title of ['Beta', 'Pinned', 'Gamma', 'Pinned', 'Delta']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}(?:\\s|$)`) }));
      await waitFor(() => expect(useNoteStore.getState().activeTabId).toBe(`notes/${title}.md`));
    }

    const state = useNoteStore.getState();
    expect(state.openTabs.map((tab) => tab.id)).toEqual(['notes/Pinned.md', 'notes/Delta.md']);
  });

  // The shortcut used to sit in a hint line beside the ×, where it crowded the
  // Forge name. It lives in the tooltip now, on the same × the note uses.
  it('closes with the shared × and keeps the shortcut in its tooltip', () => {
    const onClose = vi.fn();
    render(<IndexOverlay isOpen onClose={onClose} />);

    const close = screen.getByRole('button', { name: 'Close Index' });
    expect(close).toHaveClass('close-button');
    expect(close.getAttribute('title')).toMatch(/^Close \(Esc, .+\\\)$/);
    expect(screen.queryByText(/Esc closes/i)).not.toBeInTheDocument();

    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
