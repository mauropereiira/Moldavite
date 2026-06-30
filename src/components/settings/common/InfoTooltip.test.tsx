import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InfoTooltip } from './InfoTooltip';

describe('InfoTooltip', () => {
  it('shows the text on hover, portaled to document.body', () => {
    render(<InfoTooltip text="Helpful explanation" />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('button', { name: /more information/i }));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Helpful explanation');
    // Portaled directly under <body>, not nested in the trigger wrapper.
    expect(tip.parentElement).toBe(document.body);
  });

  it('hides on mouse leave', () => {
    render(<InfoTooltip text="x" />);
    const btn = screen.getByRole('button', { name: /more information/i });
    fireEvent.mouseEnter(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
