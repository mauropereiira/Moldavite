/**
 * Settings → Plugins → Browser clipper: install the extension, pair a browser,
 * and see which browsers are paired.
 *
 * "Install extension" never navigates on its own. It shows the steps first,
 * because both browsers are about to ask for something unusual — Developer mode
 * in Chrome, a signed file in Firefox — and meeting that for the first time on
 * chrome://extensions is how people conclude the app is broken.
 */

import { useCallback, useEffect, useState } from 'react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { Download, Globe2, Link2Off } from 'lucide-react';
import { safeInvoke } from '@/lib/ipc';
import { DialogSurface } from '@/components/ui';

const EXTENSION_URL = 'https://github.com/mauropereiira/Moldavite/tree/main/extension';

interface BridgeTarget {
  label: string;
  connected: boolean;
}

type Panel = 'chromium' | 'firefox' | null;

export function BrowserClipperCard() {
  const [targets, setTargets] = useState<BridgeTarget[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTargets(await safeInvoke<BridgeTarget[]>('browser_bridge_status'));
    } catch {
      setTargets([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connected = targets.filter((target) => target.connected).map((target) => target.label);

  const run = async (command: string) => {
    setBusy(true);
    setError(null);
    try {
      await safeInvoke(command);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setPanel(null);
  };

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Browser clipper
        </h4>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Save the page you are reading as a Markdown note. Links survive, images and styling do
          not.
        </p>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {connected.length > 0
          ? `Connected: ${connected.join(', ')}`
          : 'Not connected yet — Chrome needs Developer mode.'}
      </p>

      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            backgroundColor: 'transparent',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          <Download aria-hidden="true" className="w-4 h-4" />
          Install extension
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run('connect_browser_bridge')}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            backgroundColor: 'transparent',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
          }}
        >
          <Globe2 aria-hidden="true" className="w-4 h-4" />
          Connect browser
        </button>
        {connected.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('disconnect_browser_bridge')}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'transparent',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          >
            <Link2Off aria-hidden="true" className="w-4 h-4" />
            Disconnect
          </button>
        )}
      </div>

      {sheetOpen && (
        <div
          className="settings-scrim fixed inset-0 z-[10000] flex items-center justify-center modal-backdrop-enter"
          onMouseDown={(event) => event.target === event.currentTarget && closeSheet()}
        >
          <DialogSurface
            onEscape={closeSheet}
            aria-labelledby="clipper-install-title"
            className="settings-dialog modal-content-enter p-6"
            style={{ width: 'min(30rem, calc(100% - 2rem))' }}
          >
            <h2
              id="clipper-install-title"
              className="text-lg font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              Install the clipper
            </h2>

            <div className="mt-4 space-y-2">
              <Disclosure
                label="Chrome, Edge & Brave"
                open={panel === 'chromium'}
                onToggle={() => setPanel(panel === 'chromium' ? null : 'chromium')}
              >
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    Download and unzip <code>moldavite-clipper-chrome.zip</code>.
                  </li>
                  <li>
                    Open <code>chrome://extensions</code> and turn on{' '}
                    <strong>Developer mode</strong>.
                  </li>
                  <li>
                    Click <strong>Load unpacked</strong> and choose the unzipped folder.
                  </li>
                </ol>
                <p className="mt-2">
                  Chrome only allows extensions from outside its store in Developer mode. That is
                  Chrome&apos;s rule for anything unlisted, not a warning about this extension.
                </p>
              </Disclosure>

              <Disclosure
                label="Firefox"
                open={panel === 'firefox'}
                onToggle={() => setPanel(panel === 'firefox' ? null : 'firefox')}
              >
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    Download <code>moldavite-clipper.xpi</code>.
                  </li>
                  <li>Open it in Firefox and confirm.</li>
                </ol>
                <p className="mt-2">
                  Firefox installs only signed add-ons, so this file is signed by Mozilla. It is not
                  listed in their store — the download stays here.
                </p>
              </Disclosure>
            </div>

            <p className="mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Then come back and press <strong>Connect browser</strong>.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeSheet}
                className="px-3 py-1.5 text-sm font-medium"
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                }}
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={() => {
                  void shellOpen(EXTENSION_URL);
                  closeSheet();
                }}
                className="px-3 py-1.5 text-sm font-medium"
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              >
                Understood
              </button>
            </div>
          </DialogSurface>
        </div>
      )}
    </section>
  );
}

function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: '1px solid var(--border-muted)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium"
        style={{ backgroundColor: 'transparent', color: 'var(--text-primary)' }}
      >
        {label}
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {children}
        </div>
      )}
    </div>
  );
}
