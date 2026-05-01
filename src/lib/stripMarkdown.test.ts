import { describe, it, expect } from 'vitest';
import { stripMarkdown } from './fileSystem';

describe('stripMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(stripMarkdown('')).toBe('');
  });

  it('strips ATX headings', () => {
    expect(stripMarkdown('# Title\n## Sub\n### Three')).toContain('Title');
    expect(stripMarkdown('# Title')).not.toContain('#');
  });

  it('drops link URLs but keeps text', () => {
    expect(stripMarkdown('See [docs](https://example.com) for more.')).toContain(
      'See docs for more.',
    );
  });

  it('keeps wiki link display name', () => {
    // [[Display|target]] — display text comes first, target second.
    expect(stripMarkdown('Pair with [[the project|project-2025]] today.')).toContain(
      'Pair with the project today.',
    );
    expect(stripMarkdown('See [[Onboarding]].')).toContain('See Onboarding.');
  });

  it('keeps task checkbox glyph', () => {
    const out = stripMarkdown('- [x] done\n- [ ] not yet');
    expect(out).toContain('[x] done');
    expect(out).toContain('[ ] not yet');
  });

  it('drops bullet markers but keeps indent', () => {
    const out = stripMarkdown('- one\n  - nested\n- three');
    expect(out).toContain('one');
    expect(out).toContain('nested');
    expect(out).not.toMatch(/^- /m);
  });

  it('strips inline emphasis and strong', () => {
    const out = stripMarkdown('This is **bold** and *italic* and ~~gone~~.');
    expect(out).toContain('This is bold and italic and gone.');
  });

  it('preserves fenced code body and removes fences', () => {
    const out = stripMarkdown('```js\nconst x = 1;\n```');
    expect(out).toContain('const x = 1;');
    expect(out).not.toContain('```');
  });

  it('decodes common HTML entities', () => {
    expect(stripMarkdown('a &amp; b &lt;c&gt;')).toContain('a & b <c>');
  });

  it('strips inline HTML tags', () => {
    expect(stripMarkdown('<u>under</u> <mark>hi</mark>')).toContain('under hi');
  });

  it('drops blockquote markers', () => {
    expect(stripMarkdown('> quoted\n> line')).toContain('quoted');
    expect(stripMarkdown('> quoted')).not.toContain('>');
  });

  it('replaces images with their alt text', () => {
    expect(stripMarkdown('![logo](/x.png) hi')).toContain('logo hi');
  });

  it('collapses 3+ blank lines into 2', () => {
    expect(stripMarkdown('a\n\n\n\nb')).toBe('a\n\nb\n');
  });
});
