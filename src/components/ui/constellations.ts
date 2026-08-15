/**
 * Three constellations, drawn behind the welcome screen.
 *
 * Moldavite is impact glass — it fell from the sky — so a night sky is the
 * material's own origin rather than decoration borrowed for atmosphere.
 *
 * Coordinates are normalised to a 0–1 box (y down) per constellation, so each
 * can be placed and scaled independently. Star `m` is apparent magnitude,
 * loosely: lower is brighter, and it drives dot radius and opacity so the
 * brighter stars actually read as brighter. Shapes are the conventional
 * stick figures, simplified — recognisable at a glance, not astrometry.
 */

export interface Star {
  x: number;
  y: number;
  /** Apparent magnitude — smaller is brighter. */
  m: number;
}

export interface Constellation {
  name: string;
  stars: Star[];
  /** Index pairs into `stars`, drawn as hairlines. */
  lines: [number, number][];
}

export const CONSTELLATIONS: Constellation[] = [
  {
    // The twins: two near-parallel figures joined at the heads.
    name: 'Gemini',
    stars: [
      { x: 0.08, y: 0.05, m: 1.6 }, // Castor
      { x: 0.32, y: 0.12, m: 1.1 }, // Pollux
      { x: 0.14, y: 0.32, m: 3.0 }, // Mebsuta
      { x: 0.38, y: 0.38, m: 3.5 }, // Wasat
      { x: 0.1, y: 0.56, m: 3.3 }, // Tejat
      { x: 0.34, y: 0.62, m: 1.9 }, // Alhena
      { x: 0.03, y: 0.78, m: 3.6 }, // Propus
      { x: 0.28, y: 0.85, m: 3.8 }, // Mekbuda
    ],
    lines: [
      [0, 1],
      [0, 2],
      [2, 4],
      [4, 6],
      [1, 3],
      [3, 5],
      [5, 7],
      [2, 3],
    ],
  },
  {
    // The scales: a lopsided quadrilateral with two dangling arms.
    name: 'Libra',
    stars: [
      { x: 0.48, y: 0.08, m: 2.6 }, // Zubeneschamali
      { x: 0.18, y: 0.36, m: 2.7 }, // Zubenelgenubi
      { x: 0.78, y: 0.34, m: 3.9 },
      { x: 0.42, y: 0.6, m: 3.3 }, // Brachium
      { x: 0.7, y: 0.72, m: 4.1 },
      { x: 0.08, y: 0.66, m: 4.5 },
    ],
    lines: [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 4],
      [3, 4],
      [1, 5],
    ],
  },
  {
    // The water bearer: a long zigzag trailing into the water jar.
    name: 'Aquarius',
    stars: [
      { x: 0.06, y: 0.26, m: 3.7 }, // Albali
      { x: 0.24, y: 0.16, m: 2.9 }, // Sadalsuud
      { x: 0.42, y: 0.28, m: 3.0 }, // Sadalmelik
      { x: 0.56, y: 0.18, m: 4.0 },
      { x: 0.68, y: 0.34, m: 3.8 }, // the jar
      { x: 0.82, y: 0.26, m: 4.2 },
      { x: 0.6, y: 0.56, m: 3.3 }, // Skat
      { x: 0.44, y: 0.72, m: 4.3 },
      { x: 0.28, y: 0.86, m: 4.5 },
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [4, 6],
      [6, 7],
      [7, 8],
    ],
  },
];
