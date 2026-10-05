export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string | number> {
  ariaLabel: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
}

/** More options than this in one row wrap each label onto three or four lines. */
const MAX_COLUMNS = 4;

export function SegmentedControl<T extends string | number>({
  ariaLabel,
  value,
  onChange,
  options,
}: SegmentedControlProps<T>) {
  const columns = Math.min(options.length, MAX_COLUMNS);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="settings-segmented-control"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className="focus-ring settings-segmented-option"
          style={{
            borderLeft: index % columns === 0 ? undefined : '1px solid var(--border-default)',
            borderTop: index < columns ? undefined : '1px solid var(--border-default)',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
