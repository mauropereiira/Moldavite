/**
 * Application-update checks, persisted pending metadata, and install lifecycle state.
 * Automatic checks are silent and indicator-only; manual checks retain explicit feedback.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export const INITIAL_UPDATE_CHECK_DELAY_MS = 15 * 1000;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateState {
  availableVersion: string | null;
  downloading: boolean;
  progress: number;
  error: string | null;
  isChecking: boolean;
  /** Unix timestamp of the last successful updater response. */
  lastCheckedAt: number | null;
  dismissed: boolean;
  /** Live updater handle; intentionally not persisted. */
  update: Update | null;
  checkForUpdate: () => Promise<void>;
  checkForUpdateSilently: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
  startPeriodicChecks: () => () => void;
}

type PersistedUpdateState = Pick<UpdateState, 'availableVersion' | 'lastCheckedAt' | 'dismissed'>;

const initialUpdateState = {
  availableVersion: null,
  downloading: false,
  progress: 0,
  error: null,
  isChecking: false,
  lastCheckedAt: null,
  dismissed: false,
  update: null,
} satisfies Omit<
  UpdateState,
  'checkForUpdate' | 'checkForUpdateSilently' | 'installUpdate' | 'dismiss' | 'startPeriodicChecks'
>;

export function isUpdateCheckStale(lastCheckedAt: number | null, now = Date.now()): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
}

export function selectHasPendingUpdate(state: Pick<UpdateState, 'availableVersion'>): boolean {
  return state.availableVersion !== null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set, get) => {
      const runCheck = async (silent: boolean) => {
        if (get().isChecking) return;

        set({ isChecking: true, error: null });
        try {
          const update = await check();
          const checkedAt = Date.now();

          if (update) {
            const previous = get();
            set({
              availableVersion: update.version,
              update,
              // Automatic discoveries are indicator-only. If an explicit check
              // already opened this version's notification, leave it alone.
              dismissed: silent
                ? previous.availableVersion === update.version
                  ? previous.dismissed
                  : true
                : false,
              isChecking: false,
              lastCheckedAt: checkedAt,
            });
          } else {
            set({
              availableVersion: null,
              update: null,
              dismissed: false,
              isChecking: false,
              lastCheckedAt: checkedAt,
            });
          }
        } catch (error) {
          console.error(
            silent
              ? '[updateStore] Automatic update check failed:'
              : '[updateStore] Update check failed:',
            error
          );
          set({
            isChecking: false,
            error: silent ? null : errorMessage(error, 'Update check failed'),
          });
        }
      };

      return {
        ...initialUpdateState,

        checkForUpdate: () => runCheck(false),

        checkForUpdateSilently: () => runCheck(true),

        installUpdate: async () => {
          let update = get().update;
          if (!update && !get().availableVersion) return;

          set({ downloading: true, progress: 0, error: null });

          try {
            // Persisted metadata survives a relaunch, but the updater handle
            // cannot. Re-check only when needed to recover an installable handle.
            if (!update) {
              update = await check();
              const checkedAt = Date.now();
              if (!update) {
                set({
                  availableVersion: null,
                  update: null,
                  dismissed: false,
                  downloading: false,
                  lastCheckedAt: checkedAt,
                });
                return;
              }
              set({
                availableVersion: update.version,
                update,
                lastCheckedAt: checkedAt,
              });
            }

            let downloaded = 0;
            let contentLength = 0;

            await update.downloadAndInstall((event) => {
              switch (event.event) {
                case 'Started':
                  contentLength = event.data.contentLength || 0;
                  break;
                case 'Progress': {
                  downloaded += event.data.chunkLength;
                  if (contentLength > 0) {
                    set({ progress: Math.round((downloaded / contentLength) * 100) });
                  }
                  break;
                }
                case 'Finished':
                  set({ progress: 100 });
                  break;
              }
            });

            // Clear persisted pending state before relaunch so the installed
            // version never rehydrates with a stale indicator.
            set({
              availableVersion: null,
              update: null,
              dismissed: false,
              downloading: false,
              progress: 100,
            });
            await relaunch();
          } catch (error) {
            set({
              downloading: false,
              error: errorMessage(error, 'Download failed'),
            });
          }
        },

        dismiss: () => {
          set({ dismissed: true });
        },

        startPeriodicChecks: () => {
          const runAutomaticCheck = () => {
            void get().checkForUpdateSilently();
          };

          const initialTimeout = window.setTimeout(
            runAutomaticCheck,
            INITIAL_UPDATE_CHECK_DELAY_MS
          );
          const interval = window.setInterval(runAutomaticCheck, UPDATE_CHECK_INTERVAL_MS);
          const handleFocus = () => {
            if (isUpdateCheckStale(get().lastCheckedAt)) {
              runAutomaticCheck();
            }
          };

          window.addEventListener('focus', handleFocus);

          return () => {
            window.clearTimeout(initialTimeout);
            window.clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
          };
        },
      };
    },
    {
      name: 'moldavite-updates',
      partialize: (state): PersistedUpdateState => ({
        availableVersion: state.availableVersion,
        lastCheckedAt: state.lastCheckedAt,
        dismissed: state.dismissed,
      }),
    }
  )
);

export function __resetUpdateStoreForTests(): void {
  useUpdateStore.setState(initialUpdateState);
  void useUpdateStore.persist.clearStorage();
}
