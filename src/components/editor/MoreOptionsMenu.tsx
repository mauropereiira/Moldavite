import { isMobilePlatform } from '@/lib/platform';
import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { save } from '@tauri-apps/plugin-dialog';
import { Dropdown, DropdownItem, DropdownDivider } from '@/components/ui/Dropdown';
import { useNoteStore, useQuickSwitcherStore } from '@/stores';
import { htmlToMarkdown, exportSingleNote, exportNoteToPdf, exportNoteAsPlaintext } from '@/lib';
import { fileStem, noteDiskFilename } from '@/lib/leaveSave';
import { useNotes } from '@/hooks/useNotes';
import { SaveTemplateModal } from '@/components/templates/SaveTemplateModal';
import { PdfExportOptionsModal } from './PdfExportOptionsModal';
import type { NoteFile } from '@/types';
import type { PdfPageSize, PdfMarginPreset } from '@/stores';
import { noteDeepLink } from '@/hooks/usePluginDeepLinks';
import { isDroppedId, isLooseNote } from '@/lib/looseId';
import { revealLooseFile, saveLooseCopy } from '@/lib/looseFiles';
import { CURRENT_PLATFORM } from '@/lib/shortcuts';
import { CloseButton } from '@/components/ui/CloseButton';

const REVEAL_LABEL =
  CURRENT_PLATFORM === 'macos'
    ? 'Show in Finder'
    : CURRENT_PLATFORM === 'windows'
      ? 'Show in Explorer'
      : 'Show in folder';

const RenameNoteModal = lazy(() =>
  import('@/components/ui/RenameNoteModal').then((m) => ({ default: m.RenameNoteModal }))
);

interface MoreOptionsMenuProps {
  onDelete: () => void;
  onShowToast?: (message: string) => void;
  wordCount: number;
  characterCount: number;
  openDirection?: 'up' | 'down';
  onRenameNote: (note: NoteFile, title: string) => Promise<void>;
  /** A locked note open for viewing: its plaintext exists only in memory. */
  readOnly?: boolean;
}

