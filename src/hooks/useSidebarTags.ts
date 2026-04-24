import { useEffect, useRef } from 'react';
import { aggregateTags, hasTag, extractTags, readNote } from '@/lib';
import { useSettingsStore, useTagStore } from '@/stores';
import type { NoteFile } from '@/types';

/**
 * Reads every unlocked note once (results cached in-memory per path),
 * feeds them into `aggregateTags`, keeps `useTagStore` in sync, and
 * exposes helpers for the sidebar to look up tags on a single note and
 * to filter a list of notes by the user's selected tag(s).
 */
export function useSidebarTags(notes: NoteFile[]) {
  const { tagsEnabled } = useSettingsStore();
  const { allTags, selectedTag, selectedTags, setAllTags, setSelectedTag } = useTagStore();

  // Cache note content by path so we don't re-read on every render.
  const noteContentCacheRef = useRef<Map<string, string>>(new Map());

  const getNoteTags = (notePath: string): string[] => {
    const content = noteContentCacheRef.current.get(notePath);
    if (!content) return [];
    return extractTags(content);
  };

  // Aggregate tags from all notes (only when tags are enabled).
  useEffect(() => {
    if (!tagsEnabled) {
      setAllTags(new Map());
      return;
    }

    const run = async () => {
      const contents: string[] = [];
      for (const note of notes) {
        if (note.isLocked) continue;
        let content = noteContentCacheRef.current.get(note.path);
        if (content === undefined) {
          try {
            content = await readNote(note.name, note.isDaily || false);
            noteContentCacheRef.current.set(note.path, content);
          } catch (_error) {
            console.error('[Sidebar] Failed to read note for tags:', note.name);
            content = '';
          }
        }
        contents.push(content);
      }
      setAllTags(aggregateTags(contents));
    };

    run();
  }, [notes, setAllTags, tagsEnabled]);

  // Clear tag filter when the tag it references vanishes.
  useEffect(() => {
    if (selectedTag && !allTags.has(selectedTag)) {
      setSelectedTag(null);
    }
  }, [allTags, selectedTag, setSelectedTag]);

  // Filter notes by the user's selected-tag set (AND semantics).
  // Not wrapped in useMemo — React Compiler handles the equivalent
  // caching and manual memoization interferes with its analysis.
  const filterByTag = (list: NoteFile[]): NoteFile[] => {
    if (selectedTags.length === 0) return list;
    return list.filter((note) => {
      const content = noteContentCacheRef.current.get(note.path);
      if (!content) return false;
      return selectedTags.every((tag) => hasTag(content, tag));
    });
  };

  return { getNoteTags, filterByTag };
}
