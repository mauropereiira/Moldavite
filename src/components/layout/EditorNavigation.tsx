import { Fragment, useState } from 'react';
import { useOverlayStore, useSettingsStore } from '@/stores';
import { useElementWidth } from '@/hooks/useElementWidth';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { captureImpactOrigin } from '@/lib/impactOrigin';

/**
 * Below this editor width the three links stop clearing the footer's own
 * controls even after those have collapsed, so they fold into one menu. It is
 * deliberately far below `ACTIONS_COLLAPSE_WIDTH` in `EditorFooter`: these
 * links are the cheapest thing on the row to keep, so the actions yield first.
 */
const NAV_COLLAPSE_WIDTH = 420;

const linkStyle = {
  color: 'var(--text-muted)',
  fontSize: '10px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
} as const;

export function EditorNavigation() {
  const { indexMode, agendaMode, setIsSettingsOpen } = useSettingsStore();
  const { openIndex, openAgenda, closeOverlay } = useOverlayStore();
  // The editor column, not this nav: it is absolutely positioned, so its own
  // width is just its content's. The parent is what it is centred within.
  const [column, setColumn] = useState<HTMLElement | null>(null);
  const columnWidth = useElementWidth(column);
  const isCollapsed = columnWidth !== null && columnWidth < NAV_COLLAPSE_WIDTH;

  /**
   * `from` is the element the click came from, so an overlay can animate out of
   * it. Collapsed there is no such element — the link is a menu row that is
   * already gone by the time the overlay paints — and the overlay falls back to
   * its own centre.
   */
  const items = [
    indexMode !== 'off' && {
      label: 'Index',
      open: (from?: Element) => {
        if (indexMode === 'overlay' && from) captureImpactOrigin(from);
        openIndex(indexMode === 'pinned');
      },
    },
    agendaMode !== 'off' && {
      label: 'Agenda',
      open: (from?: Element) => {
        if (agendaMode === 'overlay' && from) captureImpactOrigin(from);
        openAgenda(agendaMode === 'pinned');
      },
    },
    {
      label: 'Settings',
      open: () => {
        closeOverlay();
        setIsSettingsOpen(true);
      },
    },
  ].filter((item) => item !== false);

  return (
    <nav
      ref={(node) => setColumn(node?.parentElement ?? null)}
      className="editor-navigation-links"
      aria-label="App navigation"
      style={{
        position: 'absolute',
        left: '50%',
        // Occupies the footer row's own box — same 34px, same bottom edge — so
        // these links sit on one line with the footer's controls instead of
        // floating a few pixels above them. It was a bare `bottom: 14px`,
        // which put the two sets of labels on visibly different baselines.
        bottom: 0,
        height: '34px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transform: 'translateX(-50%)',
      }}
    >
      {isCollapsed ? (
        <Dropdown
          openDirection="up"
          position="center"
          trigger={
            <button type="button" className="text-link" style={linkStyle}>
              Menu
            </button>
          }
        >
          {items.map((item) => (
            <DropdownItem key={item.label} onClick={() => item.open()}>
              {item.label}
            </DropdownItem>
          ))}
        </Dropdown>
      ) : (
        items.map((item, position) => (
          <Fragment key={item.label}>
            {position > 0 && (
              <span aria-hidden="true" style={{ color: 'var(--border-strong)', fontSize: '10px' }}>
                ·
              </span>
            )}
            <button
              type="button"
              onClick={(event) => item.open(event.currentTarget)}
              className="text-link"
              style={linkStyle}
            >
              {item.label}
            </button>
          </Fragment>
        ))
      )}
    </nav>
  );
}
