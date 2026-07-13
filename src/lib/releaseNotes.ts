/**
 * Bundles the project CHANGELOG.md at build time (Vite `?raw`) and exposes the
 * parsed notes for a given version. This is the single place that performs the
 * Vite-specific raw import, keeping changelog.ts pure and unit-testable.
 * Parse failures are isolated to a `null` result so release-note display cannot
 * block the rest of the UI.
 */
import changelogRaw from '../../CHANGELOG.md?raw';
import { parseChangelog, type ChangelogEntry } from './changelog';

export function getReleaseNotes(version: string): ChangelogEntry | null {
  try {
    return parseChangelog(changelogRaw, version);
  } catch {
    return null;
  }
}
