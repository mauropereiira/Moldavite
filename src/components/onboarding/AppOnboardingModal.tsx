/**
 * AppOnboardingModal — first-run app-level onboarding.
 *
 * Six-step flow for new users: Welcome → Pick your Forge → Quick tour →
 * AI & Agents → Local semantic search → Default Markdown app.
 *
 * Visibility is gated by two persisted `useSettingsStore` flags:
 * - `hasSeenAppOnboarding` — false on first launch → show the full flow.
 * - `lastSeenOnboardingVersion` — highest content version the user has seen.
 *   Each step records the version it shipped in (`since`). When new pages
 *   ship, bump `APP_ONBOARDING_VERSION`; users who already completed
 *   onboarding then see once only the steps newer than what they saw, never
 *   the whole flow again. Phones skip that update flow entirely.
 *
 * The default-app step is left out where it cannot help: unsupported
 * platforms, Moldavite already the default, or a launch that opened a file.
 * When it was the only new step the modal stays closed and the version is
 * still recorded, so it is asked at most once.
 *
 * Esc on all but the final step is a no-op (matches `CalendarOnboardingModal`
 * UX — onboarding requires explicit dismissal). The final step closes on Esc.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Sparkles,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  PanelLeft,
  Edit3,
  Calendar,
  Search,
  Bot,
  Brain,
  FileText,
  Plug,
  ShieldCheck,
  Link2,
} from 'lucide-react';
import { isMobilePlatform } from '@/lib/platform';
import { formatShortcut } from '@/lib/shortcuts';
import { open as openDirDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '@/stores/settingsStore';
import { DotLoader } from '@/components/ui/DotLoader';
import { useNoteStore } from '@/stores/noteStore';
import {
  ensureDirectories,
  getNotesDirectory,
  listNotes,
  setActiveForge,
  setForgesRoot,
} from '@/lib/fileSystem';
import {
  canOfferDefaultApp,
  getDefaultMarkdownAppStatus,
  makeDefaultLabel,
  makeDefaultMarkdownApp,
  type DefaultAppStatus,
} from '@/lib/defaultApp';
import { wasLaunchedWithFile } from '@/lib/launchContext';

/**
 * Bump this when adding new feature pages so existing users see them once.
 * v1 — original Welcome / Forge / Tour flow.
 * v2 — AI & Agents pages (agent-ready Forge, MCP server, semantic search).
 * v3: make Moldavite the default app for .md files.
 */
export const APP_ONBOARDING_VERSION = 3;

type StepKey = 'welcome' | 'forge' | 'tour' | 'ai-agents' | 'ai-search' | 'default-app';

const STEPS: ReadonlyArray<{ key: StepKey; since: number; mobile: boolean }> = [
  { key: 'welcome', since: 1, mobile: true },
  { key: 'forge', since: 1, mobile: true },
  { key: 'tour', since: 1, mobile: true },
  { key: 'ai-agents', since: 2, mobile: false },
  { key: 'ai-search', since: 2, mobile: false },
  { key: 'default-app', since: 3, mobile: false },
];

/**
 * A user who finished onboarding before the version key existed persisted
 * `hasSeenAppOnboarding` with version 0, and had seen v1.
 */
function candidateSteps(mobile: boolean, firstRun: boolean, lastSeenVersion: number): StepKey[] {
  if (mobile) return firstRun ? STEPS.filter((s) => s.mobile).map((s) => s.key) : [];
  const seen = firstRun ? 0 : Math.max(lastSeenVersion, 1);
  return STEPS.filter((s) => s.since > seen).map((s) => s.key);
}

type DefaultAppOffer = { status: DefaultAppStatus; offer: boolean };

function subscribeToSettingsHydration(onStoreChange: () => void) {
  const stopWaiting = useSettingsStore.persist.onHydrate(onStoreChange);
  const finishWaiting = useSettingsStore.persist.onFinishHydration(onStoreChange);
  return () => {
    stopWaiting();
    finishWaiting();
  };
}

