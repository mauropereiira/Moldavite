/**
 * WordPress.com connection state.
 *
 * `chosenSiteId` persists because picking a site every time you publish is a
 * question with the same answer — most people write for one blog. It is
 * changeable from the same menu, so the default costs nothing to reverse.
 *
 * `postsByNote` maps a note's path to the post a previous publish created, so
 * re-publishing updates that post instead of scattering duplicate drafts. It is
 * keyed per site: the same note published to two blogs is two posts.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  wordpressConnect,
  wordpressDisconnect,
  wordpressPublish,
  wordpressSites,
  wordpressStatus,
  type PublishedPost,
  type WordPressSite,
} from '@/lib/wordpress';

interface WordPressState {
  available: boolean;
  connected: boolean;
  /** True while the browser is open and the callback has not arrived. */
  connecting: boolean;
  publishing: boolean;
  sites: WordPressSite[];
  chosenSiteId: number | null;
  error: string | null;

  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  loadSites: () => Promise<void>;
  chooseSite: (siteId: number) => void;
  publish: (note: { path: string; title: string; content: string }) => Promise<PublishedPost>;
  /** Called by the `wordpress:auth` listener when the exchange finishes. */
  settleAuth: (result: { connected: boolean; error: string | null }) => void;

  postsByNote: Record<string, number>;
  trashedPostsById: Record<string, Record<string, number>>;
  /**
   * Follow a note to its new path so its published post follows too.
   *
   * The key contains the note's path, which is mutable. Without this, renaming
   * a published note stranded its mapping — and worse, a *new* note later
   * taking the old path inherited it, so publishing that new note would
   * overwrite the old note's post. `publish` deliberately preserves a live
   * post's status, so that could rewrite something already public.
   */
  notePathChanged: (oldPath: string, newPath: string) => void;
  noteTrashed: (notePath: string, trashId: string) => void;
  noteRestored: (trashId: string, notePath: string) => void;
  forgetTrashedNote: (trashId: string) => void;
  forgetAllTrashedNotes: () => void;
}

const postKey = (siteId: number, notePath: string) => `${siteId}:${notePath}`;

/** Split a `${siteId}:${notePath}` key. Note paths may contain `:`. */
const splitPostKey = (key: string): { siteId: string; notePath: string } => {
  const colon = key.indexOf(':');
  return { siteId: key.slice(0, colon), notePath: key.slice(colon + 1) };
};

export const useWordPressStore = create<WordPressState>()(
  persist(
    (set, get) => ({
      available: false,
      connected: false,
      connecting: false,
      publishing: false,
      sites: [],
      chosenSiteId: null,
      error: null,
      postsByNote: {},
      trashedPostsById: {},

      refresh: async () => {
        try {
          const status = await wordpressStatus();
          set({
            available: status.available,
            connected: status.connected,
            error: status.error,
          });
          if (status.connected && get().sites.length === 0) {
            await get().loadSites();
          }
        } catch (error) {
          set({ error: String(error) });
        }
      },

      connect: async () => {
        set({ connecting: true, error: null });
        try {
          await wordpressConnect();
        } catch (error) {
          // Only the browser handoff failed; the flow never started.
          set({ connecting: false, error: String(error) });
        }
      },

      settleAuth: ({ connected, error }) => {
        set({ connecting: false, connected, error });
        if (connected) void get().loadSites();
      },

      disconnect: async () => {
        try {
          await wordpressDisconnect();
          // Forget the site and the post map too: they belong to the account
          // that just went away, and silently reusing them against a different
          // account would overwrite someone else's posts.
          set({
            connected: false,
            sites: [],
            chosenSiteId: null,
            postsByNote: {},
            trashedPostsById: {},
            error: null,
          });
        } catch (error) {
          set({ error: String(error) });
        }
      },

      loadSites: async () => {
        try {
          const sites = await wordpressSites();
          const chosen = get().chosenSiteId;
          set({
            sites,
            error: null,
            // Drop a remembered site the account can no longer publish to, and
            // settle on the only option when there is just one.
            chosenSiteId:
              chosen && sites.some((s) => s.id === chosen)
                ? chosen
                : sites.length === 1
                  ? sites[0].id
                  : null,
          });
        } catch (error) {
          set({ error: String(error) });
        }
      },

      chooseSite: (siteId) => set({ chosenSiteId: siteId }),

      notePathChanged: (oldPath, newPath) =>
        set((state) => {
          const moved: Record<string, number> = {};
          let changed = false;
          for (const [key, postId] of Object.entries(state.postsByNote)) {
            const { siteId, notePath } = splitPostKey(key);
            if (notePath === oldPath) {
              moved[`${siteId}:${newPath}`] = postId;
              changed = true;
            } else {
              moved[key] = postId;
            }
          }
          return changed ? { postsByNote: moved } : state;
        }),

      noteTrashed: (notePath, trashId) =>
        set((state) => {
          const postsByNote: Record<string, number> = {};
          const archived: Record<string, number> = {};
          for (const [key, postId] of Object.entries(state.postsByNote)) {
            if (splitPostKey(key).notePath === notePath) archived[key] = postId;
            else postsByNote[key] = postId;
          }
          return {
            postsByNote,
            trashedPostsById:
              Object.keys(archived).length > 0
                ? { ...state.trashedPostsById, [trashId]: archived }
                : state.trashedPostsById,
          };
        }),

      noteRestored: (trashId, notePath) =>
        set((state) => {
          const archived = state.trashedPostsById[trashId];
          if (!archived) return state;
          const postsByNote = { ...state.postsByNote };
          for (const [key, postId] of Object.entries(archived)) {
            postsByNote[`${splitPostKey(key).siteId}:${notePath}`] = postId;
          }
          const { [trashId]: _restored, ...trashedPostsById } = state.trashedPostsById;
          return { postsByNote, trashedPostsById };
        }),

      forgetTrashedNote: (trashId) =>
        set((state) => {
          if (!(trashId in state.trashedPostsById)) return state;
          const { [trashId]: _forgotten, ...trashedPostsById } = state.trashedPostsById;
          return { trashedPostsById };
        }),

      forgetAllTrashedNotes: () => set({ trashedPostsById: {} }),

      publish: async (note) => {
        const siteId = get().chosenSiteId;
        if (!siteId) throw new Error('Choose a WordPress site first.');
        set({ publishing: true, error: null });
        try {
          const existing = get().postsByNote[postKey(siteId, note.path)];
          const post = await wordpressPublish({
            siteId,
            title: note.title,
            content: note.content,
            existingPostId: existing ?? null,
          });
          set((state) => ({
            publishing: false,
            postsByNote: { ...state.postsByNote, [postKey(siteId, note.path)]: post.id },
          }));
          return post;
        } catch (error) {
          set({ publishing: false, error: String(error) });
          throw error;
        }
      },
    }),
    {
      name: 'moldavite-wordpress',
      version: 0, // Hook for future migrations; no shape changes yet.
      // Connection state is read from the Keychain on launch, never persisted
      // here. Only the two choices that are genuinely the user's are kept.
      partialize: (state) => ({
        chosenSiteId: state.chosenSiteId,
        postsByNote: state.postsByNote,
        trashedPostsById: state.trashedPostsById,
      }),
    }
  )
);
