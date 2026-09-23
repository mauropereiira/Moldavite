import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast actions', () => {
  it('stays until an action is chosen, then runs it and dismisses', () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toast
        toast={{
          id: 'toast-1',
          type: 'error',
          message: "Couldn't save",
          duration: 4000,
          actions: [{ label: 'Retry', onClick: retry }],
        }}
        onDismiss={onDismiss}
      />
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(retry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith('toast-1');
  });
});
