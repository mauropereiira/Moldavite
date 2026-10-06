import { act, render, screen, waitFor, within } from '@testing-library/react';
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

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

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
    platform.mobile = false;
    localStorage.clear();
    resetStores([], [], false);
  });

  it('shows the phone its note calendar, its events and what changed', async () => {
    platform.mobile = true;
    resetStores();
    // A desktop preference must not leave the phone's Agenda without its calendar.
    useSettingsStore.setState({ showCalendarWidget: false });
    render(<AgendaOverlay isOpen onClose={vi.fn()} />);
    await act(async () => {});
    const calendar = screen.getByRole('region', { name: 'Calendar' });
    expect(within(calendar).getByText('Events')).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Changed on this day' })).toBeInTheDocument();
    expect(useCalendarStore.getState().checkPermission).toHaveBeenCalled();
  });

  it('keeps events and changes on a desktop whose month calendar is off', async () => {
    resetStores();
    useSettingsStore.setState({ showCalendarWidget: false });
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
      events: buildAllDayEvents(1),
      fetchEvents: vi.fn(async () => {}),
    });
    render(<AgendaOverlay isOpen onClose={vi.fn()} />);
    await act(async () => {});
    const calendar = screen.getByRole('region', { name: 'Calendar' });
    expect(
      within(calendar).queryByRole('button', { name: 'Previous month' })
    ).not.toBeInTheDocument();
    expect(within(calendar).getByText('All-day event 1')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Changed on this day' })).toBeInTheDocument();
  });

  it('lists what changed on the selected day and closes when a note is opened', async () => {
    const changed: NoteFile = {
      name: 'Launch plan.md',
      path: 'notes/Launch plan.md',
      isDaily: false,
      isWeekly: false,
      isLocked: false,
      createdAt: Date.parse('2025-03-01T10:00:00Z') / 1000,
      modifiedAt: new Date(2025, 2, 14, 15, 20).getTime() / 1000,
    };
    resetStores([changed]);
    useNoteStore.setState({ selectedDate: new Date(2025, 2, 14, 12) });
    const onClose = vi.fn();
    render(<AgendaOverlay isOpen onClose={onClose} />);
    await act(async () => {});

    const changes = screen.getByRole('region', { name: 'Changed on this day' });
    const row = within(changes).getByRole('button', { name: /Launch plan/ });
    expect(row).toHaveTextContent('15:20');
    await act(async () => {
      row.click();
    });
    expect(onClose).toHaveBeenCalled();
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
    expect(screen.getByRole('region', { name: 'Calendar' })).toHaveStyle({ minHeight: '0' });
    expect(screen.getByRole('region', { name: 'Changed on this day' })).toBeInTheDocument();
    expect(useNoteStore.getState().notes).toHaveLength(164);
    expect(useFolderStore.getState().folders).toHaveLength(3);
    expect(useTagStore.getState().allTags.size).toBeGreaterThan(0);
  });

  it('renders with empty stores when Tauri IPC is unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AgendaOverlay isOpen onClose={vi.fn()} />);

    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Changed on this day' })).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
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
      // The overlay exit is a real 200 ms timer; a loaded CI runner needs more than 500 ms.
      { timeout: 2000 }
    );

    await act(async () => {
      view.rerender(<AgendaOverlay isOpen onClose={vi.fn()} />);
    });
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
  });
});
