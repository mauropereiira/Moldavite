import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePluginCommandStore } from './pluginCommandStore';

vi.mock('./toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

describe('pluginCommandStore', () => {
  beforeEach(() => usePluginCommandStore.getState().clear());

  it('adds and lists commands', () => {
    usePluginCommandStore.getState().addCommand({ pluginId: 'p', id: 'p:a', label: 'A', handler: () => {} });
    expect(usePluginCommandStore.getState().commands).toHaveLength(1);
  });

  it('removes all commands for a plugin', () => {
    const s = usePluginCommandStore.getState();
    s.addCommand({ pluginId: 'p', id: 'p:a', label: 'A', handler: () => {} });
    s.addCommand({ pluginId: 'q', id: 'q:b', label: 'B', handler: () => {} });
    s.removeByPlugin('p');
    expect(usePluginCommandStore.getState().commands.map((c) => c.id)).toEqual(['q:b']);
  });

  it('execute runs the matching handler', async () => {
    const spy = vi.fn();
    usePluginCommandStore.getState().addCommand({ pluginId: 'p', id: 'p:a', label: 'A', handler: spy });
    await usePluginCommandStore.getState().execute('p:a');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('execute swallows handler errors', async () => {
    usePluginCommandStore.getState().addCommand({
      pluginId: 'p',
      id: 'p:boom',
      label: 'Boom',
      handler: () => {
        throw new Error('x');
      },
    });
    await expect(usePluginCommandStore.getState().execute('p:boom')).resolves.toBeUndefined();
  });
});
