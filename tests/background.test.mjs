import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

test('worker: UI commands, scoped learning, exclusions, removal, host failure and sync', async () => {
  const listeners = {}, sent = [], persisted = [];
  const navigationHints = {};
  const storage = { state: { sites: [], enabled: false, profile: 'balanced', revision: 0, repository: 'https://untrusted.invalid' } }, downloads = [];
  let nativeMissing = false, serviceError = false, nativeVersion = '0.1.5';
  const tabs = new Map([[1,'https://www.example.com/page'],[2,'https://unselected.org/'],[3,'https://www.tiktok.com/'],[4,'https://second.org/']]);
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  globalThis.chrome = {
    storage: { session: {
      get: async key => ({ [key]: navigationHints[key] }),
      set: async values => Object.assign(navigationHints, values),
      remove: async key => { delete navigationHints[key]; },
      clear: async () => { for (const key of Object.keys(navigationHints)) delete navigationHints[key]; }
    }, local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(x => x in storage).map(x => [x, structuredClone(storage[x])])),
      set: async value => { Object.assign(storage, structuredClone(value)); persisted.push(structuredClone(value)); }
    } },
    runtime: {
      id: 'test-extension', getURL: file => file,
      onStartup: event('startup'), onInstalled: event('installed'), onMessage: event('message'),
      sendNativeMessage: async (name, message) => {
        assert.equal(name, 'org.goodbyedpi.companion');
        sent.push(structuredClone(message));
        if (nativeMissing) throw new Error('Native messaging host not found');
        if (serviceError) return { ok: false, error: 'Local service is stopped' };
        return { ok: true, running: message.enabled && message.domains.length > 0, version: nativeVersion };
      }
    },
    action: { setBadgeText: async () => {} },
    alarms: { create: async () => {}, onAlarm: event('alarm') },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('Tab closed'); return { url: tabs.get(id) }; },
      query: async () => tabs.has(3) ? [{ id: 3, url: tabs.get(3) }] : [],
      create: async () => {}, onRemoved: event('tabRemoved')
    },
    downloads: {
      download: async options => { downloads.push(options); return downloads.length; },
      search: async ({ id }) => downloads[id - 1] ? [{ id, state: 'in_progress', bytesReceived: 1, totalBytes: 10, exists: false }] : [],
      show: async () => {}
    },
    webRequest: { onBeforeRequest: event('request'), onErrorOccurred: event('failedNavigation') }
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
    assert.equal(result.state.repository, undefined);
    assert.equal(result.state.privacyAccepted, false);
    assert.equal(sent.length, 0);
    assert.equal(downloads.length, 0);
    listeners.failedNavigation({ tabId: 9, url: 'https://before-consent.net/', type: 'main_frame' });
    await pause(0); assert.deepEqual(navigationHints, {});
    assert.equal((await message('add', { domain: 'example.com' })).ok, false);
    await message('consent');
    listeners.failedNavigation({ tabId: 7, url: 'https://unavailable.net/private-path?secret=value', type: 'main_frame' });
    await pause(30);
    assert.deepEqual(navigationHints['navigation-hint:7'], { host: 'unavailable.net', failed: true });
    assert(!JSON.stringify(navigationHints).includes('private-path'));
    listeners.tabRemoved(7); await pause(0);
    assert.equal(navigationHints['navigation-hint:7'], undefined);
    result = await message('add', { domain: 'https://www.example.com/page' });
    assert.deepEqual(result.domains, ['example.com']);
    serviceError = true;
    result = await message('view');
    assert.equal(result.nativeMissing, false);
    assert.equal(downloads.length, 0); // A stopped service is not a missing installation.
    serviceError = false;
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
    assert(storage.state.sites.some(x => x.domain === 'tiktok.com'));
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].saveAs, false);
    assert.match(downloads[0].url, /^https:\/\/github.com\/darkhakker\/GoodbyeDPI-Companion\/releases\/download\/v0.1.5-preview.1\/GoodbyeDPI-Companion-Setup.exe$/);
    await message('view'); await message('view');
    assert.equal(downloads.length, 1); // Popup polling must not download repeatedly.
    result = await message('repository', { value: 'https://untrusted.invalid' });
    assert.equal(result.ok, false);
    nativeMissing = false;
    result = await message('sync');
    assert.equal(result.nativeError, '');
    assert.deepEqual(sent.at(-1).domains, ['tiktok.com']);
    listeners.request({ tabId: 3, url: 'https://www.tiktok.com/', type: 'main_frame', initiator: 'null' });
    listeners.request({ tabId: 3, url: 'https://p19-common-sign.tiktokcdn.com/video', type: 'media', initiator: 'https://www.tiktok.com' });
    await pause(30);
    result = await message('snapshot');
    const firstSeen = result.state.sites[0].learned['p19-common-sign.tiktokcdn.com'].firstSeen;
    assert(result.state.sites[0].learned['www.tiktok.com']);
    assert(result.domains.includes('p19-common-sign.tiktokcdn.com'));
    assert(!result.domains.includes('tiktokcdn.com'));
    listeners.request({ tabId: 3, url: 'https://p19-common-sign.tiktokcdn.com/again', type: 'media', initiator: 'https://www.tiktok.com' });
    listeners.request({ tabId: 3, url: 'https://late-player.cdn.net/video', type: 'media', initiator: 'https://cross-origin-frame.net' });
    listeners.request({ tabId: 3, url: 'https://opaque-frame.cdn.net/image', type: 'image', initiator: 'null' });
    listeners.request({ tabId: 3, url: 'https://static.tiktok.com/image', type: 'image', initiator: 'https://www.tiktok.com' });
    await pause(30);
    result = await message('snapshot');
    const observed = result.state.sites[0].learned;
    assert.equal(observed['p19-common-sign.tiktokcdn.com'].firstSeen, firstSeen);
    assert.equal(observed['late-player.cdn.net'].source, 'tiktok.com');
    assert(observed['opaque-frame.cdn.net']); assert(observed['static.tiktok.com']);
    assert(!result.domains.includes('static.tiktok.com')); // Parent rule already covers it.
    await message('add', { domain: 'second.org' });
    listeners.request({ tabId: 4, url: 'https://p19-common-sign.tiktokcdn.com/video', type: 'media', initiator: 'https://second.org' });
    listeners.request({ tabId: -1, url: 'https://worker-assets.net/video', type: 'media', initiator: 'https://www.tiktok.com' });
    listeners.request({ tabId: -1, url: 'https://ambiguous-cdn.net/video', type: 'media', initiator: 'https://p19-common-sign.tiktokcdn.com' });
    await pause(30);
    result = await message('snapshot');
    assert.equal(result.state.sites[1].learned['p19-common-sign.tiktokcdn.com'].source, 'second.org');
    assert.equal(result.state.sites[0].learned['worker-assets.net'].via, 'worker');
    assert(!result.domains.includes('ambiguous-cdn.net'));
    tabs.delete(3);
    listeners.request({ tabId: -1, url: 'https://after-close.net/video', type: 'media', initiator: 'https://www.tiktok.com' });
    await pause(30);
    result = await message('snapshot'); assert(!result.domains.includes('after-close.net'));
    await message('remove', { domain: 'second.org' });
    result = await message('add', { domain: 'com' });
    assert.equal(result.ok, false);
    await import('../extension/background.js?test=worker-restart');
    result = await message('view');
    assert.deepEqual(result.state.sites.map(x => x.domain), ['tiktok.com']);
    result = await message('add', { domain: 'tiktok.com' });
    assert.equal(result.state.sites.length, 1);
    assert.deepEqual(storage.state.sites.map(x => x.domain), ['tiktok.com']);
    nativeVersion = '0.1.2';
    result = await message('sync');
    assert.equal(result.nativeMissing, true);
    assert.match(result.nativeError, /update required/);
    nativeVersion = '0.1.5';
    result = await message('revokeConsent');
    assert.equal(result.state.privacyAccepted, false);
    assert.equal(storage.state.enabled, false);
    assert.deepEqual(navigationHints, {});
    const callsAfterRevoke = sent.length;
    tabs.set(3, 'https://www.tiktok.com/');
    listeners.request({ tabId: 3, url: 'https://must-not-record.net/x', type: 'image', initiator: 'https://www.tiktok.com' });
    listeners.failedNavigation({ tabId: 3, url: 'https://must-not-record.net/x', type: 'main_frame' });
    await pause(30);
    assert(!storage.state.sites[0].learned['must-not-record.net']);
    assert.deepEqual(navigationHints, {});
    await message('view'); assert.equal(sent.length, callsAfterRevoke);
    assert.equal(listeners.message({ action: 'view' }, { id: 'other-extension' }, () => {}), undefined);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
