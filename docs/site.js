(function () {
  'use strict';

  var THEME_STORAGE_KEY = 'moldavite-site-theme';
  var activeTheme = readStoredTheme();

  applyTheme(activeTheme, false);

  var FIELD_WIDTH = 1200;
  var FIELD_HEIGHT = 800;
  var BACKGROUND_STAR_COUNT = 180;
  var METEOR_CADENCE_MIN = 14000;
  var METEOR_CADENCE_MAX = 22000;
  var METEOR_DURATION_MIN = 900;
  var METEOR_DURATION_MAX = 1200;
  var ASTEROID_LERP = 0.18;
  var ASTEROID_SIZE = 14;
  var ASTEROID_TRAIL = [
    { size: 4, lerp: 0.12, opacity: 0.24 },
    { size: 3, lerp: 0.09, opacity: 0.15 },
    { size: 2, lerp: 0.07, opacity: 0.08 },
  ];
  var STAR_CLUSTERS = [
    { x: 0.16, y: 0.2, spread: 0.12 },
    { x: 0.82, y: 0.22, spread: 0.1 },
    { x: 0.22, y: 0.78, spread: 0.11 },
    { x: 0.8, y: 0.75, spread: 0.13 },
  ];
  var CONSTELLATION_LAYOUT = {
    Gemini: { x: -80, y: 70, width: 560, height: 360, rotation: -14 },
    Aquarius: { x: 650, y: -45, width: 690, height: 400, rotation: 12 },
    Libra: { x: 315, y: 535, width: 530, height: 320, rotation: -9 },
  };
  var CONSTELLATIONS = [
    {
      name: 'Gemini',
      stars: [
        { x: 0.08, y: 0.05, m: 1.6 },
        { x: 0.32, y: 0.12, m: 1.1 },
        { x: 0.14, y: 0.32, m: 3.0 },
        { x: 0.38, y: 0.38, m: 3.5 },
        { x: 0.1, y: 0.56, m: 3.3 },
        { x: 0.34, y: 0.62, m: 1.9 },
        { x: 0.03, y: 0.78, m: 3.6 },
        { x: 0.28, y: 0.85, m: 3.8 },
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
      name: 'Libra',
      stars: [
        { x: 0.48, y: 0.08, m: 2.6 },
        { x: 0.18, y: 0.36, m: 2.7 },
        { x: 0.78, y: 0.34, m: 3.9 },
        { x: 0.42, y: 0.6, m: 3.3 },
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
      name: 'Aquarius',
      stars: [
        { x: 0.06, y: 0.26, m: 3.7 },
        { x: 0.24, y: 0.16, m: 2.9 },
        { x: 0.42, y: 0.28, m: 3.0 },
        { x: 0.56, y: 0.18, m: 4.0 },
        { x: 0.68, y: 0.34, m: 3.8 },
        { x: 0.82, y: 0.26, m: 4.2 },
        { x: 0.6, y: 0.56, m: 3.3 },
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
  var METEOR_BANDS = [
    { xMin: 88, xMax: 228, yMin: 50, yMax: 125, angleMin: 155, angleMax: 205 },
    { xMin: 972, xMax: 1112, yMin: 50, yMax: 125, angleMin: -25, angleMax: 25 },
    { xMin: 88, xMax: 228, yMin: 395, yMax: 470, angleMin: 155, angleMax: 205 },
    { xMin: 972, xMax: 1112, yMin: 395, yMax: 470, angleMin: -25, angleMax: 25 },
  ];

  var motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarsePointer = window.matchMedia('(pointer: coarse)');
  var videoObserver = null;

  function prefersReducedMotion() {
    return motionPreference.matches;
  }

  function readStoredTheme() {
    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch (error) {
      return 'light';
    }
  }

  function storeTheme(theme) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      // Storage can be unavailable in privacy modes. The live toggle still works.
    }
  }

  function notifyThemeChange() {
    var event;
    if (typeof window.CustomEvent === 'function') {
      event = new CustomEvent('moldavite:themechange');
    } else {
      event = document.createEvent('Event');
      event.initEvent('moldavite:themechange', false, false);
    }
    document.dispatchEvent(event);
  }

  function applyTheme(theme, notify) {
    var dark = theme === 'dark';
    activeTheme = dark ? 'dark' : 'light';

    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-pressed', dark ? 'true' : 'false');
      button.setAttribute('aria-label', dark ? 'Switch to light' : 'Switch to dark');
    });

    if (notify) notifyThemeChange();
  }

  function setupTheme() {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        var nextTheme = activeTheme === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme, true);
        storeTheme(nextTheme);
      });
    });

    window.addEventListener('storage', function (event) {
      if (event.key !== THEME_STORAGE_KEY) return;
      applyTheme(event.newValue === 'dark' ? 'dark' : 'light', true);
    });
  }

  function createSeededRandom(seed) {
    var state = seed >>> 0;

    return function () {
      var value;
      state = (state + 0x6d2b79f5) >>> 0;
      value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothstep(from, to, value) {
    var position = Math.min(1, Math.max(0, (value - from) / (to - from)));
    return position * position * (3 - 2 * position);
  }

  function createBackgroundStars(count) {
    var random = createSeededRandom(0x4d4f4c44);
    var stars = [];

    while (stars.length < count) {
      var x = random();
      var y = random();
      var cluster;
      var angle;
      var distance;
      var centreX;
      var centreY;
      var centreDistance;
      var edgeStrength;

      if (random() < 0.3) {
        cluster = STAR_CLUSTERS[Math.floor(random() * STAR_CLUSTERS.length)];
        angle = random() * Math.PI * 2;
        distance = cluster.spread * Math.sqrt(random());
        x = cluster.x + Math.cos(angle) * distance;
        y = cluster.y + Math.sin(angle) * distance;
      }

      if (x < 0 || x > 1 || y < 0 || y > 1) continue;

      centreX = (x - 0.5) / 0.5;
      centreY = (y - 0.5) / 0.5;
      centreDistance = Math.sqrt(centreX * centreX + centreY * centreY) / Math.SQRT2;
      edgeStrength = 0.12 + 0.88 * smoothstep(0.08, 0.86, centreDistance);

      if (random() > 0.38 + edgeStrength * 0.62) continue;

      stars.push({
        x: x * FIELD_WIDTH,
        y: y * FIELD_HEIGHT,
        radius: 0.4 + random() * 0.8,
        opacityOffset: edgeStrength * random() * 0.08,
        duration: 4 + random() * 5,
        delay: -random() * 9,
      });
    }

    return stars;
  }

  var BACKGROUND_STARS = createBackgroundStars(BACKGROUND_STAR_COUNT);

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function createMeteor(now) {
    var band = METEOR_BANDS[Math.floor(Math.random() * METEOR_BANDS.length)];
    return {
      x: randomBetween(band.xMin, band.xMax),
      y: randomBetween(band.yMin, band.yMax),
      angle: randomBetween(band.angleMin, band.angleMax),
      length: randomBetween(68, 115),
      duration: randomBetween(METEOR_DURATION_MIN, METEOR_DURATION_MAX),
      startedAt: now,
    };
  }

  function useConstellationTransform(context, constellation) {
    var layout = CONSTELLATION_LAYOUT[constellation.name];
    var centreX = layout.width / 2;
    var centreY = layout.height / 2;
    context.translate(layout.x + centreX, layout.y + centreY);
    context.rotate((layout.rotation * Math.PI) / 180);
    context.translate(-centreX, -centreY);
    return layout;
  }

  function setupSky() {
    var canvas = document.querySelector('[data-sky]');
    var context;
    var width = 0;
    var height = 0;
    var pixelRatio = 1;
    var frame = 0;
    var resizeFrame = 0;
    var meteor = null;
    var nextMeteorAt = 0;
    var colors = null;
    var colorsDirty = true;
    var lastFrameAnimated = null;

    if (!canvas || !canvas.getContext) return;
    context = canvas.getContext('2d');
    if (!context) return;

    function readColors() {
      var styles = window.getComputedStyle(document.documentElement);
      var valid;
      colors = {
        star: styles.getPropertyValue('--star').trim(),
        bright: styles.getPropertyValue('--star-bright').trim(),
        meteor: styles.getPropertyValue('--meteor').trim(),
      };
      valid = colors.star && colors.bright && colors.meteor;
      colorsDirty = !valid;
      return valid;
    }

    function prepareField() {
      var scale = Math.max(width / FIELD_WIDTH, height / FIELD_HEIGHT);
      var offsetX = (width - FIELD_WIDTH * scale) / 2;
      var offsetY = (height - FIELD_HEIGHT * scale) / 2;
      context.translate(offsetX, offsetY);
      context.scale(scale, scale);
      return scale;
    }

    function drawBackgroundStars(time, animated) {
      var seconds = time / 1000;
      context.fillStyle = colors.star;

      BACKGROUND_STARS.forEach(function (star) {
        var twinkle = 1;
        var baseOpacity = 0.55 + star.opacityOffset * 3.5;
        if (animated) {
          twinkle = 0.85 + 0.25 * Math.sin(((seconds + star.delay) / star.duration) * Math.PI * 2);
        }
        context.globalAlpha = Math.min(1, baseOpacity * twinkle);
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();
      });
    }

    function drawConstellationLines(scale) {
      context.strokeStyle = colors.star;
      context.globalAlpha = 0.36;
      context.lineWidth = 0.5 / scale;

      CONSTELLATIONS.forEach(function (constellation) {
        var layout;
        context.save();
        layout = useConstellationTransform(context, constellation);
        constellation.lines.forEach(function (line) {
          var from = constellation.stars[line[0]];
          var to = constellation.stars[line[1]];
          context.beginPath();
          context.moveTo(from.x * layout.width, from.y * layout.height);
          context.lineTo(to.x * layout.width, to.y * layout.height);
          context.stroke();
        });
        context.restore();
      });
    }

    function drawConstellationStars(time, animated) {
      var globalIndex = 0;
      var seconds = time / 1000;
      context.fillStyle = colors.bright;

      CONSTELLATIONS.forEach(function (constellation) {
        var layout;
        context.save();
        layout = useConstellationTransform(context, constellation);
        constellation.stars.forEach(function (star) {
          var magnitude = Math.min(4.5, Math.max(1, star.m));
          var brightness = (4.5 - magnitude) / 3.5;
          var radius = 1.2 + brightness * 1.2;
          var duration = 4 + ((globalIndex * 7) % 11) * 0.5;
          var delay = -globalIndex * 0.73;
          var twinkle = 1;
          if (animated) {
            twinkle = 0.85 + 0.25 * Math.sin(((seconds + delay) / duration) * Math.PI * 2);
          }
          context.globalAlpha = Math.min(1, (0.36 + brightness * 0.64) * twinkle);
          context.beginPath();
          context.arc(star.x * layout.width, star.y * layout.height, radius, 0, Math.PI * 2);
          context.fill();
          globalIndex += 1;
        });
        context.restore();
      });
    }

    function drawMeteor(time, scale) {
      var progress;
      var flightOpacity;
      var distance;
      var radians;
      var gradient;

      if (!meteor) return;
      progress = Math.min(1, (time - meteor.startedAt) / meteor.duration);
      if (progress >= 1) {
        meteor = null;
        return;
      }

      if (progress < 0.18) flightOpacity = progress / 0.18;
      else if (progress <= 0.62) flightOpacity = 1;
      else flightOpacity = 1 - (progress - 0.62) / 0.38;

      distance = -14 + progress * 62;
      radians = (meteor.angle * Math.PI) / 180;
      context.save();
      context.translate(
        meteor.x + Math.cos(radians) * distance,
        meteor.y + Math.sin(radians) * distance
      );
      context.rotate(radians);
      gradient = context.createLinearGradient(-meteor.length / 2, 0, meteor.length / 2, 0);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.58, colors.meteor);
      gradient.addColorStop(1, colors.meteor);
      context.strokeStyle = gradient;
      context.globalAlpha = Math.max(0, flightOpacity);
      context.lineCap = 'round';
      context.lineWidth = 0.75 / scale;
      context.beginPath();
      context.moveTo(-meteor.length / 2, 0);
      context.lineTo(meteor.length / 2, 0);
      context.stroke();
      context.restore();
    }

    function drawSky(time, animated) {
      var scale;
      if (!width || !height) return;
      if (colorsDirty && !readColors()) return;

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.save();
      scale = prepareField();
      drawBackgroundStars(time, animated);
      drawConstellationLines(scale);
      drawConstellationStars(time, animated);
      if (animated) drawMeteor(time, scale);
      context.restore();
      context.globalAlpha = 1;
      lastFrameAnimated = animated;
    }

    function scheduleMeteor(now) {
      nextMeteorAt = now + randomBetween(METEOR_CADENCE_MIN, METEOR_CADENCE_MAX);
    }

    function tick(time) {
      if (document.hidden || prefersReducedMotion()) {
        frame = 0;
        return;
      }
      if (!nextMeteorAt) scheduleMeteor(time);
      if (!meteor && time >= nextMeteorAt) {
        meteor = createMeteor(time);
        scheduleMeteor(time);
      }
      drawSky(time, true);
      frame = window.requestAnimationFrame(tick);
    }

    function stopAnimation() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      meteor = null;
      nextMeteorAt = 0;
    }

    function startAnimation() {
      stopAnimation();
      if (prefersReducedMotion() || document.hidden || !window.requestAnimationFrame) {
        if (lastFrameAnimated !== false) drawSky(0, false);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    }

    function resize() {
      var bounds = canvas.getBoundingClientRect();
      width = Math.max(0, Math.round(bounds.width));
      height = Math.max(0, Math.round(bounds.height));
      pixelRatio = Math.max(1, window.devicePixelRatio || 1);

      if (
        canvas.width !== Math.round(width * pixelRatio) ||
        canvas.height !== Math.round(height * pixelRatio)
      ) {
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
      }

      drawSky(0, false);
    }

    function queueResize() {
      if (!window.requestAnimationFrame) {
        resize();
        return;
      }
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(function () {
        resizeFrame = 0;
        resize();
      });
    }

    function handleMotionChange() {
      startAnimation();
    }

    function handleVisibilityChange() {
      if (document.hidden) stopAnimation();
      else startAnimation();
    }

    function handleThemeChange() {
      var time = window.performance && window.performance.now ? window.performance.now() : 0;
      colorsDirty = true;
      if (!readColors()) return;
      drawSky(time, !prefersReducedMotion());
    }

    resize();
    startAnimation();
    window.addEventListener('resize', queueResize, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('moldavite:themechange', handleThemeChange);
    if (motionPreference.addEventListener) {
      motionPreference.addEventListener('change', handleMotionChange);
    } else {
      motionPreference.addListener(handleMotionChange);
    }
  }

  function isTextEntryTarget(target) {
    var input;
    var type;
    if (!(target instanceof Element)) return false;
    if (target.closest('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) {
      return true;
    }
    input = target.closest('input');
    if (!input) return false;
    type = (input.getAttribute('type') || 'text').toLowerCase();
    return (
      [
        'button',
        'checkbox',
        'color',
        'file',
        'hidden',
        'image',
        'radio',
        'range',
        'reset',
        'submit',
      ].indexOf(type) === -1
    );
  }

  function makeCursorLayer(size) {
    var layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.color = 'var(--asteroid)';
    layer.style.height = size + 'px';
    layer.style.left = '0';
    layer.style.opacity = '0';
    layer.style.pointerEvents = 'none';
    layer.style.position = 'fixed';
    layer.style.top = '0';
    layer.style.width = size + 'px';
    layer.style.willChange = 'opacity, transform';
    layer.style.zIndex = '30000';
    return layer;
  }

  function makeAsteroidSvg() {
    var namespace = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(namespace, 'svg');
    var path = document.createElementNS(namespace, 'path');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.style.display = 'block';
    svg.style.height = '100%';
    svg.style.transformOrigin = 'center';
    svg.style.width = '100%';
    svg.style.willChange = 'transform';
    path.setAttribute('d', 'M1.4 6.2 5.8 1.3 12.1 2.5 15 7.7 12.4 13.8 6.1 14.7 1 10.4Z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }

  function makeImpactSvg() {
    var namespace = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(namespace, 'svg');
    var circle = document.createElementNS(namespace, 'circle');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.style.display = 'block';
    circle.setAttribute('cx', '20');
    circle.setAttribute('cy', '20');
    circle.setAttribute('r', '17');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '0.75');
    svg.appendChild(circle);
    return svg;
  }

  function setupAsteroidCursor() {
    var mounted = false;
    var frame = 0;
    var asteroid = null;
    var asteroidRock = null;
    var impact = null;
    var cursorStyle = null;
    var trailElements = [];
    var target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var position = { x: target.x, y: target.y };
    var trail = [];
    var pointerVisible = false;
    var overInteractive = false;
    var overTextEntry = false;
    var impactState = null;

    if (!('PointerEvent' in window) || !window.requestAnimationFrame) return;

    function now() {
      return window.performance && window.performance.now
        ? window.performance.now()
        : new Date().getTime();
    }

    function setPointerAppearance() {
      var showAsteroid = pointerVisible && !overTextEntry && !document.hidden;
      if (showAsteroid) document.documentElement.classList.add('asteroid-cursor-active');
      else document.documentElement.classList.remove('asteroid-cursor-active');
      if (asteroid) asteroid.style.opacity = showAsteroid ? '0.62' : '0';
      trailElements.forEach(function (dot, index) {
        dot.style.opacity = showAsteroid ? String(ASTEROID_TRAIL[index].opacity) : '0';
      });
    }

    function updateColor() {
      var color = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue('--asteroid')
        .trim();
      if (!color) return;
      if (asteroid) asteroid.style.color = color;
      if (impact) impact.style.color = color;
      trailElements.forEach(function (dot) {
        dot.style.color = color;
      });
    }

    function handlePointerMove(event) {
      if (event.pointerType === 'touch') return;
      target.x = event.clientX;
      target.y = event.clientY;
      pointerVisible = true;
      overTextEntry = isTextEntryTarget(event.target);
      overInteractive =
        event.target instanceof Element &&
        event.target.closest('button, a, [role="button"], [role="link"]') !== null;
      setPointerAppearance();
    }

    function handlePointerLeave() {
      pointerVisible = false;
      setPointerAppearance();
    }

    function handleClick(event) {
      if (!pointerVisible || event.detail === 0 || isTextEntryTarget(event.target)) return;
      impactState = { x: event.clientX, y: event.clientY, startedAt: now() };
      impact.style.opacity = '0.38';
    }

    function tick() {
      var currentTime = now();
      position.x += (target.x - position.x) * ASTEROID_LERP;
      position.y += (target.y - position.y) * ASTEROID_LERP;
      asteroid.style.transform =
        'translate3d(' +
        (position.x - ASTEROID_SIZE / 2) +
        'px,' +
        (position.y - ASTEROID_SIZE / 2) +
        'px,0) scale(' +
        (overInteractive ? 1.16 : 1) +
        ')';
      asteroidRock.style.transform = 'rotate(' + ((currentTime % 7000) / 7000) * 360 + 'deg)';

      trail.forEach(function (dot, index) {
        var leader = index === 0 ? position : trail[index - 1];
        var spec = ASTEROID_TRAIL[index];
        dot.x += (leader.x - dot.x) * spec.lerp;
        dot.y += (leader.y - dot.y) * spec.lerp;
        trailElements[index].style.transform =
          'translate3d(' + (dot.x - spec.size / 2) + 'px,' + (dot.y - spec.size / 2) + 'px,0)';
      });

      if (impactState) {
        var progress = Math.min(1, (currentTime - impactState.startedAt) / 500);
        var eased = 1 - Math.pow(1 - progress, 3);
        var scale = 0.22 + eased * 0.98;
        impact.style.opacity = String(0.38 * (1 - progress));
        impact.style.transform =
          'translate3d(' +
          (impactState.x - 20) +
          'px,' +
          (impactState.y - 20) +
          'px,0) scale(' +
          scale +
          ')';
        if (progress >= 1) impactState = null;
      }

      frame = window.requestAnimationFrame(tick);
    }

    function startFrame() {
      if (!mounted || frame || document.hidden) return;
      frame = window.requestAnimationFrame(function () {
        frame = 0;
        tick();
      });
    }

    function stopFrame() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    }

    function mount() {
      if (mounted) return;
      mounted = true;
      asteroid = makeCursorLayer(ASTEROID_SIZE);
      asteroid.setAttribute('data-asteroid-cursor', '');
      asteroidRock = makeAsteroidSvg();
      asteroid.appendChild(asteroidRock);
      document.body.appendChild(asteroid);

      ASTEROID_TRAIL.forEach(function (spec) {
        var dot = makeCursorLayer(spec.size);
        dot.setAttribute('data-asteroid-trail', '');
        dot.style.background = 'currentColor';
        dot.style.borderRadius = '50%';
        document.body.appendChild(dot);
        trailElements.push(dot);
        trail.push({ x: target.x, y: target.y });
      });

      impact = makeCursorLayer(40);
      impact.setAttribute('data-asteroid-impact', '');
      impact.appendChild(makeImpactSvg());
      document.body.appendChild(impact);
      updateColor();

      cursorStyle = document.createElement('style');
      cursorStyle.setAttribute('data-asteroid-cursor-style', '');
      cursorStyle.textContent =
        'html.asteroid-cursor-active,html.asteroid-cursor-active *{cursor:none!important}' +
        'html.asteroid-cursor-active input:not([type="button"]):not([type="checkbox"]):not([type="color"]):not([type="file"]):not([type="image"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"]),' +
        'html.asteroid-cursor-active textarea,html.asteroid-cursor-active [contenteditable="true"],html.asteroid-cursor-active [contenteditable="plaintext-only"]{cursor:text!important}';
      document.head.appendChild(cursorStyle);

      document.addEventListener('pointermove', handlePointerMove, { passive: true });
      document.addEventListener('pointerleave', handlePointerLeave);
      document.addEventListener('click', handleClick, true);
      startFrame();
    }

    function unmount() {
      if (!mounted) return;
      mounted = false;
      stopFrame();
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerleave', handlePointerLeave);
      document.removeEventListener('click', handleClick, true);
      document.documentElement.classList.remove('asteroid-cursor-active');
      if (asteroid) asteroid.remove();
      if (impact) impact.remove();
      trailElements.forEach(function (dot) {
        dot.remove();
      });
      if (cursorStyle) cursorStyle.remove();
      asteroid = null;
      asteroidRock = null;
      impact = null;
      cursorStyle = null;
      trailElements = [];
      trail = [];
      pointerVisible = false;
      impactState = null;
    }

    function updateAvailability() {
      if (prefersReducedMotion() || coarsePointer.matches) unmount();
      else mount();
    }

    function handleVisibilityChange() {
      if (!mounted) return;
      if (document.hidden) {
        stopFrame();
        pointerVisible = false;
        setPointerAppearance();
      } else {
        startFrame();
      }
    }

    updateAvailability();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('moldavite:themechange', updateColor);
    if (motionPreference.addEventListener) {
      motionPreference.addEventListener('change', updateAvailability);
      coarsePointer.addEventListener('change', updateAvailability);
    } else {
      motionPreference.addListener(updateAvailability);
      coarsePointer.addListener(updateAvailability);
    }
  }

  function setupSafely(setup) {
    try {
      setup();
    } catch (error) {
      // Atmospheric effects are enhancements; one failure must not block the page.
    }
  }

  function setupNavigation() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.nav-links');
    if (!toggle || !nav) return;

    function closeNavigation(returnFocus) {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation');
      if (returnFocus) toggle.focus();
    }

    toggle.addEventListener('click', function () {
      var willOpen = !nav.classList.contains('is-open');
      nav.classList.toggle('is-open', willOpen);
      toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      toggle.setAttribute('aria-label', willOpen ? 'Close navigation' : 'Open navigation');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) closeNavigation(false);
    });

    document.addEventListener('click', function (event) {
      if (!nav.classList.contains('is-open')) return;
      if (nav.contains(event.target) || toggle.contains(event.target)) return;
      closeNavigation(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        closeNavigation(true);
      }
    });

    var desktop = window.matchMedia('(min-width: 901px)');
    var resetAtDesktop = function (event) {
      if (event.matches) closeNavigation(false);
    };
    if (desktop.addEventListener) desktop.addEventListener('change', resetAtDesktop);
    else desktop.addListener(resetAtDesktop);
  }

  function prepareDocumentReveals() {
    document
      .querySelectorAll(
        '.docs-hero, .docs-toc, .docs-body > h2, .docs-body > .callout, .next-links'
      )
      .forEach(function (element) {
        element.classList.add('reveal');
      });
  }

  function setupReveals() {
    prepareDocumentReveals();

    document.querySelectorAll('.reveal-group').forEach(function (group) {
      Array.prototype.forEach.call(group.children, function (child, index) {
        child.style.setProperty('--i', index);
      });
    });

    var targets = document.querySelectorAll('.reveal, .reveal-group');
    if (!targets.length) return;

    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      targets.forEach(function (target) {
        target.classList.add('is-visible');
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 }
    );

    targets.forEach(function (target) {
      observer.observe(target);
    });
  }

  function pauseVideos() {
    document.querySelectorAll('video[data-autoplay]').forEach(function (video) {
      video.removeAttribute('autoplay');
      video.pause();
    });
  }

  function startVideoObserver() {
    if (videoObserver) videoObserver.disconnect();
    videoObserver = null;
    pauseVideos();

    var videos = document.querySelectorAll('video[data-autoplay]');
    if (!videos.length || prefersReducedMotion() || !('IntersectionObserver' in window)) return;

    videoObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var video = entry.target;
          video.dataset.inView = entry.isIntersecting ? 'true' : 'false';
          if (entry.isIntersecting && !document.hidden) {
            var attempt = video.play();
            if (attempt && attempt.catch) attempt.catch(function () {});
          } else {
            video.pause();
          }
        });
      },
      { rootMargin: '80px 0px', threshold: 0.22 }
    );

    videos.forEach(function (video) {
      videoObserver.observe(video);
    });
  }

  function setupVideos() {
    startVideoObserver();

    var handleMotionChange = function () {
      startVideoObserver();
      if (prefersReducedMotion()) pauseVideos();
    };

    if (motionPreference.addEventListener) {
      motionPreference.addEventListener('change', handleMotionChange);
    } else {
      motionPreference.addListener(handleMotionChange);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden || prefersReducedMotion()) {
        pauseVideos();
        return;
      }

      document
        .querySelectorAll('video[data-autoplay][data-in-view="true"]')
        .forEach(function (video) {
          var attempt = video.play();
          if (attempt && attempt.catch) attempt.catch(function () {});
        });
    });
  }

  function setupCopyButtons() {
    document.querySelectorAll('[data-copy-target]').forEach(function (button) {
      button.addEventListener('click', function () {
        var target = document.getElementById(button.getAttribute('data-copy-target'));
        if (!target) return;

        var value = target.textContent.trim();
        var original = button.textContent;

        function showResult(label) {
          button.textContent = label;
          window.setTimeout(function () {
            button.textContent = original;
          }, 1600);
        }

        function selectText() {
          var selection = window.getSelection();
          var range = document.createRange();
          range.selectNodeContents(target);
          selection.removeAllRanges();
          selection.addRange(range);
          showResult('Press Cmd+C');
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(function () {
            showResult('Copied');
          }, selectText);
          return;
        }

        selectText();
      });
    });
  }

  function text(parent, tag, className, value) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }

  function validRegistryEntry(entry) {
    return (
      entry &&
      typeof entry === 'object' &&
      typeof entry.id === 'string' &&
      /^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) &&
      typeof entry.name === 'string' &&
      entry.name.length > 0 &&
      entry.name.length <= 160 &&
      typeof entry.description === 'string' &&
      entry.description.length > 0 &&
      entry.description.length <= 1000 &&
      typeof entry.author === 'string' &&
      entry.author.length > 0 &&
      entry.author.length <= 160 &&
      typeof entry.version === 'string' &&
      entry.version.length > 0 &&
      entry.version.length <= 64 &&
      Array.isArray(entry.permissions) &&
      entry.permissions.length <= 50 &&
      entry.permissions.every(function (permission) {
        return typeof permission === 'string' && permission.length <= 128;
      }) &&
      Array.isArray(entry.allowedHosts) &&
      entry.allowedHosts.length <= 50 &&
      entry.allowedHosts.every(function (host) {
        return typeof host === 'string' && host.length <= 253;
      })
    );
  }

  function pluginCard(plugin) {
    var card = document.createElement('article');
    card.className = 'directory-card';
    card.setAttribute(
      'data-plugin-search-text',
      [plugin.name, plugin.description, plugin.author]
        .concat(plugin.permissions, plugin.allowedHosts)
        .join(' ')
        .toLowerCase()
    );

    var heading = document.createElement('div');
    heading.className = 'directory-card-heading';
    text(heading, 'h3', '', plugin.name);
    text(heading, 'span', 'directory-version', 'By ' + plugin.author);
    card.appendChild(heading);
    text(card, 'p', 'directory-description', plugin.description);

    var permissions = document.createElement('div');
    permissions.className = 'directory-permissions';
    permissions.setAttribute('aria-label', 'Permissions');
    if (plugin.permissions.length === 0) {
      text(permissions, 'span', 'directory-chip', 'No extra permissions');
    }
    plugin.permissions.forEach(function (permission) {
      text(permissions, 'span', 'directory-chip', permission);
    });
    plugin.allowedHosts.forEach(function (host) {
      text(permissions, 'span', 'directory-chip directory-host', 'host: ' + host);
    });
    card.appendChild(permissions);

    var install = document.createElement('div');
    install.className = 'directory-install';
    var installLink = text(install, 'a', 'directory-install-button', 'Install in Moldavite');
    installLink.setAttribute('href', 'moldavite://plugin/' + plugin.id);

    var hint = document.createElement('span');
    hint.appendChild(document.createTextNode('Need the app? '));
    var downloadLink = text(hint, 'a', '', 'Download Moldavite');
    downloadLink.setAttribute('href', 'https://github.com/mauropereiira/Moldavite/releases/latest');
    hint.appendChild(document.createTextNode('.'));
    install.appendChild(hint);
    card.appendChild(install);

    return card;
  }

  function loadPluginDirectory() {
    var directory = document.querySelector('[data-plugin-directory]');
    if (!directory) return;

    var status = document.querySelector('[data-registry-status]');
    var search = document.querySelector('[data-plugin-search]');
    var count = document.querySelector('[data-plugin-count]');
    var empty = document.querySelector('[data-plugin-empty]');
    var registryUrl =
      'https://raw.githubusercontent.com/mauropereiira/moldavite-plugins/main/registry.json';

    function filterDirectory() {
      var query = search ? search.value.trim().toLowerCase() : '';
      var terms = query ? query.split(/\s+/) : [];
      var cards = Array.prototype.slice.call(directory.querySelectorAll('.directory-card'));
      var visible = 0;

      cards.forEach(function (card) {
        var searchable = card.getAttribute('data-plugin-search-text') || '';
        var matches = terms.every(function (term) {
          return searchable.indexOf(term) !== -1;
        });
        card.hidden = !matches;
        if (matches) visible += 1;
      });

      if (count) {
        count.textContent = query
          ? visible + ' of ' + cards.length + ' plugins'
          : cards.length + (cards.length === 1 ? ' plugin' : ' plugins');
      }
      if (empty) empty.hidden = visible !== 0;
    }

    if (search) search.addEventListener('input', filterDirectory);
    filterDirectory();

    fetch(registryUrl, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('registry unavailable');
        return response.json();
      })
      .then(function (registry) {
        if (
          !registry ||
          registry.registryVersion !== 1 ||
          !Array.isArray(registry.plugins) ||
          registry.plugins.length > 500
        ) {
          throw new Error('unexpected registry format');
        }

        var plugins = registry.plugins.filter(validRegistryEntry);
        if (plugins.length === 0) throw new Error('no valid registry entries');

        var fragment = document.createDocumentFragment();
        plugins.forEach(function (plugin) {
          fragment.appendChild(pluginCard(plugin));
        });
        directory.replaceChildren(fragment);
        if (status) {
          status.textContent =
            'Live directory · ' + plugins.length + (plugins.length === 1 ? ' plugin' : ' plugins');
        }
        filterDirectory();
      })
      .catch(function () {
        if (status) status.textContent = 'Showing the bundled fallback directory';
      });
  }

  setupSafely(setupTheme);
  setupSafely(setupSky);
  setupSafely(setupAsteroidCursor);
  setupNavigation();
  setupReveals();
  setupVideos();
  setupCopyButtons();
  loadPluginDirectory();
})();
