/** Per-Forge namespacing tests for the default daily template and pinned templates. */

import { describe, it, expect, beforeEach } from 'vitest';
import { useTemplateStore } from './templateStore';
import { rememberActiveForge } from '@/lib/forgeStorage';

/** Persist rehydration settles in microtasks with synchronous storage. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('templateStore per-Forge isolation', () => {
  beforeEach(() => {
    // Reset in-memory state first: `setState` writes through the persist
    // middleware, so clearing storage afterwards is what leaves it empty for
    // the test body (clearing first would leave the write behind).
    useTemplateStore.setState({ defaultDailyTemplate: null, pinnedTemplateIds: [] });
    localStorage.clear();
  });

  it('picks up a pre-existing flat "template-storage" value once, under the active Forge', async () => {
    localStorage.setItem(
      'template-storage',
      JSON.stringify({
        state: { defaultDailyTemplate: 'daily-template', pinnedTemplateIds: ['t1'] },
      })
    );

    await useTemplateStore.persist.rehydrate();

    expect(useTemplateStore.getState().defaultDailyTemplate).toBe('daily-template');
    expect(useTemplateStore.getState().pinnedTemplateIds).toEqual(['t1']);
    expect(localStorage.getItem('template-storage:Default')).toContain('daily-template');
  });

  it('writes the default template under the Forge that is active at write time', () => {
    rememberActiveForge('Alpha');
    useTemplateStore.getState().setDefaultDailyTemplate('alpha-template');
    rememberActiveForge('Beta');
    useTemplateStore.getState().setDefaultDailyTemplate('beta-template');

    const alpha = JSON.parse(localStorage.getItem('template-storage:Alpha') ?? '{}');
    const beta = JSON.parse(localStorage.getItem('template-storage:Beta') ?? '{}');
    expect(alpha.state.defaultDailyTemplate).toBe('alpha-template');
    expect(beta.state.defaultDailyTemplate).toBe('beta-template');
  });

  it("re-reads the correct Forge's default template once the active Forge is known", async () => {
    localStorage.setItem(
      'template-storage:Beta',
      JSON.stringify({ state: { defaultDailyTemplate: 'beta-template', pinnedTemplateIds: [] } })
    );
    // Stand in for the stale slice hydration loaded under the previous Forge.
    useTemplateStore.setState({ defaultDailyTemplate: 'alpha-template' });

    rememberActiveForge('Beta');
    await flushMicrotasks();

    expect(useTemplateStore.getState().defaultDailyTemplate).toBe('beta-template');
  });

  it('drops the default template carried over from another Forge that has no slice here', async () => {
    useTemplateStore.setState({ defaultDailyTemplate: 'alpha-template', pinnedTemplateIds: ['x'] });

    rememberActiveForge('Empty');
    await flushMicrotasks();

    expect(useTemplateStore.getState().defaultDailyTemplate).toBeNull();
    expect(useTemplateStore.getState().pinnedTemplateIds).toEqual([]);
  });
});
