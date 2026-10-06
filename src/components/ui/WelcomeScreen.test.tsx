import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFolderStore, useNoteStore, useOverlayStore, useSettingsStore } from '@/stores';
import { PRESETS, useThemeStore } from '@/stores/themeStore';
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

  it('places the cursor at the pointer immediately, without waiting for animation frames', () => {
    vi.useFakeTimers();
    const view = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );
    const cursor = view.getByTestId('welcome-asteroid-cursor');

    // MouseEvent supplies coordinates in jsdom, which has no PointerEvent constructor.
    fireEvent(document, new MouseEvent('pointermove', { clientX: 120, clientY: 180 }));
    expect(cursor.style.transform).toBe('translate3d(113px, 173px, 0) scale(1)');

    const button = view.getByRole('button', { name: /new note/i });
    fireEvent(button, new MouseEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300 }));
    expect(cursor.style.transform).toBe('translate3d(393px, 293px, 0) scale(1.16)');

    act(() => vi.advanceTimersByTime(100));
    expect(cursor.style.transform).toBe('translate3d(393px, 293px, 0) scale(1.16)');
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

  // The asteroid hides the real pointer to stand in for it. A dialog opening
  // above the welcome screen therefore has to hand the pointer back, or the
  // release notes arrive with nothing visible to click them with — which is
  // exactly what 2.0.0 shipped. The mouse need not move for this to happen,
  // so the check cannot hang off pointermove.
  it('returns the real cursor while a dialog is open, without the pointer moving', async () => {
    const view = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );
    const root = document.documentElement;
    expect(root.classList.contains('welcome-asteroid-cursor-active')).toBe(true);
    expect(root.classList.contains('welcome-asteroid-yielded')).toBe(false);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    await act(async () => {
      document.body.appendChild(dialog);
      await Promise.resolve();
    });
    expect(root.classList.contains('welcome-asteroid-yielded')).toBe(true);

    await act(async () => {
      dialog.remove();
      await Promise.resolve();
    });
    expect(root.classList.contains('welcome-asteroid-yielded')).toBe(false);

    view.unmount();
    expect(root.classList.contains('welcome-asteroid-cursor-active')).toBe(false);
    expect(root.classList.contains('welcome-asteroid-yielded')).toBe(false);
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
    useSettingsStore.setState({ quietHomeScreen: true });
    view = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );
    expect(view.queryByTestId('welcome-asteroid-cursor')).not.toBeInTheDocument();
    view.unmount();

    useSettingsStore.setState({ quietHomeScreen: false });
    useOverlayStore.getState().openIndex(false);
    view = render(
      <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
    );
    expect(view.queryByTestId('welcome-asteroid-cursor')).not.toBeInTheDocument();
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
});
