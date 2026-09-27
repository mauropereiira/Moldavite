import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders on the body, outside the panel that opened it', () => {
    render(
      <div data-testid="panel" style={{ transform: 'translateZ(0)', overflow: 'auto' }}>
        <ConfirmDialog title="Allow?" message="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </div>
    );

    const dialog = screen.getByRole('dialog');
    expect(screen.getByTestId('panel')).not.toContainElement(dialog);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('still confirms and cancels from the body', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Allow?"
        message="Sure?"
        confirmLabel="Allow"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
