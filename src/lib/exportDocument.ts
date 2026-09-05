import { save } from '@tauri-apps/plugin-dialog';
import { exportNotes, exportEncryptedBackup } from './fileSystem';
import { safeInvoke } from './ipc';
import { isMobilePlatform } from './platform';

type DocumentExport =
  | { kind: 'notes' }
  | { kind: 'backup'; password: string }
  | { kind: 'settings'; json: string };

/** iOS copies a finished file; desktop chooses a destination before writing. */
export async function exportDocument(request: DocumentExport): Promise<boolean> {
  if (isMobilePlatform()) {
    return safeInvoke<boolean>('export_mobile_document', { request });
  }
  const date = new Date().toISOString().split('T')[0];
  const options = {
    notes: { title: 'Export Notes', stem: 'export', extension: 'zip', label: 'ZIP Archive' },
    backup: {
      title: 'Export Encrypted Backup',
      stem: 'backup',
      extension: 'moldavite-backup',
      label: 'Moldavite Backup',
    },
    settings: { title: 'Export Settings', stem: 'settings', extension: 'json', label: 'JSON' },
  }[request.kind];
  const destination = await save({
    title: options.title,
    defaultPath: `moldavite-${options.stem}-${date}.${options.extension}`,
    filters: [{ name: options.label, extensions: [options.extension] }],
  });
  if (!destination) return false;
  if (request.kind === 'notes') await exportNotes(destination);
  else if (request.kind === 'backup') await exportEncryptedBackup(destination, request.password);
  else await safeInvoke('export_settings_json', { path: destination, json: request.json });
  return true;
}
