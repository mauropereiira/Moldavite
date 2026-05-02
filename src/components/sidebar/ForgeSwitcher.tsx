import { useEffect, useRef, useState } from 'react';
import { useForgeStore } from '@/stores';
import { useToast } from '@/hooks/useToast';

interface ForgeSwitcherProps {
  onManage: () => void;
}

/**
 * Sidebar header dropdown that lets the user pick which Forge to work in.
 *
 * Switching reloads the window — the same trick `set_notes_directory`
 * already uses — so every store, cache, and watcher rebinds against the
 * new Forge root.
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
      void loadForges().finally(() => setOpen(true));
    };
    window.addEventListener('moldavite:open-forge-switcher', onOpen);
    return () =>
      window.removeEventListener('moldavite:open-forge-switcher', onOpen);
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
    <div ref={wrapRef} className="relative px-3 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm font-medium hover:bg-[var(--bg-hover)]"
        style={{ color: 'var(--text-primary)' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch Forge"
      >
        <span className="truncate">{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          style={{ flexShrink: 0, opacity: 0.6 }}
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-30 left-3 right-3 top-full mt-1 rounded-md border shadow-lg overflow-hidden"
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
              className="w-full text-left px-3 py-1.5 text-sm flex items-center justify-between hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              <span className="truncate">{f.name}</span>
              {f.isActive && (
                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  active
                </span>
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
                className="flex-1 px-2 py-1 text-sm rounded border bg-transparent"
                style={{
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                className="px-2 py-1 text-xs rounded"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--accent-text, #fff)',
                }}
              >
                Create
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              + New Forge
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
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-primary)' }}
          >
            Manage Forges…
          </button>
        </div>
      )}
    </div>
  );
}
