/**
 * First-run onboarding and versioned feature pages, filtered by platform and
 * active season. The shared decision also coordinates automatic release notes.
 * Escape closes only the final page; earlier pages require an explicit action.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useLaunchContextStore, wasLaunchedWithFile } from '@/lib/launchContext';
import { APP_ONBOARDING_VERSION, getAppOnboardingSteps } from '@/lib/appOnboarding';
import { ACTIVE_SEASON, JACK_O_LANTERN_SRC, type Season } from '@/lib/seasons';
import { applyTheme, PRESETS, useThemeStore, type ThemePreset } from '@/stores/themeStore';
import { useSettingsHydration } from '@/hooks/useSettingsHydration';
import { MaskArt } from '@/components/ui/MaskArt';

export { APP_ONBOARDING_VERSION } from '@/lib/appOnboarding';

const SEASON_PAGES: Record<
  Season,
  { title: string; body: string; preset: ThemePreset; icon: React.ReactNode }
> = {
  autumn: {
    title: 'Autumn is here',
    body: 'Try a warm Autumn theme in light and dark, with leaves and a few small touches that work with any theme. Turn the touches off in Settings › Layout › Seasonal touches.',
    preset: 'autumn',
    icon: <MaskArt src={JACK_O_LANTERN_SRC} className="w-10 h-10" />,
  },
};

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
  const [defaultApp, setDefaultApp] = useState<DefaultAppStatus | null>(null);
  const [isMakingDefault, setIsMakingDefault] = useState(false);
  const [makeDefaultError, setMakeDefaultError] = useState<string | null>(null);
  const settingsHydrated = useSettingsHydration();
  const launchContext = useLaunchContextStore();
  const canShowWelcome = settingsHydrated && launchContext.ready && !wasLaunchedWithFile();
  const { theme, preset, setPreset } = useThemeStore();
  const seasonPage = ACTIVE_SEASON !== null ? SEASON_PAGES[ACTIVE_SEASON] : null;

  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const mobile = isMobilePlatform();
  const isFirstRun = !hasSeenAppOnboarding;
  const isFeatureUpdate = !isFirstRun;
  const steps = canShowWelcome
    ? getAppOnboardingSteps(mobile, isFirstRun, lastSeenOnboardingVersion)
    : [];
  const wantsDefaultApp = steps.includes('open-files');
  const offerDefaultApp = defaultApp && canOfferDefaultApp(defaultApp);
  const isOpen = steps.length > 0;
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLastStep = stepIndex >= steps.length - 1;

  useEffect(() => {
    if (!wantsDefaultApp || defaultApp) return;
    let cancelled = false;
    getDefaultMarkdownAppStatus().then((status) => {
      if (cancelled) return;
      setDefaultApp(status);
    });
    return () => {
      cancelled = true;
    };
  }, [wantsDefaultApp, defaultApp]);

  const nothingLeftToShow =
    canShowWelcome &&
    !isFirstRun &&
    lastSeenOnboardingVersion < APP_ONBOARDING_VERSION &&
    steps.length === 0;
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
                    i === stepIndex ? 'var(--text-primary)' : 'var(--border-default)',
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

            {step === 'season' && seasonPage && (
              <SeasonStep titleId="app-onboarding-title" page={seasonPage} />
            )}

            {step === 'open-files' && (
              <OpenFilesStep
                titleId="app-onboarding-title"
                status={offerDefaultApp ? defaultApp : null}
                isMakingDefault={isMakingDefault}
                onMakeDefault={handleMakeDefault}
                error={makeDefaultError}
              />
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
              {step === 'season' && seasonPage && preset !== seasonPage.preset ? (
                <>
                  <button
                    type="button"
                    onClick={finishStep}
                    className="px-3 py-2 text-sm font-medium transition-colors focus-ring"
                    style={{
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Keep my theme
                  </button>
                  <button
                    ref={primaryButtonRef}
                    type="button"
                    onClick={() => {
                      setPreset(seasonPage.preset);
                      applyTheme(theme, seasonPage.preset);
                      finishStep();
                    }}
                    className="px-4 py-2 text-sm font-medium transition-colors focus-ring"
                    style={{
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    Use {PRESETS.find((p) => p.id === seasonPage.preset)?.label}
                  </button>
                </>
              ) : step === 'season' || step === 'open-files' ? (
                <button
                  ref={primaryButtonRef}
                  type="button"
                  onClick={finishStep}
                  disabled={isMakingDefault}
                  className="px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 focus-ring"
                  style={{
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Continue
                </button>
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

function SeasonStep({ titleId, page }: { titleId: string; page: (typeof SEASON_PAGES)[Season] }) {
  const { theme, preset } = useThemeStore();
  const palette = PRESETS.find((p) => p.id === page.preset);
  if (!palette) return null;
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const swatches = isDark ? palette.darkSwatches : palette.swatches;

  return (
    <div className="text-center">
      <div
        className="flex justify-center mb-3"
        style={{ color: 'var(--text-muted)' }}
        aria-hidden="true"
      >
        {page.icon}
      </div>
      <h2
        id={titleId}
        className="text-xl font-semibold mb-3"
        style={{
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          letterSpacing: '-0.015em',
        }}
      >
        {page.title}
      </h2>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {page.body}
      </p>
      <div
        role="img"
        aria-label={`${palette.label} palette`}
        className="flex gap-1 p-1 mt-5 mx-auto"
        style={{ border: '1px solid var(--border-default)', maxWidth: '15rem', height: '2rem' }}
      >
        {Object.entries(swatches).map(([key, color]) => (
          <span key={key} className="flex-1" style={{ backgroundColor: color }} />
        ))}
      </div>
      {preset === page.preset && (
        <p className="text-sm mt-4" style={{ color: 'var(--text-secondary)' }}>
          You&apos;re already using {palette.label}
        </p>
      )}
    </div>
  );
}

function OpenFilesStep({
  titleId,
  status,
  isMakingDefault,
  onMakeDefault,
  error,
}: {
  titleId: string;
  status: DefaultAppStatus | null;
  isMakingDefault: boolean;
  onMakeDefault: () => void;
  error: string | null;
}) {
  return (
    <div className="text-center">
      <h2
        id={titleId}
        className="text-xl font-semibold mb-3 text-center"
        style={{
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          letterSpacing: '-0.015em',
        }}
      >
        Open any Markdown file
      </h2>
      <p className="text-sm leading-relaxed text-center" style={{ color: 'var(--text-secondary)' }}>
        Choose Moldavite in Open With, drop a file on the window, or press {formatShortcut('⌘O')}.
        It opens where it lives, no Forge needed, and your changes save back to the file.
      </p>
      {status && (
        <button
          type="button"
          onClick={onMakeDefault}
          disabled={isMakingDefault}
          className="px-3 py-2 mt-4 text-sm font-medium transition-colors disabled:opacity-50 focus-ring"
          style={{
            backgroundColor: 'transparent',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
          }}
        >
          {makeDefaultLabel(status)}
        </button>
      )}
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
