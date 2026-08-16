import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';
import { AllDayEvent, EventBlock } from './EventBlock';

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(async () => undefined),
}));

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
