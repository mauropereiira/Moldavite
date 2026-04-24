/**
 * Toggle — modern pill-style on/off switch used throughout the Settings UI.
 */

export interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function Toggle({ enabled, onChange }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="relative inline-flex h-6 w-10 items-center transition-all"
      style={{
        borderRadius: '12px',
        backgroundColor: enabled ? 'var(--accent-primary)' : 'var(--bg-inset)',
        border: `1px solid ${enabled ? 'var(--accent-primary)' : 'var(--border-default)'}`,
      }}
    >
      <span
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
