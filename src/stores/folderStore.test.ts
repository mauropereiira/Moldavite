/** Per-Forge namespacing tests for expanded-folder and section-collapse state. */

import { describe, it, expect, beforeEach } from 'vitest';
import { useFolderStore } from './folderStore';
import { rememberActiveForge } from '@/lib/forgeStorage';

/** Persist rehydration settles in microtasks with synchronous storage. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('folderStore per-Forge isolation', () => {
  beforeEach(() => {
    // Reset in-memory state first: `setState` writes through the persist
    // middleware, so clearing storage afterwards is what leaves it empty for
    // the test body (clearing first would leave the write behind).
    useFolderStore.setState({ expandedFolders: [] });
    localStorage.clear();
  });

  it('picks up a pre-existing flat "moldavite-folders" value once, under the active Forge', async () => {
    localStorage.setItem(
      'moldavite-folders',
      JSON.stringify({ state: { expandedFolders: ['Projects'] } })
    );

    await useFolderStore.persist.rehydrate();

    expect(useFolderStore.getState().expandedFolders).toEqual(['Projects']);
    expect(localStorage.getItem('moldavite-folders:Default')).toContain('Projects');
  });

  it('writes expanded folders under the Forge that is active at write time', () => {
    rememberActiveForge('Alpha');
    useFolderStore.getState().expandFolder('Alpha Folder');
    rememberActiveForge('Beta');
    useFolderStore.getState().expandFolder('Beta Folder');

    const alpha = JSON.parse(localStorage.getItem('moldavite-folders:Alpha') ?? '{}');
    const beta = JSON.parse(localStorage.getItem('moldavite-folders:Beta') ?? '{}');
    expect(alpha.state.expandedFolders).toEqual(['Alpha Folder']);
    expect(beta.state.expandedFolders).toEqual(['Beta Folder']);
  });

  it("re-reads the correct Forge's folders once the active Forge is known", async () => {
    localStorage.setItem(
      'moldavite-folders:Beta',
      JSON.stringify({ state: { expandedFolders: ['Beta Folder'] } })
    );
    // Stand in for the stale slice hydration loaded under the previous Forge.
    useFolderStore.setState({ expandedFolders: ['Alpha Folder'] });

    rememberActiveForge('Beta');
    await flushMicrotasks();

    expect(useFolderStore.getState().expandedFolders).toEqual(['Beta Folder']);
  });

  it('drops expanded folders carried over from another Forge that has no slice here', async () => {
    useFolderStore.setState({ expandedFolders: ['Alpha Folder'] });

    rememberActiveForge('Empty');
    await flushMicrotasks();

    expect(useFolderStore.getState().expandedFolders).toEqual([]);
  });
});
