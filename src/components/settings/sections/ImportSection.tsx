/** Settings → Import: one-time, read-only Obsidian vault COPY import wizard. */

import { useEffect, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useForgeStore } from '@/stores/forgeStore';
import { useObsidianImportStore } from '@/stores/obsidianImportStore';
import { getForgeNameError } from '@/lib/obsidianImport';

export function ImportSection() {
  const stage = useObsidianImportStore((state) => state.stage);
  const analyze = useObsidianImportStore((state) => state.analyze);

  const chooseVault = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Choose an Obsidian vault',
    });
    if (typeof selected !== 'string') return;
    await analyze(selected).catch(() => undefined);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold obs-import-title">Import</h2>
        <p className="text-sm mt-1 obs-import-copy">
          Bring an existing vault into a new Forge without changing the source.
        </p>
      </div>
      <div className="obs-import-card space-y-4">
        <div>
          <h3 className="text-sm font-medium obs-import-title">Obsidian vault</h3>
          <p className="text-xs mt-1 obs-import-copy">
            Copy notes, supported daily notes, wiki-links, and referenced attachments into a new
            Forge. Hidden items, Canvas files, trash, and symlinks are skipped.
          </p>
        </div>
        <div className="obs-import-safe text-xs">
          The source is opened read-only. Moldavite never edits, moves, or deletes its files.
        </div>
        <button type="button" onClick={() => void chooseVault()} className="obs-import-primary">
          <FolderOpen className="w-4 h-4" /> Import Obsidian vault…
        </button>
      </div>
      {stage !== 'idle' && <Wizard chooseVault={chooseVault} />}
    </div>
  );
}

