(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function prefersReducedMotion() {
    return reduceMotion.matches;
  }

  /* ---------------------------------------------------------------------
     Navigation
     --------------------------------------------------------------------- */

  function setupNavigation() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.nav-links');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.tagName === 'A') {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------------------------------------------------------------------
     Scroll reveals
     --------------------------------------------------------------------- */

  function setupReveals() {
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
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
    );

    targets.forEach(function (target) {
      observer.observe(target);
    });
  }

  /* ---------------------------------------------------------------------
     Video: only play what is on screen, and never autoplay under
     reduced-motion — the poster frame carries the meaning instead.
     --------------------------------------------------------------------- */

  function setupVideos() {
    var videos = document.querySelectorAll('video[data-autoplay]');
    if (!videos.length) return;

    if (prefersReducedMotion()) {
      videos.forEach(function (video) {
        video.removeAttribute('autoplay');
        video.pause();
      });
      return;
    }

    if (!('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var video = entry.target;
          if (entry.isIntersecting) {
            var attempt = video.play();
            if (attempt && attempt.catch) attempt.catch(function () {});
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.2 }
    );

    videos.forEach(function (video) {
      observer.observe(video);
    });
  }

  /* ---------------------------------------------------------------------
     Signature: one note, two truths.

     The rich editor and the plain Markdown file are the same note. On first
     view the panel plays that argument through once by itself, then hands
     control to the reader.
     --------------------------------------------------------------------- */

  function setupDuality() {
    var root = document.querySelector('[data-duality]');
    if (!root) return;

    var tabs = Array.prototype.slice.call(root.querySelectorAll('.duality-tab'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('.duality-panel'));
    var path = root.querySelector('.duality-path');
    if (!tabs.length || !panels.length) return;

    var timers = [];
    var autoplayed = false;

    function show(name) {
      tabs.forEach(function (tab) {
        tab.setAttribute('aria-selected', tab.dataset.view === name ? 'true' : 'false');
      });
      panels.forEach(function (panel) {
        panel.dataset.active = panel.dataset.view === name ? 'true' : 'false';
      });
      var active = tabs.filter(function (tab) {
        return tab.dataset.view === name;
      })[0];
      if (path && active && active.dataset.path) path.textContent = active.dataset.path;
    }

    function cancelAutoplay() {
      timers.forEach(clearTimeout);
      timers = [];
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        cancelAutoplay();
        show(tab.dataset.view);
      });
    });

    root.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      var current = tabs.findIndex(function (tab) {
        return tab.getAttribute('aria-selected') === 'true';
      });
      var next = event.key === 'ArrowRight' ? current + 1 : current - 1;
      if (next < 0) next = tabs.length - 1;
      if (next >= tabs.length) next = 0;
      cancelAutoplay();
      show(tabs[next].dataset.view);
      tabs[next].focus();
      event.preventDefault();
    });

    show(root.dataset.defaultView || tabs[0].dataset.view);

    // The autoplay sequence only makes sense once both panels have something
    // to show; opt out until the editor recording is in place.
    if (root.dataset.autoplay === 'off') return;
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || autoplayed) return;
          autoplayed = true;
          observer.disconnect();
          timers.push(
            setTimeout(function () {
              show('source');
            }, 2200)
          );
          timers.push(
            setTimeout(function () {
              show('editor');
            }, 5400)
          );
        });
      },
      { threshold: 0.45 }
    );

    observer.observe(root);
  }

  /* ---------------------------------------------------------------------
     Copy buttons
     --------------------------------------------------------------------- */

  function setupCopyButtons() {
    document.querySelectorAll('[data-copy-target]').forEach(function (button) {
      button.addEventListener('click', function () {
        var target = document.getElementById(button.getAttribute('data-copy-target'));
        if (!target) return;
        var value = target.textContent;
        var original = button.textContent;

        function done(label) {
          button.textContent = label;
          setTimeout(function () {
            button.textContent = original;
          }, 1600);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(
            function () {
              done('Copied');
            },
            function () {
              done('Press ⌘C');
            }
          );
          return;
        }

        var selection = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
        done('Press ⌘C');
      });
    });
  }

  /* ---------------------------------------------------------------------
     Plugin directory — the registry URL is pinned, every entry is validated
     before it is rendered, and a failed fetch falls back to the static
     markup already in the page.
     --------------------------------------------------------------------- */

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
  setupReveals();
  setupVideos();
  setupDuality();
  setupCopyButtons();
  loadPluginDirectory();
})();
