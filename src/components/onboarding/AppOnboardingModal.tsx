/**
 * AppOnboardingModal — first-run app-level onboarding.
 *
 * Five-step flow for new users: Welcome → Pick your Forge → Quick tour →
 * AI & Agents → Local semantic search.
 *
 * Visibility is gated by two persisted `useSettingsStore` flags:
 * - `hasSeenAppOnboarding` — false on first launch → show the full flow.
 * - `lastSeenOnboardingVersion` — highest content version the user has seen.
 *   When new feature pages ship, bump `APP_ONBOARDING_VERSION`; users who
 *   already completed onboarding then see just the new pages once
 *   (`FEATURE_UPDATE_FLOW`), never the whole flow again.
 *
 * Esc on all but the final step is a no-op (matches `CalendarOnboardingModal`
 * UX — onboarding requires explicit dismissal). The final step closes on Esc.
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
  Bot,
  Brain,
  FileText,
  Plug,
  ShieldCheck,
  Link2,
} from 'lucide-react';
import { open as openDirDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '@/stores/settingsStore';
import { getNotesDirectory, setNotesDirectory } from '@/lib/fileSystem';

/**
 * Bump this when adding new feature pages so existing users see them once.
 * v1 — original Welcome / Forge / Tour flow.
 * v2 — AI & Agents pages (agent-ready Forge, MCP server, semantic search).
 */
export const APP_ONBOARDING_VERSION = 2;

type StepKey = 'welcome' | 'forge' | 'tour' | 'ai-agents' | 'ai-search';

const FULL_FLOW: StepKey[] = ['welcome', 'forge', 'tour', 'ai-agents', 'ai-search'];
/** Shown to users who completed onboarding before `APP_ONBOARDING_VERSION`. */
const FEATURE_UPDATE_FLOW: StepKey[] = ['ai-agents', 'ai-search'];

