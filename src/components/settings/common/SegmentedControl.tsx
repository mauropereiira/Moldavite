export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string | number> {
  ariaLabel: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  label?: string;
}

export function SegmentedControl<T extends string | number>({
  ariaLabel,
  value,
  onChange,
  options,
  label,
}: SegmentedControlProps<T>) {
  return (
    <div className="settings-segmented-row">
      {label && <p className="settings-control-label">{label}</p>}
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="settings-segmented-control"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option, index) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className="focus-ring settings-segmented-option"
              style={{
                borderLeft: index === 0 ? undefined : '1px solid var(--border-default)',
                borderBottom: `2px solid ${active ? 'var(--text-primary)' : 'transparent'}`,
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
