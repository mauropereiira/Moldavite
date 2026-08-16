import React, { useState, useRef, useEffect } from 'react';
import { applyImpactOrigin, captureImpactOrigin } from '@/lib/impactOrigin';

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  position?: 'left' | 'right' | 'center';
  openDirection?: 'up' | 'down';
  className?: string;
}

export function Dropdown({
  trigger,
  children,
  position = 'left',
  openDirection = 'down',
  className = '',
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const positionClasses = {
    left: 'left-0',
    right: 'right-0',
    center: 'left-1/2 -translate-x-1/2',
  };

  const directionClasses = openDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1';

  const withCloseHandler = (nodes: React.ReactNode): React.ReactNode =>
    React.Children.map(nodes, (child) => {
      if (!React.isValidElement(child)) return child;

      if (child.type === React.Fragment) {
        return React.cloneElement(
          child,
          undefined,
          withCloseHandler((child.props as { children?: React.ReactNode }).children)
        );
      }

      // A filter box is not a choice. Closing the menu when it is clicked
      // would make it impossible to focus, let alone type in.
      if (child.type === DropdownSearch) return child;

      // Neither is a setting you are adjusting *before* you act. Anything
      // inside a static region keeps the menu open, including its descendants,
      // so picking a site leaves you looking at the button that publishes to it.
      if (child.type === DropdownStatic) return child;

      const clickable = child as React.ReactElement<{
        onClick?: React.MouseEventHandler<HTMLElement>;
      }>;
      return React.cloneElement(clickable, {
        onClick: (event) => {
          clickable.props.onClick?.(event);
          setIsOpen(false);
        },
      });
    });

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <div
        onClick={(event) => {
          if (!isOpen) captureImpactOrigin(event.currentTarget);
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {trigger}
      </div>

      {isOpen && (
        <div
          ref={applyImpactOrigin}
          role="menu"
          className={`absolute ${directionClasses} ${positionClasses[position]} z-50 min-w-[180px] py-1 modal-content-enter impact-surface`}
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {withCloseHandler(children)}
        </div>
      )}
    </div>
  );
}

// Menu item component
interface DropdownItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: React.ReactNode;
  variant?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
}

export function DropdownItem({
  children,
  onClick,
  icon,
  variant = 'default',
  disabled = false,
}: DropdownItemProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      role="menuitem"
      // `primary` marks the action the menu exists for. The accent is the one
      // colour this design holds back for a single thing at a time, so it reads
      // as "this is the button" without a filled block shouting in a menu of
      // quiet rows.
      className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors focus-ring${
        variant === 'primary' ? ' dropdown-item-primary' : ''
      }`}
      style={{
        color:
          variant === 'danger'
            ? 'var(--error)'
            : variant === 'primary'
              ? 'var(--accent)'
              : 'var(--text-primary)',
        fontWeight: variant === 'primary' ? 600 : undefined,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
      disabled={disabled}
      aria-disabled={disabled}
    >
      {icon && <span className="w-4 h-4 flex-shrink-0">{icon}</span>}
      {children}
    </button>
  );
}

/**
 * A filter box that lives inside a menu without dismissing it.
 *
 * `Dropdown` closes on any child's click so that picking an item works without
 * every caller wiring it up. That is wrong for a text field: the first click to
 * focus it would shut the menu. `Dropdown` skips the close handler for this
 * component specifically, which is why it has to be its own type rather than a
 * plain `<input>` passed as a child.
 */
export function DropdownSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
}) {
  return (
    <div className="px-2 pb-1" onClick={(event) => event.stopPropagation()}>
      <input
        type="text"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-2 py-1 text-sm focus-ring"
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-muted)',
          color: 'var(--text-primary)',
        }}
      />
    </div>
  );
}

/**
 * A region of a menu that does not dismiss it.
 *
 * `Dropdown` closes on any child's click, which is right for a choice that ends
 * the interaction and wrong for one that sets up the next step. Choosing which
 * site to publish to is the second kind: closing there hides the Publish button
 * the choice was made for, and you have to reopen the menu to find it.
 */
export function DropdownStatic({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// Divider component
export function DropdownDivider() {
  return <div className="my-1" style={{ borderTop: '1px solid var(--border-muted)' }} />;
}

// Label/header component
export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-header px-3 py-1.5">{children}</div>;
}