export function AppOnboardingModal() {
  const {
    hasSeenAppOnboarding,
    setHasSeenAppOnboarding,
    lastSeenOnboardingVersion,
    setLastSeenOnboardingVersion,
    setIsSettingsOpen,
  } = useSettingsStore();
  const [stepIndex, setStepIndex] = useState(0);
  const [forgePath, setForgePath] = useState<string>('');
  const [isPicking, setIsPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const isFirstRun = !hasSeenAppOnboarding;
  const isFeatureUpdate =
    hasSeenAppOnboarding && lastSeenOnboardingVersion < APP_ONBOARDING_VERSION;
  const isOpen = isFirstRun || isFeatureUpdate;

  const steps = isFirstRun ? FULL_FLOW : FEATURE_UPDATE_FLOW;
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLastStep = stepIndex >= steps.length - 1;

  // Load Forge path when entering the Forge step.
  useEffect(() => {
    if (!isOpen) return;
    if (step !== 'forge') return;
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
    // Order matters: mark the version first so first-run users never flash the
    // feature-update flow between the two store updates.
    setLastSeenOnboardingVersion(APP_ONBOARDING_VERSION);
    setHasSeenAppOnboarding(true);
    // Restore focus to whatever was focused before the modal opened.
    previouslyFocusedRef.current?.focus?.();
  }, [setHasSeenAppOnboarding, setLastSeenOnboardingVersion]);

  const openSettings = useCallback(() => {
    close();
    setIsSettingsOpen(true);
  }, [close, setIsSettingsOpen]);

  const goNext = useCallback(() => {
    setStepIndex((i) => (i < steps.length - 1 ? i + 1 : i));
  }, [steps.length]);

  const goBack = useCallback(() => {
    setStepIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  // Keyboard handling: trap focus within the dialog and gate Esc.
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only allow Esc to close on the final step. Earlier steps require
        // explicit dismissal so users don't skip onboarding by accident.
        if (isLastStep) {
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
  }, [isOpen, isLastStep, close]);

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
            {steps.map((key, i) => (
              <div
                key={key}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === stepIndex ? '1.5rem' : '0.5rem',
                  backgroundColor:
                    i === stepIndex ? 'var(--accent-primary)' : 'var(--border-default)',
                }}
              />
            ))}
          </div>

          {step === 'welcome' && (
            <WelcomeStep titleId="app-onboarding-title" />
          )}

          {step === 'forge' && (
            <ForgeStep
              titleId="app-onboarding-title"
              forgePath={forgePath}
              isPicking={isPicking}
              pickError={pickError}
              onPickFolder={handlePickFolder}
            />
          )}

          {step === 'tour' && (
            <TourStep titleId="app-onboarding-title" tiles={tourTiles} />
          )}

          {step === 'ai-agents' && (
            <AiAgentsStep
              titleId="app-onboarding-title"
              isFeatureUpdate={isFeatureUpdate}
            />
          )}

          {step === 'ai-search' && (
            <AiSearchStep titleId="app-onboarding-title" />
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-8">
            <div>
              {stepIndex > 0 && (
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
              {!isLastStep ? (
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
                <>
                  <button
                    type="button"
                    onClick={openSettings}
                    className="px-3 py-2 text-sm font-medium transition-colors focus-ring"
                    style={{
                      backgroundColor: 'var(--bg-panel)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Open Settings
                  </button>
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
                    {isFirstRun ? 'Get started' : 'Done'}
                  </button>
                </>
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

function AiAgentsStep({
  titleId,
  isFeatureUpdate,
}: {
  titleId: string;
  isFeatureUpdate: boolean;
}) {
  return (
    <div>
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
        style={{ backgroundColor: 'var(--accent-subtle)' }}
        aria-hidden="true"
      >
        <Bot className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
      </div>
      <h2
        id={titleId}
        className="text-xl font-semibold mb-3 text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        {isFeatureUpdate ? 'New: built for AI agents' : 'Built for AI agents'}
      </h2>
      <p
        className="text-sm leading-relaxed mb-5 text-center"
        style={{ color: 'var(--text-secondary)' }}
      >
        Your notes are plain Markdown on your Mac, so AI tools can work with them
        directly — nothing is uploaded, and you choose what AI can touch.
      </p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div
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
            <FileText className="w-5 h-5" aria-hidden="true" />
            <span
              className="text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Agent-ready Forge
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            One click writes an AGENTS.md (plus a .gitignore) so agents like Claude Code
            understand your vault.
          </p>
        </div>
        <div
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
            <Plug className="w-5 h-5" aria-hidden="true" />
            <span
              className="text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              MCP server
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Run Moldavite with <span className="font-mono">--mcp</span> to give Claude
            Code or Claude Desktop structured tools to search and read your notes.
          </p>
        </div>
      </div>
      <p
        className="text-xs flex items-center justify-center gap-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
        Writes stay off until you switch them on in Settings.
      </p>
    </div>
  );
}

function AiSearchStep({ titleId }: { titleId: string }) {
  return (
    <div>
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
        style={{ backgroundColor: 'var(--accent-subtle)' }}
        aria-hidden="true"
      >
        <Brain className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
      </div>
      <h2
        id={titleId}
        className="text-xl font-semibold mb-3 text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        Semantic search, fully offline
      </h2>
      <p
        className="text-sm leading-relaxed mb-5 text-center"
        style={{ color: 'var(--text-secondary)' }}
      >
        Find notes by meaning, not just keywords. Choose from three local models (with
        all-MiniLM-L6-v2 as the default), then opt in to download your selection once — after
        that everything runs offline, and your notes never leave your Mac.
      </p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div
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
            <Search className="w-5 h-5" aria-hidden="true" />
            <span
              className="text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Semantic mode
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            A new chip in sidebar search switches between keyword and by-meaning results.
          </p>
        </div>
        <div
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
            <Link2 className="w-5 h-5" aria-hidden="true" />
            <span
              className="text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Related notes
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            The backlinks panel gains a Related section with the notes closest in meaning.
          </p>
        </div>
      </div>
      <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
        Everything here is opt-in — find it under Settings → AI &amp; Agents.
      </p>
    </div>
  );
}
