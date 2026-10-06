import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useToastStore } from '@/stores/toastStore';
import { ToastContainer } from './ToastContainer';

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
const z = (name: string) => {
  const match = css.match(new RegExp(`--z-${name}:\\s*(\\d+);`));
  if (!match) throw new Error(`--z-${name} is not defined`);
  return Number(match[1]);
};

describe('notice and toast stacking', () => {
  it('puts the update card above surfaces and the rail, below dialogs', () => {
    expect(z('notice')).toBeGreaterThan(z('surface'));
    expect(z('notice')).toBeGreaterThan(z('rail'));
    expect(z('notice')).toBeLessThan(z('dialog'));
  });

  it('puts toasts above everything, dialogs included', () => {
    expect(z('toast')).toBeGreaterThan(z('dialog'));
  });

  it('renders the toast container on the toast layer', () => {
    useToastStore.setState({
      toasts: [{ id: 'saved', type: 'success', message: 'Saved', duration: 0 }],
    });
    const { container } = render(<ToastContainer />);
    expect(container.querySelector('.toast-container')?.className).toContain('z-[var(--z-toast)]');
  });
});
