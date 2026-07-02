import { describe, it, expect } from 'vitest';
import { slugifyNoteName, noteNameToFilename } from './fileSystem';

// slugifyNoteName MUST stay in sync with note_name_to_filename in
// src-tauri/src/wiki.rs — these cases mirror the Rust tests.
describe('slugifyNoteName', () => {
  it('slugifies basic names', () => {
    expect(slugifyNoteName('Meeting Notes')).toBe('meeting-notes');
    expect(slugifyNoteName('  Padded  ')).toBe('padded');
    expect(slugifyNoteName('Q1 / Q2 plan!')).toBe('q1--q2-plan');
  });

  it('strips a trailing .md extension', () => {
    expect(slugifyNoteName('Meeting Notes.md')).toBe('meeting-notes');
  });

  it('preserves unicode letters and normalizes to NFC', () => {
    expect(slugifyNoteName('Café')).toBe('café');
    // Decomposed e + combining acute equals the precomposed form.
    expect(slugifyNoteName('Café')).toBe('café');
    expect(slugifyNoteName('日本語ノート')).toBe('日本語ノート');
  });

  it('no longer collides accented and unaccented names', () => {
    expect(slugifyNoteName('Café')).not.toBe(slugifyNoteName('Cafe'));
  });

  it('falls back to "untitled" for names with no usable characters', () => {
    expect(slugifyNoteName('!!!')).toBe('untitled');
    expect(slugifyNoteName('   ')).toBe('untitled');
  });
});

describe('noteNameToFilename', () => {
  it('appends .md to the slug', () => {
    expect(noteNameToFilename('Meeting Notes')).toBe('meeting-notes.md');
    expect(noteNameToFilename('日本語ノート')).toBe('日本語ノート.md');
    expect(noteNameToFilename('!!!')).toBe('untitled.md');
  });
});
