import { render, screen } from '@testing-library/react';
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

    expect(screen.getByRole('dialog', { name: 'Unlock Note' })).toHaveAttribute(
      'aria-modal',
      'true'
    );
  });
});
