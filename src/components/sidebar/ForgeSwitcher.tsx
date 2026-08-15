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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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

  const label = active ?? 'Forge';

  return (
    <div ref={wrapRef} className="relative px-3 pt-4">
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
        className="w-full flex items-center justify-between gap-2 px-1 pb-3 text-left"
        style={{
          color: 'var(--text-primary)',
          borderBottom: '1px solid var(--border-default)',
          fontFamily: 'var(--font-display)',
          fontSize: '20px',
          fontWeight: 500,
          letterSpacing: '-0.015em',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch Forge"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="truncate">{label}</span>
        </span>
        <span aria-hidden="true" className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          ↓
        </span>
      </button>

      {open && (
        <div
          ref={applyImpactOrigin}
          role="listbox"
          className="absolute z-30 left-3 right-3 top-full mt-1 border overflow-hidden modal-content-enter impact-surface"
          style={{
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-default)',
          }}
        >
          {forges.length === 0 && (
            <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              No Forges found.
            </div>
          )}
          {forges.map((f) => (
            <button
              key={f.name}
              type="button"
              role="option"
              aria-selected={f.isActive}
              onClick={() => handleSwitch(f.name)}
              className="w-full text-left px-3 py-1.5 text-sm flex items-center justify-between"
              style={{ color: 'var(--text-primary)' }}
            >
              <span className="truncate">{f.name}</span>
              {f.isActive && (
                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>active</span>
              )}
            </button>
          ))}

          <div className="border-t" style={{ borderColor: 'var(--border-default)' }} />

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
              className="w-full text-left px-3 py-1.5 text-sm"
              style={{ color: 'var(--text-primary)' }}
            >
              New Forge
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
            className="w-full text-left px-3 py-1.5 text-sm"
            style={{ color: 'var(--text-primary)' }}
          >
            Manage Forges…
          </button>
        </div>
      )}
    </div>
  );
}
