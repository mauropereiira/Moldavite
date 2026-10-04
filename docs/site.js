(function () {
  'use strict';

  var THEME_KEY = 'moldavite-site-theme';
  var root = document.documentElement;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(pointer: fine)');

  function prefersReducedMotion() {
    return reducedMotion.matches;
  }

  function setupSafely(setup) {
    try {
      setup();
    } catch (error) {
      // Each piece is an enhancement; one failing must not take the page with it.
    }
  }

  function onVisible(elements, callback, options) {
    if (!('IntersectionObserver' in window)) {
      elements.forEach(callback);
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          callback(entry.target);
        });
      },
      options || { rootMargin: '0px 0px 15% 0px', threshold: 0 }
    );
    elements.forEach(function (element) {
      observer.observe(element);
    });
  }

  // Theme. Cream first, dark only when chosen; the choice is remembered and
  // the new colours spread out from the button that was pressed.
  // The site follows the system's light or dark setting. Pressing the toggle
  // records an explicit choice; choosing the system's own theme again clears
  // it, so the site goes back to following the system.
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function systemTheme() {
    return systemDark.matches ? 'dark' : 'light';
  }

  function savedTheme() {
    try {
      var value = window.localStorage.getItem(THEME_KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch (error) {
      return null;
    }
  }

  function readTheme() {
    return savedTheme() || systemTheme();
  }

  function applyTheme(theme) {
    var dark = theme === 'dark';
    if (dark) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    // Both theme-color tags (light and dark schemes) follow the theme shown,
    // so a toggled choice also colours the browser's own chrome.
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      meta.setAttribute('content', dark ? '#14120C' : '#F9F6ED');
    });
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-pressed', dark ? 'true' : 'false');
      button.setAttribute('aria-label', dark ? 'Switch to light' : 'Switch to dark');
    });
  }

  function setupTheme() {
    applyTheme(readTheme());
    var followSystem = function () {
      if (!savedTheme()) applyTheme(systemTheme());
    };
    if (systemDark.addEventListener) systemDark.addEventListener('change', followSystem);
    else systemDark.addListener(followSystem);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try {
          if (next === systemTheme()) window.localStorage.removeItem(THEME_KEY);
          else window.localStorage.setItem(THEME_KEY, next);
        } catch (error) {
          // Private modes can refuse storage; the switch still works for this visit.
        }
        if (prefersReducedMotion() || typeof document.startViewTransition !== 'function') {
          applyTheme(next);
          return;
        }
        var rect = button.getBoundingClientRect();
        root.style.setProperty('--vt-x', rect.left + rect.width / 2 + 'px');
        root.style.setProperty('--vt-y', rect.top + rect.height / 2 + 'px');
        root.classList.add('is-theming');
        var transition = document.startViewTransition(function () {
          applyTheme(next);
        });
        transition.ready.catch(function () {});
        transition.finished
          .catch(function () {})
          .then(function () {
            root.classList.remove('is-theming');
          });
      });
    });
  }

  // Header: clear over the hero, solid once the page moves.
  function setupHeader() {
    var header = document.querySelector('.site-header');
    if (!header) return;
    var hero = document.querySelector('.hero');
    var night = document.querySelector('.night-sky');
    var frame = 0;
    function update() {
      frame = 0;
      header.classList.toggle('is-solid', !hero || window.scrollY > 24);
      if (night) {
        header.classList.toggle(
          'is-night',
          night.getBoundingClientRect().top <= header.offsetHeight
        );
      }
    }
    update();
    window.addEventListener(
      'scroll',
      function () {
        if (!frame) frame = window.requestAnimationFrame(update);
      },
      { passive: true }
    );
  }

  // The small-screen menu: a sheet that opens from the header.
  function setupMenu() {
    var button = document.querySelector('.menu-button');
    var nav = document.getElementById('site-nav');
    if (!button || !nav) return;

    Array.prototype.forEach.call(nav.children, function (child, index) {
      child.style.setProperty('--i', index);
    });

    function setOpen(open, returnFocus) {
      nav.classList.toggle('is-open', open);
      root.classList.toggle('is-menu-open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (!open && returnFocus) button.focus();
    }

    button.addEventListener('click', function () {
      setOpen(!nav.classList.contains('is-open'));
    });
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) setOpen(false, true);
    });
    var wide = window.matchMedia('(min-width: 861px)');
    var reset = function (event) {
      if (event.matches) setOpen(false);
    };
    if (wide.addEventListener) wide.addEventListener('change', reset);
    else wide.addListener(reset);
  }

  // Headlines are split into words so each can rise out of its own line.
  // Screen readers get the sentence once, from a hidden copy.
  function splitWords(element, delay) {
    var text = element.textContent.trim().replace(/\s+/g, ' ');
    if (!text || element.children.length) return;
    element.textContent = '';
    var hidden = document.createElement('span');
    hidden.className = 'visually-hidden';
    hidden.textContent = text;
    var shown = document.createElement('span');
    shown.setAttribute('aria-hidden', 'true');
    text.split(' ').forEach(function (word, index, words) {
      var box = document.createElement('span');
      var inner = document.createElement('span');
      box.className = 'w';
      inner.textContent = word;
      inner.style.setProperty('--w', index);
      box.appendChild(inner);
      shown.appendChild(box);
      if (index < words.length - 1) shown.appendChild(document.createTextNode(' '));
    });
    if (delay) element.style.setProperty('--wd', delay);
    element.appendChild(hidden);
    element.appendChild(shown);
  }

  function setupEntrances() {
    var hero = document.querySelector('.hero');
    var heroTitle = hero && hero.querySelector('h1');
    var docsTitle = document.querySelector('.docs-hero h1');

    document.querySelectorAll('[data-words]').forEach(function (element) {
      if (element === heroTitle) {
        splitWords(element, '120ms');
      } else {
        // Section headings fade in with the rest of the page while scrolling.
        element.removeAttribute('data-words');
        element.setAttribute('data-reveal', '');
      }
    });

    if (docsTitle && !docsTitle.hasAttribute('data-words')) {
      splitWords(docsTitle, '80ms');
      docsTitle.setAttribute('data-words', '');
    }

    document.querySelectorAll('.docs-hero p, .docs-hero .version-badge').forEach(function (el, i) {
      el.setAttribute('data-reveal', '');
      el.style.setProperty('--i', i + 2);
    });

    // The hero plays the moment the page is ready; everything else waits
    // until it scrolls into view.
    var first = [];
    if (hero) first.push(hero, heroTitle);
    document
      .querySelectorAll('.docs-hero [data-words], .docs-hero [data-reveal]')
      .forEach(function (el) {
        first.push(el);
      });
    // A frame lets the hidden state paint first so the entrance plays; the
    // timer guarantees it even where frames are paused, like a background tab.
    var shown = false;
    function showFirst() {
      if (shown) return;
      shown = true;
      first.forEach(function (el) {
        if (el) el.classList.add('is-in');
      });
    }
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(showFirst);
    });
    window.setTimeout(showFirst, 120);

    var rest = Array.prototype.filter.call(
      document.querySelectorAll('[data-reveal], [data-words], [data-stagger]'),
      function (el) {
        return first.indexOf(el) === -1 && !el.parentElement.closest('[data-stagger]');
      }
    );
    if (prefersReducedMotion()) {
      rest.forEach(function (el) {
        el.classList.add('is-in');
      });
      return;
    }
    onVisible(rest, function (el) {
      el.classList.add('is-in');
    });
  }

  // The landscape leans a few pixels toward the pointer, near hills more than
  // far ones. Meteors cross the sky now and then while the hero is in view.
  function setupHero() {
    var hero = document.querySelector('.hero');
    if (!hero || prefersReducedMotion()) return;

    if (finePointer.matches) {
      var frame = 0;
      var target = 0;
      window.addEventListener(
        'pointermove',
        function (event) {
          target = (event.clientX / window.innerWidth - 0.5) * -8;
          if (frame) return;
          frame = window.requestAnimationFrame(function () {
            frame = 0;
            hero.style.setProperty('--mx', target.toFixed(2));
          });
        },
        { passive: true }
      );
    }

    setupMeteors(hero, 1600);
  }

  // Meteors cross a sky now and then while it is on screen: the hero and the
  // footer. Each streak is one element that removes itself when it lands.
  function setupMeteors(sky, firstDelay) {
    var inView = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
      }).observe(sky);
    }

    function meteor() {
      var streak = document.createElement('span');
      streak.className = 'meteor';
      streak.setAttribute('aria-hidden', 'true');
      streak.style.setProperty('--x', (55 + Math.random() * 38).toFixed(1) + '%');
      streak.style.setProperty('--y', (6 + Math.random() * 22).toFixed(1) + '%');
      streak.style.setProperty('--a', (148 + Math.random() * 16).toFixed(1) + 'deg');
      streak.addEventListener('animationend', function () {
        streak.remove();
      });
      sky.appendChild(streak);
    }

    function schedule(delay) {
      window.setTimeout(function () {
        if (inView && !document.hidden) meteor();
        schedule(6000 + Math.random() * 8000);
      }, delay);
    }
    schedule(firstDelay);
  }

  // The wordmarks move on the browser's scroll timeline (see styles.css);
  // this only measures where each movement starts and ends, once and again
  // on resize, and hands the numbers to CSS. Browsers without scroll
  // timelines get the same movement from a scroll listener instead.
  //   Hero: it moves down the page at under half the scroll speed, so the
  //   hills overtake it, setting fully as its top reaches the forest body.
  //   Footer: it starts just above the footer's top edge, where the footer
  //   clips it, and comes down to land as the hills come fully into view.
  function setupMarks() {
    if (prefersReducedMotion()) return;
    var heroWrap = document.querySelector('.hero .mark-wrap');
    var footer = document.querySelector('.site-footer');
    var footWrap = footer && footer.querySelector('.mark-wrap');
    if (!heroWrap && !footWrap) return;
    var timeline = window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()');
    var m = {};

    function docTop(element) {
      return element.getBoundingClientRect().top + window.scrollY;
    }

    function measure() {
      // Measure at rest: the animations are paused out of the way first.
      [heroWrap, footWrap].forEach(function (wrap) {
        if (wrap) wrap.style.animation = 'none';
        if (wrap) wrap.style.transform = '';
      });
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      if (heroWrap) {
        var hills = heroWrap.parentElement;
        var lw = Math.max(window.innerWidth, 900);
        var top = docTop(heroWrap);
        m.setBy = Math.max(1, (docTop(hills) + hills.offsetHeight - lw * 0.1 - top) / 0.45);
        m.setDepth = m.setBy * 0.45;
        heroWrap.style.setProperty('--set-by', m.setBy.toFixed(0) + 'px');
        heroWrap.style.setProperty('--set-depth', m.setDepth.toFixed(0) + 'px');
      }
      if (footWrap) {
        var land = footWrap.parentElement;
        var footerTop = docTop(footer);
        var height = footWrap.getBoundingClientRect().height;
        m.landFrom = Math.min(max - 1, Math.max(0, footerTop - window.innerHeight * 0.85));
        m.landTo = Math.min(
          max,
          Math.max(m.landFrom + 1, docTop(land) + land.offsetHeight - window.innerHeight)
        );
        m.landOffset = footerTop - height - 24 - docTop(footWrap);
        footWrap.style.setProperty('--land-from', m.landFrom.toFixed(0) + 'px');
        footWrap.style.setProperty('--land-to', m.landTo.toFixed(0) + 'px');
        footWrap.style.setProperty('--land-offset', m.landOffset.toFixed(0) + 'px');
      }
      [heroWrap, footWrap].forEach(function (wrap) {
        if (wrap) wrap.style.animation = '';
      });
    }

    function fallback() {
      var s = window.scrollY;
      if (heroWrap) {
        var p = Math.min(1, s / m.setBy);
        heroWrap.style.transform = 'translateY(' + (p * m.setDepth).toFixed(1) + 'px)';
        heroWrap.style.opacity = String(1 - Math.min(1, Math.max(0, (p - 0.45) / 0.4)));
      }
      if (footWrap) {
        var q = Math.min(1, Math.max(0, (s - m.landFrom) / (m.landTo - m.landFrom)));
        var eased = 1 - Math.pow(1 - q, 3);
        footWrap.style.transform = 'translateY(' + (m.landOffset * (1 - eased)).toFixed(1) + 'px)';
      }
    }

    measure();
    var onResize = function () {
      measure();
      if (!timeline) fallback();
    };
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('load', onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
    if (!timeline) {
      fallback();
      window.addEventListener('scroll', fallback, { passive: true });
    }
  }

  // The app window types its note. As each line finishes, it lands in the
  // Markdown file beside it, which is the whole point of the product.
  function setupTyping() {
    var note = document.querySelector('[data-typing]');
    var file = document.querySelector('[data-file]');
    var saved = document.querySelector('[data-saved]');
    if (!note || !file || prefersReducedMotion() || !('IntersectionObserver' in window)) return;

    var blocks = Array.prototype.map.call(note.querySelectorAll('[data-t]'), function (block) {
      var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      var nodes = [];
      while (walker.nextNode())
        nodes.push({ node: walker.currentNode, text: walker.currentNode.nodeValue });
      nodes.forEach(function (item) {
        item.node.nodeValue = '';
      });
      block.setAttribute('data-pending', '');
      var lines = (block.getAttribute('data-l') || '').split(',').filter(Boolean);
      return { el: block, nodes: nodes, lines: lines };
    });
    var lines = {};
    file.querySelectorAll('[data-l]').forEach(function (line) {
      lines[line.getAttribute('data-l')] = line;
      line.hidden = true;
    });

    var caret = document.createElement('span');
    caret.className = 'caret';
    note.querySelector('[data-t]').appendChild(caret);

    var savedTimer = 0;
    function save(block) {
      block.lines.forEach(function (key) {
        var line = lines[key];
        if (!line) return;
        line.hidden = false;
        line.classList.add('is-new');
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            line.classList.remove('is-new');
          });
        });
      });
      if (saved && block.lines.length) {
        saved.classList.add('is-on');
        window.clearTimeout(savedTimer);
        savedTimer = window.setTimeout(function () {
          saved.classList.remove('is-on');
        }, 900);
      }
    }

    function typeBlock(b, n, c) {
      if (b >= blocks.length) return;
      var block = blocks[b];
      block.el.removeAttribute('data-pending');
      if (n >= block.nodes.length) {
        save(block);
        window.setTimeout(function () {
          typeBlock(b + 1, 0, 0);
        }, 380);
        return;
      }
      var item = block.nodes[n];
      if (c === 0) item.node.parentNode.insertBefore(caret, item.node.nextSibling);
      if (c >= item.text.length) {
        typeBlock(b, n + 1, 0);
        return;
      }
      var ch = item.text.charAt(c);
      item.node.nodeValue += ch;
      var delay = 18 + Math.random() * 34;
      if (/[.,:]/.test(ch)) delay += 160;
      window.setTimeout(function () {
        typeBlock(b, n, c + 1);
      }, delay);
    }

    onVisible(
      [note],
      function () {
        window.setTimeout(function () {
          typeBlock(0, 0, 0);
        }, 500);
      },
      { threshold: 0.4 }
    );
  }

  // The write switch in the AI diagram: flip it and the write tools come on,
  // the way they do in Settings.
  function setupSwitch() {
    var toggle = document.querySelector('[data-switch]');
    var diagram = document.querySelector('[data-diagram]');
    var state = document.querySelector('[data-write-state]');
    if (!toggle || !diagram) return;
    toggle.addEventListener('click', function () {
      var on = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', on ? 'true' : 'false');
      diagram.classList.toggle('writes-on', on);
      if (state) state.textContent = on ? 'on, you allowed it' : 'off by default';
    });
  }

  // Name the download after the visitor's system, and point iPhone and iPad
  // at the App Store.
  function detectPlatform() {
    var ua = navigator.userAgent || '';
    var platform = navigator.platform || '';
    if (/iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      return 'ios';
    }
    if (/Android/.test(ua)) return 'android';
    if (/Win/.test(platform) || /Windows/.test(ua)) return 'windows';
    if (/Mac/.test(platform)) return 'mac';
    if (/Linux/.test(platform) || /Linux/.test(ua)) return 'linux';
    return '';
  }

  function setupPlatform() {
    var system = detectPlatform();
    var names = {
      mac: 'Download for Mac',
      windows: 'Download for Windows',
      linux: 'Download for Linux',
    };
    document.querySelectorAll('[data-download]').forEach(function (link) {
      var label = link.querySelector('[data-download-label]');
      if (system === 'ios') {
        link.href = 'https://apps.apple.com/app/id6809157286';
        if (label) label.textContent = 'Get it on the App Store';
      } else if (system === 'android') {
        link.href = '#get';
      } else if (names[system] && label) {
        label.textContent = names[system];
      }
    });
    var card = document.querySelector('[data-platform="' + system + '"]');
    if (card) card.classList.add('is-yours');
  }

  function setupCopy() {
    document.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var target = document.getElementById(button.getAttribute('data-copy'));
        if (!target) return;
        var value = target.textContent.trim();
        var original = button.textContent;
        function show(label) {
          button.textContent = label;
          button.classList.add('is-done');
          window.setTimeout(function () {
            button.textContent = original;
            button.classList.remove('is-done');
          }, 1600);
        }
        function select() {
          var range = document.createRange();
          range.selectNodeContents(target);
          var selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          show('Press Cmd+C');
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(function () {
            show('Copied');
          }, select);
        } else {
          select();
        }
      });
    });
  }

  // The contents list follows the section you are reading.
  function setupContents() {
    var toc = document.querySelector('.docs-toc');
    if (!toc) return;
    var links = {};
    toc.querySelectorAll('a[href^="#"]').forEach(function (link) {
      links[link.getAttribute('href').slice(1)] = link;
    });
    var headings = Array.prototype.filter.call(
      document.querySelectorAll('.docs-content h2[id]'),
      function (heading) {
        return links[heading.id];
      }
    );
    if (!headings.length) return;
    var active = null;
    var frame = 0;
    function update() {
      frame = 0;
      var line = window.innerHeight * 0.3;
      var current = headings[0];
      headings.forEach(function (heading) {
        if (heading.getBoundingClientRect().top <= line) current = heading;
      });
      var link = links[current.id];
      if (link === active) return;
      if (active) active.classList.remove('is-active');
      active = link;
      link.classList.add('is-active');
    }
    window.addEventListener(
      'scroll',
      function () {
        if (!frame) frame = window.requestAnimationFrame(update);
      },
      { passive: true }
    );
    update();
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

  function isMobileInstallOs() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
    return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  }

  function replaceMobileInstallLinks(root) {
    if (!isMobileInstallOs()) return;
    root.querySelectorAll('.directory-install-button').forEach(function (link) {
      var note = document.createElement('span');
      note.textContent = 'Install from Moldavite on a Mac, Windows or Linux computer.';
      link.replaceWith(note);
    });
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

    replaceMobileInstallLinks(directory);

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
        replaceMobileInstallLinks(directory);
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

  // Skies off screen pause their twinkle, so nothing animates out of sight.
  function setupSkyPause() {
    if (!('IntersectionObserver' in window)) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('is-away', !entry.isIntersecting);
      });
    });
    document.querySelectorAll('.sky').forEach(function (sky) {
      observer.observe(sky);
    });
  }

  setupSafely(setupTheme);
  setupSafely(setupSkyPause);
  setupSafely(setupHeader);
  setupSafely(setupMenu);
  setupSafely(setupEntrances);
  setupSafely(setupHero);
  setupSafely(setupMarks);
  setupSafely(function () {
    var footer = document.querySelector('.site-footer');
    if (footer && !prefersReducedMotion()) setupMeteors(footer, 3000);
  });
  setupSafely(setupTyping);
  setupSafely(setupSwitch);
  setupSafely(setupPlatform);
  setupSafely(setupCopy);
  setupSafely(setupContents);
  setupSafely(loadPluginDirectory);
})();
