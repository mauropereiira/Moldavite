import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The popup talks to the host through a native-messaging port, so these tests
 * stand a fake port in its place. The paths that matter are the unhappy ones:
 * an unpaired browser is the first thing most people will hit.
 */

const dom = () => {
  document.body.innerHTML = `
    <select id="forge"></select>
    <button id="clip"></button>
    <p id="status"></p>`;
};

/**
 * @param {(message: object) => object | null} reply — null means "never answers".
 * @returns {object[]} every message the popup sent, in order.
 */
function stubBrowser(reply, { connectThrows = false, injection = { result: {} } } = {}) {
  const sent = [];
  const port = {
    messageListeners: [],
    disconnectListeners: [],
    onMessage: { addListener: (fn) => port.messageListeners.push(fn) },
    onDisconnect: { addListener: (fn) => port.disconnectListeners.push(fn) },
    disconnect: () => {},
    postMessage: (message) => {
      sent.push(message);
      const response = reply(message);
      if (response === null) {
        port.disconnectListeners.forEach((fn) => fn());
        return;
      }
      port.messageListeners.forEach((fn) => fn(response));
    },
  };

  vi.stubGlobal('chrome', {
    runtime: {
      connectNative: () => {
        if (connectThrows) throw new Error('no such host');
        return port;
      },
    },
    tabs: { query: async () => [{ id: 1 }] },
    scripting: { executeScript: async () => [injection] },
  });
  return sent;
}

const forgesThen = (clipReply) => (message) =>
  message.op === 'forges' ? { ok: true, forges: ['Default', 'Work'], active: 'Work' } : clipReply;

const clickClip = async () => {
  document.getElementById('clip').click();
  await settle();
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const status = () => document.getElementById('status').textContent;

describe('popup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    dom();
  });

  it('populates the dropdown and preselects the active Forge', async () => {
    stubBrowser(() => ({ ok: true, forges: ['Default', 'Work'], active: 'Work' }));

    await import('../src/popup.js');
    await settle();

    const select = document.getElementById('forge');
    expect([...select.options].map((option) => option.value)).toEqual(['Default', 'Work']);
    expect(select.value).toBe('Work');
    expect(document.getElementById('clip').disabled).toBe(false);
  });

  it('says how to pair when the host is not installed', async () => {
    stubBrowser(() => ({}), { connectThrows: true });

    await import('../src/popup.js');
    await settle();

    expect(status()).toMatch(/Settings → Plugins/);
    expect(document.getElementById('clip').disabled).toBe(true);
  });

  it('says the same thing when the port closes without answering', async () => {
    stubBrowser(() => null);

    await import('../src/popup.js');
    await settle();

    expect(status()).toMatch(/Settings → Plugins/);
  });

  it('surfaces the error text the host sent rather than a generic failure', async () => {
    stubBrowser(() => ({ ok: false, error: "Forge 'Work' does not exist" }));

    await import('../src/popup.js');
    await settle();

    expect(status()).toBe("Forge 'Work' does not exist");
  });

  it('sends the converted page and reports where it landed', async () => {
    const sent = stubBrowser(forgesThen({ ok: true, path: 'notes/Clippings/How TLS works.md' }), {
      injection: {
        result: {
          html: '<html><body><p>First paragraph.</p></body></html>',
          url: 'https://example.com/tls',
          title: 'How TLS works',
        },
      },
    });

    await import('../src/popup.js');
    await settle();
    await clickClip();

    expect(sent[1]).toEqual({
      op: 'clip',
      forge: 'Work',
      title: 'How TLS works',
      url: 'https://example.com/tls',
      markdown: 'First paragraph.',
    });
    expect(status()).toBe('Saved to notes/Clippings/How TLS works.md');
  });

  it('says the page could not be read rather than clipping an empty injection result', async () => {
    const sent = stubBrowser(forgesThen({ ok: true, path: 'notes/Clippings/whatever.md' }));

    await import('../src/popup.js');
    await settle();
    await clickClip();

    expect(status()).toBe('Moldavite could not read this page.');
    expect(sent.map((message) => message.op)).toEqual(['forges']);
  });

  it('stops a page that converts to nothing before it reaches the host', async () => {
    const sent = stubBrowser(forgesThen({ ok: false, error: 'markdown is required' }), {
      injection: {
        result: {
          html: '<html><body><img src="/a.png"><img src="/b.png"></body></html>',
          url: 'https://example.com/gallery',
          title: 'Gallery',
        },
      },
    });

    await import('../src/popup.js');
    await settle();
    await clickClip();

    expect(status()).toBe('There is nothing to clip on this page.');
    expect(sent.map((message) => message.op)).toEqual(['forges']);
  });
});
