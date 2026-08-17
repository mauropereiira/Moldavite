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

/** @param {(message: object) => object | null} reply — null means "never answers". */
function stubBrowser(reply, { connectThrows = false } = {}) {
  const port = {
    messageListeners: [],
    disconnectListeners: [],
    onMessage: { addListener: (fn) => port.messageListeners.push(fn) },
    onDisconnect: { addListener: (fn) => port.disconnectListeners.push(fn) },
    disconnect: () => {},
    postMessage: (message) => {
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
    scripting: { executeScript: async () => [{ result: {} }] },
  });
}

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
});
