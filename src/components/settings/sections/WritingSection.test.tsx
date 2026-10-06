import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';
import { isMobilePlatform } from '@/lib/platform';
import { WritingSection } from './WritingSection';

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => false) }));
vi.mock('@/hooks/useTemplates', () => ({
  useTemplates: () => ({ deleteExistingTemplate: vi.fn(), updateExistingTemplate: vi.fn() }),
}));
vi.mock('@/components/templates/SettingsTemplates', () => ({ SettingsTemplates: () => null }));

describe('WritingSection writing toolbar', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
    vi.mocked(isMobilePlatform).mockReturnValue(false);
  });

  it('is on by default and turns off', () => {
    render(<WritingSection />);
    expect(useSettingsStore.getState().showWritingToolbar).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Writing toolbar' }));
    expect(useSettingsStore.getState().showWritingToolbar).toBe(false);
  });

  it('is not offered on a phone, which has no writing toolbar', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<WritingSection />);
    expect(screen.queryByRole('switch', { name: 'Writing toolbar' })).toBeNull();
  });
});
