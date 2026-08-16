import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollapsibleSection } from './CollapsibleSection';

describe('CollapsibleSection', () => {
  it('removes collapsed content from keyboard navigation', () => {
    const { rerender } = render(
      <CollapsibleSection title="Notes" isCollapsed onToggle={vi.fn()}>
        <button>Hidden action</button>
      </CollapsibleSection>
    );

    expect(screen.queryByRole('button', { name: 'Hidden action' })).not.toBeInTheDocument();

    rerender(
      <CollapsibleSection title="Notes" isCollapsed={false} onToggle={vi.fn()}>
        <button>Hidden action</button>
      </CollapsibleSection>
    );

    expect(screen.getByRole('button', { name: 'Hidden action' })).toBeInTheDocument();
  });
});
