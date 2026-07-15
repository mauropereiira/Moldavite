import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { __resetObsidianImportStoreForTests, useObsidianImportStore } from './obsidianImportStore';
import { OBSIDIAN_IMPORT_PROGRESS_EVENT } from '@/lib/obsidianImport';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
type Handler = (event: { payload: unknown }) => void;
let handlers: Record<string, Handler>;

const preview = {
  noteCount: 12,
  attachmentCount: 3,
  detectedDailyNotes: { folder: 'Journal', format: 'DD-MM-YYYY' },
  folderCount: 4,
  canvasCount: 1,
  estimatedCollisions: 2,
  hasObsidianDirectory: true,
  warnings: [],
};

const report = {
  forgeName: 'Research',
  dailyNotesImported: 5,
  standaloneNotesImported: 7,
  attachmentsImported: 2,
  skippedItems: [{ path: 'Board.canvas', reason: 'Obsidian Canvas files are not imported' }],
  linkConversionsPerformed: 9,
  warnings: ['Could not resolve attachment missing.png'],
};

describe('obsidianImportStore', () => {
  beforeEach(() => {
    __resetObsidianImportStoreForTests();
    handlers = {};
    mockListen.mockReset();
    mockListen.mockImplementation(async (event, handler) => {
      handlers[event as string] = handler as Handler;
      return () => {};
    });
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'analyze_obsidian_vault') return preview;
      if (command === 'import_obsidian_vault') return report;
      return undefined;
    });
  });

  it('analyzes a selected folder and prefills the Forge name from its final segment', async () => {
    await useObsidianImportStore.getState().analyze('/Users/example/Obsidian/Research');

    expect(mockInvoke).toHaveBeenCalledWith('analyze_obsidian_vault', {
      path: '/Users/example/Obsidian/Research',
    });
    const state = useObsidianImportStore.getState();
    expect(state.stage).toBe('preview');
    expect(state.forgeName).toBe('Research');
    expect(state.preview).toEqual(preview);
    expect(Object.keys(handlers)).toEqual([OBSIDIAN_IMPORT_PROGRESS_EVENT]);
  });

  it('supports Windows-style selected paths without using Array.at', async () => {
    await useObsidianImportStore.getState().analyze('C:\\Notes\\Personal Vault');
    expect(useObsidianImportStore.getState().forgeName).toBe('Personal Vault');
  });

  it('rejects an unsafe Forge name before invoking the import command', async () => {
    await useObsidianImportStore.getState().analyze('/vaults/Research');
    mockInvoke.mockClear();
    useObsidianImportStore.getState().setForgeName('../escape');

    await expect(useObsidianImportStore.getState().startImport()).rejects.toThrow(
      'cannot contain ".."'
    );
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useObsidianImportStore.getState().stage).toBe('preview');
  });

  it('streams progress and finishes on the summary report', async () => {
    let resolveImport: ((value: typeof report) => void) | undefined;
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'analyze_obsidian_vault') return preview;
      if (command === 'import_obsidian_vault') {
        return await new Promise<typeof report>((resolve) => {
          resolveImport = resolve;
        });
      }
      return undefined;
    });
    await useObsidianImportStore.getState().analyze('/vaults/Research');
    const importing = useObsidianImportStore.getState().startImport();
    await Promise.resolve();
    handlers[OBSIDIAN_IMPORT_PROGRESS_EVENT]({ payload: { current: 10, total: 12 } });
    expect(useObsidianImportStore.getState().progress).toEqual({ current: 10, total: 12 });

    if (!resolveImport) throw new Error('Import command was not invoked');
    resolveImport(report);
    await expect(importing).resolves.toEqual(report);
    const state = useObsidianImportStore.getState();
    expect(state.stage).toBe('summary');
    expect(state.report).toEqual(report);
    expect(state.progress).toBeNull();
  });

  it('reset clears all transient wizard state', async () => {
    await useObsidianImportStore.getState().analyze('/vaults/Research');
    useObsidianImportStore.getState().reset();
    const state = useObsidianImportStore.getState();
    expect(state.stage).toBe('idle');
    expect(state.sourcePath).toBeNull();
    expect(state.preview).toBeNull();
    expect(state.report).toBeNull();
  });
});
