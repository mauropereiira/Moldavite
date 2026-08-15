import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { formatShortcut } from '@/lib/shortcuts';
import { useNoteStore, useOverlayStore, useSettingsStore } from '@/stores';
import { CONSTELLATIONS } from './constellations';
import { WORDMARK_BOX, WORDMARK_GLYPHS } from './wordmarkGlyphs';

const COUNTER_DURATION_FALLBACK_MS = 700;
const COUNTER_DELAY_FALLBACK_MS = 640;
const CONSTELLATION_FIELD = { width: 1200, height: 800 };
export const BACKGROUND_STAR_COUNT = 180;
const METEOR_CADENCE_MS = { min: 14_000, max: 22_000 };
const METEOR_DURATION_MS = { min: 900, max: 1_200 };
const ASTEROID_LERP = 0.18;
const ASTEROID_SIZE = 14;
const ASTEROID_TRAIL = [
  { size: 4, lerp: 0.12, opacity: 0.24 },
  { size: 3, lerp: 0.09, opacity: 0.15 },
  { size: 2, lerp: 0.07, opacity: 0.08 },
] as const;
const CONSTELLATION_LAYOUT: Record<
  string,
  { x: number; y: number; width: number; height: number; rotation: number }
> = {
  Gemini: { x: -80, y: 70, width: 560, height: 360, rotation: -14 },
  Aquarius: { x: 650, y: -45, width: 690, height: 400, rotation: 12 },
  Libra: { x: 315, y: 535, width: 530, height: 320, rotation: -9 },
};
const CONSTELLATION_STAR_OFFSETS = CONSTELLATIONS.map((_, constellationIndex) =>
  CONSTELLATIONS.slice(0, constellationIndex).reduce(
    (total, constellation) => total + constellation.stars.length,
    0
  )
);
const METEOR_BANDS = [
  { xMin: 88, xMax: 228, yMin: 50, yMax: 125, angleMin: 155, angleMax: 205 },
  { xMin: 972, xMax: 1112, yMin: 50, yMax: 125, angleMin: -25, angleMax: 25 },
  { xMin: 88, xMax: 228, yMin: 395, yMax: 470, angleMin: 155, angleMax: 205 },
  { xMin: 972, xMax: 1112, yMin: 395, yMax: 470, angleMin: -25, angleMax: 25 },
] as const;

interface BackgroundStar {
  x: number;
  y: number;
  radius: number;
  opacityOffset: number;
  duration: number;
  delay: number;
}

const STAR_CLUSTERS = [
  { x: 0.16, y: 0.2, spread: 0.12 },
  { x: 0.82, y: 0.22, spread: 0.1 },
  { x: 0.22, y: 0.78, spread: 0.11 },
  { x: 0.8, y: 0.75, spread: 0.13 },
] as const;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function smoothstep(from: number, to: number, value: number): number {
  const position = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return position * position * (3 - 2 * position);
}

function createBackgroundStars(count: number): BackgroundStar[] {
  const random = createSeededRandom(0x4d4f4c44);
  const stars: BackgroundStar[] = [];

  while (stars.length < count) {
    let x = random();
    let y = random();

    if (random() < 0.3) {
      const cluster = STAR_CLUSTERS[Math.floor(random() * STAR_CLUSTERS.length)];
      const angle = random() * Math.PI * 2;
      const distance = cluster.spread * Math.sqrt(random());
      x = cluster.x + Math.cos(angle) * distance;
      y = cluster.y + Math.sin(angle) * distance;
    }

    if (x < 0 || x > 1 || y < 0 || y > 1) continue;

    const centreDistance = Math.hypot((x - 0.5) / 0.5, (y - 0.5) / 0.5) / Math.SQRT2;
    const edgeStrength = 0.12 + 0.88 * smoothstep(0.08, 0.86, centreDistance);

    // The same smooth radial curve thins the centre and lowers its opacity.
    // A non-zero floor keeps the wordmark area connected to the wider sky.
    if (random() > 0.38 + edgeStrength * 0.62) continue;

    stars.push({
      x: x * CONSTELLATION_FIELD.width,
      y: y * CONSTELLATION_FIELD.height,
      radius: 0.4 + random() * 0.8,
      opacityOffset: edgeStrength * random() * 0.08,
      duration: 4 + random() * 5,
      delay: -random() * 9,
    });
  }

  return stars;
}

const BACKGROUND_STARS = createBackgroundStars(BACKGROUND_STAR_COUNT);

interface Meteor {
  id: number;
  x: number;
  y: number;
  angle: number;
  length: number;
  duration: number;
}

