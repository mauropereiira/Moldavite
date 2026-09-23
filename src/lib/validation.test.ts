/** Regression coverage for editor-content emptiness and media-only content. */

import { describe, it, expect } from 'vitest';
import {
  getFolderNameError,
  getNoteTitleError,
  hasOnlyEmptyParagraphs,
  isContentEmpty,
  isValidDateString,
  isValidNoteName,
} from './validation';

const EMPTY_TABLE =
  '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup>' +
  '<tbody><tr><th colspan="1" rowspan="1"><p></p></th><th colspan="1" rowspan="1"><p></p></th></tr>' +
  '<tr><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr></tbody></table><p></p>';

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
    expect(getNoteTitleError('Q3: Roadmap')).toBe('Title cannot contain / \\ : * ? " < > | [ ]');
    expect(getNoteTitleError('Reports.')).toBe('Title cannot start or end with a dot');
    expect(getNoteTitleError('.hidden')).toBe('Title cannot start or end with a dot');
  });

  it('rejects square brackets, which would end a wiki link to the note', () => {
    expect(getNoteTitleError('[draft] Plan')).toBe('Title cannot contain / \\ : * ? " < > | [ ]');
  });

  it('accepts the names the app generates and other names the backend accepts', () => {
    for (const title of [
      'Untitled',
      'Untitled (2)',
      'Untitled (3)',
      'Plan (copy)',
      'Plan (conflict 2026-09-23 1412)',
      'Café & bar',
      "Mauro's notes, v1.2",
      '日本語ノート',
    ]) {
      expect(getNoteTitleError(title)).toBeNull();
    }
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

  it('keeps a daily note holding only a table of empty cells', () => {
    expect(isContentEmpty(EMPTY_TABLE)).toBe(false);
  });
});

describe('hasOnlyEmptyParagraphs', () => {
  it('is true for a new note', () => {
    expect(hasOnlyEmptyParagraphs('')).toBe(true);
    expect(hasOnlyEmptyParagraphs('<p></p>')).toBe(true);
    expect(hasOnlyEmptyParagraphs('<p></p><p>&nbsp;</p>')).toBe(true);
  });

  it('is false once any block other than a paragraph exists, filled in or not', () => {
    expect(hasOnlyEmptyParagraphs(EMPTY_TABLE)).toBe(false);
    expect(hasOnlyEmptyParagraphs('<h2></h2>')).toBe(false);
    expect(hasOnlyEmptyParagraphs('<ul><li><p></p></li></ul>')).toBe(false);
    expect(hasOnlyEmptyParagraphs('<p></p><hr><p></p>')).toBe(false);
    expect(hasOnlyEmptyParagraphs('<p>hello</p>')).toBe(false);
  });

  it('leaves autosave deleting a daily note left with only an empty heading or divider', () => {
    expect(isContentEmpty('<h2></h2>')).toBe(true);
    expect(isContentEmpty('<hr>')).toBe(true);
  });
});

describe('isValidDateString', () => {
  it('rejects calendar dates that JavaScript normalizes into another month', () => {
    expect(isValidDateString('2025-02-30')).toBe(false);
    expect(isValidDateString('2023-02-29')).toBe(false);
    expect(isValidDateString('2025-04-31')).toBe(false);
  });

  it('accepts a real leap day', () => {
    expect(isValidDateString('2024-02-29')).toBe(true);
  });
});
