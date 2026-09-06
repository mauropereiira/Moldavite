import { useSettingsStore, type ChromeMode, type SettingsState } from '@/stores';
import { SectionHeading, SegmentedControl, Toggle } from '../common';
import { formatShortcut } from '@/lib/shortcuts';
import { isMobilePlatform } from '@/lib/platform';

type BooleanLayoutSetting =
  | 'showIconRail'
  | 'showNoteHeader'
  | 'showTabBar'
  | 'showEditorFooter'
  | 'showBacklinksPanel'
  | 'showWelcomeDots'
  | 'showWelcomeStats'
  | 'showWelcomeDate'
  | 'showAsteroidCursor';

const EDITOR_CONTROLS = [
  ['Note header', 'showNoteHeader'],
  ['Tab bar', 'showTabBar'],
  ['Editor footer', 'showEditorFooter'],
  ['Backlinks panel', 'showBacklinksPanel'],
] as const;

const WELCOME_CONTROLS = [
  ['Constellations', 'showWelcomeDots'],
  ['Live counts', 'showWelcomeStats'],
  ['Date', 'showWelcomeDate'],
  ['Asteroid cursor', 'showAsteroidCursor'],
] as const;

const MODES: readonly { value: ChromeMode; label: string }[] = [
  { value: 'overlay', label: 'Overlay' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'off', label: 'Off' },
];

function setBooleanSetting(key: BooleanLayoutSetting, enabled: boolean) {
  useSettingsStore.setState({ [key]: enabled } as Pick<SettingsState, BooleanLayoutSetting>);
}

const EDITOR_WIDTHS = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
] as const;

function ToggleRow({
  label,
  setting,
  enabled,
}: {
  label: string;
  setting: BooleanLayoutSetting;
  enabled: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-6 py-3"
      style={{ borderBottom: '1px solid var(--border-muted)' }}
    >
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
      <Toggle
        enabled={enabled}
        onChange={(value) => setBooleanSetting(setting, value)}
        ariaLabel={label}
      />
    </div>
  );
}

/**
 * Segmented control. Generic over its option type so the same control serves
 * the 3-way chrome modes and the 4-way editor width without a second copy.
 */
function ModeRow<T extends string>({
  label,
  value,
  onChange,
  options = MODES as unknown as ReadonlyArray<{ value: T; label: string }>,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options?: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <SegmentedControl
      label={label}
      ariaLabel={`${label} mode`}
      value={value}
      onChange={onChange}
      options={options}
    />
  );
}

export function LayoutSection() {
  const settings = useSettingsStore();
  // A phone forces the rail and overlay mode, has no writing column wider
  // than the screen, and no pointer for the asteroid cursor
  // (`WelcomeScreen` already skips it on coarse pointers).
  const mobile = isMobilePlatform();
  const welcomeControls = mobile
    ? WELCOME_CONTROLS.filter(([, setting]) => setting !== 'showAsteroidCursor')
    : WELCOME_CONTROLS;

  return (
    <div className="space-y-7">
      <section>
        <SectionHeading>Navigation</SectionHeading>
        {mobile ? (
          <p className="text-sm py-3" style={{ color: 'var(--text-muted)' }}>
            Desktop settings. On a phone the Index and Agenda open as overlays.
          </p>
        ) : (
          <>
            <ToggleRow label="Icon rail" setting="showIconRail" enabled={settings.showIconRail} />
            <ModeRow
              label={`Index · ${formatShortcut('⌘\\')}`}
              value={settings.indexMode}
              onChange={settings.setIndexMode}
            />
            <ModeRow
              label={`Agenda · ${formatShortcut('⌘⌥\\')}`}
              value={settings.agendaMode}
              onChange={settings.setAgendaMode}
            />
          </>
        )}
      </section>

      <section>
        <SectionHeading>Editor</SectionHeading>
        {!mobile && (
          <ModeRow
            label="Writing column width"
            value={settings.editorWidth}
            onChange={settings.setEditorWidth}
            options={EDITOR_WIDTHS}
          />
        )}
        {EDITOR_CONTROLS.map(([label, setting]) => (
          <ToggleRow key={setting} label={label} setting={setting} enabled={settings[setting]} />
        ))}
      </section>

      <section>
        <SectionHeading>Welcome</SectionHeading>
        {welcomeControls.map(([label, setting]) => (
          <ToggleRow key={setting} label={label} setting={setting} enabled={settings[setting]} />
        ))}
      </section>
    </div>
  );
}
