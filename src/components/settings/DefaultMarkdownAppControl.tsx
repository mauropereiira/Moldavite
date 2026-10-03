import { useEffect, useState } from 'react';
import { isMobilePlatform } from '@/lib/platform';
import {
  getDefaultMarkdownAppStatus,
  makeDefaultLabel,
  makeDefaultMarkdownApp,
  type DefaultAppStatus,
} from '@/lib/defaultApp';

function guidance(status: DefaultAppStatus): string {
  if (status.mode === 'open-settings') {
    return 'Windows asks you to choose: search for .md in Default Apps and pick Moldavite.';
  }
  return status.isDefault
    ? 'Double-click a .md file anywhere and it opens here.'
    : 'Make Moldavite the app that opens a double-clicked .md file.';
}

export default function DefaultMarkdownAppControl() {
  const mobile = isMobilePlatform();
  const [status, setStatus] = useState<DefaultAppStatus | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mobile) return;
    let cancelled = false;
    getDefaultMarkdownAppStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [mobile]);

  if (mobile || !status || status.mode === 'unsupported') return null;

  const handleMakeDefault = async () => {
    setError(null);
    setIsWorking(true);
    try {
      setStatus(await makeDefaultMarkdownApp());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div
      className="p-4 space-y-3"
      style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
    >
      <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        Default app for Markdown files
      </h3>
      <div className="flex items-center justify-between gap-3">
        <div>
          {status.isDefault !== null && (
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {status.isDefault ? 'Moldavite opens .md files' : 'Another app opens .md files'}
            </span>
          )}
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {guidance(status)}
          </p>
        </div>
        {status.isDefault !== true && (
          <button
            type="button"
            onClick={handleMakeDefault}
            disabled={isWorking}
            className="flex-shrink-0 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'transparent',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            {makeDefaultLabel(status)}
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
