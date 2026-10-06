import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';
import { isMobilePlatform } from '@/lib/platform';
import { EditorSection } from './EditorSection';

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => false) }));

describe('EditorSection writing toolbar', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
    vi.mocked(isMobilePlatform).mockReturnValue(false);
  });

  it('is on by default and turns off', () => {
    render(<EditorSection />);
    const toggle = screen.getByRole('switch', { name: 'Show the writing toolbar' });
    expect(useSettingsStore.getState().showWritingToolbar).toBe(true);
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().showWritingToolbar).toBe(false);
  });

  it('is not offered on a phone, which has no writing toolbar', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<EditorSection />);
    expect(screen.queryByRole('switch', { name: 'Show the writing toolbar' })).toBeNull();
  });
});
