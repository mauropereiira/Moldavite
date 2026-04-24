/**
 * ShortcutRow — renders a single keyboard-shortcut entry (description + kbd chips).
 */

export interface ShortcutRowProps {
  keys: string[];
  description: string;
}

export function ShortcutRow({ keys, description }: ShortcutRowProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{description}</span>
      <div className="flex gap-1">
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="px-2 py-0.5 text-xs font-mono"
            style={{
              backgroundColor: 'var(--bg-inset)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
            }}
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}
