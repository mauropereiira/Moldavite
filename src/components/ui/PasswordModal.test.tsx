import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdKeyboard } from '@/lib/noteTitleFocus';
import { PasswordModal } from './PasswordModal';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

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

describe('PasswordModal on a phone', () => {
  afterEach(() => {
    platform.mobile = false;
  });

  it('takes the focus from the keyboard stand-in as it opens', () => {
    platform.mobile = true;
    holdKeyboard();
    render(
      <PasswordModal
        isOpen
        mode="lock"
        noteTitle="Private note"
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
  });
});
