import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import { useToastStore } from '@/stores/toastStore';

// Strip absolute filesystem paths from backend error messages before they
// surface to the UI. Backend errors like "Failed to read /Users/alice/Notes/x.md"
// leak account names and vault layout; we replace paths with `<path>` so the
// sanitized message is safe to toast, log, or include in bug reports.
//
// Matches:
//   /Users/... /home/... /private/... /var/...   (POSIX)
//   C:\Users\...                                  (Windows)
// up to the next whitespace, quote, or colon delimiter.
const PATH_PATTERNS: RegExp[] = [
  /\/(?:Users|home|private|var|tmp|opt|etc)\/[^\s"':;,]+/g,
  /[A-Z]:\\[^\s"':;,]+/g,
];

export function sanitizeIpcError(raw: string): string {
  let out = raw;
  for (const re of PATH_PATTERNS) out = out.replace(re, '<path>');
  return out;
}

export interface SafeInvokeOptions {
  /**
   * If true, shows an error toast when the command fails.
   * Default: false — callers typically have their own toast/error handling.
   */
  toastOnError?: boolean;
  /**
   * Optional prefix for the toast message (e.g., "Save failed").
   */
  toastPrefix?: string;
}

/**
 * Thin wrapper around Tauri's `invoke` that sanitizes backend error strings
 * (removing absolute filesystem paths) and optionally surfaces a toast on
 * failure. Always re-throws so existing error handling continues to work.
 */
export async function safeInvoke<T = void>(
  cmd: string,
  args?: InvokeArgs,
  opts: SafeInvokeOptions = {},
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const raw =
      typeof e === 'string'
        ? e
        : e instanceof Error
          ? e.message
          : String(e);
    const safe = sanitizeIpcError(raw);
    if (opts.toastOnError) {
      const msg = opts.toastPrefix ? `${opts.toastPrefix}: ${safe}` : safe;
      useToastStore.getState().addToast('error', msg);
    }
    throw new Error(safe);
  }
}
