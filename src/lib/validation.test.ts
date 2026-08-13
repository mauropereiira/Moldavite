/** Regression coverage for editor-content emptiness and media-only content. */

import { describe, it, expect } from 'vitest';
import {
  getFolderNameError,
  getNoteTitleError,
  isContentEmpty,
  isValidNoteName,
} from './validation';

describe('note title Windows portability', () => {
  it('rejects every reserved device stem case-insensitively', () => {
    for (const title of ['CON', 'prn', 'Aux', 'nul', 'COM1', 'com9', 'LPT1', 'lpt9', 'NUL.md']) {
      expect(isValidNoteName(title)).toBe(false);
      expect(getNoteTitleError(title)).toBe('Title cannot use a Windows reserved name');
    }
  });

  it('keeps similar non-device titles valid', () => {
    for (const title of ['Console', 'COM0', 'COM10', 'LPT0', 'LPT10', 'NUL notes']) {
      expect(isValidNoteName(title)).toBe(true);
      expect(getNoteTitleError(title)).toBeNull();
    }
  });

  it('rejects Windows-illegal punctuation before a note write', () => {
    expect(getNoteTitleError('Q3: Roadmap')).toBe(
      'Title can only contain letters, numbers, spaces, and hyphens'
    );
    expect(getNoteTitleError('Reports.')).toBe(
      'Title can only contain letters, numbers, spaces, and hyphens'
    );
  });
});

describe('folder name Windows portability', () => {
  it('returns specific errors for reserved names, illegal characters, and trailing dots', () => {
    expect(getFolderNameError('COM1')).toBe('Folder name is reserved by Windows');
    expect(getFolderNameError('Q3: Roadmap')).toBe(
      'Folder name contains characters that Windows does not allow'
    );
    expect(getFolderNameError('Reports.')).toBe('Folder name cannot end with a dot');
  });
});

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
