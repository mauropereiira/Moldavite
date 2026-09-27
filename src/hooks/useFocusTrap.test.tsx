/** Regression coverage for focus activation, inactivity, cycling, and restoration. */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { holdKeyboard } from '@/lib/noteTitleFocus';
import { useFocusTrap } from './useFocusTrap';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

function Harness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, active);
  return (
    <div ref={ref} tabIndex={-1}>
      <button>first</button>
      <button>second</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  afterEach(() => {
    platform.mobile = false;
  });

  it('moves focus to the first focusable element when active', async () => {
    render(<Harness active />);
    // Initial focus is deferred via requestAnimationFrame; waitFor retries.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('first')));
  });

  it('leaves focus in a text field that took it as the dialog mounted', async () => {
    function FieldHarness() {
      const ref = useRef<HTMLDivElement | null>(null);
      useFocusTrap(ref, true);
      return (
        <div ref={ref} tabIndex={-1}>
          <button>close</button>
          <input aria-label="field" autoFocus />
        </div>
      );
    }
    render(<FieldHarness />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(screen.getByLabelText('field'));
  });

  // The phone's Index closes as a new note hands its title the focus, which
  // keeps the keyboard up; restoring the focus from before would drop it.
  it('leaves focus that an action moved outside the trap where it went', async () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    const { rerender } = render(<Harness active />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('first')));

    outside.focus();
    rerender(<Harness active={false} />);

    expect(document.activeElement).toBe(outside);
    outside.remove();
    before.remove();
  });

  it('restores the earlier focus when focus was still inside', async () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    const { rerender } = render(<Harness active />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('first')));

    rerender(<Harness active={false} />);

    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('does nothing when inactive', async () => {
    render(<Harness active={false} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).not.toBe(screen.getByText('first'));
  });

  it('leaves the focus with the stand-in holding the phone keyboard', async () => {
    platform.mobile = true;
    holdKeyboard();
    const standIn = document.activeElement;
    render(<Harness active />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    expect(document.activeElement).toBe(standIn);
    if (standIn instanceof HTMLElement) standIn.blur();
  });

  it('focuses the container on a phone when no stand-in holds the focus', async () => {
    platform.mobile = true;
    const { container } = render(<Harness active />);
    await waitFor(() => expect(document.activeElement).toBe(container.firstChild));
  });
});
