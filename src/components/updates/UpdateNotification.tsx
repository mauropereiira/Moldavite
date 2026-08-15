import { useEffect } from 'react';
import { useUpdateStore } from '@/stores';
import { DotLoader } from '@/components/ui/DotLoader';

export function UpdateNotification() {
  const {
    availableVersion,
    downloading,
    progress,
    error,
    dismissed,
    installUpdate,
    dismiss,
    startPeriodicChecks,
  } = useUpdateStore();

  // Start periodic update checks on mount
  useEffect(() => {
    const cleanup = startPeriodicChecks();
    return cleanup;
  }, [startPeriodicChecks]);

  // Don't render if no update available or dismissed
  if (!availableVersion || dismissed) {
    return null;
  }

  return (
    <section
      role="region"
      aria-label={`Update ${availableVersion} available`}
      className="update-notification-enter"
      style={{
        position: 'fixed',
        right: '16px',
        // Top-right: an update is an arrival, and the bottom-right corner is
        // where transient toasts live. This one persists until dismissed, so
        // it should not be mistaken for one.
        top: '16px',
        zIndex: 50,
        width: 'min(360px, calc(100vw - 32px))',
        backgroundColor: 'var(--bg-base)',
        border: '1px solid var(--border-strong)',
        color: 'var(--text-primary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '10px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          Update available
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update notification"
          style={{
            padding: '4px 0',
            border: 0,
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-display)',
            fontSize: '10px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>

      <div style={{ padding: '16px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
          Version{' '}
          <span style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {availableVersion}
          </span>{' '}
          is ready to install.
        </p>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: '16px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-default)',
            }}
          >
            <span
              style={{
                display: 'block',
                marginBottom: '6px',
                fontFamily: 'var(--font-display)',
                fontSize: '10px',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-error)',
              }}
            >
              Error
            </span>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-error)' }}>{error}</p>
          </div>
        )}

        {downloading && (
          <div style={{ marginTop: '16px' }}>
            <div
              aria-hidden="true"
              style={{
                position: 'relative',
                height: '1px',
                backgroundColor: 'var(--border-default)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '1px',
                  backgroundColor: 'var(--text-primary)',
                  transition: 'width var(--dur-base) var(--ease-standard)',
                }}
              />
            </div>
            <p
              style={{
                margin: '7px 0 0',
                fontFamily: 'var(--font-display)',
                fontSize: '10px',
                letterSpacing: '0.14em',
                textAlign: 'right',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              Downloading {progress}%
            </p>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '16px',
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-default)',
          }}
        >
          <button
            type="button"
            onClick={installUpdate}
            disabled={downloading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 0',
              border: 0,
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
              fontSize: '10px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: downloading ? 'default' : 'pointer',
              opacity: downloading ? 0.6 : 1,
            }}
          >
            {downloading && <DotLoader label="Installing update" />}
            {downloading ? 'Installing…' : 'Install now'}
          </button>
          {!downloading && (
            <button
              type="button"
              onClick={dismiss}
              style={{
                padding: '4px 0',
                border: 0,
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-display)',
                fontSize: '10px',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Later
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
