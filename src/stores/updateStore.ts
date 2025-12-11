import { create } from 'zustand';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// Check for updates every 24 hours (in milliseconds)
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

interface UpdateState {
  available: boolean;
  version: string | null;
  downloading: boolean;
  progress: number;
  error: string | null;
  isChecking: boolean;
  lastChecked: Date | null;
  dismissed: boolean;
  update: Update | null;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
  startPeriodicChecks: () => () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  available: false,
  version: null,
  downloading: false,
  progress: 0,
  error: null,
  isChecking: false,
  lastChecked: null,
  dismissed: false,
  update: null,

  checkForUpdate: async () => {
    set({ isChecking: true, error: null });
    try {
      const update = await check();
      if (update) {
        set({
          available: true,
          version: update.version,
          update,
          dismissed: false,
          isChecking: false,
          lastChecked: new Date(),
        });
      } else {
        set({
          available: false,
          version: null,
          update: null,
          isChecking: false,
          lastChecked: new Date(),
        });
      }
    } catch (error) {
      console.error('[updateStore] Update check failed:', error);
      set({
        isChecking: false,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : 'Update check failed',
      });
    }
  },

  installUpdate: async () => {
    const { update } = get();
    if (!update) return;

    set({ downloading: true, progress: 0, error: null });

    try {
      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              const progress = Math.round((downloaded / contentLength) * 100);
              set({ progress });
            }
            break;
          case 'Finished':
            set({ progress: 100 });
            break;
        }
      });

      // Relaunch the app after successful download
      await relaunch();
    } catch (error) {
      set({
        downloading: false,
        error: error instanceof Error ? error.message : 'Download failed',
      });
    }
  },

  dismiss: () => {
    set({ dismissed: true });
  },

  startPeriodicChecks: () => {
    // Initial check after a short delay to let app fully load
    const initialTimeout = setTimeout(() => {
      get().checkForUpdate();
    }, 5000);

    // Periodic checks every 24 hours
    const interval = setInterval(() => {
      get().checkForUpdate();
    }, UPDATE_CHECK_INTERVAL);

    // Return cleanup function
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  },
}));
