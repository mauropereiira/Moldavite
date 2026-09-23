import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PasswordModal } from './PasswordModal';

describe('PasswordModal accessibility', () => {
  it('exposes a named modal dialog', () => {
    render(
      <PasswordModal
        isOpen
        mode="unlock"
        noteTitle="Private note"
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Unlock note' })).toHaveAttribute(
      'aria-modal',
      'true'
    );
  });
});

describe('PasswordModal wrong password', () => {
  it('says how many attempts are left once, not twice', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error('WRONG_PASSWORD:1:Incorrect password. 1 attempts remaining.'));
    render(
      <PasswordModal
        isOpen
        mode="unlock"
        noteTitle="Private note"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(
      await screen.findByText('Incorrect password. 1 attempt left before a short lockout.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/remaining/)).not.toBeInTheDocument();
  });
});
