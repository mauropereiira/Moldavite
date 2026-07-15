/** Typed IPC contract for the one-time, read-only Obsidian vault COPY importer. */

import { safeInvoke } from './ipc';

export const OBSIDIAN_IMPORT_PROGRESS_EVENT = 'obsidian-import://progress';

export interface ObsidianDailyNotesConfig {
  folder: string;
  format: string;
}

export interface ObsidianVaultPreview {
  noteCount: number;
  attachmentCount: number;
  detectedDailyNotes: ObsidianDailyNotesConfig | null;
  folderCount: number;
  canvasCount: number;
  estimatedCollisions: number;
  hasObsidianDirectory: boolean;
  warnings: string[];
}

export interface ObsidianImportProgress {
  current: number;
  total: number;
}

export interface SkippedImportItem {
  path: string;
  reason: string;
}

export interface ObsidianImportReport {
  forgeName: string;
  dailyNotesImported: number;
  standaloneNotesImported: number;
  attachmentsImported: number;
  skippedItems: SkippedImportItem[];
  linkConversionsPerformed: number;
  warnings: string[];
}

export function analyzeObsidianVault(path: string): Promise<ObsidianVaultPreview> {
  return safeInvoke<ObsidianVaultPreview>('analyze_obsidian_vault', { path });
}

export function importObsidianVault(
  path: string,
  forgeName: string
): Promise<ObsidianImportReport> {
  return safeInvoke<ObsidianImportReport>('import_obsidian_vault', { path, forgeName });
}

/** Mirror `commands::forges::is_valid_forge_name` for immediate form feedback. */
export function getForgeNameError(name: string): string | null {
  if (!name) return 'Forge name is required';
  if (name.includes('\0')) return 'Forge name cannot contain null characters';
  if (name.includes('..')) return 'Forge name cannot contain ".."';
  if (name.startsWith('/') || name.startsWith('\\') || name.includes('/') || name.includes('\\')) {
    return 'Forge name must be a single folder name';
  }
  if (name.startsWith('.')) return 'Forge name cannot start with a period';
  if (['CON', 'PRN', 'AUX', 'NUL'].includes(name.toUpperCase())) {
    return 'That Forge name is reserved';
  }
  if (Array.from(name).length > 64) return 'Forge name must be 64 characters or less';
  return null;
}

export function forgeNameFromVaultPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}
