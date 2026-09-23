import { Cloud } from 'lucide-react';
import { DotLoader } from '@/components/ui/DotLoader';
import { downloadCloudNote, useCloudDownloadStore } from '@/lib/cloudNotes';
import type { Note } from '@/types';

/** Shown in place of the editor for a note whose contents are still in iCloud. */
export function CloudNotePlaceholder({ note }: { note: Note }) {
  const status = useCloudDownloadStore((state) => state.downloads[note.id]);
  const download = () => void downloadCloudNote(note);

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Cloud size={28} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
      <h2 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
        This note is in iCloud
      </h2>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        It hasn&apos;t been downloaded to this device yet.
      </p>
      {status?.state === 'downloading' ? (
        <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <DotLoader label="Downloading" />
          Downloading…
        </p>
      ) : status?.state === 'error' ? (
        <>
          <p className="text-sm" role="alert" style={{ color: 'var(--text-primary)' }}>
            {status.message}
          </p>
          <button type="button" className="btn min-h-11 focus-ring" onClick={download}>
            Try again
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-primary min-h-11 focus-ring" onClick={download}>
          Download
        </button>
      )}
    </div>
  );
}
