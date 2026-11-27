import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';

export type Season = 'autumn' | 'winter';

/**
 * The season this release carries, chosen per release rather than by date: a
 * seasonal update stays until the next one replaces it, and `null` ships none.
 */
export const ACTIVE_SEASON: Season | null = 'winter';

/**
 * The season's mascot. The onboarding page uses the large cut; corners use the
 * small one, which has bolder lines so it still reads at 18 to 22px.
 */
export const SEASON_MASCOT: Record<
  Season,
  { src: string; smallSrc: string; label: string; edition: string }
> = {
  autumn: {
    src: '/seasonal/jack-o-lantern.webp',
    smallSrc: '/seasonal/jack-o-lantern-small.webp',
    label: 'Happy autumn',
    edition: 'Autumn edition',
  },
  winter: {
    src: '/seasonal/winter-mascot.webp',
    smallSrc: '/seasonal/winter-mascot-small.webp',
    label: 'Happy winter',
    edition: 'Winter edition',
  },
};

/** The season whose small touches (Settings mascot, falling leaves or snow) are showing, if any. */
export function useSeasonalTouches(): Season | null {
  const enabled = useSettingsStore((state) => state.showSeasonalTouches);
  return enabled ? ACTIVE_SEASON : null;
}

/**
 * The seasonal theme whose own artwork should draw: touches on and that
 * season's theme picked. A seasonal theme keeps its scene after its release.
 */
export function useSeasonArt(): Season | null {
  const enabled = useSettingsStore((state) => state.showSeasonalTouches);
  const preset = useThemeStore((state) => state.preset);
  if (!enabled) return null;
  return preset in SEASON_MASCOT ? (preset as Season) : null;
}
