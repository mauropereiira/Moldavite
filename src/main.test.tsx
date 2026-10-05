import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ mobile: false }));

vi.mock('./App', () => ({ default: () => <p>app</p> }));
vi.mock('./lib/platform', () => ({ isMobilePlatform: () => env.mobile }));

beforeEach(() => {
  vi.resetModules();
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
});

afterEach(() => {
  document.getElementById('root')?.remove();
  vi.restoreAllMocks();
});

it.each([
  ['on the desktop', false],
  ['on a phone', true],
])('mounts the app %s', async (_label, mobile) => {
  env.mobile = mobile;
  vi.doMock('./mobile.css', () => ({}));

  await import('./main');

  expect(await screen.findByText('app')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('logs and shows the recovery screen when the phone stylesheet fails to load', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  env.mobile = true;
  vi.doMock('./mobile.css', () => {
    throw new Error('chunk failed to load');
  });

  await import('./main');

  expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible();
  expect(screen.queryByText('app')).toBeNull();
  expect(consoleError).toHaveBeenCalledWith('[main] Failed to start the app:', expect.any(Error));
});
