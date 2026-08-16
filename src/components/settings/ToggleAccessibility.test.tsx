import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/stores';
import { FeaturesSection } from './sections/FeaturesSection';

describe('Settings toggles', () => {
  beforeEach(() => useSettingsStore.getState().resetToDefaults());

  it('gives every feature switch an accessible name', () => {
    render(<FeaturesSection />);

    expect(screen.getByRole('switch', { name: 'Enable tags' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable backlinks' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show calendar widget' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show timeline widget' })).toBeInTheDocument();
  });
});
