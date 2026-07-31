import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import {
  htmlToMarkdown,
  isHtmlContent,
  listNotes,
  markdownToHtml,
  preserveBufferCopy,
  readNoteWithMeta,
} from '@/lib/fileSystem';
import { flushPendingAutosave, resetAutosaveBaseline } from '@/lib/autosaveFlush';
import { useNoteStore } from '@/stores/noteStore';

export function ExternalChangeBanner() {
  const currentNote = useNoteStore((state) => state.currentNote);
  const externallyChanged = useNoteStore((state) => state.externallyChanged);
  const [isResolving, setIsResolving] = useState(false);
  const toast = useToast();

  if (!currentNote || !externallyChanged.has(currentNote.id)) return null;

  const filename = currentNote.isDaily
    ? `${currentNote.date}.md`
    : currentNote.isWeekly
      ? `${currentNote.week}.md`
      : currentNote.id.startsWith('notes/')
        ? currentNote.id.slice('notes/'.length)
        : `${currentNote.title}.md`;

  const keepBuffer = async () => {
    setIsResolving(true);
    await flushPendingAutosave();
    useNoteStore.getState().clearExternallyChanged(currentNote.id);
    setIsResolving(false);
  };

  const handleUseDisk = async () => {
    setIsResolving(true);
    try {
      const copy = await preserveBufferCopy(
        filename,
        htmlToMarkdown(currentNote.content),
        currentNote.isDaily,
        currentNote.isWeekly
      );
      const disk = await readNoteWithMeta(filename, currentNote.isDaily, currentNote.isWeekly);
      const html = isHtmlContent(disk.content) ? disk.content : markdownToHtml(disk.content);
      useNoteStore.getState().applyExternalContent(currentNote.id, html);
      resetAutosaveBaseline(currentNote.id, html);
      listNotes()
        .then((notes) => useNoteStore.getState().setNotes(notes))
        .catch((error) => {
          console.error('[ExternalChangeBanner] Failed to refresh note list:', error);
        });
      toast.success(`Saved your version as ${copy.split('/').pop() ?? copy}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Could not use the disk version: ${message}`);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 text-sm border-b"
      style={{
        backgroundColor: 'var(--warning-muted)',
        borderColor: 'var(--warning)',
        color: 'var(--text-primary)',
      }}
      role="status"
      aria-live="polite"
    >
      <span>This note changed on disk.</span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          className="btn btn-sm focus-ring"
          disabled={isResolving}
          onClick={() => void keepBuffer()}
        >
          Keep my version
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary focus-ring"
          disabled={isResolving}
          onClick={() => void handleUseDisk()}
        >
          Use disk version
        </button>
      </div>
    </div>
  );
}
