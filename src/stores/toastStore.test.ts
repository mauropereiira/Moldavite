import { beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from './toastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('toastStore', () => {
  it('keeps the five newest plain toasts', () => {
    const { addToast } = useToastStore.getState();
    for (let i = 1; i <= 7; i++) addToast('success', `toast ${i}`);

    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'toast 7',
      'toast 6',
      'toast 5',
      'toast 4',
      'toast 3',
    ]);
  });

  it('never trims a toast that has actions', () => {
    const { addToast } = useToastStore.getState();
    addToast('error', 'Save failed', undefined, [{ label: 'Retry', onClick: () => {} }]);
    for (let i = 1; i <= 6; i++) addToast('success', `toast ${i}`);

    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages).toContain('Save failed');
    expect(messages).toHaveLength(5);
    expect(messages[0]).toBe('toast 6');
  });
});
