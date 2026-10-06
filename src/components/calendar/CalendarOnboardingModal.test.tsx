import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCalendarStore } from '@/stores/calendarStore';
import { useLaunchContextStore } from '@/lib/launchContext';
import { CalendarOnboardingModal } from './CalendarOnboardingModal';

const nextFrame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

beforeEach(() => {
  useLaunchContextStore.setState({ ready: true, launchedWithFile: false });
  useCalendarStore.setState({
    sources: [{ id: 'apple', available: true, connected: true }] as never,
    hasSeenOnboarding: false,
  });
});

afterEach(() => {
  useCalendarStore.setState({ sources: [], hasSeenOnboarding: false });
});

describe('CalendarOnboardingModal', () => {
  it('is a modal dialog on the dialog layer, above every surface', () => {
    render(<CalendarOnboardingModal />);

    const dialog = screen.getByRole('dialog', { name: /^Calendar Events in Your/ });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // jsdom paints nothing, so the stacking itself is checked in WebKit; this
    // pins the layer the backdrop asks for.
    expect(dialog.parentElement?.className).toContain('z-[var(--z-dialog)]');
  });

  it('takes focus from the surface that opened it and gives it back', async () => {
    const agenda = document.createElement('button');
    agenda.textContent = 'Close Agenda';
    document.body.appendChild(agenda);
    agenda.focus();

    render(<CalendarOnboardingModal />);
    await nextFrame();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);

    act(() => useCalendarStore.getState().setHasSeenOnboarding(true));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(agenda);
    agenda.remove();
  });

  it('closes on Escape', () => {
    render(<CalendarOnboardingModal />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useCalendarStore.getState().hasSeenOnboarding).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('stacking scale', () => {
  it('puts a dialog above the overlays, the full-window surfaces and the rail', () => {
    const css = readFileSync('src/index.css', 'utf8');
    const z = (name: string) => Number(css.match(new RegExp(`--z-${name}:\\s*(\\d+)`))?.[1]);

    expect(z('overlay')).toBeLessThan(z('surface'));
    expect(z('surface')).toBeLessThan(z('rail'));
    expect(z('rail')).toBeLessThan(z('dialog'));
    // The graph keeps a literal just under Settings.
    const graph = readFileSync('src/components/graph/GraphView.tsx', 'utf8');
    expect(Number(graph.match(/graph-view fixed inset-y-0 z-\[(\d+)\]/)?.[1])).toBeLessThan(
      z('dialog')
    );
  });
});
