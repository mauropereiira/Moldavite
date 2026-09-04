/**
 * Persist-version regression test.
 *
 * zustand only invokes `migrate` when the persisted payload's `version` is a
 * number that differs from the store's configured `version`. A store with no
 * explicit `version` config still defaults to 0 and writes that into storage,
 * so a payload saved before `version: 0` was added here (or by any older
 * build) has no `version` key at all, not a mismatched one — and must
 * rehydrate unchanged rather than being dropped as unmigratable.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { usePdfExportStore } from './pdfExportStore';

describe('pdfExportStore persist version', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rehydrates a stored value with no version field unchanged', async () => {
    localStorage.setItem(
      'moldavite-pdf-export',
      JSON.stringify({ state: { pageSize: 'a4', margin: 'wide' } })
    );

    await usePdfExportStore.persist.rehydrate();

    expect(usePdfExportStore.getState().pageSize).toBe('a4');
    expect(usePdfExportStore.getState().margin).toBe('wide');
  });
});
