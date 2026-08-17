/**
 * The popup is the whole extension: it owns the Forge dropdown, the conversion,
 * and the native-messaging port. No background service worker — a clip finishes
 * inside a single click, and an MV3 worker would add a lifecycle for nothing.
 */

import { htmlToMarkdown } from './convert.js';

const HOST = 'com.moldavite.clipper';
/** Above this the host would refuse it anyway; failing here says something useful. */
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const NOT_CONNECTED =
  "Moldavite isn't connected yet — open Settings → Plugins and press Connect browser.";

const api = globalThis.browser ?? globalThis.chrome;
const forgeSelect = document.getElementById('forge');
const clipButton = document.getElementById('clip');
const statusLine = document.getElementById('status');

const say = (message) => {
  statusLine.textContent = message;
};

/**
 * One request per connection. Native-messaging ports are cheap, and a fresh one
 * means a failed clip cannot leave state behind that poisons the next.
 */
function ask(message) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = api.runtime.connectNative(HOST);
    } catch {
      reject(new Error(NOT_CONNECTED));
      return;
    }

    let settled = false;
    port.onMessage.addListener((response) => {
      settled = true;
      port.disconnect();
      if (response?.ok) {
        resolve(response);
      } else {
        reject(new Error(response?.error ?? 'Moldavite could not complete that.'));
      }
    });
    // Fires when the host is missing, exits, or we disconnected after a reply.
    port.onDisconnect.addListener(() => {
      if (!settled) reject(new Error(NOT_CONNECTED));
    });

    port.postMessage(message);
  });
}

async function loadForges() {
  const { forges, active } = await ask({ op: 'forges' });
  forgeSelect.replaceChildren(
    ...forges.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === active;
      return option;
    })
  );
  clipButton.disabled = forges.length === 0;
  if (forges.length === 0) say('No Forges found.');
}

async function clip() {
  clipButton.disabled = true;
  say('Clipping…');
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await api.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    const markdown = htmlToMarkdown(result.html, result.url);
    if (new Blob([markdown]).size > MAX_MARKDOWN_BYTES) {
      throw new Error('This page is too large to clip.');
    }

    const { path } = await ask({
      op: 'clip',
      forge: forgeSelect.value,
      title: result.title,
      url: result.url,
      markdown,
    });
    say(`Saved to ${path}`);
  } catch (error) {
    say(error.message);
  } finally {
    clipButton.disabled = false;
  }
}

clipButton.addEventListener('click', () => void clip());
loadForges().catch((error) => {
  clipButton.disabled = true;
  say(error.message);
});
