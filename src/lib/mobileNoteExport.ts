import { safeInvoke } from './ipc';
import { readNote, stripMarkdown } from './fileSystem';
import { flushPendingAutosave, getPendingAutosaveNoteId } from './autosaveFlush';

async function flushBeforeExport() {
  await flushPendingAutosave();
  if (getPendingAutosaveNoteId()) throw new Error('Save the pending edit before exporting.');
}

export async function exportMobileNote(
  path: string,
  format: 'markdown' | 'plaintext'
): Promise<boolean> {
  await flushBeforeExport();
  if (format === 'markdown') {
    return safeInvoke('export_mobile_document', { request: { kind: 'note', path } });
  }
  const [category, ...parts] = path.split('/');
  if (!['notes', 'daily', 'weekly'].includes(category) || parts.length === 0) {
    throw new Error('Invalid note path');
  }
  const markdown = await readNote(parts.join('/'), category === 'daily', category === 'weekly');
  const filename =
    parts[parts.length - 1].replace(/\.md$/, '').replace(/[\\/:*?"<>|]/g, '_') + '.txt';
  return safeInvoke('export_mobile_document', {
    request: { kind: 'text', path, filename, content: stripMarkdown(markdown) },
  });
}

export async function exportMobileSelection(paths: string[]): Promise<boolean> {
  await flushBeforeExport();
  return safeInvoke('export_mobile_document', { request: { kind: 'selection', paths } });
}
