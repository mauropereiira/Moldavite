import { describe, expect, it } from 'vitest';
import { commonRuns, replayCharacters, replayLines } from './markdownMerge';

describe('commonRuns', () => {
  it('finds what two sequences share, in order', () => {
    expect(commonRuns('abcdef', 'abXdef')).toEqual([
      [0, 0, 2],
      [3, 3, 3],
    ]);
    expect(commonRuns(['a', 'b'], ['a', 'x', 'b'])).toEqual([
      [0, 0, 1],
      [1, 2, 1],
    ]);
  });

  it('gives up past its edit limit', () => {
    expect(commonRuns('a'.repeat(1200), 'b'.repeat(1200))).toBeNull();
  });
});

describe('replaying an edit onto the source', () => {
  it('keeps the source spelling around a typed word', () => {
    expect(replayCharacters('one\ntwo [x]', 'one two \\[x\\]', 'one two! \\[x\\]')).toBe(
      'one\ntwo! [x]'
    );
  });

  it('replaces a spelling the edit reached', () => {
    expect(replayCharacters('a \\[x\\] b', 'a [x] b', 'a [y] b')).toBe('a \\[y\\] b');
  });

  it('keeps the other lines of a block line by line', () => {
    expect(
      replayLines(
        '|a|b|\n|-|-|\n|1|2|',
        '| a | b |\n| --- | --- |\n| 1 | 2 |',
        '| a | b |\n| --- | --- |\n| 1 | 3 |'
      )
    ).toBe('|a|b|\n|-|-|\n| 1 | 3 |');
    expect(replayLines('a\nb', 'a b', 'a c')).toBeNull();
  });

  it('adds and removes whole lines', () => {
    expect(replayLines('*  a\n*  b', '* a\n* b', '* a\n* new\n* b')).toBe('*  a\n* new\n*  b');
    expect(replayLines('*  a\n*  b', '* a\n* b', '* b')).toBe('*  b');
  });
});
