/** Toggle: accessible on/off switch used throughout Settings. On tints its track with the theme's accent. */

export interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** Accessible label for screen readers; the visible row text is not a native label. */
  ariaLabel: string;
  disabled?: boolean;
}

export function Toggle({ enabled, onChange, ariaLabel, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className="settings-toggle"
    >
      <span aria-hidden="true" className="settings-toggle-marker" />
    </button>
  );
}
