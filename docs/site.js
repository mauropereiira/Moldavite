/* Shared progressive enhancement for the self-contained GitHub Pages site. */
(function () {
  'use strict';

  var motion = window.matchMedia('(prefers-reduced-motion: no-preference)');

  function setupNavigation() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  function splitWords(element) {
    var label = (element.textContent || '').replace(/\s+/g, ' ').trim();
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    var textNodes = [];
    var current = walker.nextNode();
    var wordIndex = 0;

    while (current) {
      textNodes.push(current);
      current = walker.nextNode();
    }

    textNodes.forEach(function (node) {
      if (!node.nodeValue || !/\S/.test(node.nodeValue)) return;
      var fragment = document.createDocumentFragment();
      node.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          fragment.appendChild(document.createTextNode(part));
          return;
        }
        var word = document.createElement('span');
        word.className = 'blur-word';
        word.style.setProperty('--word-delay', wordIndex * 100 + 'ms');
        word.setAttribute('aria-hidden', 'true');
        word.textContent = part;
        fragment.appendChild(word);
        wordIndex += 1;
      });
      node.parentNode.replaceChild(fragment, node);
    });

    if (label) element.setAttribute('aria-label', label);
    element.classList.add('blur-text-ready');
  }

  function setupBlurText() {
    if (!motion.matches) return;

    var heroTitle = document.getElementById('hero-title');
    if (heroTitle) splitWords(heroTitle);

    var sectionTitles = document.querySelectorAll('.landing-section .section-title');
    sectionTitles.forEach(function (title) {
      splitWords(title);
    });

    if (!('IntersectionObserver' in window)) {
      sectionTitles.forEach(function (title) {
        title.classList.add('is-blur-visible');
      });
      return;
    }

    var titleObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-blur-visible');
          titleObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.1 }
    );
    sectionTitles.forEach(function (title) {
      titleObserver.observe(title);
    });
  }

  function setupReveals() {
    if (!motion.matches) return;
    var sections = document.querySelectorAll(
      '.landing-section, .docs-body > h2, .docs-body > .callout, .docs-body > .method-list, .plugin-directory'
    );
    sections.forEach(function (section) {
      section.classList.add('section-reveal');
    });

    var targets = document.querySelectorAll('.reveal, .reveal-group, .section-reveal');
    if (!('IntersectionObserver' in window)) {
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
      { rootMargin: '0px 0px -7% 0px', threshold: 0.06 }
    );
    targets.forEach(function (target) {
      observer.observe(target);
    });
  }

  function setupCopyButtons() {
    document.querySelectorAll('[data-copy-target]').forEach(function (button) {
      button.addEventListener('click', function () {
        var target = document.getElementById(button.getAttribute('data-copy-target'));
        if (!target) return;
        var selectCommand = function () {
          var selection = window.getSelection();
          if (selection) selection.selectAllChildren(target);
        };
        var showCopied = function () {
          var previous = button.textContent;
          button.textContent = 'Copied';
          window.setTimeout(function () {
            button.textContent = previous;
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(target.textContent || '')
            .then(showCopied)
            .catch(selectCommand);
        } else {
          selectCommand();
        }
      });
    });
  }

  function setupMineralField() {
    if (!motion.matches) return;
    var canvas = document.createElement('canvas');
    canvas.className = 'mineral-field';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    var context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      canvas.remove();
      return;
    }

    var width = 0;
    var height = 0;
    var ratio = 1;
    var shards = [];
    var frame = 0;
    var lastDraw = 0;

    function newShard(index) {
      var points = 4 + (index % 3);
      var shape = [];
      for (var point = 0; point < points; point += 1) {
        var angle = (Math.PI * 2 * point) / points;
        var radius = 0.58 + ((index * 17 + point * 11) % 34) / 100;
        shape.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        size: 7 + Math.random() * 18,
        vx: -1.5 + Math.random() * 3,
        vy: 2 + Math.random() * 4,
        angle: Math.random() * Math.PI,
        spin: -0.025 + Math.random() * 0.05,
        alpha: 0.05 + Math.random() * 0.1,
        shape: shape,
      };
    }

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      var count = width < 700 ? 9 : 15;
      shards = Array.from({ length: count }, function (_, index) {
        return newShard(index);
      });
    }

    function draw(timestamp) {
      frame = window.requestAnimationFrame(draw);
      if (timestamp - lastDraw < 42) return;
      var elapsed = Math.min((timestamp - lastDraw) / 1000 || 0, 0.1);
      lastDraw = timestamp;
      context.clearRect(0, 0, width, height);
      shards.forEach(function (shard) {
        shard.x += shard.vx * elapsed;
        shard.y += shard.vy * elapsed;
        shard.angle += shard.spin * elapsed;
        if (shard.y - shard.size > height) shard.y = -shard.size;
        if (shard.x + shard.size < 0) shard.x = width + shard.size;
        if (shard.x - shard.size > width) shard.x = -shard.size;

        context.save();
        context.translate(shard.x, shard.y);
        context.rotate(shard.angle);
        context.beginPath();
        shard.shape.forEach(function (point, index) {
          var x = point[0] * shard.size;
          var y = point[1] * shard.size;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.closePath();
        context.fillStyle = 'rgba(121, 206, 149, ' + shard.alpha + ')';
        context.strokeStyle = 'rgba(210, 186, 120, ' + shard.alpha * 0.55 + ')';
        context.lineWidth = 0.7;
        context.fill();
        context.stroke();
        context.restore();
      });
    }

    function start() {
      if (frame || document.hidden || !motion.matches) return;
      canvas.hidden = false;
      lastDraw = performance.now();
      frame = window.requestAnimationFrame(draw);
    }

    function stop() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    }

    resize();
    start();
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else start();
    });
    var handleMotionChange = function () {
      if (motion.matches) start();
      else {
        stop();
        canvas.hidden = true;
      }
    };
    if (motion.addEventListener) motion.addEventListener('change', handleMotionChange);
    else motion.addListener(handleMotionChange);
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
    text(heading, 'span', 'directory-version', 'v' + plugin.version + ' · ' + plugin.author);
    card.appendChild(heading);
    text(card, 'p', 'directory-description', plugin.description);

    var permissions = document.createElement('div');
    permissions.className = 'directory-permissions';
    permissions.setAttribute('aria-label', 'Permissions');
    if (plugin.permissions.length === 0)
      text(permissions, 'span', 'directory-chip', 'No extra permissions');
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
    hint.appendChild(document.createTextNode('App not installed? '));
    var downloadLink = text(hint, 'a', '', 'Download here');
    downloadLink.setAttribute('href', 'index.html');
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
        if (status) status.textContent = 'Live directory · ' + plugins.length + ' plugins';
        filterDirectory();
      })
      .catch(function () {
        if (status) status.textContent = 'Showing the bundled fallback directory';
      });
  }

  setupNavigation();
  setupBlurText();
  setupReveals();
  setupCopyButtons();
  setupMineralField();
  loadPluginDirectory();
})();
