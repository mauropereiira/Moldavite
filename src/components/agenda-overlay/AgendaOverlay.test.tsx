import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, FolderInfo, NoteFile } from '@/types';
import {
  useCalendarStore,
  useFolderStore,
  useNoteStore,
  useSettingsStore,
  useTagStore,
} from '@/stores';
import { AgendaOverlay } from './AgendaOverlay';

const ipc = vi.hoisted(() => ({
  notesAvailable: true,
  notes: [] as NoteFile[],
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case 'list_notes':
        return ipc.notesAvailable ? ipc.notes : undefined;
      case 'read_note':
        return {
          content: `#daily #${String(args?.filename ?? 'note')}`,
          color: null,
          contentHash: 'calendar-test-hash',
        };
      case 'get_calendar_permission':
        return 'NotDetermined';
      case 'is_calendar_authorized':
        return false;
      case 'list_calendar_sources':
      case 'list_calendars':
        return [];
      case 'fetch_calendar_events':
        return { events: [], errors: [] };
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
    const date = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10);
    return {
      name: `${date}.md`,
      path: `daily/${date}.md`,
      isDaily: true,
      isWeekly: false,
      date,
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

  return { notes: [...dailyNotes, ...standaloneNotes], folders };
}

function buildAllDayEvents(count: number): CalendarEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `google:all-day-${index}`,
    source: 'google',
    title: `All-day event ${index + 1}`,
    start: '2025-03-14T00:00:00.000Z',
    end: '2025-03-15T00:00:00.000Z',
    isAllDay: true,
    location: '',
    notes: '',
    calendarId: 'google:primary',
    calendarTitle: 'Primary',
    calendarColor: 'var(--calendar-google)',
    url: '',
  }));
}

function resetStores(notes: NoteFile[] = [], folders: FolderInfo[] = [], notesAvailable = true) {
  ipc.notes = notes;
  ipc.notesAvailable = notesAvailable;
  useNoteStore.setState({
    notes,
    openTabs: [],
    activeTabId: null,
    currentNote: null,
    isLoading: false,
    isSaving: false,
    selectedDate: new Date('2025-03-14T12:00:00Z'),
    selectedWeek: null,
    unlockedNotes: new Set(),
    externallyChanged: new Set(),
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
      ['project', 82],
      ['daily', 111],
      ['reference', 27],
    ]),
    selectedTags: [],
    selectedTag: null,
    tagSearchQuery: '',
  });
  useSettingsStore.getState().resetToDefaults();
  useCalendarStore.setState({
    permissionStatus: 'NotDetermined',
    isAuthorized: false,
    isRequestingPermission: false,
    sources: [],
    events: [],
    isLoadingEvents: false,
    eventsError: null,
    sourceErrors: [],
    lastSynced: null,
    calendars: [],
    selectedCalendarIds: [],
    calendarEnabled: true,
    checkPermission: vi.fn(async () => {}),
  });
}

describe('AgendaOverlay', () => {
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

    render(
      <StrictMode>
        <AgendaOverlay isOpen onClose={vi.fn()} />
      </StrictMode>
    );

    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Month calendar' })).toHaveStyle({ minHeight: '0' });
    expect(screen.getByRole('region', { name: 'Event timeline' })).toBeInTheDocument();
    expect(useNoteStore.getState().notes).toHaveLength(164);
    expect(useFolderStore.getState().folders).toHaveLength(3);
    expect(useTagStore.getState().allTags.size).toBeGreaterThan(0);
  });

  it('renders with empty stores when Tauri IPC is unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation((message) => {
      if (message !== '[useNotes] Failed to initialize:') {
        throw new Error(`Unexpected console.error: ${String(message)}`);
      }
    });
    render(<AgendaOverlay isOpen onClose={vi.fn()} />);

    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Month calendar' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Event timeline' })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      '[useNotes] Failed to initialize:',
      expect.objectContaining({ message: 'Invalid response from list_notes' })
    );
    consoleError.mockRestore();
  });

  it('bounds a long all-day list without starving the hourly timeline', () => {
    resetStores();
    useSettingsStore.setState({ showCalendarWidget: false, showTimelineWidget: true });
    useCalendarStore.setState({
      sources: [
        {
          source: 'google',
          available: true,
          connected: true,
          account: null,
          permission: null,
          error: null,
        },
      ],
      events: buildAllDayEvents(12),
      fetchEvents: vi.fn(async () => {}),
      checkPermission: vi.fn(async () => {}),
    });

    render(<AgendaOverlay isOpen onClose={vi.fn()} />);

    const allDayRegion = screen.getByRole('region', { name: 'All-day events' });
    expect(screen.getByRole('region', { name: 'Agenda' })).toHaveStyle({ position: 'absolute' });
    expect(allDayRegion.style.maxHeight).toBe('35%');
    expect(allDayRegion.style.overflowY).toBe('auto');
    expect(allDayRegion.getAttribute('style')).toContain(
      'border-bottom: 1px solid var(--border-strong)'
    );
    expect(screen.getAllByText(/^All-day event \d+$/)).toHaveLength(12);

    const hourlyTimeline = screen.getByRole('region', { name: 'Hourly timeline' });
    expect(hourlyTimeline).toBeInTheDocument();
    expect(hourlyTimeline).toHaveStyle({ minHeight: '50%' });
  });

  it('opens and closes repeatedly without throwing', async () => {
    resetStores();
    const view = render(<AgendaOverlay isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Agenda' })).not.toBeInTheDocument();

    await act(async () => {
      view.rerender(<AgendaOverlay isOpen onClose={vi.fn()} />);
    });
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();

    await act(async () => {
      view.rerender(<AgendaOverlay isOpen={false} onClose={vi.fn()} />);
    });
    await waitFor(
      () => expect(screen.queryByRole('heading', { name: 'Agenda' })).not.toBeInTheDocument(),
      { timeout: 500 }
    );

    await act(async () => {
      view.rerender(<AgendaOverlay isOpen onClose={vi.fn()} />);
    });
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
  });
});
