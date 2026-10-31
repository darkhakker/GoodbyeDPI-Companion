import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

test('worker: UI commands, scoped learning, exclusions, removal, host failure and sync', async () => {
  const listeners = {}, sent = [], persisted = [];
  let nativeMissing = false;
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  globalThis.chrome = {
    storage: { local: {
      get: async () => ({}),
      set: async value => { persisted.push(structuredClone(value)); }
    } },
    runtime: {
      id: 'test-extension', getURL: file => file,
      onStartup: event('startup'), onInstalled: event('installed'), onMessage: event('message'),
      sendNativeMessage: async (name, message) => {
        assert.equal(name, 'org.goodbyedpi.companion');
        sent.push(structuredClone(message));
        if (nativeMissing) throw new Error('Native messaging host not found');
        return { ok: true, running: message.enabled && message.domains.length > 0 };
      }
    },
    action: { setBadgeText: async () => {} },
    alarms: { create: async () => {}, onAlarm: event('alarm') },
    tabs: { get: async id => ({ url: id === 1 ? 'https://www.example.com/page' : 'https://unselected.org/' }) },
    webRequest: { onBeforeRequest: event('request') }
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ text: async () => readFileSync(new URL('../extension/public_suffix_list.dat', import.meta.url), 'utf8') });
  await import('../extension/background.js');
  const message = (action, data = {}) => new Promise(resolve => {
    assert.equal(listeners.message({ action, ...data }, { id: 'test-extension' }, resolve), true);
  });
  try {
    let result = await message('view');
    assert.deepEqual(result.domains, []);
    result = await message('add', { domain: 'https://www.example.com/page' });
    assert.deepEqual(result.domains, ['example.com']);
    await message('enabled', { value: true });
    listeners.request({ tabId: 2, url: 'https://unrelated-cdn.org/x', type: 'script', initiator: 'https://unselected.org' });
    listeners.request({ tabId: 1, url: 'https://assets.shared.net/x', type: 'script', initiator: 'https://example.com' });
    listeners.request({ tabId: 1, url: 'https://unrelated-navigation.org', type: 'main_frame', initiator: 'https://example.com' });
    listeners.request({ tabId: 1, url: 'https://github.io/script', type: 'script', initiator: 'https://example.com' });
    await pause(50);
    result = await message('view');
    assert.deepEqual(result.domains, ['assets.shared.net', 'example.com']);
    result = await message('exclude', { domain: 'example.com', host: 'assets.shared.net' });
    assert.deepEqual(result.domains, ['example.com']);
    listeners.request({ tabId: 1, url: 'https://assets.shared.net/y', type: 'script', initiator: 'https://example.com' });
    await pause(30);
    result = await message('view');
    assert.deepEqual(result.domains, ['example.com']);
    result = await message('remove', { domain: 'example.com' });
    assert.deepEqual(result.domains, []);
    assert.equal(sent.at(-1).domains.length, 0);
    nativeMissing = true;
    result = await message('add', { domain: 'tiktok.com' });
    assert.equal(result.ok, true); // Configuration is retained for later installation.
    assert.match(result.nativeError, /host not found/);
    assert(persisted.at(-1).state.sites.some(x => x.domain === 'tiktok.com'));
    nativeMissing = false;
    result = await message('sync');
    assert.equal(result.nativeError, '');
    assert(sent.at(-1).domains.includes('tiktokcdn.com'));
    result = await message('add', { domain: 'com' });
    assert.equal(result.ok, false);
    assert.equal(listeners.message({ action: 'view' }, { id: 'other-extension' }, () => {}), undefined);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
