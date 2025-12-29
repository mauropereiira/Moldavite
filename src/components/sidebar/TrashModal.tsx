import { useState } from 'react';
import { X, Undo2, Trash2, FileText, Calendar, Folder, ChevronRight } from 'lucide-react';
import type { TrashedNote } from '@/types';

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  trashedNotes: TrashedNote[];
  onRestore: (trashId: string) => void;
  onRestoreNoteFromFolder?: (trashId: string, noteFilename: string) => void;
  onPermanentDelete: (trashId: string) => void;
  onEmptyTrash: () => void;
}

export function TrashModal({
  isOpen,
  onClose,
  trashedNotes,
  onRestore,
  onRestoreNoteFromFolder,
  onPermanentDelete,
  onEmptyTrash,
}: TrashModalProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const handleEmptyTrash = () => {
    if (trashedNotes.length === 0) return;
    onEmptyTrash();
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 modal-backdrop-enter"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 modal-content-enter overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Trash
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Items are automatically deleted after 7 days
          </p>
        </div>

        {/* Content */}
        <div className="max-h-80 overflow-y-auto">
          {trashedNotes.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Trash2 className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Trash is empty
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {trashedNotes.map((note) => (
                <div key={note.id}>
                  {/* Main item row */}
                  <div
                    className={`px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                      note.isFolder ? 'cursor-pointer' : ''
                    }`}
                    onClick={note.isFolder ? () => toggleFolder(note.id) : undefined}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        {note.isFolder ? (
                          <div className="flex items-center gap-1">
                            <ChevronRight
                              className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                                expandedFolders.has(note.id) ? 'rotate-90' : ''
                              }`}
                            />
                            <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                          </div>
                        ) : note.isDaily ? (
                          <Calendar className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {note.filename.replace(/\.md$/, '')}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {note.isFolder && note.containedFiles.length > 0
                              ? `${note.containedFiles.length} ${note.containedFiles.length === 1 ? 'note' : 'notes'} · `
                              : ''}
                            {note.daysRemaining} {note.daysRemaining === 1 ? 'day' : 'days'} remaining
                          </p>
                        </div>
                      </div>
                      <div
                        className="flex items-center gap-1 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => onRestore(note.id)}
                          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                          title={note.isFolder ? 'Restore folder' : 'Restore note'}
                        >
                          <Undo2 className="w-4 h-4 text-gray-500 hover:text-blue-500" />
                        </button>
                        <button
                          onClick={() => onPermanentDelete(note.id)}
                          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                          title="Delete permanently"
                        >
                          <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-500" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded folder contents */}
                  {note.isFolder && expandedFolders.has(note.id) && note.containedFiles.length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800">
                      {note.containedFiles.map((filename) => (
                        <div
                          key={filename}
                          className="px-4 py-2 pl-12 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                              <p className="text-sm text-gray-700 dark:text-gray-300 truncate">
                                {filename.replace(/\.md$/, '')}
                              </p>
                            </div>
                            {onRestoreNoteFromFolder && (
                              <button
                                onClick={() => onRestoreNoteFromFolder(note.id, filename)}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
                                title="Restore to notes"
                              >
                                <Undo2 className="w-3.5 h-3.5 text-gray-500 hover:text-blue-500" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {trashedNotes.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleEmptyTrash}
              className="w-full px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              Empty Trash
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
