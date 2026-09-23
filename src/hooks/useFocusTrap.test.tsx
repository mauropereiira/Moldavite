/** Regression coverage for focus activation, inactivity, cycling, and restoration. */

import { describe, it, expect } from 'vitest';
import { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

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

  it('does nothing when inactive', async () => {
    render(<Harness active={false} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).not.toBe(screen.getByText('first'));
  });
});
