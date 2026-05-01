/**
 * AppOnboardingModal — first-run app-level onboarding.
 *
 * Three-step flow: Welcome → Pick your Forge → Quick tour.
 * Visibility is gated by `useSettingsStore.hasSeenAppOnboarding`. The flag is
 * persisted via Zustand `persist`, so the modal only appears on first launch
 * (or when the user explicitly clears it from Settings → About).
 *
 * Esc on steps 1 and 2 is a no-op (matches `CalendarOnboardingModal` UX —
 * onboarding requires explicit dismissal). Step 3 closes on completion.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  PanelLeft,
  Edit3,
  Network,
  Search,
  RefreshCw,
} from 'lucide-react';
import { open as openDirDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '@/stores/settingsStore';
import { getNotesDirectory, setNotesDirectory } from '@/lib/fileSystem';

type Step = 0 | 1 | 2;

export function AppOnboardingModal() {
  const { hasSeenAppOnboarding, setHasSeenAppOnboarding } = useSettingsStore();
  const [step, setStep] = useState<Step>(0);
  const [forgePath, setForgePath] = useState<string>('');
  const [isPicking, setIsPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const isOpen = !hasSeenAppOnboarding;

  // Load Forge path when entering step 2.
  useEffect(() => {
    if (!isOpen) return;
    if (step !== 1) return;
    let cancelled = false;
    getNotesDirectory()
      .then((p) => {
        if (!cancelled) setForgePath(p);
      })
      .catch(() => {
        if (!cancelled) setForgePath('');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, step]);

  // Focus management: move focus to primary action on open / step change,
  // restore previously-focused element on close.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    // Defer to ensure the button is rendered.
    const id = window.setTimeout(() => {
      primaryButtonRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [isOpen, step]);

  useEffect(() => {
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  const close = useCallback(() => {
    setHasSeenAppOnboarding(true);
    // Restore focus to whatever was focused before the modal opened.
    previouslyFocusedRef.current?.focus?.();
  }, [setHasSeenAppOnboarding]);

  const goNext = useCallback(() => {
    setStep((s) => (s < 2 ? ((s + 1) as Step) : s));
  }, []);

  const goBack = useCallback(() => {
    setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
  }, []);

  // Keyboard handling: trap focus within the dialog and gate Esc.
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only allow Esc to close on the final step. Earlier steps require
        // explicit dismissal so users don't skip onboarding by accident.
        if (step === 2) {
          e.preventDefault();
          close();
        } else {
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, step, close]);

  const handlePickFolder = useCallback(async () => {
    setPickError(null);
    setIsPicking(true);
    try {
      const selected = await openDirDialog({
        directory: true,
        title: 'Select Forge Directory',
      });
      if (selected && typeof selected === 'string') {
        await setNotesDirectory(selected);
        setForgePath(selected);
      }
    } catch (err) {
      setPickError(String(err));
    } finally {
      setIsPicking(false);
    }
  }, []);

  const tourTiles = useMemo(
    () => [
      {
        icon: <PanelLeft className="w-5 h-5" aria-hidden="true" />,
        title: 'Sidebar',
        body: 'Notes, folders, and tags — all one click away.',
      },
      {
        icon: <Edit3 className="w-5 h-5" aria-hidden="true" />,
        title: 'Editor',
        body: 'Markdown, [[wiki-links]], and slash commands.',
      },
      {
        icon: <Network className="w-5 h-5" aria-hidden="true" />,
        title: 'Graph view',
        body: 'See how your notes connect (⌘⇧G).',
      },
      {
        icon: <Search className="w-5 h-5" aria-hidden="true" />,
        title: 'Quick switcher',
        body: 'Jump to any note instantly (⌘P).',
      },
    ],
    [],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
      data-testid="app-onboarding-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-onboarding-title"
        className="modal-elevated modal-content-enter overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-md)',
          maxWidth: '32rem',
          width: 'calc(100% - 2rem)',
        }}
      >
        <div className="p-8">
          {/* Step indicators */}
          <div className="flex justify-center gap-2 mb-6" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === step ? '1.5rem' : '0.5rem',
                  backgroundColor:
                    i === step ? 'var(--accent-primary)' : 'var(--border-default)',
                }}
              />
            ))}
          </div>

          {step === 0 && (
            <WelcomeStep titleId="app-onboarding-title" />
          )}

          {step === 1 && (
            <ForgeStep
              titleId="app-onboarding-title"
              forgePath={forgePath}
              isPicking={isPicking}
              pickError={pickError}
              onPickFolder={handlePickFolder}
            />
          )}

          {step === 2 && (
            <TourStep titleId="app-onboarding-title" tiles={tourTiles} />
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-8">
            <div>
              {step > 0 && (
                <button
                  type="button"
                  onClick={goBack}
                  className="px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 focus-ring"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {step < 2 ? (
                <button
                  ref={primaryButtonRef}
                  type="button"
                  onClick={goNext}
                  className="px-4 py-2 text-sm font-medium text-white transition-colors flex items-center gap-1.5 focus-ring"
                  style={{
                    backgroundColor: 'var(--accent-primary)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  Next
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              ) : (
                <button
                  ref={primaryButtonRef}
                  type="button"
                  onClick={close}
                  className="px-4 py-2 text-sm font-medium text-white transition-colors focus-ring"
                  style={{
                    backgroundColor: 'var(--accent-primary)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  Get started
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeStep({ titleId }: { titleId: string }) {
  return (
    <div className="text-center">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
        style={{ backgroundColor: 'var(--accent-subtle)' }}
        aria-hidden="true"
      >
        <Sparkles className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
      </div>
      <h2
        id={titleId}
        className="text-xl font-semibold mb-3"
        style={{ color: 'var(--text-primary)' }}
      >
        Welcome to Moldavite
      </h2>
      <p
        className="text-sm leading-relaxed mb-3"
        style={{ color: 'var(--text-secondary)' }}
      >
        A local-first Markdown notebook for daily notes, ideas, and links between them.
      </p>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
        Your notes live in your Forge — a folder of plain .md files you can sync, back
        up, or open in any other tool.
      </p>
    </div>
  );
}

function ForgeStep({
  titleId,
  forgePath,
  isPicking,
  pickError,
  onPickFolder,
}: {
  titleId: string;
  forgePath: string;
  isPicking: boolean;
  pickError: string | null;
  onPickFolder: () => void;
}) {
  return (
    <div>
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
        style={{ backgroundColor: 'var(--accent-subtle)' }}
        aria-hidden="true"
      >
        <FolderOpen className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
      </div>
      <h2
        id={titleId}
        className="text-xl font-semibold mb-3 text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        Pick your Forge
      </h2>
      <p
        className="text-sm leading-relaxed mb-4 text-center"
        style={{ color: 'var(--text-secondary)' }}
      >
        Your Forge is the folder where every note is stored as a plain .md file. You can
        keep the default or pick anywhere you like.
      </p>

      <label
        className="text-xs mb-1.5 block"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Forge location
      </label>
      <div
        className="px-3 py-2 text-sm mb-3 truncate"
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-secondary)',
        }}
        title={forgePath}
      >
        {forgePath || 'Loading…'}
      </div>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={onPickFolder}
          disabled={isPicking}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 focus-ring"
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          {isPicking ? (
            <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <FolderOpen className="w-4 h-4" aria-hidden="true" />
          )}
          {isPicking ? 'Moving…' : 'Choose another folder…'}
        </button>
      </div>

      {pickError && (
        <p className="text-xs mb-3" style={{ color: 'var(--error)' }}>
          {pickError}
        </p>
      )}

      <div
        className="p-3 text-xs space-y-1"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-tertiary)',
        }}
      >
        <p style={{ color: 'var(--text-secondary)' }}>What lives in your Forge:</p>
        <p>
          <span className="font-mono">daily/</span> — daily notes
          (<span className="font-mono">YYYY-MM-DD.md</span>)
        </p>
        <p>
          <span className="font-mono">weekly/</span> — weekly notes
          (<span className="font-mono">YYYY-Www.md</span>)
        </p>
        <p>
          <span className="font-mono">notes/</span> — standalone notes and folders
        </p>
        <p>
          <span className="font-mono">templates/</span> — reusable note templates
        </p>
      </div>
    </div>
  );
}

function TourStep({
  titleId,
  tiles,
}: {
  titleId: string;
  tiles: { icon: React.ReactNode; title: string; body: string }[];
}) {
  return (
    <div>
      <h2
        id={titleId}
        className="text-xl font-semibold mb-3 text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        A quick tour
      </h2>
      <p
        className="text-sm leading-relaxed mb-5 text-center"
        style={{ color: 'var(--text-secondary)' }}
      >
        Four spots worth knowing about.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <div
            key={tile.title}
            className="p-3"
            style={{
              backgroundColor: 'var(--bg-panel)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)',
            }}
          >
            <div
              className="flex items-center gap-2 mb-1"
              style={{ color: 'var(--accent-primary)' }}
            >
              {tile.icon}
              <span
                className="text-sm font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {tile.title}
              </span>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {tile.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