let meteorSequence = 0;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createMeteor(): Meteor {
  const band = METEOR_BANDS[Math.floor(Math.random() * METEOR_BANDS.length)];

  return {
    id: ++meteorSequence,
    x: randomBetween(band.xMin, band.xMax),
    y: randomBetween(band.yMin, band.yMax),
    angle: randomBetween(band.angleMin, band.angleMax),
    length: randomBetween(68, 115),
    duration: randomBetween(METEOR_DURATION_MS.min, METEOR_DURATION_MS.max),
  };
}

interface WelcomeCounts {
  notes: number;
  daily: number;
  weekly: number;
}

function mediaQueryMatches(query: string): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaQueryMatches(query));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

function AsteroidCursor() {
  const asteroidRef = useRef<HTMLDivElement>(null);
  const trailRefs = useRef<Array<HTMLDivElement | null>>([]);
  const impactRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const asteroid = asteroidRef.current;
    const impact = impactRef.current;
    if (!asteroid || !impact) return;

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const position = { ...target };
    const trail = ASTEROID_TRAIL.map(() => ({ ...target }));
    let frame = 0;
    let visible = false;
    let overInteractive = false;

    document.documentElement.classList.add('welcome-asteroid-cursor-active');

    const reveal = () => {
      if (visible) return;
      visible = true;
      asteroid.style.opacity = '0.62';
      trailRefs.current.forEach((dot, index) => {
        if (dot) dot.style.opacity = String(ASTEROID_TRAIL[index].opacity);
      });
    };

    /**
     * The asteroid is a flourish for the welcome screen; a dialog is a task.
     * While one is open — release notes, a confirmation, Settings — the real
     * pointer comes back and the asteroid stands down. Without this the
     * cursor is hidden by CSS while an arrow is what the dialog's buttons
     * actually need, which reads as the pointer having vanished.
     *
     * Driven by a MutationObserver rather than the animation loop: a dialog
     * can open under a stationary mouse, so waiting for the next pointermove
     * would leave the cursor hidden until you happened to move it. The
     * observer also keeps this off the per-frame path, where a repeated
     * document-wide query would be pure waste, and it still fires when the
     * window is backgrounded and rAF is throttled.
     */
    let yielded = false;
    const syncYield = () => {
      const modalOpen = document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
      if (modalOpen === yielded) return;
      yielded = modalOpen;
      document.documentElement.classList.toggle('welcome-asteroid-yielded', modalOpen);
      const visibility = modalOpen ? 'hidden' : 'visible';
      asteroid.style.visibility = visibility;
      trailRefs.current.forEach((dot) => {
        if (dot) dot.style.visibility = visibility;
      });
    };
    const overlayObserver = new MutationObserver(syncYield);
    overlayObserver.observe(document.body, { childList: true, subtree: true });
    syncYield();

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      target.x = event.clientX;
      target.y = event.clientY;
      overInteractive =
        event.target instanceof Element &&
        event.target.closest('button, a, [role="button"], [role="link"]') !== null;
      reveal();
    };

    const handleClick = (event: MouseEvent) => {
      impact.style.left = `${event.clientX - 20}px`;
      impact.style.top = `${event.clientY - 20}px`;
      impact.style.animation = 'none';
      void impact.offsetWidth;
      impact.style.animation = 'welcome-asteroid-impact 500ms var(--ease-standard) both';
    };

    const tick = () => {
      position.x += (target.x - position.x) * ASTEROID_LERP;
      position.y += (target.y - position.y) * ASTEROID_LERP;
      asteroid.style.transform = `translate3d(${position.x - ASTEROID_SIZE / 2}px, ${position.y - ASTEROID_SIZE / 2}px, 0) scale(${overInteractive ? 1.16 : 1})`;

      trail.forEach((dot, index) => {
        const leader = index === 0 ? position : trail[index - 1];
        const spec = ASTEROID_TRAIL[index];
        dot.x += (leader.x - dot.x) * spec.lerp;
        dot.y += (leader.y - dot.y) * spec.lerp;
        const element = trailRefs.current[index];
        if (element) {
          element.style.transform = `translate3d(${dot.x - spec.size / 2}px, ${dot.y - spec.size / 2}px, 0)`;
        }
      });

      frame = requestAnimationFrame(tick);
    };

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('click', handleClick, true);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      overlayObserver.disconnect();
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('click', handleClick, true);
      document.documentElement.classList.remove('welcome-asteroid-cursor-active');
      document.documentElement.classList.remove('welcome-asteroid-yielded');
    };
  }, []);

  const fixedLayerStyle = {
    color: 'var(--text-primary)',
    left: 0,
    opacity: 0,
    pointerEvents: 'none',
    position: 'fixed',
    top: 0,
    willChange: 'transform',
    zIndex: 30_000,
  } as const;

  return (
    <>
      {ASTEROID_TRAIL.map((dot, index) => (
        <div
          key={dot.size}
          ref={(element) => {
            trailRefs.current[index] = element;
          }}
          style={{ ...fixedLayerStyle, width: dot.size, height: dot.size }}
        >
          <svg aria-hidden="true" viewBox="0 0 4 4" style={{ display: 'block' }}>
            <circle cx="2" cy="2" r="2" fill="currentColor" />
          </svg>
        </div>
      ))}
      <div
        ref={asteroidRef}
        data-testid="welcome-asteroid-cursor"
        style={{ ...fixedLayerStyle, width: ASTEROID_SIZE, height: ASTEROID_SIZE }}
      >
        <svg
          aria-hidden="true"
          className="welcome-asteroid-rock"
          viewBox="0 0 16 16"
          style={{ display: 'block', width: '100%', height: '100%' }}
        >
          <path
            d="M1.4 6.2 5.8 1.3 12.1 2.5 15 7.7 12.4 13.8 6.1 14.7 1 10.4Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div
        ref={impactRef}
        data-testid="welcome-asteroid-impact"
        style={{
          ...fixedLayerStyle,
          width: 40,
          height: 40,
          transformOrigin: 'center',
          willChange: 'opacity, transform',
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 40 40" style={{ display: 'block' }}>
          <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="0.75" />
        </svg>
      </div>
    </>
  );
}

function readMotionMilliseconds(token: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (value.endsWith('ms')) return Number.parseFloat(value);
  if (value.endsWith('s')) return Number.parseFloat(value) * 1000;
  return fallback;
}

function useAnimatedCounts(target: WelcomeCounts, reducedMotion: boolean): WelcomeCounts {
  const [counts, setCounts] = useState<WelcomeCounts>(() =>
    reducedMotion ? target : { notes: 0, daily: 0, weekly: 0 }
  );
  const countsRef = useRef(counts);

  useEffect(() => {
    countsRef.current = counts;
  }, [counts]);

  useEffect(() => {
    if (reducedMotion) {
      countsRef.current = target;
      setCounts(target);
      return;
    }

    const startCounts = countsRef.current;
    const duration = readMotionMilliseconds(
      '--welcome-counter-duration',
      COUNTER_DURATION_FALLBACK_MS
    );
    const delay = readMotionMilliseconds('--welcome-glyphs-complete', COUNTER_DELAY_FALLBACK_MS);
    let frame = 0;
    let startTime: number | null = null;

    const tick = (time: number) => {
      startTime ??= time;
      const progress = Math.min(Math.max(time - startTime - delay, 0) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = {
        notes: Math.round(startCounts.notes + (target.notes - startCounts.notes) * eased),
        daily: Math.round(startCounts.daily + (target.daily - startCounts.daily) * eased),
        weekly: Math.round(startCounts.weekly + (target.weekly - startCounts.weekly) * eased),
      };

      countsRef.current = next;
      setCounts(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, target]);

  return counts;
}

function MeteorLayer() {
  const [meteor, setMeteor] = useState<Meteor | null>(null);
  const gradientId = `welcome-meteor-${useId().replaceAll(':', '')}`;

  useEffect(() => {
    let spawnTimer: number | undefined;
    let clearTimer: number | undefined;

    const spawn = () => {
      const nextMeteor = createMeteor();
      setMeteor(nextMeteor);
      clearTimer = window.setTimeout(() => {
        setMeteor((current) => (current?.id === nextMeteor.id ? null : current));
      }, nextMeteor.duration);
      spawnTimer = window.setTimeout(
        spawn,
        randomBetween(METEOR_CADENCE_MS.min, METEOR_CADENCE_MS.max)
      );
    };

    spawnTimer = window.setTimeout(
      spawn,
      randomBetween(METEOR_CADENCE_MS.min, METEOR_CADENCE_MS.max)
    );

    return () => {
      if (spawnTimer !== undefined) window.clearTimeout(spawnTimer);
      if (clearTimer !== undefined) window.clearTimeout(clearTimer);
    };
  }, []);

  if (!meteor) return null;

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={-meteor.length / 2}
          y1="0"
          x2={meteor.length / 2}
          y2="0"
        >
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.58" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="1" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <g transform={`translate(${meteor.x} ${meteor.y}) rotate(${meteor.angle})`}>
        <g
          className="welcome-meteor"
          data-testid="welcome-meteor"
          style={{ animationDuration: `${meteor.duration}ms` }}
        >
          <line
            x1={-meteor.length / 2}
            y1="0"
            x2={meteor.length / 2}
            y2="0"
            stroke={`url(#${gradientId})`}
            strokeLinecap="round"
            strokeWidth="0.75"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </g>
    </>
  );
}

function ConstellationField({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="welcome-constellation-field"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      viewBox={`0 0 ${CONSTELLATION_FIELD.width} ${CONSTELLATION_FIELD.height}`}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <g className="welcome-background-star-drift">
        {BACKGROUND_STARS.map((star, index) => {
          const starStyle: CSSProperties & { '--welcome-star-base-opacity': string } = {
            '--welcome-star-base-opacity': `calc(var(--welcome-background-star-opacity-min) + ${star.opacityOffset.toFixed(4)})`,
            animationDelay: `${star.delay.toFixed(2)}s`,
            animationDuration: `${star.duration.toFixed(2)}s`,
          };

          return (
            <circle
              key={index}
              className="welcome-background-star"
              cx={star.x}
              cy={star.y}
              r={star.radius}
              fill="currentColor"
              style={starStyle}
            />
          );
        })}
      </g>
      {CONSTELLATIONS.map((constellation, constellationIndex) => {
        const layout = CONSTELLATION_LAYOUT[constellation.name];
        const point = (starIndex: number) => ({
          x: constellation.stars[starIndex].x * layout.width,
          y: constellation.stars[starIndex].y * layout.height,
        });

        return (
          <g
            key={constellation.name}
            data-constellation={constellation.name}
            transform={`translate(${layout.x} ${layout.y}) rotate(${layout.rotation} ${layout.width / 2} ${layout.height / 2})`}
          >
            <g
              className={`welcome-constellation-drift welcome-constellation-drift-${constellation.name.toLowerCase()}`}
            >
              {constellation.lines.map(([fromIndex, toIndex], lineIndex) => {
                const from = point(fromIndex);
                const to = point(toIndex);
                return (
                  <line
                    key={`${fromIndex}-${toIndex}`}
                    className="welcome-constellation-line"
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    pathLength="1"
                    stroke="currentColor"
                    strokeDasharray="1"
                    strokeWidth="0.5"
                    vectorEffect="non-scaling-stroke"
                    style={{
                      animationDelay: `${130 + constellationIndex * 50 + lineIndex * 7}ms`,
                    }}
                  />
                );
              })}
              {constellation.stars.map((star, starIndex) => {
                const magnitude = Math.min(4.5, Math.max(1, star.m));
                const brightness = (4.5 - magnitude) / 3.5;
                const radius = 1.2 + brightness * 1.2;
                const globalIndex = CONSTELLATION_STAR_OFFSETS[constellationIndex] + starIndex;
                const starStyle: CSSProperties & { '--welcome-star-base-opacity': string } = {
                  '--welcome-star-base-opacity': `calc(var(--welcome-constellation-star-opacity-min) + ${(brightness * 0.08).toFixed(4)})`,
                  animationDelay: `${(-globalIndex * 0.73).toFixed(2)}s`,
                  animationDuration: `${4 + ((globalIndex * 7) % 11) * 0.5}s`,
                };

                return (
                  <g
                    key={starIndex}
                    className="welcome-constellation-star-reveal"
                    style={{
                      animationDelay: `${40 + constellationIndex * 45 + (starIndex % 4) * 10}ms`,
                    }}
                  >
                    <g className="welcome-constellation-star-twinkle" style={starStyle}>
                      <circle
                        className="welcome-constellation-star"
                        cx={star.x * layout.width}
                        cy={star.y * layout.height}
                        r={radius}
                        fill="currentColor"
                      />
                    </g>
                  </g>
                );
              })}
            </g>
          </g>
        );
      })}
      {!reducedMotion && <MeteorLayer />}
    </svg>
  );
}

function AnimatedWordmark() {
  const fontTransform = `translate(${-WORDMARK_BOX.minX} ${WORDMARK_BOX.maxY}) scale(1 -1)`;

  return (
    <div
      className="welcome-wordmark"
      style={{
        position: 'relative',
        width: '73%',
        maxWidth: '860px',
        color: 'var(--text-primary)',
        zIndex: 1,
      }}
    >
      <svg
        role="img"
        aria-label="Moldavite"
        viewBox={`0 0 ${WORDMARK_BOX.w} ${WORDMARK_BOX.h}`}
        style={{ position: 'relative', display: 'block', width: '100%', overflow: 'visible' }}
      >
        <title>Moldavite</title>
        {WORDMARK_GLYPHS.map((glyph, index) => (
          <g
            key={`${glyph.ch}-${index}`}
            className="welcome-wordmark-glyph"
            style={{ animationDelay: `calc(${index} * var(--welcome-glyph-stagger))` }}
          >
            <g transform={fontTransform}>
              <path
                className={glyph.mirrored ? 'welcome-signature-glyph' : undefined}
                d={glyph.d}
                fill="currentColor"
                style={
                  glyph.mirrored
                    ? {
                        transformBox: 'view-box',
                        transformOrigin: `${glyph.cx}px ${glyph.cy}px`,
                      }
                    : undefined
                }
              />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function WelcomeEmptyState({
  onCreateToday,
  onCreateNote,
}: {
  onCreateToday: () => void;
  onCreateNote: () => void;
}) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const { showWelcomeDots, showWelcomeStats, showWelcomeDate, showAsteroidCursor, isSettingsOpen } =
    useSettingsStore();
  const activeOverlay = useOverlayStore((state) => state.activeOverlay);
  const notes = useNoteStore((state) => state.notes);
  // Everything here comes from `noteStore`, which is loaded at startup.
  // Tag and folder counts deliberately are NOT used: both stores are populated
  // by hooks that only mount with the Sidebar, and the Sidebar is now a
  // summoned overlay — so on a cold start they are legitimately empty and the
  // counter would animate proudly to zero. Populating them here would mean
  // reading every note's contents at launch to print one number.
  const targetCounts = useMemo(
    () => ({
      notes: notes.length,
      daily: notes.filter((note) => note.isDaily).length,
      weekly: notes.filter((note) => note.isWeekly).length,
    }),
    [notes]
  );
  const counts = useAnimatedCounts(targetCounts, reducedMotion);
  const date = useMemo(() => format(new Date(), 'EEEE · d MMMM yyyy'), []);
  const actionStyle = { color: 'var(--text-secondary)', paddingBottom: '2px' };

  return (
    <div
      className="flex flex-col items-center justify-center h-full w-full px-8"
      style={{
        isolation: 'isolate',
        overflow: 'hidden',
        position: 'relative',
        // Chrome, not content: this screen is pure identity, so selecting
        // "Moldavite" or the note counts copies nothing anyone wants.
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {showAsteroidCursor &&
        !reducedMotion &&
        !coarsePointer &&
        activeOverlay === null &&
        !isSettingsOpen && <AsteroidCursor />}
      {showWelcomeDots && <ConstellationField reducedMotion={reducedMotion} />}
      {showWelcomeDate && (
        <p
          className="welcome-reveal welcome-reveal-date"
          style={{
            marginBottom: '24px',
            color: 'var(--text-muted)',
            fontSize: '10px',
            fontWeight: 500,
            letterSpacing: '0.14em',
            lineHeight: 1,
            position: 'relative',
            textTransform: 'uppercase',
            zIndex: 1,
          }}
        >
          {date}
        </p>
      )}

      <AnimatedWordmark />

      <div
        className="welcome-reveal welcome-reveal-actions flex items-center gap-6 text-sm"
        style={{ marginTop: 'clamp(2rem, 6vh, 4rem)', position: 'relative', zIndex: 1 }}
      >
        <button
          type="button"
          onClick={onCreateToday}
          className="welcome-note-action"
          style={actionStyle}
        >
          Today&rsquo;s note
        </button>
        <button
          type="button"
          onClick={onCreateNote}
          className="welcome-note-action"
          style={actionStyle}
        >
          New note
        </button>
      </div>

      {showWelcomeStats && (
        <p
          className="welcome-reveal welcome-reveal-stats"
          aria-label={`${targetCounts.notes} notes, ${targetCounts.daily} daily, ${targetCounts.weekly} weekly`}
          style={{
            marginTop: '20px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-display)',
            fontSize: '10px',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.08em',
            lineHeight: 1,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {counts.notes} notes · {counts.daily} daily · {counts.weekly} weekly
        </p>
      )}

      <p
        className="welcome-reveal welcome-reveal-hint text-xs"
        style={{
          marginTop: '24px',
          color: 'var(--text-muted)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {formatShortcut('⌘N')}
      </p>
    </div>
  );
}
