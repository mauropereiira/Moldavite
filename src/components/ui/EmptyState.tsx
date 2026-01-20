import React, { RefAttributes } from 'react';
import { LucideIcon, LucideProps } from 'lucide-react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'outline';
  icon?: LucideIcon;
}

interface EmptyStateProps {
  icon: LucideIcon | ((props: Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>) => React.ReactElement);
  heading: string;
  message?: string;
  actions?: EmptyStateAction[];
  hint?: string;
  features?: string[];
  variant?: 'default' | 'compact' | 'card';
  iconColor?: string;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  heading,
  message,
  actions,
  hint,
  features,
  variant = 'default',
  iconColor,
  className = '',
}: EmptyStateProps) {
  const containerClasses = {
    default: 'py-12 px-6',
    compact: 'py-6 px-4',
    card: 'py-8 px-6 rounded-xl',
  };

  const containerStyles = {
    default: {},
    compact: {},
    card: {
      backgroundColor: 'var(--bg-inset)',
      border: '1px solid var(--border-muted)',
    },
  };

  const iconSizes = {
    default: 'w-12 h-12',
    compact: 'w-8 h-8',
    card: 'w-10 h-10',
  };

  const headingSizes = {
    default: 'text-xl',
    compact: 'text-sm',
    card: 'text-lg',
  };

  return (
    <div
      className={`flex flex-col items-center justify-center text-center max-w-md mx-auto content-enter ${containerClasses[variant]} ${className}`}
      style={containerStyles[variant]}
    >
      {/* Icon */}
      <div
        className={`mb-6 ${iconColor || ''}`}
        style={iconColor ? undefined : { color: 'var(--text-muted)' }}
      >
        <Icon className={iconSizes[variant]} strokeWidth={1.5} />
      </div>

      {/* Heading */}
      <h3
        className={`font-semibold mb-2 ${headingSizes[variant]}`}
        style={{ color: 'var(--text-primary)' }}
      >
        {heading}
      </h3>

      {/* Message */}
      {message && (
        <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
      )}

      {/* Features list */}
      {features && features.length > 0 && (
        <ul className="text-sm mb-6 space-y-2 text-left" style={{ color: 'var(--text-secondary)' }}>
          {features.map((feature, index) => (
            <li key={index} className="flex items-center gap-2">
              <span style={{ color: 'var(--success)' }}>✓</span>
              {feature}
            </li>
          ))}
        </ul>
      )}

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          {actions.map((action, index) => {
            const ActionIcon = action.icon;
            const baseClasses =
              'px-4 py-2 text-sm font-medium rounded-lg transition-all btn-interactive flex items-center gap-2 justify-center focus-ring';
            const variantClasses = {
              primary: 'text-white btn-primary btn-primary-gradient',
              secondary: '',
              outline: 'bg-transparent',
            };
            const variantStyles = {
              primary: {},
              secondary: {
                color: 'var(--text-primary)',
                backgroundColor: 'var(--bg-inset)',
              },
              outline: {
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
              },
            };

            return (
              <button
                key={index}
                onClick={action.onClick}
                className={`${baseClasses} ${variantClasses[action.variant || 'primary']}`}
                style={variantStyles[action.variant || 'primary']}
              >
                {ActionIcon && <ActionIcon className="w-4 h-4" />}
                {action.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Hint */}
      {hint && (
        <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

// Pre-built empty state variants
export function WelcomeEmptyState({
  onCreateToday,
  onCreateNote,
}: {
  onCreateToday: () => void;
  onCreateNote: () => void;
}) {
  return (
    <EmptyState
      icon={({ className }) => (
        <img
          src="/logo.png"
          alt="Notomattic Logo"
          className={className}
        />
      )}
      heading="Welcome to Notomattic"
      message="Your privacy-first note-taking app. All your notes stay on your Mac, never uploaded anywhere."
      actions={[
        {
          label: "Today's Note",
          onClick: onCreateToday,
          variant: 'primary',
        },
        {
          label: 'New Note',
          onClick: onCreateNote,
          variant: 'outline',
        },
      ]}
      hint="Press ⌘N to create a note"
      iconColor="text-blue-400 dark:text-blue-500"
    />
  );
}

export function NoSearchResultsEmptyState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <EmptyState
      icon={({ className, strokeWidth }) => (
        <svg
          className={className}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={strokeWidth}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
      )}
      heading="No notes found"
      message={`No results for "${query}". Try different keywords or create a new note.`}
      actions={[
        {
          label: 'Clear Search',
          onClick: onClear,
          variant: 'secondary',
        },
      ]}
      variant="compact"
      iconColor="text-gray-400 dark:text-gray-500"
    />
  );
}

export function NoEventsEmptyState() {
  return (
    <EmptyState
      icon={({ className, strokeWidth }) => (
        <svg
          className={className}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={strokeWidth}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z"
          />
        </svg>
      )}
      heading="No events today"
      message="Enjoy your free time! Your calendar is clear."
      variant="compact"
      iconColor="text-green-400 dark:text-green-500"
    />
  );
}

export function ConnectCalendarEmptyState({
  onConnect,
  isConnecting,
}: {
  onConnect: () => void;
  isConnecting: boolean;
}) {
  return (
    <EmptyState
      icon={({ className, strokeWidth }) => (
        <svg
          className={className}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={strokeWidth}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
          />
        </svg>
      )}
      heading="Connect Your Calendar"
      message="View your daily schedule alongside your notes"
      features={[
        'See all your events at a glance',
        'Works with iCloud, Google & Exchange',
        'Completely private - stays on your Mac',
      ]}
      actions={[
        {
          label: isConnecting ? 'Connecting...' : 'Enable Calendar Access',
          onClick: onConnect,
          variant: 'primary',
        },
      ]}
      variant="card"
      iconColor="text-blue-400 dark:text-blue-500"
    />
  );
}

export function NoNotesEmptyState({ onCreateNote }: { onCreateNote: () => void }) {
  return (
    <EmptyState
      icon={({ className, strokeWidth }) => (
        <svg
          className={className}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={strokeWidth}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
      )}
      heading="No notes yet"
      message="Create your first note to get started"
      actions={[
        {
          label: 'Create Note',
          onClick: onCreateNote,
          variant: 'primary',
        },
      ]}
      variant="compact"
      iconColor="text-gray-400 dark:text-gray-500"
    />
  );
}
