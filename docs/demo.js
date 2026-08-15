(function () {
  'use strict';

  var safeFilenameCharacters;

  try {
    safeFilenameCharacters = new RegExp('[^\\p{Alphabetic}\\p{N}-]', 'gu');
  } catch (error) {
    safeFilenameCharacters = /[^a-z0-9-]/g;
  }

  function noteFilename(title) {
    var normalized = title;

    if (typeof normalized.normalize === 'function') {
      try {
        normalized = normalized.normalize('NFC');
      } catch (error) {}
    }

    var slug = normalized
      .replace(/\.md$/, '')
      .toLowerCase()
      .replace(/^\s+|\s+$/g, '')
      .replace(/\s+/g, '-')
      .replace(safeFilenameCharacters, '');

    if (!slug || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)) {
      slug = 'untitled';
    }

    return slug + '.md';
  }

  function cleanUpDownload(anchor, urlApi, objectUrl) {
    try {
      if (anchor && anchor.parentNode) anchor.parentNode.removeChild(anchor);
    } catch (error) {}

    try {
      if (urlApi && objectUrl) urlApi.revokeObjectURL(objectUrl);
    } catch (error) {}
  }

  function setupDemo() {
    var demo = document.querySelector('[data-demo]');
    if (!demo) return;

    var title = demo.querySelector('[data-demo-title]');
    var body = demo.querySelector('[data-demo-body]');
    var filename = demo.querySelector('[data-demo-filename]');
    var download = demo.querySelector('[data-demo-download]');
    var feedbackTimer = null;

    if (!title || !body || !filename || !download) return;

    var originalDownloadLabel = download.textContent;

    function updateFilename() {
      filename.textContent = noteFilename(title.value);
    }

    function confirmDownload() {
      if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
      download.textContent = 'Downloaded';
      feedbackTimer = window.setTimeout(function () {
        download.textContent = originalDownloadLabel;
        feedbackTimer = null;
      }, 2000);
    }

    title.addEventListener('input', updateFilename);
    download.setAttribute('aria-live', 'polite');
    download.setAttribute('aria-atomic', 'true');
    download.addEventListener('click', function () {
      var anchor = null;
      var objectUrl = null;
      var urlApi = window.URL || window.webkitURL;

      try {
        if (!urlApi || typeof urlApi.createObjectURL !== 'function') return;

        var currentFilename = noteFilename(title.value);
        var note = new Blob([body.value], { type: 'text/markdown;charset=utf-8' });

        filename.textContent = currentFilename;
        objectUrl = urlApi.createObjectURL(note);
        anchor = document.createElement('a');
        anchor.setAttribute('download', currentFilename);
        anchor.setAttribute('href', objectUrl);
        anchor.setAttribute('aria-hidden', 'true');
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
        confirmDownload();

        window.setTimeout(function () {
          cleanUpDownload(anchor, urlApi, objectUrl);
        }, 0);
      } catch (error) {
        cleanUpDownload(anchor, urlApi, objectUrl);
      }
    });

    updateFilename();
  }

  setupDemo();
})();
