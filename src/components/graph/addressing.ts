import type { NoteFile } from '@/types';

/** Graph node ids are the same Forge-relative paths returned by list_notes. */
export function noteForGraphNode(notes: NoteFile[], nodeId: string): NoteFile | undefined {
  if (nodeId.startsWith('missing:')) return undefined;
  return notes.find((note) => note.path === nodeId);
}
