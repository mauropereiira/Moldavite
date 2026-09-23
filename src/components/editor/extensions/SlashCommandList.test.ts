import { describe, expect, it } from 'vitest';
import { filterCommands } from './SlashCommandList';

describe('slash command filtering', () => {
  it('offers Table outside a table and leaves it out inside one', () => {
    expect(filterCommands('').map((item) => item.title)).toContain('Table');
    expect(filterCommands('grid').map((item) => item.title)).toEqual(['Table']);

    const inTable = filterCommands('', true).map((item) => item.title);
    expect(inTable).not.toContain('Table');
    expect(inTable).toContain('Divider');
    expect(filterCommands('grid', true)).toEqual([]);
  });
});
