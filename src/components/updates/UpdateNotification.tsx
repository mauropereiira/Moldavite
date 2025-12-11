import { useEffect } from 'react';
import { useUpdateStore } from '@/stores';
import { Download, X, RefreshCw } from 'lucide-react';

export function UpdateNotification() {
  const {
    available,
    version,
    downloading,
    progress,
    error,
    dismissed,
    installUpdate,
    dismiss,
    startPeriodicChecks,
  } = useUpdateStore();

  // Start periodic update checks on mount
  useEffect(() => {
    const cleanup = startPeriodicChecks();
    return cleanup;
  }, [startPeriodicChecks]);

  // Don't render if no update available or dismissed
  if (!available || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-2 fade-in duration-300">
      <div className="bg-white dark:bg-gray-800 rounded shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-100 dark:border-blue-800">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Update Available
            </span>
          </div>
          <button
            onClick={dismiss}
            className="p-1 hover:bg-blue-100 dark:hover:bg-blue-800 rounded transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            Version <span className="font-medium">{version}</span> is ready to install.
          </p>

          {/* Error message */}
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</p>
          )}

          {/* Progress bar */}
          {downloading && (
            <div className="mb-3">
              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                {progress}%
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={installUpdate}
              disabled={downloading}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded transition-colors"
            >
              {downloading ? (
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
            {!downloading && (
              <button
                onClick={dismiss}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
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
