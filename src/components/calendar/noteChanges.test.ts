import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteFile } from '@/types';
import { changesOnDay, fileBirthTimesKept } from './noteChanges';

const seconds = (iso: string) => Date.parse(iso) / 1000;

function note(name: string, times: { createdAt?: string; modifiedAt?: string }): NoteFile {
  return {
    name: `${name}.md`,
    path: `notes/${name}.md`,
    isDaily: false,
    isWeekly: false,
    isLocked: false,
    createdAt: times.createdAt ? seconds(times.createdAt) : undefined,
    modifiedAt: times.modifiedAt ? seconds(times.modifiedAt) : undefined,
  };
}

const names = (notes: NoteFile[], day: Date, birthTimesKept = true) =>
  changesOnDay(notes, day, birthTimesKept).map((change) => change.note.name);

describe('changesOnDay', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('puts an edit at 23:30 local on that local day, not the UTC one', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    // 23:30 on 5 October in Los Angeles is already 6 October in UTC.
    const late = note('Late', { modifiedAt: '2026-10-06T06:30:00Z' });

    expect(names([late], new Date(2026, 9, 5, 12))).toEqual(['Late.md']);
    expect(names([late], new Date(2026, 9, 6, 12))).toEqual([]);
  });

  it('keeps an edit just after local midnight on the new day', () => {
    vi.stubEnv('TZ', 'Europe/Lisbon');
    const early = note('Early', { modifiedAt: '2026-08-14T23:05:00Z' });

    expect(names([early], new Date(2026, 7, 15, 12))).toEqual(['Early.md']);
    expect(names([early], new Date(2026, 7, 14, 12))).toEqual([]);
  });

  it('covers all 25 hours of the New York fall-back day', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const day = new Date(2026, 10, 1, 12);
    const notes = [
      note('Before', { modifiedAt: '2026-11-01T03:59:00Z' }),
      note('First half hour', { modifiedAt: '2026-11-01T04:00:00Z' }),
      note('Second 01:30', { modifiedAt: '2026-11-01T06:30:00Z' }),
      note('Last minute', { modifiedAt: '2026-11-02T04:59:00Z' }),
      note('After', { modifiedAt: '2026-11-02T05:00:00Z' }),
    ];

    expect(names(notes, day)).toEqual(['Last minute.md', 'Second 01:30.md', 'First half hour.md']);
  });

  it('covers only the 23 hours of the New York spring-forward day', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const day = new Date(2026, 2, 8, 12);
    const notes = [
      note('Start', { modifiedAt: '2026-03-08T05:00:00Z' }),
      note('End', { modifiedAt: '2026-03-09T03:59:00Z' }),
      note('Next day', { modifiedAt: '2026-03-09T04:00:00Z' }),
    ];

    expect(names(notes, day)).toEqual(['End.md', 'Start.md']);
  });

  it('tells a created note from an edited one, and from one created then edited', () => {
    vi.stubEnv('TZ', 'UTC');
    const day = new Date(Date.UTC(2026, 9, 6, 12));
    const changes = changesOnDay(
      [
        note('Edited', { createdAt: '2026-09-01T10:00:00Z', modifiedAt: '2026-10-06T14:00:00Z' }),
        note('Created', { createdAt: '2026-10-06T09:00:00Z', modifiedAt: '2026-10-06T09:00:30Z' }),
        note('Both', { createdAt: '2026-10-06T08:00:00Z', modifiedAt: '2026-10-06T16:00:00Z' }),
        note('Created, edited later', {
          createdAt: '2026-10-06T07:00:00Z',
          modifiedAt: '2026-10-08T07:00:00Z',
        }),
      ],
      day,
      true
    );

    expect(changes.map((change) => [change.note.name, change.kind])).toEqual([
      ['Both.md', 'created-edited'],
      ['Edited.md', 'edited'],
      ['Created.md', 'created'],
      ['Created, edited later.md', 'created'],
    ]);
    expect(changes[0].at).toBe(Date.parse('2026-10-06T16:00:00Z'));
    expect(changes[0].createdAt).toBe(Date.parse('2026-10-06T08:00:00Z'));
    expect(changes[3].at).toBe(Date.parse('2026-10-06T07:00:00Z'));
  });

  it('reports every change as an edit where saves reset the birth time', () => {
    vi.stubEnv('TZ', 'UTC');
    const day = new Date(Date.UTC(2026, 9, 6, 12));
    const saved = note('Saved', {
      createdAt: '2026-10-06T10:00:00Z',
      modifiedAt: '2026-10-06T10:00:00Z',
    });
    const createdOnly = note('Birth only', { createdAt: '2026-10-06T09:00:00Z' });

    expect(changesOnDay([saved, createdOnly], day, false)).toEqual([
      { note: saved, kind: 'edited', at: Date.parse('2026-10-06T10:00:00Z'), createdAt: undefined },
    ]);
  });

  it('lists a note with no times nowhere, and a note with only a modified time as edited', () => {
    vi.stubEnv('TZ', 'UTC');
    const day = new Date(Date.UTC(2026, 9, 6, 12));
    const remote = {
      ...note('Remote', { modifiedAt: '2026-10-06T11:00:00Z' }),
      notDownloaded: true,
    };

    expect(changesOnDay([note('Unknown', {}), remote], day, true)).toEqual([
      {
        note: remote,
        kind: 'edited',
        at: Date.parse('2026-10-06T11:00:00Z'),
        createdAt: undefined,
      },
    ]);
  });

  it('orders ties by path so the list does not shuffle between renders', () => {
    vi.stubEnv('TZ', 'UTC');
    const at = { modifiedAt: '2026-10-06T11:00:00Z' };

    expect(names([note('b', at), note('a', at)], new Date(Date.UTC(2026, 9, 6)))).toEqual([
      'a.md',
      'b.md',
    ]);
  });

  it('trusts birth times on macOS and Windows but not on Linux', () => {
    const agent = vi.spyOn(navigator, 'userAgent', 'get');
    agent.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15');
    expect(fileBirthTimesKept()).toBe(true);
    agent.mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    expect(fileBirthTimesKept()).toBe(true);
    agent.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15');
    expect(fileBirthTimesKept()).toBe(false);
  });
});
