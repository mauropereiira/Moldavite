import { useEffect, useState } from 'react';
import { useForgeStore } from '@/stores';
import { useToast } from '@/hooks/useToast';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

interface ManageForgesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ManageForgesModal({ isOpen, onClose }: ManageForgesModalProps) {
  const { forges, forgesRoot, loadForges, renameForge, deleteForge, setForgesRoot } =
    useForgeStore();
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const toast = useToast();

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

  const handleDelete = async (name: string) => {
    const ok = window.confirm(
      `Delete the Forge "${name}"? All notes inside it will be removed permanently.`,
    );
    if (!ok) return;
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg shadow-xl w-full max-w-md p-5"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Manage Forges</h2>
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
          Forges root: <span className="font-mono break-all">{forgesRoot ?? '(not set)'}</span>
        </div>

        <div className="space-y-1 max-h-72 overflow-y-auto">
          {forges.length === 0 ? (
            <div className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
              No Forges yet.
            </div>
          ) : (
            forges.map((f) => (
              <div
                key={f.name}
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
                        setRenamingName(null);
                        setRenameValue('');
                      }
                    }}
                    onBlur={() => void handleRename(f.name)}
                    className="flex-1 px-2 py-1 text-sm rounded border bg-transparent"
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
                  disabled={f.isActive}
                  onClick={() => void handleDelete(f.name)}
                  className="text-xs px-2 py-0.5 rounded hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title={f.isActive ? 'Switch first to delete the active Forge' : ''}
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void handlePickRoot()}
            className="text-xs px-3 py-1.5 rounded border"
            style={{ borderColor: 'var(--border-default)' }}
          >
            Change Forges root…
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded"
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-text, #fff)',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
