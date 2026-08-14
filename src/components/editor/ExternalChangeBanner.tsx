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
import { ConfirmDialog } from '@/components/ui';

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
  const client = externallyChanged.get(currentNote.id);

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
    <ConfirmDialog
      title={client ? `${client} wants to change this note.` : 'This note changed on disk.'}
      message={
        client
          ? "You have unsaved edits. Accepting replaces them with the agent's version."
          : 'You have unsaved edits. Using the disk version replaces them.'
      }
      confirmLabel={client ? 'Accept' : 'Use disk version'}
      cancelLabel={client ? 'Keep mine' : 'Keep my version'}
      busy={isResolving}
      onConfirm={() => void handleUseDisk()}
      onCancel={() => void keepBuffer()}
    />
  );
}
