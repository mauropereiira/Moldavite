import { describe, it, expect } from 'vitest';
import { parseChangelog, isNewerVersion, shouldShowWhatsNew } from './changelog';

const SAMPLE = `# Changelog

All notable changes to Moldavite are documented here.

## [1.4.0] - 2026-06-30

### Added
- **What's New popup** — shows release notes after an update.
- **Plugin commands** — register palette commands.

### Fixed
- **Info tooltips** — no longer clipped off-screen.

## [1.3.1] - 2026-05-02

### Fixed
- **Pinned tabs** — survive sidebar navigation.
`;

describe('parseChangelog', () => {
  it('extracts the requested version section with grouped bullets', () => {
    const entry = parseChangelog(SAMPLE, '1.4.0');
    expect(entry).not.toBeNull();
    if (!entry) return;
    expect(entry.version).toBe('1.4.0');
    expect(entry.date).toBe('2026-06-30');
    expect(entry.groups).toHaveLength(2);
    expect(entry.groups[0].title).toBe('Added');
    expect(entry.groups[0].items).toHaveLength(2);
    // Markdown bold markers are stripped for safe plain-text rendering.
    expect(entry.groups[0].items[0]).toContain("What's New popup");
    expect(entry.groups[0].items[0]).not.toContain('**');
    expect(entry.groups[1].title).toBe('Fixed');
  });

  it('does not bleed into the next version section', () => {
    const entry = parseChangelog(SAMPLE, '1.4.0');
    expect(entry).not.toBeNull();
    if (!entry) return;
    const all = entry.groups.flatMap((g) => g.items).join(' ');
    expect(all).not.toContain('Pinned tabs');
  });

  it('returns null for a version not present', () => {
    expect(parseChangelog(SAMPLE, '9.9.9')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseChangelog('not a changelog', '1.0.0')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('compares semver numerically', () => {
    expect(isNewerVersion('1.4.0', '1.3.1')).toBe(true);
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('1.3.1', '1.4.0')).toBe(false);
    expect(isNewerVersion('1.4.0', '1.4.0')).toBe(false);
  });
  it('ignores pre-release suffixes', () => {
    expect(isNewerVersion('1.4.0-beta.1', '1.3.1')).toBe(true);
  });
});

describe('shouldShowWhatsNew', () => {
  it('does not show on first launch (no lastSeenVersion)', () => {
    expect(
      shouldShowWhatsNew({ lastSeenVersion: null, currentVersion: '1.4.0', hasEntry: true })
    ).toBe(false);
  });
  it('shows when current is newer and an entry exists', () => {
    expect(
      shouldShowWhatsNew({ lastSeenVersion: '1.3.1', currentVersion: '1.4.0', hasEntry: true })
    ).toBe(true);
  });
  it('does not show without a changelog entry', () => {
    expect(
      shouldShowWhatsNew({ lastSeenVersion: '1.3.1', currentVersion: '1.4.0', hasEntry: false })
    ).toBe(false);
  });
  it('does not show on same version or downgrade', () => {
    expect(
      shouldShowWhatsNew({ lastSeenVersion: '1.4.0', currentVersion: '1.4.0', hasEntry: true })
    ).toBe(false);
    expect(
      shouldShowWhatsNew({ lastSeenVersion: '1.4.0', currentVersion: '1.3.1', hasEntry: true })
    ).toBe(false);
  });
});
