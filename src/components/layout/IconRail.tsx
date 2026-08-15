import { useState, type MouseEvent, type ReactNode } from 'react';
import { Calendar, Clock, Network, PanelLeft, Search, Settings, Trash2 } from 'lucide-react';
import {
  useGraphStore,
  useNoteStore,
  useOverlayStore,
  useQuickSwitcherStore,
  useSettingsStore,
  useTimelineStore,
  useUpdateStore,
} from '@/stores';
import { IconRailTrash } from './IconRailTrash';
import { captureImpactOrigin } from '@/lib/impactOrigin';
import { flushPendingAutosave } from '@/lib/autosaveFlush';

interface RailButtonProps {
  label: string;
  tooltip: string;
  /**
   * Whether this button *is* the surface currently on screen. Omit it for
   * controls that only open something — one surface must never light up two
   * controls, so a plain shortcut like the monogram carries no active state
   * and no toggle semantics.
   */
  active?: boolean;
  ariaDisabled?: boolean;
  /** Marks the surface this button owns, for surfaces that close on outside clicks. */
  surface?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}

function RailButton({
  label,
  tooltip,
  active,
  ariaDisabled = false,
  surface,
  onClick,
  children,
}: RailButtonProps) {
  return (
    <button
      type="button"
      className="icon-rail-button"
      data-tooltip={tooltip}
      data-surface={surface}
      data-active={active ? 'true' : undefined}
      aria-label={label}
      aria-pressed={active}
      aria-disabled={ariaDisabled || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const iconProps = { size: 18, strokeWidth: 1.25, 'aria-hidden': true } as const;

export function IconRail() {
  const indexMode = useSettingsStore((state) => state.indexMode);
  const agendaMode = useSettingsStore((state) => state.agendaMode);
  const isSettingsOpen = useSettingsStore((state) => state.isSettingsOpen);
  const setIsSettingsOpen = useSettingsStore((state) => state.setIsSettingsOpen);
  const { activeOverlay, isSidebarHidden, isRightPanelHidden, toggleIndex, toggleAgenda } =
    useOverlayStore();
  const quickSwitcherOpen = useQuickSwitcherStore((state) => state.isOpen);
  const toggleQuickSwitcher = useQuickSwitcherStore((state) => state.toggle);
  const graphOpen = useGraphStore((state) => state.isOpen);
  const toggleGraph = useGraphStore((state) => state.toggle);
  const timelineOpen = useTimelineStore((state) => state.isOpen);
  const toggleTimeline = useTimelineStore((state) => state.toggle);
  const availableVersion = useUpdateStore((state) => state.availableVersion);
  const activeTabId = useNoteStore((state) => state.activeTabId);
  const deactivateNote = useNoteStore((state) => state.deactivateNote);
  const [trashAnchor, setTrashAnchor] = useState<HTMLButtonElement | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  const indexOpen = activeOverlay === 'index' || (indexMode === 'pinned' && !isSidebarHidden);
  const agendaOpen = activeOverlay === 'agenda' || (agendaMode === 'pinned' && !isRightPanelHidden);

  const handleIndex = (event: MouseEvent<HTMLButtonElement>) => {
    if (indexMode === 'off') return;
    if (indexMode === 'overlay' && activeOverlay !== 'index') {
      captureImpactOrigin(event.currentTarget);
    }
    toggleIndex(indexMode === 'pinned');
  };

  const handleHome = async () => {
    if (activeOverlay === null && activeTabId === null) return;

    await flushPendingAutosave();
    useOverlayStore.getState().closeOverlay();
    deactivateNote();
  };

  const handleAgenda = (event: MouseEvent<HTMLButtonElement>) => {
    if (agendaMode === 'off') return;
    if (agendaMode === 'overlay' && activeOverlay !== 'agenda') {
      captureImpactOrigin(event.currentTarget);
    }
    toggleAgenda(agendaMode === 'pinned');
  };

  const handleQuickSwitcher = (event: MouseEvent<HTMLButtonElement>) => {
    if (!quickSwitcherOpen) captureImpactOrigin(event.currentTarget);
    toggleQuickSwitcher();
  };

  const handleTrash = (event: MouseEvent<HTMLButtonElement>) => {
    setTrashAnchor(event.currentTarget);
    setTrashOpen((open) => !open);
  };

  return (
    <aside
      className="icon-rail flex h-full flex-shrink-0 flex-col items-center"
      aria-label="App navigation"
      style={{
        position: 'relative',
        zIndex: 10000,
        width: '48px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        backgroundColor: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-default)',
      }}
    >
      <div className="flex w-full flex-col items-center pt-3">
        {/* The brand mark returns to the welcome screen; open tabs stay available. */}
        <RailButton label="Home" tooltip="Home" onClick={() => void handleHome()}>
          <span className="icon-rail-monogram" aria-hidden="true" />
        </RailButton>

        <div
          aria-hidden="true"
          className="my-2"
          style={{ width: '24px', borderTop: '1px solid var(--border-default)' }}
        />

        <nav className="flex w-full flex-col items-center" aria-label="Navigation surfaces">
          <RailButton
            label="Index (Command Backslash)"
            tooltip={'Index · ⌘\\'}
            active={indexOpen}
            ariaDisabled={indexMode === 'off'}
            onClick={handleIndex}
          >
            <PanelLeft {...iconProps} />
          </RailButton>
          <RailButton
            label="Search (Command P)"
            tooltip="Search · ⌘P"
            surface="search"
            active={quickSwitcherOpen}
            onClick={handleQuickSwitcher}
          >
            <Search {...iconProps} />
          </RailButton>
          <RailButton
            label="Agenda (Command Option Backslash)"
            tooltip={'Agenda · ⌘⌥\\'}
            active={agendaOpen}
            ariaDisabled={agendaMode === 'off'}
            onClick={handleAgenda}
          >
            <Calendar {...iconProps} />
          </RailButton>
          <RailButton
            label="Graph (Command Shift G)"
            tooltip="Graph · ⌘⇧G"
            active={graphOpen}
            onClick={toggleGraph}
          >
            <Network {...iconProps} />
          </RailButton>
          <RailButton
            label="Timeline"
            tooltip="Timeline"
            active={timelineOpen}
            onClick={toggleTimeline}
          >
            <Clock {...iconProps} />
          </RailButton>
        </nav>
      </div>

      <div className="mt-auto flex w-full flex-col items-center pb-3">
        <RailButton
          label={
            availableVersion
              ? 'Settings — update available (Command Comma)'
              : 'Settings (Command Comma)'
          }
          tooltip={
            availableVersion
              ? `Settings · Update ${availableVersion} available · ⌘,`
              : 'Settings · ⌘,'
          }
          active={isSettingsOpen}
          onClick={() => setIsSettingsOpen(true)}
        >
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Settings {...iconProps} />
            {availableVersion && (
              <span
                aria-hidden="true"
                data-testid="settings-update-indicator"
                style={{
                  position: 'absolute',
                  top: '-3px',
                  right: '-5px',
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--update-dot)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </span>
        </RailButton>
        <RailButton label="Trash" tooltip="Trash" active={trashOpen} onClick={handleTrash}>
          <Trash2 {...iconProps} />
        </RailButton>
      </div>

      {trashOpen && trashAnchor && (
        <IconRailTrash anchor={trashAnchor} onClose={() => setTrashOpen(false)} />
      )}
    </aside>
  );
}
