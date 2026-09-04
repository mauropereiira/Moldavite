import { Dropdown, DropdownItem, DropdownDivider } from '@/components/ui/Dropdown';
import { useNoteStore } from '@/stores';
import { htmlToMarkdown } from '@/lib';

interface ShareMenuProps {
  onShowToast?: (message: string) => void;
  openDirection?: 'up' | 'down';
}

export function ShareMenu({ onShowToast, openDirection = 'down' }: ShareMenuProps) {
  // Export needs the note body, so this genuinely reads `content` and
  // re-renders on every keystroke like the Editor itself — narrowed to just
  // `currentNote` (rather than the whole store) so unrelated state changes
  // elsewhere don't also re-render it.
  const currentNote = useNoteStore((state) => state.currentNote);

  const handleCopyLink = async () => {
    if (!currentNote) return;

    // Create partial wiki link for easy paste - user can confirm via autocomplete
    const noteName = currentNote.isDaily && currentNote.date ? currentNote.date : currentNote.title;

    const wikiLink = `[${noteName}`;

    try {
      await navigator.clipboard.writeText(wikiLink);
      onShowToast?.('Wiki link copied');
    } catch (error) {
      console.error('[ShareMenu] Failed to copy link:', error);
    }
  };

  const handleExportText = async () => {
    if (!currentNote) return;

    try {
      // Convert HTML content to plain text
      const markdown = htmlToMarkdown(currentNote.content);
      const plainText = markdown
        .replace(/#{1,6}\s/g, '') // Remove heading markers
        .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
        .replace(/\*([^*]+)\*/g, '$1') // Remove italic
        .replace(/`([^`]+)`/g, '$1') // Remove inline code
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Replace links with text

      // Create and download file
      const blob = new Blob([plainText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentNote.title}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onShowToast?.('Exported as text');
    } catch (error) {
      console.error('[ShareMenu] Failed to export as text:', error);
    }
  };

  return (
    <Dropdown
      position="right"
      openDirection={openDirection}
      trigger={
        <button className="toolbar-button" title="Share" aria-label="Share">
          Share
        </button>
      }
    >
      <DropdownItem onClick={handleCopyLink}>Copy wiki link</DropdownItem>
      <DropdownDivider />
      <DropdownItem onClick={handleExportText}>Export as plain text</DropdownItem>
    </Dropdown>
  );
}
