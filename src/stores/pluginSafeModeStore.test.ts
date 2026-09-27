import { describe, expect, it } from 'vitest';
import { PLUGINS_RUNNING, toSafeModeStatus } from './pluginSafeModeStore';

describe('toSafeModeStatus', () => {
  it('keeps a well-formed safe mode reply', () => {
    expect(
      toSafeModeStatus({ active: true, reason: 'unfinishedStart', pluginIds: ['a', 'b'] })
    ).toEqual({ active: true, reason: 'unfinishedStart', pluginIds: ['a', 'b'] });
  });

  it('treats anything but an explicit active reply as plugins running', () => {
    for (const value of [null, undefined, [], 'yes', { active: 'true' }, { active: false }]) {
      expect(toSafeModeStatus(value)).toEqual(PLUGINS_RUNNING);
    }
  });

  it('drops an unknown reason and non-string ids', () => {
    expect(toSafeModeStatus({ active: true, reason: 'other', pluginIds: ['a', 1, null] })).toEqual({
      active: true,
      reason: null,
      pluginIds: ['a'],
    });
  });
});
