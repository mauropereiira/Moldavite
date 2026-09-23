import { useEffect, useState } from 'react';
import { useForgeStore } from '@/stores';
import { useToast } from '@/hooks/useToast';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { DialogSurface } from '@/components/ui/DialogSurface';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { isMobilePlatform } from '@/lib/platform';
import SyncedForgeControl from '@/components/settings/SyncedForgeControl';

interface ManageForgesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ManageForgesModal({ isOpen, onClose }: ManageForgesModalProps) {
  const { forges, forgesRoot, loadForges, renameForge, deleteForge, setForgesRoot } =
    useForgeStore();
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const toast = useToast();
  const mobile = isMobilePlatform();

  useEffect(() => {
    if (isOpen) loadForges().catch(() => undefined);
  }, [isOpen, loadForges]);

  if (!isOpen) return null;

  const handleRename = async (oldName: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingName(null);
      return;
    }
    try {
      await renameForge(oldName, trimmed);
      toast.success(`Renamed "${oldName}" to "${trimmed}"`);
      setRenamingName(null);
      setRenameValue('');
    } catch (e) {
      toast.error(`Rename failed: ${(e as Error).message}`);
    }
  };

  // An in-app dialog: WKWebView on iOS shows no window.confirm, so the
  // delete silently did nothing there.
  const handleDelete = async (name: string) => {
    setConfirmingDelete(null);
    try {
      await deleteForge(name);
      toast.success(`Forge "${name}" deleted`);
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    }
  };

  const handlePickRoot = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Pick Forges root directory',
      });
      if (typeof selected !== 'string') return;
      const resolved = await setForgesRoot(selected);
      toast.success(`Forges root set to ${resolved}`);
    } catch (e) {
      toast.error(`Could not set Forges root: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <div
        className="forge-management-backdrop fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'color-mix(in srgb, var(--text-primary) 40%, transparent)' }}
        onClick={onClose}
      >
        <DialogSurface
          onEscape={onClose}
          aria-labelledby="manage-forges-title"
          className="forge-management-dialog rounded-lg w-full max-w-md p-5"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 id="manage-forges-title" className="text-base font-semibold">
              Manage Forges
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 text-sm rounded hover:bg-[var(--bg-hover)]"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            {mobile ? (
              'These Forges are stored on this device.'
            ) : (
              <>
                Forges root:{' '}
                <span className="font-mono break-all">{forgesRoot ?? '(not set)'}</span>
              </>
            )}
          </div>

          <div className="space-y-1 max-h-72 overflow-y-auto">
            {forges.length === 0 ? (
              <div className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                No Forges yet.
              </div>
            ) : (
              forges
                .filter((forge) => !forge.isSynced)
                .map((f) => (
                  <div
                    key={f.id ?? f.name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded"
                    style={{ background: 'var(--bg-default)' }}
                  >
                    {renamingName === f.name ? (
                      <input
                        type="text"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename(f.name);
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            setRenamingName(null);
                            setRenameValue('');
                          }
                        }}
                        onBlur={() => void handleRename(f.name)}
                        className="flex-1 min-w-0 px-2 py-1 text-sm rounded border bg-transparent"
                        style={{
                          borderColor: 'var(--border-default)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    ) : (
                      <span className="flex-1 text-sm truncate">
                        {f.name}
                        {f.isActive && (
                          <span
                            className="ml-2"
                            style={{ color: 'var(--text-muted)', fontSize: '11px' }}
                          >
                            active
                          </span>
                        )}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingName(f.name);
                        setRenameValue(f.name);
                      }}
                      className="text-xs px-2 py-0.5 rounded hover:bg-[var(--bg-hover)]"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-disabled={f.isActive || undefined}
                      onClick={() =>
                        f.isActive
                          ? toast.error('Switch to another Forge before deleting this one')
                          : setConfirmingDelete(f.name)
                      }
                      className="text-xs px-2 py-0.5 rounded hover:bg-[var(--bg-hover)]"
                      style={f.isActive ? { opacity: 0.4 } : undefined}
                    >
                      Delete
                    </button>
                  </div>
                ))
            )}
          </div>

          <SyncedForgeControl />

          <div className="mt-4 flex items-center justify-between">
            {!mobile && (
              <button
                type="button"
                onClick={() => void handlePickRoot()}
                className="text-xs px-3 py-1.5 rounded border"
                style={{ borderColor: 'var(--border-default)' }}
              >
                Change Forges root…
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded ml-auto"
              style={{
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
              }}
            >
              Done
            </button>
          </div>
        </DialogSurface>
      </div>
      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete the Forge "${confirmingDelete}"?`}
          message="All notes inside it will be removed permanently."
          confirmLabel="Delete Forge"
          danger
          onConfirm={() => void handleDelete(confirmingDelete)}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </>
  );
}
