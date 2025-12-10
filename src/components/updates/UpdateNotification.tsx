import { useState, useEffect, useCallback, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Download, X, RefreshCw } from 'lucide-react';

// Check for updates every 4 hours (in milliseconds)
const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000;

interface UpdateState {
  available: boolean;
  version: string | null;
  downloading: boolean;
  progress: number;
  error: string | null;
}

export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({
    available: false,
    version: null,
    downloading: false,
    progress: 0,
    error: null,
  });
  const [dismissed, setDismissed] = useState(false);
  const updateRef = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setState((prev) => ({
          ...prev,
          available: true,
          version: update.version,
          error: null,
        }));
        setDismissed(false);
      }
    } catch (error) {
      // Silently fail - don't bother user with update check errors
      console.error('Update check failed:', error);
    }
  }, []);

  // Check for updates on mount and periodically
  useEffect(() => {
    // Initial check after a short delay to let app fully load
    const initialTimeout = setTimeout(checkForUpdate, 5000);

    // Periodic checks every 4 hours
    const interval = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  const handleInstall = async () => {
    const update = updateRef.current;
    if (!update) return;

    setState((prev) => ({ ...prev, downloading: true, progress: 0, error: null }));

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
              setState((prev) => ({ ...prev, progress }));
            }
            break;
          case 'Finished':
            setState((prev) => ({ ...prev, progress: 100 }));
            break;
        }
      });

      // Relaunch the app after successful download
      await relaunch();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        downloading: false,
        error: error instanceof Error ? error.message : 'Download failed',
      }));
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  // Don't render if no update available or dismissed
  if (!state.available || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-2 fade-in duration-300">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-100 dark:border-blue-800">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Update Available
            </span>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-blue-100 dark:hover:bg-blue-800 rounded transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            Version <span className="font-medium">{state.version}</span> is ready to install.
          </p>

          {/* Error message */}
          {state.error && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-3">{state.error}</p>
          )}

          {/* Progress bar */}
          {state.downloading && (
            <div className="mb-3">
              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
                  style={{ width: `${state.progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                {state.progress}%
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleInstall}
              disabled={state.downloading}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-md transition-colors"
            >
              {state.downloading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Install Now
                </>
              )}
            </button>
            {!state.downloading && (
              <button
                onClick={handleDismiss}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Later
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
