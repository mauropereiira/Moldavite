import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdKeyboard, requestTitleFocus, takeTitleFocus } from './noteTitleFocus';

describe('noteTitleFocus', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  // iOS raises the keyboard only for a focus made during the tap itself.
  it('holds the focus in a stand-in field until the title takes it', () => {
    holdKeyboard();
    const standIn = document.activeElement as HTMLInputElement;
    expect(standIn.tagName).toBe('INPUT');
    expect(standIn.getAttribute('aria-hidden')).toBe('true');

    const title = document.createElement('input');
    document.body.appendChild(title);
    title.focus();

    expect(standIn.isConnected).toBe(false);
  });

  it('lets the keyboard go when no title takes the focus', () => {
    vi.useFakeTimers();
    holdKeyboard();
    const standIn = document.activeElement as HTMLInputElement;

    vi.advanceTimersByTime(3000);

    expect(standIn.isConnected).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('answers once, and only for the note that asked', () => {
    requestTitleFocus('notes/Untitled.md');

    expect(takeTitleFocus('notes/Other.md')).toBe(false);
    expect(takeTitleFocus('notes/Untitled.md')).toBe(true);
    expect(takeTitleFocus('notes/Untitled.md')).toBe(false);
  });
});
