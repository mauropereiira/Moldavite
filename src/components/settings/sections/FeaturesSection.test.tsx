import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';
import { FeaturesSection } from './FeaturesSection';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

describe('FeaturesSection Agenda widgets', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
  });

  it('offers both Agenda widgets on the desktop', () => {
    platform.mobile = false;
    render(<FeaturesSection />);

    expect(screen.getByRole('switch', { name: 'Show calendar widget' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show timeline widget' })).toBeInTheDocument();
  });

  it('offers only the event timeline on a phone, whose note calendar always shows', () => {
    platform.mobile = true;
    render(<FeaturesSection />);

    expect(screen.queryByRole('switch', { name: 'Show calendar widget' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show timeline widget' })).toBeInTheDocument();
  });
});
