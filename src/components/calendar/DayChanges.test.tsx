import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteFile } from '@/types';
import { useNoteStore } from '@/stores';
import { DayChanges } from './DayChanges';

const loadNote = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/hooks', () => ({ useNotes: () => ({ loadNote }) }));

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const at = (hour: number, minute = 0) => new Date(2025, 2, 14, hour, minute).getTime() / 1000;
const YESTERDAY = new Date(2025, 2, 13, 12).getTime() / 1000;

const daily: NoteFile = {
  name: '2025-03-14.md',
  path: 'daily/2025-03-14.md',
  isDaily: true,
  isWeekly: false,
  date: '2025-03-14',
  isLocked: false,
  createdAt: at(8, 5),
  modifiedAt: at(17, 40),
};
const plan: NoteFile = {
  name: 'Launch plan.md',
  path: 'notes/Projects/Launch plan.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
  folderPath: 'Projects',
  createdAt: YESTERDAY,
  modifiedAt: at(14, 2),
};
const secret: NoteFile = {
  name: 'Salary.md',
  path: 'notes/Salary.md',
  isDaily: false,
  isWeekly: false,
  isLocked: true,
  createdAt: at(9, 30),
  modifiedAt: at(9, 30),
};
const untouched: NoteFile = {
  name: 'Old.md',
  path: 'notes/Old.md',
  isDaily: false,
  isWeekly: false,
  isLocked: false,
  createdAt: YESTERDAY,
  modifiedAt: YESTERDAY,
};

function rows() {
  return within(screen.getByRole('list', { name: 'Notes changed' }))
    .getAllByRole('button')
    .map((row) => row.textContent);
}

describe('DayChanges', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC);
    loadNote.mockClear();
    useNoteStore.setState({
      notes: [untouched, secret, plan, daily],
      selectedDate: new Date(2025, 2, 14, 12),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('lists the day’s notes newest first with folder, kind and time', () => {
    render(<DayChanges />);

    expect(screen.getByRole('heading', { name: 'Fri, Mar 14' })).toBeInTheDocument();
    expect(rows()).toEqual([
      'March 14, 202517:40Daily · Created, then edited',
      'Launch plan14:02Projects · Edited',
      'SalaryLocked09:30Notes · Created',
    ]);
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Launch plan/ })).toHaveAttribute(
      'title',
      'Edited at 14:02'
    );
    expect(screen.getByRole('button', { name: /March 14/ })).toHaveAttribute(
      'title',
      'Created at 08:05, edited at 17:40'
    );
  });

  it('opens the note a row names, and closes the overlay that held it', () => {
    const onNavigate = vi.fn();
    render(<DayChanges onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /Launch plan/ }));

    expect(loadNote).toHaveBeenCalledWith(plan);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('shows a locked note by name only and hands it to the unlock path', () => {
    render(<DayChanges />);

    const row = screen.getByRole('button', { name: /Salary/ });
    expect(row).toHaveTextContent(/^SalaryLocked09:30Notes · Created$/);
    fireEvent.click(row);
    expect(loadNote).toHaveBeenCalledWith(secret);
  });

  it('follows the selected day', () => {
    render(<DayChanges />);

    act(() => useNoteStore.setState({ selectedDate: new Date(2025, 2, 13, 12) }));

    expect(rows()).toEqual(['Old12:00Notes · Created', 'Launch plan12:00Projects · Created']);
  });

  it('adds a note the moment a save stamps it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2025, 2, 14, 18, 15));
    render(<DayChanges />);
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();

    act(() => useNoteStore.getState().markNoteSaved(untouched.path, '<p>new</p>'));

    expect(rows()[0]).toBe('Old18:15Notes · Edited');
  });

  it('says so calmly when nothing changed', () => {
    useNoteStore.setState({ notes: [untouched], selectedDate: new Date(2025, 2, 15, 12) });
    render(<DayChanges />);
    expect(screen.getByText('Nothing changed on this day.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Notes changed' })).not.toBeInTheDocument();
  });

  it('says so for today too', () => {
    useNoteStore.setState({ notes: [untouched], selectedDate: new Date() });
    render(<DayChanges />);
    expect(screen.getByText('Nothing has changed today yet.')).toBeInTheDocument();
  });
});
