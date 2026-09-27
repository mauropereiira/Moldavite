import { describe, expect, it } from 'vitest';
import { findBacklinks, snippetParts } from './backlinks';

describe('findBacklinks', () => {
  it('matches a link to the note its slug resolves to', () => {
    const contents = new Map([['notes/Alpha.md', 'See [[Delta Missing]] soon.']]);
    const info = new Map([['notes/Alpha.md', { name: 'Alpha.md', isDaily: false }]]);

    expect(findBacklinks('delta-missing', contents, info)).toEqual([
      { sourcePath: 'notes/Alpha.md', sourceName: 'Alpha', isDaily: false },
    ]);
  });

  it('does not match a different note', () => {
    const contents = new Map([['notes/Alpha.md', 'See [[Delta Missing]] soon.']]);
    const info = new Map([['notes/Alpha.md', { name: 'Alpha.md', isDaily: false }]]);

    expect(findBacklinks('delta', contents, info)).toEqual([]);
  });
});

describe('snippetParts', () => {
  const text = (context: string) =>
    snippetParts(context)
      .map((part) => part.text)
      .join('');

  it('drops HTML and images, including a tag the window cut in half', () => {
    expect(
      text(
        '...ng" width="300">Before <img src="images/a.png" alt="x"> [[Alpha]] after <img src="im...'
      )
    ).toBe('...Before Alpha after...');
    expect(text('See ![diagram](images/d.png) [[Alpha]]')).toBe('See Alpha');
  });

  it('unescapes Markdown escapes without turning escaped brackets into a link', () => {
    const parts = snippetParts('Literal \\[\\[not a link\\]\\] and 2 \\* 3 \\_x\\_ [[Alpha]]');
    expect(parts.map((part) => part.text).join('')).toBe(
      'Literal [[not a link]] and 2 * 3 _x_ Alpha'
    );
    expect(parts.filter((part) => part.link).map((part) => part.text)).toEqual(['Alpha']);
  });

  it('shows a wiki link as its display text and a Markdown link as its text', () => {
    const parts = snippetParts(
      'Ask [[Bob|people/bob]] via [the form](https://example.com/f) **today**'
    );
    expect(parts.map((part) => part.text).join('')).toBe('Ask Bob via the form today');
    expect(parts.filter((part) => part.link).map((part) => part.text)).toEqual(['Bob']);
  });

  it('keeps the words of a link the window cut at either end', () => {
    expect(text('...ta Missing]] and [[Alpha]] then [[Eps...')).toBe(
      '...ta Missing and Alpha then Eps...'
    );
  });

  it('collapses line breaks and heading marks into one line', () => {
    expect(text('## Plan\n\n- see [[Alpha]]\n')).toBe('Plan - see Alpha');
  });
});