function getSettingsHydrationSnapshot() {
  return useSettingsStore.persist.hasHydrated();
}

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
  const [defaultApp, setDefaultApp] = useState<DefaultAppOffer | null>(null);
  const [isMakingDefault, setIsMakingDefault] = useState(false);
  const [makeDefaultError, setMakeDefaultError] = useState<string | null>(null);
  const settingsHydrated = useSyncExternalStore(
    subscribeToSettingsHydration,
    getSettingsHydrationSnapshot,
    getSettingsHydrationSnapshot
  );

  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const mobile = isMobilePlatform();
  const isFirstRun = !hasSeenAppOnboarding;
  const isFeatureUpdate = !isFirstRun;
  const candidates = settingsHydrated
    ? candidateSteps(mobile, isFirstRun, lastSeenOnboardingVersion)
    : [];
  const wantsDefaultApp = candidates.includes('default-app');
  // The step joins only once the status says it can help, so the flow only
  // ever grows at its end and the current step never shifts.
  const steps = candidates.filter((key) => key !== 'default-app' || defaultApp?.offer);
  const isOpen = steps.length > 0;
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLastStep = stepIndex >= steps.length - 1;

  useEffect(() => {
    if (!wantsDefaultApp || defaultApp) return;
    let cancelled = false;
    getDefaultMarkdownAppStatus().then((status) => {
      if (cancelled) return;
      setDefaultApp({ status, offer: canOfferDefaultApp(status) && !wasLaunchedWithFile() });
    });
    return () => {
      cancelled = true;
    };
  }, [wantsDefaultApp, defaultApp]);

  const nothingLeftToShow = candidates.length > 0 && steps.length === 0 && defaultApp !== null;
  useEffect(() => {
    if (nothingLeftToShow) setLastSeenOnboardingVersion(APP_ONBOARDING_VERSION);
  }, [nothingLeftToShow, setLastSeenOnboardingVersion]);

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
      if (mobile) dialogRef.current?.focus();
      else primaryButtonRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [isOpen, step, mobile]);

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
    // The modal stays mounted after closing, so a replay from About must start over.
    setStepIndex(0);
    setDefaultApp(null);
    setMakeDefaultError(null);
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

  const finishStep = isLastStep ? close : goNext;

  const handleMakeDefault = useCallback(async () => {
    setMakeDefaultError(null);
    setIsMakingDefault(true);
    try {
      await makeDefaultMarkdownApp();
      finishStep();
    } catch (err) {
      setMakeDefaultError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsMakingDefault(false);
    }
  }, [finishStep]);

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
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    if (mobile) return;
    setPickError(null);
    setIsPicking(true);
    try {
      const selected = await openDirDialog({
        directory: true,
        title: 'Select Forge Directory',
      });
      if (selected && typeof selected === 'string') {
        await setForgesRoot(selected);
        await setActiveForge('Default');
        setForgePath(await getNotesDirectory());
        await ensureDirectories();
        useNoteStore.getState().setNotes(await listNotes());
      }
    } catch (err) {
      setPickError(String(err));
    } finally {
      setIsPicking(false);
    }
  }, [mobile]);

  const tourTiles = useMemo(
    () => [
      {
        icon: <Edit3 className="w-5 h-5" aria-hidden="true" />,
        title: 'Your note',
        body: 'The note is the default surface.',
      },
      {
        icon: <PanelLeft className="w-5 h-5" aria-hidden="true" />,
        title: 'Index',
        body: mobile
          ? 'Tap Index in the rail for notes, folders, and tags.'
          : `${formatShortcut('⌘\\')} summons notes, folders, and tags.`,
      },
      {
        icon: <Calendar className="w-5 h-5" aria-hidden="true" />,
        title: 'Agenda',
        body: mobile
          ? 'Tap Agenda in the rail to browse your daily notes by date.'
          : `${formatShortcut('⌘⌥\\')} summons your calendar and events.`,
      },
      {
        icon: <Search className="w-5 h-5" aria-hidden="true" />,
        title: mobile ? 'Search' : 'Pin either',
        body: mobile
          ? 'Tap Search in the rail to find words in your notes.'
          : 'Pin Index and Agenda as columns in Settings.',
      },
    ],
    [mobile]
  );

  if (!isOpen) return null;

  return (
    <div
      className="app-onboarding-scrim fixed inset-0 flex items-center justify-center z-50 modal-backdrop-enter"
      data-testid="app-onboarding-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
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
          <div className="app-onboarding-steps flex justify-center gap-2 mb-6" aria-hidden="true">
            {steps.map((key, i) => (
              <div
                key={key}
                className="h-1.5 transition-all"
                style={{
                  width: i === stepIndex ? '1.5rem' : '0.5rem',
                  backgroundColor:
                    i === stepIndex ? 'var(--accent-primary)' : 'var(--border-default)',
                }}
              />
            ))}
          </div>

          <div className="app-onboarding-body">
            {step === 'welcome' && <WelcomeStep titleId="app-onboarding-title" mobile={mobile} />}

            {step === 'forge' && (
              <ForgeStep
                titleId="app-onboarding-title"
                mobile={mobile}
                forgePath={forgePath}
                isPicking={isPicking}
                pickError={pickError}
                onPickFolder={handlePickFolder}
              />
            )}

            {step === 'tour' && <TourStep titleId="app-onboarding-title" tiles={tourTiles} />}

            {step === 'ai-agents' && (
              <AiAgentsStep titleId="app-onboarding-title" isFeatureUpdate={isFeatureUpdate} />
            )}

            {step === 'ai-search' && <AiSearchStep titleId="app-onboarding-title" />}

            {step === 'default-app' && (
              <DefaultAppStep titleId="app-onboarding-title" error={makeDefaultError} />
            )}
          </div>

          <div className="app-onboarding-footer flex items-center justify-between mt-8">
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
              {step === 'default-app' && defaultApp ? (
                <>
                  <button
                    type="button"
                    onClick={finishStep}
                    className="px-3 py-2 text-sm font-medium transition-colors focus-ring"
                    style={{
                      backgroundColor: 'var(--bg-panel)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Not now
                  </button>
                  <button
                    ref={primaryButtonRef}
                    type="button"
                    onClick={handleMakeDefault}
                    disabled={isMakingDefault}
                    className="px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 focus-ring"
                    style={{
                      backgroundColor: 'var(--accent-primary)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {makeDefaultLabel(defaultApp.status)}
                  </button>
                </>
              ) : !isLastStep ? (
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
function WelcomeStep({ titleId, mobile }: { titleId: string; mobile: boolean }) {
  return (
    <div className="text-center">
      <div
        className="w-14 h-14 flex items-center justify-center mx-auto mb-5"
        style={{ backgroundColor: 'var(--accent-subtle)' }}
        aria-hidden="true"
      >
        {mobile ? (
          <span className="onboarding-monogram" />
        ) : (
          <Sparkles className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
        )}
      </div>
      <h2
        id={titleId}
        className="text-xl font-semibold mb-3"
        style={{ color: 'var(--text-primary)' }}
      >
        Welcome to Moldavite
      </h2>
      <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
        A local-first Markdown notebook for daily notes, ideas, and links between them.
      </p>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
        Your notes live in your Forge — a folder of plain .md files you can sync, back up, or open
        in any other tool.
      </p>
    </div>
  );
}

function ForgeStep({
  titleId,
  forgePath,
  mobile,
  isPicking,
  pickError,
  onPickFolder,
}: {
  titleId: string;
  forgePath: string;
  mobile: boolean;
  isPicking: boolean;
  pickError: string | null;
  onPickFolder: () => void;
}) {
  return (
    <div>
      <div
        className="w-14 h-14 flex items-center justify-center mx-auto mb-5"
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
        {mobile ? 'Your local Forge' : 'Pick your Forge'}
      </h2>
      <p
        className="text-sm leading-relaxed mb-4 text-center"
        style={{ color: 'var(--text-secondary)' }}
      >
        {mobile
          ? 'Your Default Forge lives on this device, ready to use. Notes stay local as plain Markdown files.'
          : 'This folder becomes the location of your Forges, with a Default Forge created inside it. Every note stays a plain .md file.'}
      </p>

      {!mobile && (
        <>
          <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
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
                <DotLoader label="Moving Forge" />
              ) : (
                <FolderOpen className="w-4 h-4" aria-hidden="true" />
              )}
              {isPicking ? 'Moving…' : 'Choose another folder…'}
            </button>
          </div>
        </>
      )}

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
          <span className="font-mono">daily/</span> — daily notes (
          <span className="font-mono">YYYY-MM-DD.md</span>)
        </p>
        <p>
          <span className="font-mono">weekly/</span> — weekly notes (
          <span className="font-mono">YYYY-Www.md</span>)
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
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
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

function AiAgentsStep({ titleId, isFeatureUpdate }: { titleId: string; isFeatureUpdate: boolean }) {
  return (
    <div>
      <div
        className="w-14 h-14 flex items-center justify-center mx-auto mb-5"
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
        Your notes are plain Markdown on your Mac, so AI tools can work with them directly — nothing
        is uploaded, and you choose what AI can touch.
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
          <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--accent-primary)' }}>
            <FileText className="w-5 h-5" aria-hidden="true" />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Agent-ready Forge
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            One click writes an AGENTS.md (plus a .gitignore) so AI tools like Claude Code
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
          <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--accent-primary)' }}>
            <Plug className="w-5 h-5" aria-hidden="true" />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              MCP server
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Run Moldavite with <span className="font-mono">--mcp</span> to give AI tools like Claude
            Code structured tools to search and read your notes.
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

function DefaultAppStep({ titleId, error }: { titleId: string; error: string | null }) {
  return (
    <div>
      <div
        className="w-14 h-14 flex items-center justify-center mx-auto mb-5"
        style={{ backgroundColor: 'var(--accent-subtle)' }}
        aria-hidden="true"
      >
        <FileText className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
      </div>
      <h2
        id={titleId}
        className="text-xl font-semibold mb-3 text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        Open Markdown files with Moldavite
      </h2>
      <p className="text-sm leading-relaxed text-center" style={{ color: 'var(--text-secondary)' }}>
        Double-click any .md file and it opens here, wherever it lives. No Forge needed. You can
        change this later in Settings › General.
      </p>
      {error && (
        <p className="text-xs mt-3 text-center" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

function AiSearchStep({ titleId }: { titleId: string }) {
  return (
    <div>
      <div
        className="w-14 h-14 flex items-center justify-center mx-auto mb-5"
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
        all-MiniLM-L6-v2 as the default), then opt in to download your selection once — after that
        everything runs offline, and your notes never leave your Mac.
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
          <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--accent-primary)' }}>
            <Search className="w-5 h-5" aria-hidden="true" />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
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
          <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--accent-primary)' }}>
            <Link2 className="w-5 h-5" aria-hidden="true" />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
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
