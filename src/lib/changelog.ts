/**
 * Pure helpers for reading Keep-a-Changelog formatted release notes and
 * deciding when to show the in-app "What's New" popup. No I/O — the raw
 * changelog string is injected by the caller (see lib/releaseNotes.ts).
 * Parsing is intentionally best-effort: malformed or missing version sections
 * return `null` rather than preventing application startup.
 */

export interface ChangelogItem {
  headline: string;
  fullText: string;
}

export interface ChangelogGroup {
  title: string;
  items: ChangelogItem[];
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  groups: ChangelogGroup[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEADLINE_MAX_LENGTH = 96;

/** Remove markdown emphasis markers so notes render as safe plain text. */
const stripEmphasis = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

const truncateHeadline = (text: string): string => {
  if (text.length <= HEADLINE_MAX_LENGTH) return text;

  const available = text.slice(0, HEADLINE_MAX_LENGTH - 1);
  const lastSpace = available.lastIndexOf(' ');
  const cutAt = lastSpace >= HEADLINE_MAX_LENGTH / 2 ? lastSpace : available.length;
  return `${available.slice(0, cutAt).trimEnd()}…`;
};

/**
 * Turn one Markdown changelog bullet into both its compact display headline
 * and its complete plain-text note. Bold lead-ins are authoritative; older or
 * malformed bullets fall back to a bounded first sentence.
 */
export function parseChangelogBullet(rawText: string): ChangelogItem | null {
  if (!rawText || typeof rawText !== 'string') return null;

  const source = rawText.trim();
  const fullText = stripEmphasis(source);
  if (!fullText) return null;

  const boldLead = source.match(/^\*\*(.+?)\*\*(?:\s|$)/)?.[1];
  if (boldLead) {
    const headline = stripEmphasis(boldLead);
    if (headline) return { headline, fullText };
  }

  const firstSentence = fullText.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? fullText;
  return { headline: truncateHeadline(firstSentence), fullText };
}

/**
 * Extract the section for `version` from a Keep-a-Changelog document.
 * Returns null if the version heading is not found.
 */
export function parseChangelog(raw: string, version: string): ChangelogEntry | null {
  if (!raw || typeof raw !== 'string') return null;
  const lines = raw.split(/\r?\n/);

  const headingRe = new RegExp(`^##\\s*\\[${escapeRegExp(version)}\\]\\s*(?:-\\s*(.+))?\\s*$`);
  let start = -1;
  let date: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) {
      start = i;
      date = m[1] ? m[1].trim() : null;
      break;
    }
  }
  if (start === -1) return null;

  const groups: ChangelogGroup[] = [];
  let current: ChangelogGroup | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // next version section
    const sub = line.match(/^###\s+(.+?)\s*$/);
    if (sub) {
      current = { title: sub[1].trim(), items: [] };
      groups.push(current);
      continue;
    }
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      if (!current) {
        current = { title: 'Changes', items: [] };
        groups.push(current);
      }
      const item = parseChangelogBullet(bullet[1]);
      if (item) current.items.push(item);
    }
  }

  const nonEmpty = groups.filter((g) => g.items.length > 0);
  if (nonEmpty.length === 0) return null;
  return { version, date, groups: nonEmpty };
}

const numericParts = (v: string): number[] =>
  v
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);

/** True when semver `a` is strictly greater than `b` (pre-release ignored). */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = numericParts(a);
  const pb = numericParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function shouldShowWhatsNew(args: {
  lastSeenVersion: string | null;
  currentVersion: string;
  hasEntry: boolean;
}): boolean {
  const { lastSeenVersion, currentVersion, hasEntry } = args;
  if (lastSeenVersion === null) return false; // first launch
  if (!hasEntry) return false;
  return isNewerVersion(currentVersion, lastSeenVersion);
}
