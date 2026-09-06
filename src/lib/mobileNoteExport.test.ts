import { beforeEach, expect, it, vi } from 'vitest';
import { exportMobileNote, exportMobileSelection } from './mobileNoteExport';

const invoke = vi.hoisted(() => vi.fn());
const readNote = vi.hoisted(() => vi.fn());
const flush = vi.hoisted(() => vi.fn());
const pending = vi.hoisted(() => vi.fn());
vi.mock('./ipc', () => ({ safeInvoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('./fileSystem', async () => {
  const actual = await vi.importActual<typeof import('./fileSystem')>('./fileSystem');
  return { ...actual, readNote: (...args: unknown[]) => readNote(...args) };
});
vi.mock('./autosaveFlush', () => ({
  flushPendingAutosave: flush,
  getPendingAutosaveNoteId: pending,
}));

beforeEach(() => {
  vi.clearAllMocks();
  flush.mockResolvedValue(undefined);
  pending.mockReturnValue(null);
  invoke.mockResolvedValue(true);
});

it('exports Markdown by its full note path after flushing', async () => {
  await exportMobileNote('notes/Project/same.md', 'markdown');
  expect(flush.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0]);
  expect(invoke).toHaveBeenCalledWith('export_mobile_document', {
    request: { kind: 'note', path: 'notes/Project/same.md' },
  });
});

it('reads nested plaintext from the correct folder and strips Markdown', async () => {
  readNote.mockResolvedValue('# Heading\n\n**Text**');
  await exportMobileNote('notes/Project/same.md', 'plaintext');
  expect(readNote).toHaveBeenCalledWith('Project/same.md', false, false);
  expect(invoke).toHaveBeenCalledWith('export_mobile_document', {
    request: {
      kind: 'text',
      path: 'notes/Project/same.md',
      filename: 'same.txt',
      content: 'Heading\n\nText\n',
    },
  });
});

it('refuses to export stale disk content when an edit remains pending', async () => {
  pending.mockReturnValue('notes/pending.md');
  await expect(exportMobileSelection(['notes/pending.md'])).rejects.toThrow(
    'Save the pending edit'
  );
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps selected paths and cancellation intact', async () => {
  invoke.mockResolvedValue(false);
  const paths = ['notes/Project/same.md', 'notes/same.md'];
  expect(await exportMobileSelection(paths)).toBe(false);
  expect(invoke).toHaveBeenCalledWith('export_mobile_document', {
    request: { kind: 'selection', paths },
  });
});
