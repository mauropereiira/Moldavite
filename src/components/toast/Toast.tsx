import React, { useEffect, useState } from 'react';
import { Toast as ToastType } from '../../stores/toastStore';

interface ToastProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
    }, toast.duration);

    return () => clearTimeout(timer);
  }, [toast.duration]);

  useEffect(() => {
    if (isExiting) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, 200); // Match exit animation duration

      return () => clearTimeout(timer);
    }
  }, [isExiting, onDismiss, toast.id]);

  const handleDismiss = () => {
    setIsExiting(true);
  };

  const isSuccess = toast.type === 'success';

  return (
    <div
      className={`
        pointer-events-auto flex flex-col min-w-72 max-w-96
        rounded-md border-l-4 shadow-lg overflow-hidden
        ${isExiting ? 'toast-exit-new' : 'toast-enter-new'}
      `}
      style={{
        backgroundColor: isSuccess ? 'var(--success-muted)' : 'var(--error-muted)',
        borderLeftColor: isSuccess ? 'var(--success)' : 'var(--error)',
        color: isSuccess ? 'var(--success)' : 'var(--error)',
      }}
      role="alert"
    >
      <div className="flex items-center p-3 px-4">
      {/* Icon */}
      <span
        className="w-5 h-5 mr-3 flex-shrink-0 flex items-center justify-center"
        style={{ color: isSuccess ? 'var(--success)' : 'var(--error)' }}
      >
        {isSuccess ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-5 h-5"
          >
            <path
              fillRule="evenodd"
              d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-5 h-5"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </span>

      {/* Message */}
      <span className="text-sm font-medium flex-1">{toast.message}</span>

      {/* Close button */}
      <button
        onClick={handleDismiss}
        className="ml-3 p-1 rounded transition-colors focus-ring"
        style={{ color: isSuccess ? 'var(--success)' : 'var(--error)', opacity: 0.7 }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
        aria-label="Dismiss"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
        >
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full" style={{ backgroundColor: 'var(--border-muted)' }}>
        <div
          className="h-full toast-progress-bar"
          style={{
            backgroundColor: isSuccess ? 'var(--success)' : 'var(--error)',
            '--duration': `${toast.duration}ms`,
          } as React.CSSProperties}
        />
      </div>
    </div>
  );
};
