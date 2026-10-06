import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFolderStore, useNoteStore, useOverlayStore, useSettingsStore } from '@/stores';
import { PRESETS, useThemeStore } from '@/stores/themeStore';
import { CONSTELLATIONS } from './constellations';
import { BACKGROUND_STAR_COUNT, WelcomeEmptyState } from './WelcomeScreen';

describe('WelcomeScreen layout settings', () => {
  const setPointerPreferences = ({ reducedMotion = false }: { reducedMotion?: boolean } = {}) => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion,
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
    useThemeStore.setState({ theme: 'light', baseMode: 'light', preset: 'default' });
    useNoteStore.setState({ notes: [] });
    useFolderStore.setState({ folders: [] });
    useOverlayStore.getState().closeOverlay();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the full sky and hides it with the details on a quiet home screen', () => {
    const { container } = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );

    expect(container.querySelector('.welcome-reveal-date')).toBeInTheDocument();
    expect(container.querySelector('.welcome-constellation-field')).toBeInTheDocument();
    expect(container.querySelector('.welcome-sun')).toBeInTheDocument();
    expect(container.querySelector('.welcome-moon')).toBeInTheDocument();
    expect(container.querySelectorAll('.welcome-background-star')).toHaveLength(
      BACKGROUND_STAR_COUNT
    );
    expect(container.querySelectorAll('.welcome-constellation-star')).toHaveLength(
      CONSTELLATIONS.reduce((total, constellation) => total + constellation.stars.length, 0)
    );
    expect(container.querySelectorAll('.welcome-constellation-halo')).toHaveLength(0);
    expect(container.querySelector('.welcome-reveal-stats')).toBeInTheDocument();

    act(() => {
      useSettingsStore.setState({ quietHomeScreen: true });
    });

    expect(container.querySelector('.welcome-reveal-date')).not.toBeInTheDocument();
    expect(container.querySelector('.welcome-constellation-field')).not.toBeInTheDocument();
    expect(container.querySelector('.welcome-sun')).not.toBeInTheDocument();
    expect(container.querySelector('.welcome-moon')).not.toBeInTheDocument();
    expect(container.querySelector('.welcome-leaf')).not.toBeInTheDocument();
    expect(container.querySelector('.autumn-field')).not.toBeInTheDocument();
    expect(container.querySelector('.welcome-reveal-stats')).not.toBeInTheDocument();
  });

  it.each(PRESETS.map(({ id }) => id))('renders sun and moon masks with the %s theme', (preset) => {
    useThemeStore.setState({ preset });
    useSettingsStore.setState({ showSeasonalTouches: false });
    const { container } = render(
      <WelcomeEmptyState onCreateToday={vi.fn()} onCreateNote={vi.fn()} />
    );

    for (const art of ['sun', 'moon']) {
      const element = container.querySelector<HTMLElement>(`.welcome-${art}`);
      expect(element?.style.maskImage).toBe(`url("/sky/${art}.webp")`);
      expect(element).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('draws constellation stars as sparkles while keeping background stars circular', () => {
    const { container } = render(
      <WelcomeEmptyState onCreateToday={vi.fn()} onCreateNote={vi.fn()} />
    );
    for (const constellation of CONSTELLATIONS) {
      const group = container.querySelector(`[data-constellation="${constellation.name}"]`);
      const stars = group?.querySelectorAll('path.welcome-constellation-star');
      expect(stars).toHaveLength(constellation.stars.length);
      stars?.forEach((star) => {
        expect(star).toHaveAttribute('fill', 'currentColor');
        expect(star.closest('.welcome-constellation-star-twinkle')).not.toBeNull();
        expect(star.closest('.welcome-constellation-star-reveal')).not.toBeNull();
      });
      expect(group?.querySelectorAll('line')).toHaveLength(constellation.lines.length);
    }
    expect(container.querySelectorAll('circle.welcome-background-star')).toHaveLength(
      BACKGROUND_STAR_COUNT
    );
    expect(container.querySelector('circle.welcome-constellation-star')).toBeNull();
  });

  it.each([
    { preset: 'default', touches: true, sky: true, field: false },
    { preset: 'autumn', touches: true, sky: true, field: true },
    { preset: 'autumn', touches: false, sky: true, field: false },
    { preset: 'autumn', touches: true, sky: false, field: false },
  ] as const)('shows the autumn field only with its theme and decorations: %j', (settings) => {
    useThemeStore.setState({ preset: settings.preset });
    useSettingsStore.setState({
      showSeasonalTouches: settings.touches,
      quietHomeScreen: !settings.sky,
    });
    const { container } = render(
      <WelcomeEmptyState onCreateToday={vi.fn()} onCreateNote={vi.fn()} />
    );
    const field = container.querySelector<HTMLElement>('.autumn-field');
    expect(Boolean(field)).toBe(settings.field);
    if (field) {
      expect(field).toHaveAttribute('aria-hidden', 'true');
    }
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
  it('drifts autumn leaves across the sky only while seasonal touches are on', () => {
    const { container, unmount } = render(
      <WelcomeEmptyState onCreateToday={vi.fn()} onCreateNote={vi.fn()} />
    );
    const leaves = container.querySelectorAll<HTMLElement>('.welcome-leaf-falling');
    expect(leaves).toHaveLength(5);
    const variants = ['maple', 'oak', 'birch', 'ginkgo', 'maple'];
    leaves.forEach((leaf, index) => {
      expect(leaf.style.maskImage).toBe(`url("/seasonal/leaf-${variants[index]}.webp")`);
      expect(leaf).toHaveAttribute('aria-hidden', 'true');
      expect(parseFloat(leaf.style.width)).toBeGreaterThanOrEqual(26);
      expect(parseFloat(leaf.style.width)).toBeLessThanOrEqual(40);
    });
    unmount();

    useSettingsStore.setState({ showSeasonalTouches: false });
    const { container: plain } = render(
      <WelcomeEmptyState onCreateToday={vi.fn()} onCreateNote={vi.fn()} />
    );
    expect(plain.querySelectorAll('.welcome-leaf').length).toBe(0);
  });

  it('keeps the leaves still when reduced motion is preferred', () => {
    setPointerPreferences({ reducedMotion: true });
    const { container } = render(
      <WelcomeEmptyState onCreateToday={vi.fn()} onCreateNote={vi.fn()} />
    );
    const leaves = container.querySelectorAll<HTMLElement>('.welcome-leaf');
    expect(leaves).toHaveLength(5);
    leaves.forEach((leaf, index) => {
      expect(leaf.style.top).toBe(`${15 + index * 16}%`);
    });
    expect(container.querySelectorAll('.welcome-leaf-falling').length).toBe(0);
  });

  const welcome = () =>
    render(<WelcomeEmptyState onCreateToday={vi.fn()} onCreateNote={vi.fn()} />).container
      .firstElementChild as HTMLElement;

  it.each([
    ['the Graph', () => useOverlayStore.getState().openSurface('graph')],
    ['the Index', () => useOverlayStore.getState().openSurface('index')],
    ['the Agenda', () => useOverlayStore.getState().openSurface('agenda')],
    ['Settings', () => useSettingsStore.getState().setIsSettingsOpen(true)],
  ])('pauses its animations while %s covers it, and resumes after', (_, cover) => {
    const root = welcome();
    expect(root).not.toHaveClass('welcome-paused');

    act(cover);
    expect(root).toHaveClass('welcome-paused');

    act(() => {
      useOverlayStore.getState().closeOverlay();
      useSettingsStore.getState().setIsSettingsOpen(false);
    });
    expect(root).not.toHaveClass('welcome-paused');
  });

  it('keeps moving under the see-through quick switcher', () => {
    const root = welcome();
    act(() => useOverlayStore.getState().openSurface('search'));
    expect(root).not.toHaveClass('welcome-paused');
  });

  it('pauses while the window is hidden', () => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const root = welcome();

    hidden = true;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(root).toHaveClass('welcome-paused');

    hidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(root).not.toHaveClass('welcome-paused');
  });

  it('schedules no meteor while covered', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const root = welcome();
    act(() => useOverlayStore.getState().openSurface('graph'));

    act(() => {
      vi.advanceTimersByTime(14_000);
    });

    expect(root.querySelector('[data-testid="welcome-meteor"]')).not.toBeInTheDocument();
  });
});
