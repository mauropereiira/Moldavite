import { useEffect, useState } from 'react';
import { isMobilePlatform } from '@/lib/platform';
import {
  getDefaultMarkdownAppStatus,
  makeDefaultLabel,
  makeDefaultMarkdownApp,
  type DefaultAppStatus,
} from '@/lib/defaultApp';
import { Row } from './common';

function statusText(status: DefaultAppStatus): string | null {
  if (status.mode === 'open-settings') {
    return 'Windows asks you to choose: search for .md in Default Apps and pick Moldavite.';
  }
  if (status.isDefault === null) return null;
  return status.isDefault ? 'Moldavite opens .md files' : 'Another app opens .md files';
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
    <Row
      id="default-app"
      note={
        <>
          {statusText(status)}
          {error && <span className="settings-error">{error}</span>}
        </>
      }
    >
      {status.isDefault !== true && (
        <button
          type="button"
          onClick={handleMakeDefault}
          disabled={isWorking}
          className="settings-btn"
        >
          {makeDefaultLabel(status)}
        </button>
      )}
    </Row>
  );
}
