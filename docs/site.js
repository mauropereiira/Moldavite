(function () {
  'use strict';

  var motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  var videoObserver = null;

  function prefersReducedMotion() {
    return motionPreference.matches;
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
      .querySelectorAll('.docs-hero, .docs-toc, .docs-body > h2, .docs-body > .callout, .next-links')
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

      document.querySelectorAll('video[data-autoplay][data-in-view="true"]').forEach(function (video) {
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
          navigator.clipboard.writeText(value).then(
            function () {
              showResult('Copied');
            },
            selectText
          );
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
    downloadLink.setAttribute(
      'href',
      'https://github.com/mauropereiira/Moldavite/releases/latest'
    );
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
            'Live directory · ' +
            plugins.length +
            (plugins.length === 1 ? ' plugin' : ' plugins');
        }
        filterDirectory();
      })
      .catch(function () {
        if (status) status.textContent = 'Showing the bundled fallback directory';
      });
  }

  setupNavigation();
  setupReveals();
  setupVideos();
  setupCopyButtons();
  loadPluginDirectory();
})();
