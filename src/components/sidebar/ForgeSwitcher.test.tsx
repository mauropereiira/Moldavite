import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgeSwitcher } from './ForgeSwitcher';
import { useForgeStore } from '@/stores';

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

describe('ForgeSwitcher', () => {
  beforeEach(() => {
    useForgeStore.setState({ forges: [], active: 'Default', loading: false } as never);
  });

  // The caret used to sit at the far right of a full-width button. "Far right"
  // is the width of whatever hosts the sidebar, and in the Index overlay that
  // is the entire window — so it landed on top of the overlay's close button.
  // Keeping it beside the name is what makes that impossible, and it reads as
  // an affordance on the name rather than a glyph in a corner owning nothing.
  it('keeps the caret beside the Forge name, not pushed to the far edge', () => {
    render(<ForgeSwitcher onManage={() => {}} />);

    const trigger = screen.getByRole('button', { name: /Default/ });
    expect(trigger.className).not.toContain('justify-between');

    const label = screen.getByText('Default');
    const caret = screen.getByText('↓');
    // Siblings under the same span, so no amount of available width can
    // separate them.
    expect(caret.parentElement).toBe(label.parentElement);
  });

  it('still announces itself as the Forge picker', () => {
    render(<ForgeSwitcher onManage={() => {}} />);
    const trigger = screen.getByRole('button', { name: /Default/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('title', 'Switch Forge');
  });
});