function Wizard({ chooseVault }: { chooseVault: () => Promise<void> }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const store = useObsidianImportStore();
  const switchTo = useForgeStore((state) => state.switchTo);
  const importing = store.stage === 'importing';
  const nameError = getForgeNameError(store.forgeName);
  useFocusTrap(dialogRef, store.stage !== 'idle');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (!importing) store.reset();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [importing, store]);

  const close = () => !importing && store.reset();
  const percent =
    store.progress && store.progress.total > 0
      ? Math.min(100, Math.round((store.progress.current / store.progress.total) * 100))
      : 0;

  return (
    <div
      className="fixed inset-0 z-[10000] modal-backdrop-dark flex items-center justify-center modal-backdrop-enter"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="obsidian-import-title"
        className="obs-import-modal modal-elevated modal-content-enter"
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <h2 id="obsidian-import-title" className="text-lg font-semibold obs-import-title">
            {store.stage === 'summary' ? 'Import complete' : 'Import Obsidian vault'}
          </h2>
          {!importing && (
            <button type="button" onClick={close} className="obs-import-close" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {store.stage === 'analyzing' && <Busy label="Analyzing vault…" />}

        {store.stage === 'error' && (
          <div className="space-y-5">
            <Notice tone="error">{store.error ?? 'The vault could not be analyzed.'}</Notice>
            <Actions>
              <button type="button" onClick={store.reset} className="obs-import-secondary">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void chooseVault()}
                className="obs-import-primary"
              >
                Choose another vault…
              </button>
            </Actions>
          </div>
        )}

        {store.stage === 'preview' && store.preview && (
          <div className="space-y-5">
            {!store.preview.hasObsidianDirectory && (
              <Notice tone="warning">
                No <code>.obsidian</code> folder was found. Default daily-note settings will be
                used.
              </Notice>
            )}
            <div className="obs-import-grid">
              <Metric label="Notes" value={store.preview.noteCount} />
              <Metric label="Attachments" value={store.preview.attachmentCount} />
              <Metric label="Folders" value={store.preview.folderCount} />
              <Metric label="Canvas skipped" value={store.preview.canvasCount} />
            </div>
            <div className="text-xs obs-import-copy space-y-1">
              <p>
                Daily notes:{' '}
                {store.preview.detectedDailyNotes
                  ? `${store.preview.detectedDailyNotes.folder || 'vault root'} · ${store.preview.detectedDailyNotes.format}`
                  : 'default · YYYY-MM-DD'}
              </p>
              <p>Estimated collisions: {store.preview.estimatedCollisions}</p>
            </div>
            {store.preview.warnings.length > 0 && store.preview.hasObsidianDirectory && (
              <Notice tone="warning">{store.preview.warnings.join(' · ')}</Notice>
            )}
            {store.error && <Notice tone="error">{store.error}</Notice>}
            <div>
              <label htmlFor="obsidian-forge-name" className="text-sm font-medium obs-import-title">
                New Forge name
              </label>
              <input
                id="obsidian-forge-name"
                value={store.forgeName}
                maxLength={64}
                onChange={(event) => store.setForgeName(event.target.value)}
                aria-invalid={Boolean(nameError)}
                className={`obs-import-input ${nameError ? 'is-error' : ''}`}
              />
              {nameError && <p className="obs-import-error">{nameError}</p>}
            </div>
            <Actions split>
              <button
                type="button"
                onClick={() => void chooseVault()}
                className="obs-import-secondary"
              >
                Choose another…
              </button>
              <button
                type="button"
                disabled={Boolean(nameError)}
                onClick={() => void store.startImport().catch(() => undefined)}
                className="obs-import-primary"
              >
                Import into new Forge
              </button>
            </Actions>
          </div>
        )}

        {importing && (
          <div className="space-y-5 py-6">
            <Busy label="Copying and converting…" />
            <div
              role="progressbar"
              aria-label="Obsidian import progress"
              aria-valuemin={0}
              aria-valuemax={store.progress?.total ?? 0}
              aria-valuenow={store.progress?.current ?? 0}
              className="obs-import-progress"
            >
              <div style={{ width: store.progress?.total ? `${percent}%` : '12%' }} />
            </div>
            <p className="text-xs text-right obs-import-copy">
              {store.progress?.total
                ? `${store.progress.current} of ${store.progress.total} notes`
                : 'Preparing import…'}
            </p>
          </div>
        )}

        {store.stage === 'summary' && store.report && (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 obs-import-success" />
              <div>
                <p className="text-sm font-medium obs-import-title">
                  “{store.report.forgeName}” is ready
                </p>
                <p className="text-xs mt-1 obs-import-copy">The source vault was left unchanged.</p>
              </div>
            </div>
            <div className="obs-import-grid">
              <Metric
                label="Notes"
                value={store.report.dailyNotesImported + store.report.standaloneNotesImported}
              />
              <Metric label="Daily" value={store.report.dailyNotesImported} />
              <Metric label="Attachments" value={store.report.attachmentsImported} />
              <Metric label="Links converted" value={store.report.linkConversionsPerformed} />
            </div>
            {(store.report.warnings.length > 0 || store.report.skippedItems.length > 0) && (
              <div className="obs-import-details text-xs">
                {store.report.warnings.map((warning, index) => (
                  <p key={`w-${index}`}>Warning: {warning}</p>
                ))}
                {store.report.skippedItems.map((item, index) => (
                  <p key={`s-${index}`}>
                    <code>{item.path}</code> — {item.reason}
                  </p>
                ))}
              </div>
            )}
            <Actions>
              <button type="button" onClick={store.reset} className="obs-import-secondary">
                Done
              </button>
              <button
                type="button"
                onClick={() => store.report && void switchTo(store.report.forgeName)}
                className="obs-import-primary"
              >
                <FolderOpen className="w-4 h-4" /> Open Forge
              </button>
            </Actions>
          </div>
        )}
      </div>
    </div>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <div className="obs-import-busy">
      <Loader2 className="w-6 h-6 animate-spin" /> <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="obs-import-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Actions({ children, split = false }: { children: React.ReactNode; split?: boolean }) {
  return <div className={`obs-import-actions ${split ? 'split' : ''}`}>{children}</div>;
}

function Notice({ children, tone }: { children: React.ReactNode; tone: 'warning' | 'error' }) {
  return (
    <div className={`obs-import-notice ${tone}`}>
      <AlertTriangle className="w-4 h-4" /> <span>{children}</span>
    </div>
  );
}
