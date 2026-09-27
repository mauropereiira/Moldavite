import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberActiveForge } from '@/lib/forgeStorage';
import { SettingsData } from './SettingsData';

const invoke = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('@/lib/ipc', () => ({ safeInvoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open, save }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => toast }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  rememberActiveForge('Work');
});

describe('settings export and import', () => {
  it('exports the folder state the folder store actually writes for the active Forge', async () => {
    localStorage.setItem('moldavite-folders:Work', '{"state":{"expanded":["a"]}}');
    save.mockResolvedValue('/tmp/settings.json');
    invoke.mockResolvedValue(undefined);
    render(<SettingsData />);
    fireEvent.click(screen.getByRole('button', { name: 'Export settings (.json)' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Settings exported successfully')
    );
    const [command, { json }] = invoke.mock.calls[0];
    expect(command).toBe('export_settings_json');
    expect(JSON.parse(json).entries).toMatchObject({
      'moldavite-folders:Work': '{"state":{"expanded":["a"]}}',
    });
  });

  it('imports folder state into the key the folder store reads for the active Forge', async () => {
    open.mockResolvedValue('/tmp/settings.json');
    invoke.mockResolvedValue(
      JSON.stringify({
        app: 'moldavite',
        kind: 'settings',
        version: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        entries: { 'moldavite-folders:Work': '{"state":{"expanded":["b"]}}' },
      })
    );
    render(<SettingsData />);
    fireEvent.click(screen.getByRole('button', { name: 'Import settings (.json)' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(localStorage.getItem('moldavite-folders:Work')).toBe('{"state":{"expanded":["b"]}}');
  });
});
