/**
 * Sidebar tag aggregation and filtering over unlocked note content.
 * Content is cached by note path until its modification time changes or a save
 * or watcher event marks it stale (`markNoteTagsStale`), locked
 * notes and notes still in iCloud are never read (a read must not start a
 * download), and selected-tag filtering uses AND semantics while the tag
 * feature is enabled.
 */

import { useEffect, useRef } from 'react';
import { aggregateTags, hasTag, extractTags, readNoteSnapshot, noteFileBackendPath } from '@/lib';
import { isNotDownloadedError } from '@/lib/cloudNotes';
import { markNoteTagsStale, takeNoteTagsStale, useSettingsStore, useTagStore } from '@/stores';
import type { NoteFile } from '@/types';

/**
 * Reads every unlocked note (results cached in-memory per path and modification time),
 * feeds them into `aggregateTags`, keeps `useTagStore` in sync, and
 * exposes helpers for the sidebar to look up tags on a single note and
 * to filter a list of notes by the user's selected tag(s).
 */
export function useSidebarTags(notes: NoteFile[]) {
  const { tagsEnabled } = useSettingsStore();
  const { selectedTags, setAllTags, setSelectedTag } = useTagStore();

  const noteContentCacheRef = useRef<Map<string, { modifiedAt?: number; content: string }>>(
    new Map()
  );

  const getNoteTags = (notePath: string): string[] => {
    const content = noteContentCacheRef.current.get(notePath)?.content;
    if (!content) return [];
    return extractTags(content);
  };

  // Aggregate tags from all notes (only when tags are enabled).
  useEffect(() => {
    if (!tagsEnabled) {
      setAllTags(new Map());
      setSelectedTag(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      const contents: string[] = [];
      for (const note of notes) {
        if (cancelled) return;
        if (note.isLocked || note.notDownloaded) continue;
        const cached = noteContentCacheRef.current.get(note.path);
        const stale = takeNoteTagsStale(note.path);
        let content =
          !stale && cached?.modifiedAt === note.modifiedAt ? cached?.content : undefined;
        if (content === undefined) {
          try {
            // Snapshot read: tag scanning must not adopt the note's save
            // baseline, or a later save could overwrite an external edit
            // without preserving it as a conflict copy.
            const snapshot = await readNoteSnapshot(
              noteFileBackendPath(note),
              note.isDaily || false,
              note.isWeekly || false
            );
            // A newer scan owns the cache once this one is cancelled: this
            // read may predate the write that cancelled it.
            if (cancelled) {
              if (stale) markNoteTagsStale(note.path);
              return;
            }
            content = snapshot.content;
            noteContentCacheRef.current.set(note.path, {
              modifiedAt: note.modifiedAt,
              content,
            });
          } catch (error) {
            if (isNotDownloadedError(error)) continue;
            console.error('[Sidebar] Failed to read note for tags:', note.name);
            content = '';
          }
        }
        contents.push(content);
      }
      if (cancelled) return;
      const tags = aggregateTags(contents);
      setAllTags(tags);
      // Only a finished scan can say a tag is gone; earlier, a tag just tapped would be cleared.
      const { selectedTag } = useTagStore.getState();
      if (selectedTag && !tags.has(selectedTag)) setSelectedTag(null);
    };

    run();
    // A slower scan of an older note list must not overwrite a newer result.
    return () => {
      cancelled = true;
    };
  }, [notes, setAllTags, setSelectedTag, tagsEnabled]);

  // Filter notes by the user's selected-tag set (AND semantics).
  // Not wrapped in useMemo — React Compiler handles the equivalent
  // caching and manual memoization interferes with its analysis.
  const filterByTag = (list: NoteFile[]): NoteFile[] => {
    if (selectedTags.length === 0) return list;
    return list.filter((note) => {
      const content = noteContentCacheRef.current.get(note.path)?.content;
      if (!content) return false;
      return selectedTags.every((tag) => hasTag(content, tag));
    });
  };

  return { getNoteTags, filterByTag };
}
