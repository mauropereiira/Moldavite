import { describe, expect, it } from 'vitest';
import { fitTabs, type FitItem } from './tabOverflow';

const items = (pinned: number, open: number, width = 100): FitItem[] => [
  ...Array.from({ length: pinned }, (_, i) => ({ id: `p${i}`, width, pinned: true })),
  ...Array.from({ length: open }, (_, i) => ({ id: `o${i}`, width, pinned: false })),
];

const fit = (list: FitItem[], available: number, activeId: string | null = null) =>
  fitTabs(list, { available, gap: 2, divider: 15, activeId });

describe('fitTabs', () => {
  it('shows everything that fits, in order', () => {
    expect(fit(items(2, 2), 1000)).toEqual({ visible: ['p0', 'p1', 'o0', 'o1'], folded: [] });
  });

  it('folds from the end when the strip is too narrow', () => {
    // Three tabs and the divider take 319; a fourth makes 421.
    expect(fit(items(2, 3), 420)).toEqual({ visible: ['p0', 'p1', 'o0'], folded: ['o1', 'o2'] });
  });

  it('counts the divider only when both groups are on the bar', () => {
    expect(fit(items(0, 4), 406).visible).toHaveLength(4);
    expect(fit(items(2, 2), 406).visible).toHaveLength(3);
    expect(fit(items(2, 2), 421).visible).toHaveLength(4);
  });

  it('keeps the active tab, folding tabs before it from the end', () => {
    const result = fit(items(2, 6), 420, 'o5');
    expect(result.visible).toEqual(['p0', 'p1', 'o5']);
    expect(result.folded).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);
  });

  it('keeps an active pin without disturbing the pins before it', () => {
    expect(fit(items(6, 2), 310, 'p1').visible).toEqual(['p0', 'p1', 'p2']);
    expect(fit(items(6, 2), 310, 'p5').visible).toEqual(['p0', 'p1', 'p5']);
  });

  it('keeps the active tab even when nothing else fits beside it', () => {
    expect(fit(items(3, 3), 50, 'o2')).toEqual({
      visible: ['o2'],
      folded: ['p0', 'p1', 'p2', 'o0', 'o1'],
    });
  });

  it('shows nothing for no tabs and ignores an active id that is not in the bar', () => {
    expect(fit([], 500, 'x')).toEqual({ visible: [], folded: [] });
    expect(fit(items(1, 1), 100, 'missing').visible).toEqual(['p0']);
  });

  it.each([800, 1280, 2560])(
    'fits 25 pins and 40 open tabs at %ipx with the active tab on the bar',
    (width) => {
      const list = items(25, 40, 120);
      for (const activeId of ['p0', 'p24', 'o0', 'o39', null]) {
        const { visible, folded } = fit(list, width, activeId);
        expect(visible.length + folded.length).toBe(65);
        const shown = list.filter((item) => visible.includes(item.id));
        const used =
          shown.reduce((sum, item) => sum + item.width, 0) +
          2 * (shown.length - 1) +
          (shown.some((i) => i.pinned) && shown.some((i) => !i.pinned) ? 15 : 0);
        expect(used).toBeLessThanOrEqual(width);
        if (activeId) expect(visible).toContain(activeId);
        // Visible keeps bar order.
        expect(visible).toEqual(list.map((i) => i.id).filter((id) => visible.includes(id)));
      }
    }
  );
});
