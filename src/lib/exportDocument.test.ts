import { beforeEach, expect, it, vi } from 'vitest';
import { exportDocument } from './exportDocument';

const save = vi.hoisted(() => vi.fn());
const exportNotes = vi.hoisted(() => vi.fn());
const exportEncryptedBackup = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-dialog', () => ({ save }));
vi.mock('./fileSystem', () => ({ exportNotes, exportEncryptedBackup }));
vi.mock('./ipc', () => ({ safeInvoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('./platform', () => ({ isMobilePlatform: () => false }));

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue('/chosen/export');
});

it('keeps desktop note and encrypted backup writes at the selected destination', async () => {
  expect(await exportDocument({ kind: 'notes' })).toBe(true);
  expect(exportNotes).toHaveBeenCalledWith('/chosen/export');
  expect(await exportDocument({ kind: 'backup', password: 'test password' })).toBe(true);
  expect(exportEncryptedBackup).toHaveBeenCalledWith('/chosen/export', 'test password');
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps desktop settings payloads and destination intact', async () => {
  const json = '{"app":"moldavite"}';
  expect(await exportDocument({ kind: 'settings', json })).toBe(true);
  expect(invoke).toHaveBeenCalledWith('export_settings_json', { path: '/chosen/export', json });
});

it('does not write anything after cancelling the desktop picker', async () => {
  save.mockResolvedValue(null);
  expect(await exportDocument({ kind: 'notes' })).toBe(false);
  expect(exportNotes).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
