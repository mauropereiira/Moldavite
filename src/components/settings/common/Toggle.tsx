/**
 * Toggle — modern pill-style on/off switch used throughout the Settings UI.
 */

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
      className="relative inline-flex h-6 w-10 items-center transition-all"
      style={{
        borderRadius: '12px',
        backgroundColor: enabled ? 'var(--accent-primary)' : 'var(--bg-inset)',
        border: `1px solid ${enabled ? 'var(--accent-primary)' : 'var(--border-default)'}`,
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-4 w-4 transform transition-all"
        style={{
          borderRadius: '8px',
          backgroundColor: 'white',
          boxShadow: 'var(--shadow-sm)',
          transform: enabled ? 'translateX(18px)' : 'translateX(3px)',
        }}
      />
    </button>
  );
}
