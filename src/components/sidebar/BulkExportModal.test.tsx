/**
 * Bulk export addressing tests.
 *
 * Every format branch must address a note the way the backend does — by its
 * notes/-relative path — and the destination is one flat folder, so the
 * written filename has to carry the folder too or same-named notes collide.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NoteFile } from '@/types';

const openDialog = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => openDialog(...args),
}));

const joinPath = vi.fn((...paths: string[]) => Promise.resolve(paths.join('/')));
vi.mock('@tauri-apps/api/path', () => ({
  join: (...paths: string[]) => joinPath(...paths),
}));

const exportSingleNote = vi.fn();
const exportNoteAsPlaintext = vi.fn();
const exportNoteToPdf = vi.fn();
const readNote = vi.fn();

vi.mock('@/lib', async () => {
  const actual = await vi.importActual<typeof import('@/lib')>('@/lib');
  return {
    ...actual,
    exportSingleNote: (...args: unknown[]) => exportSingleNote(...args),
    exportNoteAsPlaintext: (...args: unknown[]) => exportNoteAsPlaintext(...args),
    exportNoteToPdf: (...args: unknown[]) => exportNoteToPdf(...args),
    readNote: (...args: unknown[]) => readNote(...args),
  };
});

import { BulkExportModal } from './BulkExportModal';
import { useNoteStore, useNoteSelectionStore } from '@/stores';

const folderNote: NoteFile = {
  name: 'roadmap.md',
  path: 'notes/Projects/roadmap.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
  folderPath: 'Projects',
};

const rootNote: NoteFile = {
  name: 'roadmap.md',
  path: 'notes/roadmap.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
};

async function exportSelection(format: 'markdown' | 'plaintext' | 'pdf', notes: NoteFile[]) {
  useNoteStore.setState({ notes });
  useNoteSelectionStore.getState().replace(notes.map((n) => n.path));

  const user = userEvent.setup();
  render(<BulkExportModal isOpen onClose={vi.fn()} />);
  if (format !== 'markdown') {
    await user.click(screen.getByRole('radio', { name: new RegExp(format, 'i') }));
  }
  await user.click(screen.getByRole('button', { name: /choose folder/i }));
}

beforeEach(() => {
  openDialog.mockReset().mockResolvedValue('/tmp/out');
  exportSingleNote.mockReset().mockResolvedValue('');
  exportNoteAsPlaintext.mockReset().mockResolvedValue('');
  exportNoteToPdf.mockReset().mockResolvedValue('');
  readNote.mockReset().mockResolvedValue('# body');
  joinPath.mockClear();
  useNoteSelectionStore.getState().clear();
});

describe('BulkExportModal note addressing', () => {
  it('renders a named modal dialog', () => {
    useNoteSelectionStore.getState().replace([folderNote.path]);
    render(<BulkExportModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Export 1 note' })).toHaveAttribute(
      'aria-modal',
      'true'
    );
  });

  it('exports Markdown by the notes/-relative path', async () => {
    await exportSelection('markdown', [folderNote]);
    expect(exportSingleNote).toHaveBeenCalledTimes(1);
    expect(exportSingleNote.mock.calls[0][0]).toBe('Projects/roadmap.md');
  });

  it('exports plaintext by the notes/-relative path', async () => {
    await exportSelection('plaintext', [folderNote]);
    expect(exportNoteAsPlaintext).toHaveBeenCalledTimes(1);
    expect(exportNoteAsPlaintext.mock.calls[0][0]).toBe('Projects/roadmap.md');
  });

  it('reads the PDF source by the notes/-relative path', async () => {
    await exportSelection('pdf', [folderNote]);
    expect(readNote).toHaveBeenCalledWith('Projects/roadmap.md', false, false);
  });
});

describe('BulkExportModal destination filenames', () => {
  it('delegates destination construction to the platform path API', async () => {
    await exportSelection('markdown', [rootNote]);
    expect(joinPath).toHaveBeenCalledWith('/tmp/out', 'roadmap.md');
  });

  it('keeps same-named notes in different folders from overwriting each other', async () => {
    await exportSelection('markdown', [folderNote, rootNote]);
    const destinations = exportSingleNote.mock.calls.map((c) => c[1]);
    expect(destinations).toEqual(['/tmp/out/Projects_roadmap.md', '/tmp/out/roadmap.md']);
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  it('leaves a root note filename unprefixed', async () => {
    await exportSelection('plaintext', [rootNote]);
    expect(exportNoteAsPlaintext.mock.calls[0][1]).toBe('/tmp/out/roadmap.txt');
  });
});
