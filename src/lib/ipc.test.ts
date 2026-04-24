import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeIpcError, safeInvoke } from './ipc';

describe('sanitizeIpcError', () => {
  it('redacts POSIX home paths', () => {
    const raw = 'Failed to read /Users/alice/Documents/notes/x.md: denied';
    expect(sanitizeIpcError(raw)).toBe('Failed to read <path>: denied');
  });

  it('redacts Windows drive paths', () => {
    const raw = 'ENOENT C:\\Users\\Bob\\notes\\x.md';
    expect(sanitizeIpcError(raw)).toContain('<path>');
    expect(sanitizeIpcError(raw)).not.toContain('Bob');
  });

  it('leaves non-path messages untouched', () => {
    expect(sanitizeIpcError('Invalid password')).toBe('Invalid password');
  });
});

describe('safeInvoke', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves with the invoke result on success', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await expect(safeInvoke('get_config')).resolves.toEqual({ ok: true });
  });

  it('sanitizes thrown string errors', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      'Failed to read /Users/eve/secret.md',
    );
    await expect(safeInvoke('read_note')).rejects.toThrow(/read <path>/);
  });
});
