import React, { RefAttributes } from 'react';
import { LucideIcon, LucideProps } from 'lucide-react';
import { SignatureMark } from './SignatureMark';

const LazyWelcomeScreen = React.lazy(() =>
  import('./WelcomeScreen').then(({ WelcomeEmptyState }) => ({ default: WelcomeEmptyState }))
);

export function WelcomeEmptyState({
  onCreateToday,
  onCreateNote,
}: {
  onCreateToday: () => void;
  onCreateNote: () => void;
}) {
  return (
    <React.Suspense fallback={null}>
      <LazyWelcomeScreen onCreateToday={onCreateToday} onCreateNote={onCreateNote} />
    </React.Suspense>
  );
}

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'outline';
  icon?: LucideIcon;
}

interface EmptyStateProps {
  icon:
    | LucideIcon
    | ((props: Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>) => React.ReactElement);
  heading: string;
  message?: string;
  actions?: EmptyStateAction[];
  hint?: string;
  features?: string[];
  variant?: 'default' | 'compact' | 'card';
  iconColor?: string;
  iconClassName?: string;
  className?: string;
}

function SignatureIcon({ className }: LucideProps & RefAttributes<SVGSVGElement>) {
  return <SignatureMark className={className} />;
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
  iconClassName,
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
      <div className="mb-6" style={{ color: iconColor || 'var(--text-muted)' }}>
        <Icon className={iconClassName ?? iconSizes[variant]} strokeWidth={1.5} />
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

export function NoSearchResultsEmptyState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <EmptyState
      icon={SignatureIcon}
      iconClassName="w-5 h-5"
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
      iconColor="var(--text-muted)"
    />
  );
}

export function NoEventsEmptyState() {
  return (
    <EmptyState
      icon={SignatureIcon}
      iconClassName="w-5 h-5"
      heading="No events today"
      message="Enjoy your free time! Your calendar is clear."
      variant="compact"
      iconColor="var(--text-muted)"
    />
  );
}

/**
 * Which sources are offered depends on the platform and the build, so the
 * caller supplies the buttons rather than this component assuming one.
 */
export function ConnectCalendarEmptyState({
  actions,
}: {
  actions: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' }[];
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
        'Read-only — Moldavite never changes an event',
        'Add or remove sources any time in Settings',
      ]}
      actions={actions}
      variant="card"
      iconColor="var(--text-secondary)"
    />
  );
}

export function NoBacklinksEmptyState() {
  return (
    <EmptyState
      icon={SignatureIcon}
      iconClassName="w-5 h-5"
      heading="No backlinks yet"
      message="When another note links to this one with [[wiki links]], it will show up here."
      variant="compact"
      iconColor="var(--text-muted)"
    />
  );
}

export function EmptyTrashEmptyState() {
  return (
    <EmptyState
      icon={SignatureIcon}
      iconClassName="w-5 h-5"
      heading="Trash is empty"
      message="Deleted notes and folders appear here for 7 days before being removed permanently."
      variant="compact"
      iconColor="var(--text-muted)"
    />
  );
}

export function EmptyGraphEmptyState() {
  return (
    <EmptyState
      icon={SignatureIcon}
      iconClassName="w-5 h-5"
      heading="Your graph is empty"
      message="Create notes and connect them with [[wiki links]] to see your knowledge graph take shape."
      variant="compact"
      iconColor="var(--text-muted)"
    />
  );
}

export function NoNotesEmptyState({ onCreateNote }: { onCreateNote: () => void }) {
  return (
    <EmptyState
      icon={SignatureIcon}
      iconClassName="w-5 h-5"
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
      iconColor="var(--text-muted)"
    />
  );
}
