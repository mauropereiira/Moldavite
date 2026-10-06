import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-shell';
import { safeInvoke } from '@/lib/ipc';
import type { CalendarEvent } from '@/types';
import { AllDayEvent, EventBlock } from './EventBlock';

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(async () => undefined),
}));

vi.mock('@/lib/ipc', () => ({
  safeInvoke: vi.fn(async () => undefined),
}));

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

const SOURCE_BLUE = `#${'336699'}`;
const SOURCE_GREEN = `#${'557744'}`;

function buildEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'google:event-1',
    source: 'google',
    title: 'Calendar event',
    start: '2025-03-14T09:00:00',
    end: '2025-03-14T10:00:00',
    isAllDay: false,
    location: 'Meeting room',
    notes: '',
    calendarId: 'google:primary',
    calendarTitle: 'Primary',
    calendarColor: SOURCE_BLUE,
    url: '',
    ...overrides,
  };
}

describe('EventBlock', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--calendar-google');
    document.documentElement.style.removeProperty('--accent-primary');
    platform.mobile = false;
    vi.mocked(open).mockClear();
    vi.mocked(safeInvoke).mockClear();
  });

  it('opens an event link in the browser on the desktop', async () => {
    const url = 'https://calendar.google.com/event?eid=1';
    const { container } = render(
      <EventBlock event={buildEvent({ url })} columnIndex={0} totalColumns={1} />
    );

    fireEvent.click(container.firstElementChild as HTMLElement);

    await waitFor(() => expect(open).toHaveBeenCalledWith(url));
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it('opens an event link through the native opener on a phone', async () => {
    platform.mobile = true;
    const url = 'https://calendar.google.com/event?eid=1';
    render(<AllDayEvent event={buildEvent({ isAllDay: true, url })} />);

    fireEvent.click(screen.getByText('Calendar event'));

    await waitFor(() => expect(safeInvoke).toHaveBeenCalledWith('open_external_link', { url }));
    expect(open).not.toHaveBeenCalled();
  });

  it('shows times on the same 24-hour clock as the timeline axis', () => {
    const { container } = render(
      <EventBlock
        event={buildEvent({ start: '2025-03-14T13:00:00', end: '2025-03-14T14:30:00' })}
        columnIndex={0}
        totalColumns={1}
      />
    );

    expect(container.textContent).toContain('13:00');
    expect(container.textContent).not.toMatch(/PM|AM/);
  });

  it('encodes event duration in the computed block height', () => {
    const { container } = render(
      <>
        <EventBlock
          event={buildEvent({ id: 'short', title: '15 minute event', end: '2025-03-14T09:15:00' })}
          columnIndex={0}
          totalColumns={1}
        />
        <EventBlock
          event={buildEvent({ id: 'long', title: '60 minute event' })}
          columnIndex={0}
          totalColumns={1}
        />
      </>
    );

    const [shortEvent, longEvent] = Array.from(container.children) as HTMLElement[];
    expect(shortEvent.style.height).toBe('20px');
    expect(longEvent.style.height).toBe('60px');
    expect(Number.parseFloat(longEvent.style.height)).toBeGreaterThanOrEqual(
      Number.parseFloat(shortEvent.style.height) * 3
    );
    expect(longEvent.style.borderTop).toBe('1px solid var(--border-muted)');
  });

  it('ignores malformed timestamps instead of throwing while formatting them', () => {
    const { container } = render(
      <EventBlock
        event={buildEvent({ start: 'not-a-timestamp' })}
        columnIndex={0}
        totalColumns={1}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders a two-pixel full-height bar in the event source colour', () => {
    const { container } = render(
      <EventBlock event={buildEvent()} columnIndex={0} totalColumns={1} />
    );

    const block = container.firstElementChild as HTMLElement;
    const sourceBar = block.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(sourceBar).toHaveStyle({ backgroundColor: SOURCE_BLUE });
    expect(sourceBar.style.width).toBe('2px');
    expect(sourceBar.style.top).toBe('0px');
    expect(sourceBar.style.bottom).toBe('0px');
  });

  it('derives distinguishable washes from different calendar source variables', () => {
    document.documentElement.style.setProperty('--calendar-google', SOURCE_BLUE);
    document.documentElement.style.setProperty('--accent-primary', SOURCE_GREEN);

    const { container } = render(
      <>
        <EventBlock
          event={buildEvent({ id: 'first-source', calendarColor: 'var(--calendar-google)' })}
          columnIndex={0}
          totalColumns={1}
        />
        <EventBlock
          event={buildEvent({ id: 'second-source', calendarColor: 'var(--accent-primary)' })}
          columnIndex={0}
          totalColumns={1}
        />
      </>
    );

    const [blueEvent, greenEvent] = Array.from(container.children) as HTMLElement[];
    expect(blueEvent.style.backgroundColor).toBe('rgba(51, 102, 153, 0.09)');
    expect(greenEvent.style.backgroundColor).toBe('rgba(85, 119, 68, 0.09)');
    expect(blueEvent.style.backgroundColor).not.toBe(greenEvent.style.backgroundColor);
  });

  it('lifts the wash and title colour on hover', () => {
    const { container } = render(
      <EventBlock event={buildEvent()} columnIndex={0} totalColumns={1} />
    );

    const block = container.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(block);

    expect(block.style.backgroundColor).toBe('rgba(51, 102, 153, 0.14)');
    expect(screen.getAllByText('Calendar event')[0]).toHaveStyle({
      color: 'var(--text-primary)',
    });
  });

  it('uses the same bar and wash treatment for all-day events', () => {
    const { container } = render(<AllDayEvent event={buildEvent({ isAllDay: true })} />);

    const block = container.firstElementChild as HTMLElement;
    const sourceBar = block.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(block.style.backgroundColor).toBe('rgba(51, 102, 153, 0.09)');
    expect(block.style.borderTop).toBe('1px solid var(--border-muted)');
    expect(sourceBar.style.width).toBe('2px');
    expect(sourceBar).toHaveStyle({ backgroundColor: SOURCE_BLUE });
  });
});
