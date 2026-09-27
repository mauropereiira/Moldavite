import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutHelpHost } from './ShortcutHelpModal';

beforeEach(() => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const press = (init: { key: string; metaKey?: boolean; ctrlKey?: boolean }) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });

describe('ShortcutHelpHost on a Mac', () => {
  it('opens on ⌘/ and not on Ctrl+/', () => {
    render(<ShortcutHelpHost />);

    press({ key: '/', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    press({ key: '/', metaKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
