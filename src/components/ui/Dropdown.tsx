import React, { useState, useRef, useEffect } from 'react';

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  position?: 'left' | 'right' | 'center';
  openDirection?: 'up' | 'down';
  className?: string;
}

export function Dropdown({ trigger, children, position = 'left', openDirection = 'down', className = '' }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const directionClasses = openDirection === 'up'
    ? 'bottom-full mb-1'
    : 'top-full mt-1';

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <div onClick={() => setIsOpen(!isOpen)}>
        {trigger}
      </div>

      {isOpen && (
        <div
          ref={menuRef}
          className={`absolute ${directionClasses} ${positionClasses[position]} z-50 min-w-[180px] py-1 modal-content-enter`}
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {React.Children.map(children, (child) => {
            if (React.isValidElement(child)) {
              return React.cloneElement(child as React.ReactElement<{ onClick?: () => void }>, {
                onClick: () => {
                  if ((child as React.ReactElement<{ onClick?: () => void }>).props.onClick) {
                    (child as React.ReactElement<{ onClick?: () => void }>).props.onClick?.();
                  }
                  setIsOpen(false);
                },
              });
            }
            return child;
          })}
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
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

export function DropdownItem({ children, onClick, icon, variant = 'default', disabled = false }: DropdownItemProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors"
      style={{
        color: variant === 'danger' ? 'var(--error)' : 'var(--text-primary)',
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
    >
      {icon && <span className="w-4 h-4 flex-shrink-0">{icon}</span>}
      {children}
    </button>
  );
}

// Divider component
export function DropdownDivider() {
  return <div className="my-1" style={{ borderTop: '1px solid var(--border-muted)' }} />;
}

// Label/header component
export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-header px-3 py-1.5">
      {children}
    </div>
  );
}
