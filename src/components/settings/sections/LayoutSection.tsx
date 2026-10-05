/**
 * LayoutSection: the rail, Index, Agenda and focus mode, the chrome around the
 * note, and folded below them the Index's sections, sort order and the pinned
 * column widths.
 */

import { useSettingsStore, type ChromeMode, type SettingsState } from '@/stores';
import { formatShortcut } from '@/lib/shortcuts';
import { isMobilePlatform } from '@/lib/platform';
import { Group, Row, SegmentedControl, ToggleRow, label } from '../common';

type BooleanLayoutSetting =
  | 'showIconRail'
  | 'showNoteHeader'
  | 'showTabBar'
  | 'showEditorFooter'
  | 'showBacklinksPanel';

const NOTE_CONTROLS: ReadonlyArray<[string, BooleanLayoutSetting]> = [
  ['note-header', 'showNoteHeader'],
  ['tab-bar', 'showTabBar'],
  ['editor-footer', 'showEditorFooter'],
  ['backlinks-panel', 'showBacklinksPanel'],
];

const MODES: ReadonlyArray<{ value: ChromeMode; label: string }> = [
  { value: 'overlay', label: 'Overlay' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'off', label: 'Off' },
];

const RAIL_SIDES = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
] as const;

const EDITOR_WIDTHS = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
] as const;

const SORT_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'modified-desc', label: 'Modified (Newest)' },
  { value: 'modified-asc', label: 'Modified (Oldest)' },
  { value: 'created-desc', label: 'Created (Newest)' },
  { value: 'created-asc', label: 'Created (Oldest)' },
] as const;

const setBoolean = (key: BooleanLayoutSetting) => (enabled: boolean) =>
  useSettingsStore.setState({ [key]: enabled } as Pick<SettingsState, BooleanLayoutSetting>);

const shortcut = (keys: string) => (
  <span className="settings-path-block">Shortcut: {formatShortcut(keys)}</span>
);

function WidthRow({
  id,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <Row id={id}>
      <input
        type="range"
        min={min}
        max={max}
        step="10"
        value={value}
        aria-label={label(id)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="settings-range"
      />
      <span className="settings-value">{value} px</span>
    </Row>
  );
}

export function LayoutSection() {
  const settings = useSettingsStore();
  // A phone forces the rail and overlay mode, has no writing column wider
  // than the screen and no panels for focus mode to hide.
  const mobile = isMobilePlatform();
  const indexPinned = settings.indexMode === 'pinned';
  const agendaPinned = settings.agendaMode === 'pinned';

  return (
    <div className="settings-tab">
      <Group id="navigation">
        {!mobile && (
          <ToggleRow
            id="icon-rail"
            value={settings.showIconRail}
            onChange={setBoolean('showIconRail')}
          />
        )}
        {(mobile || settings.showIconRail) && (
          <Row id="rail-side">
            <SegmentedControl
              ariaLabel={label('rail-side')}
              value={settings.iconRailSide}
              onChange={settings.setIconRailSide}
              options={RAIL_SIDES}
            />
          </Row>
        )}
        {!mobile && (
          <>
            <Row id="index-mode" stack detail={shortcut('⌘\\')}>
              <SegmentedControl
                ariaLabel={label('index-mode')}
                value={settings.indexMode}
                onChange={settings.setIndexMode}
                options={MODES}
              />
            </Row>
            <Row id="agenda-mode" stack detail={shortcut('⌘⌥\\')}>
              <SegmentedControl
                ariaLabel={label('agenda-mode')}
                value={settings.agendaMode}
                onChange={settings.setAgendaMode}
                options={MODES}
              />
            </Row>
            <ToggleRow
              id="focus-mode"
              value={settings.focusModeEnabled}
              onChange={settings.setFocusModeEnabled}
              detail={shortcut('⌘.')}
            />
          </>
        )}
      </Group>

      <Group id="note">
        {!mobile && (
          <Row id="writing-width" stack>
            <SegmentedControl
              ariaLabel={label('writing-width')}
              value={settings.editorWidth}
              onChange={settings.setEditorWidth}
              options={EDITOR_WIDTHS}
            />
          </Row>
        )}
        {NOTE_CONTROLS.map(([id, key]) => (
          <ToggleRow key={id} id={id} value={settings[key]} onChange={setBoolean(key)} />
        ))}
      </Group>

      <Group id="index">
        <ToggleRow
          id="folders-section"
          value={settings.showFoldersSection}
          onChange={settings.setShowFoldersSection}
        />
        <ToggleRow
          id="backlinks-section"
          value={settings.showBacklinksSection}
          onChange={settings.setShowBacklinksSection}
        />
        <Row id="sort" stack>
          <SegmentedControl
            ariaLabel={label('sort')}
            value={settings.sortOption}
            onChange={settings.setSortOption}
            options={SORT_OPTIONS}
          />
        </Row>
        {/* A width only means something for a pinned column; as an overlay the
            Index fills the window, so an ungated slider would do nothing. */}
        {!mobile && indexPinned && (
          <WidthRow
            id="index-width"
            value={settings.sidebarWidth}
            min={200}
            max={400}
            onChange={settings.setSidebarWidth}
          />
        )}
        {!mobile && agendaPinned && (
          <WidthRow
            id="agenda-width"
            value={settings.rightPanelWidth}
            min={250}
            max={500}
            onChange={settings.setRightPanelWidth}
          />
        )}
        {!mobile && !indexPinned && !agendaPinned && (
          <p className="settings-row-note settings-fold-note">
            Pin the Index or the Agenda above to set its width.
          </p>
        )}
      </Group>
    </div>
  );
}