export function MoreOptionsMenu({
  onDelete,
  onShowToast,
  wordCount,
  characterCount,
  onRenameNote,
  openDirection = 'down',
  readOnly = false,
}: MoreOptionsMenuProps) {
  // Menu actions only need the current note at the moment they run, and the
  // note info / rename affordances only need a few primitive fields — none
  // of that requires `content`, so it is read fresh from the store (never
  // subscribed) and a content-only edit in the editor does not re-render
  // this menu.
  const { currentNoteId, currentNoteIsDaily, currentNoteTitle, currentNoteDate, isLoose } =
    useNoteStore(
      useShallow((state) => ({
        currentNoteId: state.currentNote?.id ?? null,
        currentNoteIsDaily: state.currentNote?.isDaily ?? false,
        currentNoteTitle: state.currentNote?.title ?? '',
        currentNoteDate: state.currentNote?.date,
        isLoose: isLooseNote(state.currentNote),
      }))
    );
  const isDropped = isDroppedId(currentNoteId);
  const notes = useNoteStore((state) => state.notes);
  const { duplicateNote, addFileToForge } = useNotes();
  const { togglePinned, isPinned } = useQuickSwitcherStore();
  const [showNoteInfo, setShowNoteInfo] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [showPdfOptions, setShowPdfOptions] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const mobile = isMobilePlatform();
  const currentNoteFile = currentNoteId
    ? notes.find((note) => note.path === currentNoteId)
    : undefined;

  const handleCopyUrl = async () => {
    const currentNote = useNoteStore.getState().currentNote;
    if (!currentNote) return;

    try {
      await navigator.clipboard.writeText(noteDeepLink(currentNote));
      onShowToast?.('URL copied');
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to copy URL:', error);
    }
  };

  const handleDuplicate = async () => {
    const currentNote = useNoteStore.getState().currentNote;
    if (!currentNote || currentNote.isDaily) {
      onShowToast?.('Cannot duplicate daily notes');
      return;
    }

    try {
      if (!currentNoteFile) throw new Error(`${currentNote.id} is not in the note list`);
      await duplicateNote(currentNoteFile);
      onShowToast?.('Note duplicated');
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to duplicate:', error);
      onShowToast?.('Failed to duplicate');
    }
  };

  const handleExport = async () => {
    const currentNote = useNoteStore.getState().currentNote;
    if (!currentNote) return;

    try {
      if (isMobilePlatform()) {
        const { exportMobileNote } = await import('@/lib/mobileNoteExport');
        if (await exportMobileNote(currentNote.id, 'markdown')) onShowToast?.('Note exported');
        return;
      }
      const filename = noteDiskFilename(currentNote);
      const destination = await save({
        title: 'Export Note',
        defaultPath: `${fileStem(filename)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });

      if (destination) {
        await exportSingleNote(
          filename,
          destination,
          currentNote.isDaily || false,
          currentNote.isWeekly || false
        );
        onShowToast?.('Note exported');
      }
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to export:', error);
      onShowToast?.('Failed to export');
    }
  };

  // Step 1: open the options modal. Step 2 (handlePdfExportConfirm) actually
  // shows the save dialog and writes the PDF. Splitting these keeps the menu
  // click responsive — the file picker only opens after the user confirms
  // page size + margin choices.
  const handleExportPdf = () => {
    if (!currentNoteId) return;
    setShowPdfOptions(true);
  };

  const handlePdfExportConfirm = async (opts: {
    pageSize: PdfPageSize;
    margin: PdfMarginPreset;
  }) => {
    setShowPdfOptions(false);
    const currentNote = useNoteStore.getState().currentNote;
    if (!currentNote) return;

    try {
      const baseName =
        currentNote.isDaily && currentNote.date
          ? currentNote.date
          : currentNote.isWeekly && currentNote.week
            ? currentNote.week
            : currentNote.title;

      const destination = await save({
        title: 'Export as PDF',
        defaultPath: `${baseName}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (destination) {
        await exportNoteToPdf(baseName, currentNote.content, destination, opts);
        onShowToast?.('Exported as PDF');
      }
    } catch (error) {
      console.error('[MoreOptionsMenu] PDF export failed:', error);
      onShowToast?.('Failed to export PDF');
    }
  };

  const handleExportPlaintext = async () => {
    const currentNote = useNoteStore.getState().currentNote;
    if (!currentNote) return;

    try {
      const filename = noteDiskFilename(currentNote);
      const destination = await save({
        title: 'Export as plain text',
        defaultPath: `${fileStem(filename)}.txt`,
        filters: [{ name: 'Plain Text', extensions: ['txt'] }],
      });

      if (destination) {
        await exportNoteAsPlaintext(
          filename,
          destination,
          currentNote.isDaily || false,
          currentNote.isWeekly || false
        );
        onShowToast?.('Exported as plain text');
      }
    } catch (error) {
      console.error('[MoreOptionsMenu] Plaintext export failed:', error);
      onShowToast?.('Failed to export plain text');
    }
  };

  const handleReveal = async () => {
    const currentNote = useNoteStore.getState().currentNote;
    if (!currentNote) return;
    try {
      await revealLooseFile(currentNote);
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to reveal the file:', error);
      onShowToast?.('Could not show the file');
    }
  };

  const handleAddToForge = async () => {
    const currentNote = useNoteStore.getState().currentNote;
    if (!currentNote) return;
    try {
      await addFileToForge(currentNote);
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to add to the Forge:', error);
      onShowToast?.('Could not add to the Forge');
    }
  };

  const handleSaveCopy = async () => {
    const currentNote = useNoteStore.getState().currentNote;
    if (!currentNote) return;
    try {
      const name = await saveLooseCopy(currentNote);
      if (name) onShowToast?.(`Saved a copy as ${name}`);
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to save a copy:', error);
      onShowToast?.('Could not save a copy');
    }
  };

  const handleShowInfo = () => {
    setShowNoteInfo(true);
  };

  const getFileSizeEstimate = () => {
    const currentNote = useNoteStore.getState().currentNote;
    if (!currentNote) return '0 B';
    const markdown = htmlToMarkdown(currentNote.content);
    const bytes = new Blob([markdown]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Read fresh (not subscribed) only when the modal is about to show, so a
  // content-only edit never triggers this markdown conversion.
  const templateInitialContent =
    currentNoteId && showSaveTemplateModal
      ? htmlToMarkdown(useNoteStore.getState().currentNote?.content ?? '')
      : '';

  return (
    <>
      <Dropdown
        position="right"
        openDirection={openDirection}
        trigger={
          <button className="toolbar-button" title="More options" aria-label="More options">
            More
          </button>
        }
      >
        {/* A file outside the Forge has no Forge address, so nothing that
            links, pins, duplicates, renames or deletes by one applies. */}
        {isLoose && (
          <>
            {!mobile && !isDropped && (
              <DropdownItem onClick={handleReveal}>{REVEAL_LABEL}</DropdownItem>
            )}
            <DropdownItem onClick={handleAddToForge}>Add to Forge</DropdownItem>
            {!mobile && !isDropped && (
              <DropdownItem onClick={handleSaveCopy}>Save a copy…</DropdownItem>
            )}
            {!mobile && <DropdownItem onClick={handleExportPdf}>Export as PDF…</DropdownItem>}
          </>
        )}
        {/* On the phone, pinning lives in the Index's note options and a note
            leaves the app through Share's system sheet. */}
        {!isLoose && !mobile && currentNoteId && (
          <DropdownItem onClick={() => togglePinned(currentNoteId)}>
            {isPinned(currentNoteId) ? 'Unpin from the top bar' : 'Pin to the top bar'}
          </DropdownItem>
        )}
        {!isLoose && !mobile && (
          <DropdownItem onClick={handleCopyUrl}>Copy URL to note</DropdownItem>
        )}
        {!isLoose && !readOnly && (
          <>
            <DropdownItem onClick={handleDuplicate} disabled={currentNoteIsDaily}>
              Duplicate note
            </DropdownItem>
            {currentNoteFile && !currentNoteFile.isDaily && !currentNoteFile.isWeekly && (
              <DropdownItem onClick={() => setShowRenameModal(true)}>Rename note…</DropdownItem>
            )}
            <DropdownItem onClick={handleExport}>Export as Markdown</DropdownItem>
            {!mobile && <DropdownItem onClick={handleExportPdf}>Export as PDF…</DropdownItem>}
            {!mobile && (
              <DropdownItem onClick={handleExportPlaintext}>Export as plain text</DropdownItem>
            )}
            <DropdownItem onClick={() => setShowSaveTemplateModal(true)}>
              Save as template
            </DropdownItem>
          </>
        )}
        {!isLoose && (
          <>
            {(!mobile || !readOnly) && <DropdownDivider />}
            <DropdownItem onClick={handleShowInfo}>Note info</DropdownItem>
            <DropdownDivider />
            <DropdownItem onClick={onDelete} variant="danger">
              Delete note
            </DropdownItem>
          </>
        )}
      </Dropdown>

      {/* The footer can fold this menu into the Actions menu, whose entry
          transform would become the containing block of these fixed dialogs
          and trap them inside it. */}
      {createPortal(
        <>
          {/* Note Info Modal */}
          {showNoteInfo && currentNoteId && (
            <div
              className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowNoteInfo(false);
              }}
            >
              <div
                className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full"
                style={{ borderRadius: 'var(--radius-md)' }}
              >
                <div className="dialog-head">
                  <h3
                    className="text-base font-semibold mb-4"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Note Info
                  </h3>
                  <CloseButton onClick={() => setShowNoteInfo(false)} label="Close" />
                </div>
                <div className="space-y-2 text-sm">
                  <div
                    className="flex justify-between py-1.5"
                    style={{ borderBottom: '1px solid var(--border-muted)' }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>Title</span>
                    <span
                      className="truncate max-w-[180px]"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {currentNoteTitle}
                    </span>
                  </div>
                  <div
                    className="flex justify-between py-1.5"
                    style={{ borderBottom: '1px solid var(--border-muted)' }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>Type</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {currentNoteIsDaily ? 'Daily' : 'Standalone'}
                    </span>
                  </div>
                  {currentNoteIsDaily && currentNoteDate && (
                    <div
                      className="flex justify-between py-1.5"
                      style={{ borderBottom: '1px solid var(--border-muted)' }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>Date</span>
                      <span style={{ color: 'var(--text-primary)' }}>{currentNoteDate}</span>
                    </div>
                  )}
                  <div
                    className="flex justify-between py-1.5"
                    style={{ borderBottom: '1px solid var(--border-muted)' }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>Words</span>
                    <span style={{ color: 'var(--text-primary)' }}>{wordCount}</span>
                  </div>
                  <div
                    className="flex justify-between py-1.5"
                    style={{ borderBottom: '1px solid var(--border-muted)' }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>Characters</span>
                    <span style={{ color: 'var(--text-primary)' }}>{characterCount}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span style={{ color: 'var(--text-muted)' }}>File Size</span>
                    <span style={{ color: 'var(--text-primary)' }}>{getFileSizeEstimate()}</span>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button onClick={() => setShowNoteInfo(false)} className="btn focus-ring">
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Save as Template Modal */}
          {currentNoteId && (
            <SaveTemplateModal
              isOpen={showSaveTemplateModal}
              onClose={() => setShowSaveTemplateModal(false)}
              initialContent={templateInitialContent}
            />
          )}

          {/* PDF export options modal */}
          <PdfExportOptionsModal
            isOpen={showPdfOptions}
            onClose={() => setShowPdfOptions(false)}
            onConfirm={handlePdfExportConfirm}
          />

          {showRenameModal && currentNoteFile && (
            <Suspense fallback={null}>
              <RenameNoteModal
                note={currentNoteFile}
                onRename={onRenameNote}
                onClose={() => setShowRenameModal(false)}
              />
            </Suspense>
          )}
        </>,
        document.body
      )}
    </>
  );
}
