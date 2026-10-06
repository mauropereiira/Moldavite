import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';

export type Season = 'autumn';

/**
 * The season this release carries, chosen per release rather than by date: a
 * seasonal update stays until the next one replaces it, and `null` ships none.
 */
export const ACTIVE_SEASON: Season | null = 'autumn';

export const JACK_O_LANTERN_SRC = '/seasonal/jack-o-lantern.webp';
/** Bolder lines and a solid face, so it still reads at 18 to 22px. */
export const JACK_O_LANTERN_SMALL_SRC = '/seasonal/jack-o-lantern-small.webp';

/** The season whose small touches (Settings pumpkin, falling leaves) are showing, if any. */
export function useSeasonalTouches(): Season | null {
  const enabled = useSettingsStore((state) => state.showSeasonalTouches);
  return enabled ? ACTIVE_SEASON : null;
}

/** True when the Autumn theme's own artwork should draw: autumn release, touches on, Autumn theme picked. */
export function useAutumnArt(): boolean {
  const season = useSeasonalTouches();
  const preset = useThemeStore((state) => state.preset);
  return season === 'autumn' && preset === 'autumn';
}
