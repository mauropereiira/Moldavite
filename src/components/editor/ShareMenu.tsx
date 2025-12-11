import { Share2, Link2, FileText, FileDown } from 'lucide-react';
import { Dropdown, DropdownItem, DropdownDivider } from '@/components/ui/Dropdown';
import { useNoteStore } from '@/stores';
import { htmlToMarkdown } from '@/lib';

interface ShareMenuProps {
  onShowToast?: (message: string) => void;
}

export function ShareMenu({ onShowToast }: ShareMenuProps) {
  const { currentNote } = useNoteStore();

  const handleCopyLink = async () => {
    if (!currentNote) return;

    // Create partial wiki link for easy paste - user can confirm via autocomplete
    const noteName = currentNote.isDaily && currentNote.date
      ? currentNote.date
      : currentNote.title;

    const wikiLink = `[[${noteName}`;

    try {
      await navigator.clipboard.writeText(wikiLink);
      onShowToast?.('Wiki link copied');
    } catch (error) {
      console.error('[ShareMenu] Failed to copy link:', error);
    }
  };

  const handleExportPDF = () => {
    // Placeholder for PDF export
    onShowToast?.('PDF export coming soon');
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
      trigger={
        <button
          className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
          title="Share"
        >
          <Share2 className="w-4 h-4" />
        </button>
      }
    >
      <DropdownItem
        onClick={handleCopyLink}
        icon={<Link2 className="w-4 h-4" />}
      >
        Copy wiki link
      </DropdownItem>
      <DropdownDivider />
      <DropdownItem
        onClick={handleExportPDF}
        icon={<FileDown className="w-4 h-4" />}
        disabled
      >
        Export as PDF
      </DropdownItem>
      <DropdownItem
        onClick={handleExportText}
        icon={<FileText className="w-4 h-4" />}
      >
        Export as plain text
      </DropdownItem>
    </Dropdown>
  );
}
