import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTemplateStore } from '@/stores/templateStore';
import { SettingsTemplates } from './SettingsTemplates';

vi.mock('@/hooks/useTemplates', () => ({
  useTemplates: () => ({ saveNewTemplate: vi.fn() }),
}));

describe('SettingsTemplates', () => {
  // An !important reset in index.css strips Settings button fills; jsdom does not load it.
  it('gives New template a label colour that does not need an accent fill', () => {
    useTemplateStore.setState({ templates: [], pinnedTemplateIds: [] });
    render(<SettingsTemplates onDeleteTemplate={vi.fn()} onUpdateTemplate={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'New template' });
    expect(button.style.color).not.toBe('var(--text-on-accent)');
    expect(button.style.border).toContain('var(--border-default)');
  });
});
