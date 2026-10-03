/**
 * Whether Moldavite is the system's default app for `.md` files, and the one
 * action that changes it (`src-tauri/src/commands/default_app.rs`).
 *
 * `open-settings` is Windows, where an app cannot set its own default and the
 * status cannot be read; `unsupported` (iOS, an AppImage) hides the control.
 */
import { safeInvoke } from '@/lib/ipc';

export type DefaultAppMode = 'set' | 'open-settings' | 'unsupported';

export interface DefaultAppStatus {
  mode: DefaultAppMode;
  isDefault: boolean | null;
}

const UNSUPPORTED: DefaultAppStatus = { mode: 'unsupported', isDefault: null };

/** Never rejects: a failed or missing answer reads as unsupported. */
export async function getDefaultMarkdownAppStatus(): Promise<DefaultAppStatus> {
  try {
    return (
      (await safeInvoke<DefaultAppStatus | undefined>('default_markdown_app_status')) ?? UNSUPPORTED
    );
  } catch {
    return UNSUPPORTED;
  }
}

export function makeDefaultMarkdownApp(): Promise<DefaultAppStatus> {
  return safeInvoke<DefaultAppStatus>('make_default_markdown_app');
}

export function canOfferDefaultApp(status: DefaultAppStatus): boolean {
  return status.mode !== 'unsupported' && status.isDefault !== true;
}

export function makeDefaultLabel(status: DefaultAppStatus): string {
  return status.mode === 'open-settings' ? 'Open Default Apps settings' : 'Make default';
}
