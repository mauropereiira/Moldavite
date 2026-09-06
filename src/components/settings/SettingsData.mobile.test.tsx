import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsData } from './SettingsData';

const invoke = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => true }));
vi.mock('@/lib/ipc', () => ({ safeInvoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => toast }));

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue(true);
});

describe('mobile data export', () => {
  it('submits a complete ZIP export request without the desktop save dialog', async () => {
    render(<SettingsData />);
    fireEvent.click(screen.getByRole('button', { name: 'Export all notes (.zip)' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Notes exported successfully'));
    expect(invoke).toHaveBeenCalledWith('export_mobile_document', { request: { kind: 'notes' } });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not report success when the native picker is cancelled', async () => {
    invoke.mockResolvedValue(false);
    render(<SettingsData />);
    fireEvent.click(screen.getByRole('button', { name: 'Export all notes (.zip)' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export all notes (.zip)' })).toBeEnabled()
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('passes the backup password to the native export and clears the dialog', async () => {
    render(<SettingsData />);
    fireEvent.click(screen.getByRole('button', { name: 'Export encrypted backup' }));
    fireEvent.change(screen.getByPlaceholderText('Enter password'), {
      target: { value: 'test password' },
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'test password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Backup' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Encrypted backup created'));
    expect(invoke).toHaveBeenCalledWith('export_mobile_document', {
      request: { kind: 'backup', password: 'test password' },
    });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Export encrypted backup' }));
    expect(screen.getByPlaceholderText('Enter password')).toHaveValue('');
  });

  it('passes the actual settings payload to the native export', async () => {
    render(<SettingsData />);
    fireEvent.click(screen.getByRole('button', { name: 'Export settings (.json)' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Settings exported successfully')
    );
    const [command, { request }] = invoke.mock.calls[0];
    expect(command).toBe('export_mobile_document');
    expect(request.kind).toBe('settings');
    expect(JSON.parse(request.json)).toMatchObject({
      app: 'moldavite',
      kind: 'settings',
      version: 1,
    });
    expect(save).not.toHaveBeenCalled();
  });
});
