/**
 * Worker sandbox hardening coverage.
 *
 * The real scope cannot be hardened inside the test runner (it would delete the
 * runner's own globals), so these tests run the same routine against a scope
 * shaped like a browser's: capabilities live on the prototype chain, and only a
 * few things are own properties of the global.
 */

import { describe, expect, it } from 'vitest';
import type { PluginAPI } from './types';
import { buildPluginAPI, hardenGlobalScope } from './pluginWorker';

/** Defined on WorkerGlobalScope.prototype in browsers, never on the scope itself. */
const PROTOTYPE_CAPABILITIES = [
  'fetch',
  'importScripts',
  'caches',
  'indexedDB',
  'location',
  'close',
  'reportError',
];

/** Own properties of the worker global in browsers. */
const CONSTRUCTOR_CAPABILITIES = [
  'Worker',
  'SharedWorker',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'BroadcastChannel',
  'Notification',
  'Request',
  'Response',
  'Headers',
  'SharedArrayBuffer',
  'Atomics',
  // Stands in for an API a future browser adds: the allowlist must deny it
  // without anyone updating this file.
  'FutureTransportAPI',
];

/** Globals the bootstrap and the documented plugin API depend on. */
const REQUIRED_GLOBALS = [
  'Object',
  'Array',
  'JSON',
  'Promise',
  'Math',
  'Date',
  'RegExp',
  'Map',
  'Set',
  'Symbol',
  'Error',
  'URL',
  'URLSearchParams',
  'Blob',
  'TextEncoder',
  'TextDecoder',
  'structuredClone',
  'crypto',
  'atob',
  'btoa',
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'queueMicrotask',
  'performance',
  'eval',
  'parseInt',
];

type Scope = Record<string, unknown>;

function createWorkerScope(): Scope {
  const eventTargetPrototype = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
  const workerGlobalScopePrototype = Object.create(eventTargetPrototype) as Scope;
  for (const name of [...PROTOTYPE_CAPABILITIES, 'postMessage', 'onmessage']) {
    Object.defineProperty(workerGlobalScopePrototype, name, {
      value: () => name,
      configurable: true,
      writable: true,
    });
  }

  const scope = Object.create(workerGlobalScopePrototype) as Scope;
  Object.defineProperty(workerGlobalScopePrototype, 'self', {
    get: () => scope,
    configurable: true,
  });
  Object.defineProperty(workerGlobalScopePrototype, 'navigator', {
    value: {
      userAgent: 'Moldavite/test',
      language: 'en-GB',
      languages: ['en-GB', 'en'],
      hardwareConcurrency: 8,
      sendBeacon: () => true,
      storage: {},
      locks: {},
    },
    configurable: true,
    writable: true,
  });
  for (const name of [...CONSTRUCTOR_CAPABILITIES, ...REQUIRED_GLOBALS]) {
    scope[name] = name;
  }
  return scope;
}

describe('hardenGlobalScope', () => {
  it.each([...PROTOTYPE_CAPABILITIES, ...CONSTRUCTOR_CAPABILITIES])(
    'makes %s unreachable',
    (name) => {
      const scope = createWorkerScope();
      expect(scope[name]).toBeDefined();
      hardenGlobalScope(scope);
      expect(scope[name]).toBeUndefined();
    }
  );

  it('removes prototype-defined capabilities from the prototype itself', () => {
    const scope = createWorkerScope();
    hardenGlobalScope(scope);
    // `delete scope.fetch` alone is a silent no-op for prototype properties, so
    // a scope-only sweep would leave the network wide open.
    for (const name of PROTOTYPE_CAPABILITIES) {
      expect(name in scope).toBe(false);
    }
  });

  it('denies an unlisted global by default', () => {
    const scope = createWorkerScope();
    scope.SomeBrandNewCapability = () => 'reachable';
    hardenGlobalScope(scope);
    expect(scope.SomeBrandNewCapability).toBeUndefined();
  });

  it.each(REQUIRED_GLOBALS)('keeps %s available to plugin code', (name) => {
    const scope = createWorkerScope();
    hardenGlobalScope(scope);
    expect(scope[name]).toBe(name);
  });

  it('keeps the RPC channel the worker bootstrap needs', () => {
    const scope = createWorkerScope();
    hardenGlobalScope(scope);
    expect(scope.self).toBe(scope);
    expect(typeof scope.postMessage).toBe('function');
    expect(typeof scope.addEventListener).toBe('function');
    expect(typeof scope.removeEventListener).toBe('function');
  });

  it('replaces navigator with a frozen snapshot that cannot reach the network', () => {
    const scope = createWorkerScope();
    hardenGlobalScope(scope);
    const navigator = scope.navigator as Record<string, unknown>;
    expect(navigator.sendBeacon).toBeUndefined();
    expect(navigator.storage).toBeUndefined();
    expect(navigator.locks).toBeUndefined();
    expect(navigator.userAgent).toBe('Moldavite/test');
    expect(navigator.language).toBe('en-GB');
    expect(Object.isFrozen(navigator)).toBe(true);
  });

  it('strips sendBeacon in place when navigator itself cannot be replaced', () => {
    const scope = createWorkerScope();
    const platformNavigator = { userAgent: 'locked', sendBeacon: () => true };
    Object.defineProperty(scope, 'navigator', {
      value: platformNavigator,
      configurable: false,
      writable: false,
    });
    hardenGlobalScope(scope);
    expect(scope.navigator).toBe(platformNavigator);
    expect(platformNavigator.sendBeacon).toBeUndefined();
  });

  it('shadows a capability that refuses to be deleted', () => {
    const scope = createWorkerScope();
    Object.defineProperty(scope, 'fetch', {
      value: () => 'reachable',
      configurable: false,
      writable: true,
    });
    hardenGlobalScope(scope);
    expect(scope.fetch).toBeUndefined();
  });

  it('leaves a scope that is already minimal untouched', () => {
    const scope = createWorkerScope();
    hardenGlobalScope(scope);
    expect(() => hardenGlobalScope(scope)).not.toThrow();
    expect(scope.Object).toBe('Object');
  });
});

describe('worker-side permission checks', () => {
  it('rejects commands.add before registering when commands was not declared', () => {
    const api = buildPluginAPI('demo', [], '2.1.1', 2) as unknown as PluginAPI;
    expect(() =>
      api.commands.add({ id: 'verify', label: 'Verify password', handler() {} })
    ).toThrow(/commands/);
  });

  it('rejects ui.prompt before calling the host when ui was not declared', async () => {
    const api = buildPluginAPI('demo', [], '2.1.1', 2) as unknown as PluginAPI;
    await expect(
      api.ui.prompt({
        title: 'Verify',
        fields: [{ name: 'password', label: 'Password', type: 'password' }],
      })
    ).rejects.toThrow(/ui/);
  });
});
