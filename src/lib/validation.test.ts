/** Regression coverage for editor-content emptiness and media-only content. */

import { describe, it, expect } from 'vitest';
import { isContentEmpty } from './validation';

describe('isContentEmpty', () => {
  it('treats empty and tag-only content as empty', () => {
    expect(isContentEmpty('')).toBe(true);
    expect(isContentEmpty('<p></p>')).toBe(true);
    expect(isContentEmpty('<p>&nbsp;</p>')).toBe(true);
    expect(isContentEmpty('<p>   </p>')).toBe(true);
  });

  it('treats text content as non-empty', () => {
    expect(isContentEmpty('<p>hello</p>')).toBe(false);
  });

  it('treats media-only content as non-empty (image-only daily notes must not be deleted)', () => {
    expect(isContentEmpty('<p><img src="asset://localhost/img.png"></p>')).toBe(false);
    expect(isContentEmpty('<img src="x.png"/>')).toBe(false);
    expect(isContentEmpty('<video src="x.mp4"></video>')).toBe(false);
  });
});
