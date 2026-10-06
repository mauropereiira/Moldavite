import type { ComponentProps } from 'react';
import { X } from 'lucide-react';

type CloseButtonProps = Omit<ComponentProps<'button'>, 'children' | 'title' | 'aria-label'> & {
  /** The accessible name, such as "Close Index". */
  label: string;
  /** The keys that also close the surface, shown in the tooltip. */
  shortcut?: string;
};

/**
 * The one close control: the thin × from the open note's corner, used by every
 * overlay, page and dialog. The tooltip carries the keyboard shortcut, so no
 * surface needs a hint line beside it.
 */
export function CloseButton({ label, shortcut = 'Esc', className, ...props }: CloseButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={className ? `close-button ${className}` : 'close-button'}
      aria-label={label}
      title={`Close (${shortcut})`}
    >
      <X className="close-button-icon" strokeWidth={1.25} aria-hidden="true" />
    </button>
  );
}
