import { describe, it, expect } from 'vitest';
import { buildAgentsMd, GITIGNORE_CONTENT } from './agents';

describe('buildAgentsMd', () => {
  it('interpolates the Forge name into the heading', () => {
    const md = buildAgentsMd('Work');
    expect(md.startsWith('# AGENTS.md — Work')).toBe(true);
  });

  it('falls back to a generic name when the Forge name is blank', () => {
    expect(buildAgentsMd('   ')).toContain('# AGENTS.md — this Forge');
    expect(buildAgentsMd('')).toContain('# AGENTS.md — this Forge');
  });

  it('documents the real directory layout and note naming', () => {
    const md = buildAgentsMd('Default');
    expect(md).toContain('daily/');
    expect(md).toContain('YYYY-MM-DD.md');
    expect(md).toContain('weekly/');
    expect(md).toContain('YYYY-Www.md');
    expect(md).toContain('notes/');
    expect(md).toContain('templates/');
    expect(md).toContain('images/');
  });

  it('documents frontmatter, wiki links, and tags accurately', () => {
    const md = buildAgentsMd('Default');
    expect(md).toContain('color: blue');
    expect(md).toContain('[[Note Name]]');
    expect(md).toContain('[[Display text|target-note]]');
    // The unicode slug rule: accents kept, NFC-normalized.
    expect(md).toContain('NFC');
    expect(md).toContain('café.md');
    expect(md).toContain('#hashtags');
  });

  it('warns agents away from app-managed directories and locked notes', () => {
    const md = buildAgentsMd('Default');
    expect(md).toContain('.trash/');
    expect(md).toContain('.plugins/');
    expect(md).toContain('.index/');
    expect(md).toContain('.md.locked');
  });

  it('stays within the intended 60-90 line budget', () => {
    const lines = buildAgentsMd('Default').split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(60);
    expect(lines.length).toBeLessThanOrEqual(90);
  });

  it('does not claim features Moldavite does not have', () => {
    const md = buildAgentsMd('Default');
    // No invented sync/API/database claims.
    expect(md.toLowerCase()).not.toContain('cloud');
    expect(md.toLowerCase()).not.toContain('rest api');
    expect(md).toContain('There is no database');
  });
});

describe('GITIGNORE_CONTENT', () => {
  it('ignores app-managed directories and macOS noise', () => {
    const lines = GITIGNORE_CONTENT.trim().split('\n');
    expect(lines).toEqual(['.trash/', '.plugins/', '.index/', '.DS_Store']);
  });

  it('ends with a trailing newline', () => {
    expect(GITIGNORE_CONTENT.endsWith('\n')).toBe(true);
  });
});
