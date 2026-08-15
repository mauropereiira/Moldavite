import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFolderStore, useNoteStore, useOverlayStore, useSettingsStore } from '@/stores';
import { CONSTELLATIONS } from './constellations';
import { BACKGROUND_STAR_COUNT, WelcomeEmptyState } from './WelcomeScreen';

describe('WelcomeScreen layout settings', () => {
  const setPointerPreferences = ({
    reducedMotion = false,
    coarsePointer = false,
  }: {
    reducedMotion?: boolean;
    coarsePointer?: boolean;
  } = {}) => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches:
        (query === '(prefers-reduced-motion: reduce)' && reducedMotion) ||
        (query === '(pointer: coarse)' && coarsePointer),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  };

  beforeEach(() => {
    setPointerPreferences();
    useSettingsStore.getState().resetToDefaults();
    useNoteStore.setState({ notes: [] });
    useFolderStore.setState({ folders: [] });
    useOverlayStore.getState().closeOverlay();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the full sky and independently hides the welcome details', () => {
    const { container } = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );

    expect(container.querySelector('.welcome-reveal-date')).toBeInTheDocument();
    expect(container.querySelector('.welcome-constellation-field')).toBeInTheDocument();
    expect(container.querySelectorAll('.welcome-background-star')).toHaveLength(
      BACKGROUND_STAR_COUNT
    );
    expect(container.querySelectorAll('.welcome-constellation-star')).toHaveLength(
      CONSTELLATIONS.reduce((total, constellation) => total + constellation.stars.length, 0)
    );
    expect(container.querySelectorAll('.welcome-constellation-halo')).toHaveLength(0);
    expect(container.querySelector('.welcome-reveal-stats')).toBeInTheDocument();

    act(() => {
      useSettingsStore.setState({
        showWelcomeDate: false,
        showWelcomeDots: false,
        showWelcomeStats: false,
      });
    });

    expect(container.querySelector('.welcome-reveal-date')).not.toBeInTheDocument();
    expect(container.querySelector('.welcome-constellation-field')).not.toBeInTheDocument();
    expect(container.querySelector('.welcome-reveal-stats')).not.toBeInTheDocument();
  });

  it('shows a meteor after the randomized cadence', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { container } = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );

    expect(container.querySelector('[data-testid="welcome-meteor"]')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(14_000);
    });

    expect(container.querySelector('[data-testid="welcome-meteor"]')).toBeInTheDocument();
  });

  it('does not mount the meteor scheduler when reduced motion is preferred', () => {
    vi.useFakeTimers();
    setPointerPreferences({ reducedMotion: true });
    const { container } = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );

    act(() => {
      vi.advanceTimersByTime(22_000);
    });

    expect(container.querySelector('[data-testid="welcome-meteor"]')).not.toBeInTheDocument();
  });

  it('renders the asteroid only when enabled with motion and a fine pointer', () => {
    let view = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );
    expect(view.queryByTestId('welcome-asteroid-cursor')).toBeInTheDocument();
    view.unmount();

    setPointerPreferences({ reducedMotion: true });
    view = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );
    expect(view.queryByTestId('welcome-asteroid-cursor')).not.toBeInTheDocument();
    view.unmount();

    setPointerPreferences({ coarsePointer: true });
    view = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );
    expect(view.queryByTestId('welcome-asteroid-cursor')).not.toBeInTheDocument();
    view.unmount();

    setPointerPreferences();
    useSettingsStore.setState({ showAsteroidCursor: false });
    view = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );
    expect(view.queryByTestId('welcome-asteroid-cursor')).not.toBeInTheDocument();
    view.unmount();

    useSettingsStore.setState({ showAsteroidCursor: true });
    useOverlayStore.getState().openIndex(false);
    view = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );
    expect(view.queryByTestId('welcome-asteroid-cursor')).not.toBeInTheDocument();
  });
});
