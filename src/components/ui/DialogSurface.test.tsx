import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DialogSurface } from './DialogSurface';

describe('DialogSurface', () => {
  it('traps focus and restores it to the opener on unmount', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <DialogSurface aria-label="Test dialog">
        <button>First</button>
        <button>Last</button>
      </DialogSurface>
    );

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    await waitFor(() => expect(first).toHaveFocus());

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('lets only the topmost dialog handle Escape', () => {
    const outerEscape = vi.fn();
    const innerEscape = vi.fn();
    const { rerender } = render(
      <>
        <DialogSurface aria-label="Outer" onEscape={outerEscape} />
        <DialogSurface aria-label="Inner" onEscape={innerEscape} />
      </>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(innerEscape).toHaveBeenCalledOnce();
    expect(outerEscape).not.toHaveBeenCalled();

    rerender(<DialogSurface aria-label="Outer" onEscape={outerEscape} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(outerEscape).toHaveBeenCalledOnce();
  });
});
