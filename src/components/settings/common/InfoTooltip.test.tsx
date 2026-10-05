import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InfoTooltip } from './InfoTooltip';

const trigger = () => screen.getByRole('button', { name: 'About Spell check' });

describe('InfoTooltip', () => {
  it('names itself after the setting it explains', () => {
    render(<InfoTooltip text="x" label="Spell check" />);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    render(<InfoTooltip text="y" />);
    expect(screen.getByRole('button', { name: 'More information' })).toBeInTheDocument();
  });

  it('shows the text to a mouse on hover, portaled to document.body', () => {
    render(<InfoTooltip text="Helpful explanation" label="Spell check" />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Helpful explanation');
    expect(trigger()).toHaveAttribute('aria-describedby', tip.id);
    // Portaled directly under <body>, not nested in the trigger wrapper.
    expect(tip.parentElement).toBe(document.body);
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows on keyboard focus and hides on blur', () => {
    render(<InfoTooltip text="Shown on focus" label="Spell check" />);
    fireEvent.focus(trigger());
    expect(screen.getByRole('tooltip')).toHaveTextContent('Shown on focus');
    fireEvent.blur(trigger());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  // A touch screen has no hover, so a tap keeps it open until the next tap elsewhere.
  it('stays open after a tap and closes on a tap elsewhere', () => {
    render(
      <>
        <InfoTooltip text="Tapped" label="Spell check" />
        <p>elsewhere</p>
      </>
    );
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tapped');
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes on Escape without letting Escape reach the dialog behind it', () => {
    let reachedWindow = false;
    const onKey = () => (reachedWindow = true);
    window.addEventListener('keydown', onKey);
    render(<InfoTooltip text="Escapable" label="Spell check" />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    window.removeEventListener('keydown', onKey);

    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(reachedWindow).toBe(false);
  });
});
