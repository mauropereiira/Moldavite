/** App-level recovery-screen regression for uncaught child render errors. */

import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenChild(): never {
  throw new Error('render failed');
}

it('renders a reload recovery screen when a child throws', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  render(
    <AppErrorBoundary>
      <BrokenChild />
    </AppErrorBoundary>
  );

  expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible();
  consoleError.mockRestore();
});
