/** Toggle — accessible, fill-free on/off switch used throughout Settings. */

export interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** Optional accessible label for screen readers when no visible label is associated. */
  ariaLabel?: string;
}

export function Toggle({ enabled, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      onClick={() => onChange(!enabled)}
      className="settings-toggle"
      style={{
        borderColor: enabled ? 'var(--text-primary)' : 'var(--border-default)',
      }}
    >
      <span
        aria-hidden="true"
        className="settings-toggle-marker"
        style={{
          borderColor: enabled ? 'var(--text-primary)' : 'var(--text-muted)',
          transform: enabled ? 'translateX(17px)' : 'translateX(3px)',
        }}
      />
    </button>
  );
}
