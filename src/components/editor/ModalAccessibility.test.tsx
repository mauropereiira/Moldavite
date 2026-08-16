import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageModal } from './ImageModal';
import { LinkModal } from './LinkModal';

describe('editor modal accessibility', () => {
  it('exposes LinkModal as a named modal dialog', () => {
    render(<LinkModal isOpen onClose={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Insert Link' })).toHaveAttribute(
      'aria-modal',
      'true'
    );
  });

  it('exposes ImageModal as a named modal dialog', () => {
    render(<ImageModal isOpen onClose={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Insert Image' })).toHaveAttribute(
      'aria-modal',
      'true'
    );
  });
});
