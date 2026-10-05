import { useEffect, useRef, useState } from 'react';
import { useForgeStore } from '@/stores';
import { useToast } from '@/hooks/useToast';
import { applyImpactOrigin, captureImpactOrigin, clearImpactOrigin } from '@/lib/impactOrigin';

interface ForgeSwitcherProps {
  onManage: () => void;
}

/**
 * Sidebar header dropdown that lets the user pick which Forge to work in.
 *
 * Switching reloads the window — the same trick `set_notes_directory`
 * already uses — so every store and cache rebinds against the new Forge root.
 *
 * The watcher is *not* covered by that reload: it lives in the Rust process,
 * which the webview reload does not restart. `set_active_forge` swaps it over
 * explicitly through `WatcherSlot`.
 */
export function ForgeSwitcher({ onManage }: ForgeSwitcherProps) {
  const { forges, active, loadForges, switchTo, createForge } = useForgeStore();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    loadForges().catch(() => {
      // Non-fatal — single-Forge users may not have a forges_root yet.
    });
  }, [loadForges]);

  // Listen for the QuickSwitcher "Switch Forge…" command which dispatches
  // a window event after closing itself.
  useEffect(() => {
    const onOpen = () => {
      clearImpactOrigin();
      void loadForges().finally(() => setOpen(true));
    };
    window.addEventListener('moldavite:open-forge-switcher', onOpen);
    return () => window.removeEventListener('moldavite:open-forge-switcher', onOpen);
  }, [loadForges]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewName('');
      }
    };
    // Marked handled so the window's Esc handler leaves the open note alone.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setCreating(false);
        setNewName('');
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSwitch = async (name: string) => {
    setOpen(false);
    try {
      await switchTo(name);
    } catch (e) {
      toast.error(`Failed to switch Forge: ${(e as Error).message}`);
    }
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await createForge(trimmed);
      setNewName('');
      setCreating(false);
      toast.success(`Forge "${trimmed}" created`);
    } catch (e) {
      toast.error(`Could not create Forge: ${(e as Error).message}`);
    }
  };

  const label =
    forges.find((forge) => (forge.id ?? forge.name) === active)?.name ?? active ?? 'Forge';

  return (
    <div ref={wrapRef} className="forge-switcher relative px-3 pt-4">
      <div
        className="forge-switcher-head relative pb-3"
        style={{ borderBottom: '1px solid var(--border-default)' }}
      >
        <button
          type="button"
          // Re-list on open: the Forge list is otherwise only loaded at mount, so
          // a Forge created outside this window (an agent over MCP, the Obsidian
          // importer, or anything writing to the Forges root) stayed invisible
          // until the app was restarted.
          onClick={(event) => {
            if (!open) captureImpactOrigin(event.currentTarget);
            setOpen((v) => {
              if (!v) void loadForges().catch(() => {});
              return !v;
            });
          }}
          // As wide as the name, not the column: a full-width trigger put its
          // caret on the Index overlay's close button and its hover fill across
          // the whole window. The small caption says what the name is, and the
          // caret that it opens.
          className="forge-switcher-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Forge: ${label}. Switch Forge`}
          title="Switch Forge"
        >
          <span className="forge-switcher-caption" aria-hidden="true">
            Forge
          </span>
          <span className="forge-switcher-name">
            <span className="truncate">{label}</span>
            <span aria-hidden="true" className="forge-switcher-caret" />
          </span>
        </button>

        {open && (
          <div
            ref={applyImpactOrigin}
            role="listbox"
            aria-label="Forges"
            className="forge-switcher-menu flex flex-col modal-content-enter impact-surface"
          >
            {forges.length === 0 && (
              <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                No Forges found.
              </div>
            )}
            {forges.map((f) => (
              <button
                key={f.id ?? f.name}
                type="button"
                role="option"
                aria-selected={f.isActive}
                onClick={() => handleSwitch(f.id ?? f.name)}
                className="forge-switcher-row flex items-center justify-between gap-6"
              >
                <span className="truncate">
                  {f.name}
                  {f.isSynced ? ' · iCloud' : ''}
                </span>
                {f.isActive && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>active</span>
                )}
              </button>
            ))}

            <div className="forge-switcher-divider" />

            {creating ? (
              <div className="px-3 py-2 flex items-center gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate();
                    if (e.key === 'Escape') {
                      setCreating(false);
                      setNewName('');
                    }
                  }}
                  placeholder="Forge name"
                  autoFocus
                  className="flex-1 px-2 py-1 text-sm border bg-transparent"
                  style={{
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  className="px-2 py-1 text-xs border"
                  style={{
                    background: 'transparent',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="forge-switcher-row"
              >
                New Forge…
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreating(false);
                setNewName('');
                onManage();
              }}
              className="forge-switcher-row"
            >
              Manage Forges…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
