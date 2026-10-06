import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloseButton } from './CloseButton';

describe('CloseButton', () => {
  it('is the thin × named for what it closes, with Esc in its tooltip', () => {
    const onClick = vi.fn();
    render(<CloseButton label="Close Agenda" onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Close Agenda' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('title', 'Close (Esc)');
    expect(button).toHaveClass('close-button');
    expect(button.querySelector('svg')).toHaveAttribute('stroke-width', '1.25');
    expect(button).toHaveTextContent('');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('names another shortcut and keeps extra classes and the disabled state', () => {
    render(<CloseButton label="Close note" shortcut="⌘W" className="wn-close" disabled />);

    const button = screen.getByRole('button', { name: 'Close note' });
    expect(button).toHaveAttribute('title', 'Close (⌘W)');
    expect(button).toHaveClass('close-button', 'wn-close');
    expect(button).toBeDisabled();
  });
});
