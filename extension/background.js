import { hostname, parsePSL, registrable, matches, effectiveDomains, learn } from './domains.js';
import { RELEASE_TAG, SETUP_URL } from './config.js';
import { createInstaller } from './installation.js';
import { navigationKey } from './current-site.js';
const HOST = 'org.goodbyedpi.companion';
const installer = createInstaller(chrome, RELEASE_TAG, SETUP_URL);
async function installationView() {
  try { return await installer.inspect(); }
  catch (error) { return { state: 'interrupted', error: error.message }; }
}
const ready = (async () => {
  const psl = parsePSL(await (await fetch(chrome.runtime.getURL('public_suffix_list.dat'))).text());
  const saved = await chrome.storage.local.get(['state']);
  const state = saved.state || { sites: [], enabled: false, profile: 'balanced', revision: 0 };
  delete state.repository; // Migrate older installations; downloads never use user-supplied URLs.
  return { psl, state };
})();
let queue = Promise.resolve();
function serial(fn) { const task = queue.then(fn); queue = task.catch(() => {}); return task; }
let pendingSync = null;
let syncAgain = false;
let nativeState = null, nativeError = '';
let nativeMissing = false;
async function save(state) {
  state.revision++;
  await chrome.storage.local.set({ state });
  await chrome.alarms.create('sync', { delayInMinutes: 0.5 });
}
async function sync() {
  if (pendingSync) { syncAgain = true; return pendingSync; }
  pendingSync = (async () => {
    do {
      syncAgain = false;
      const { state } = await ready;
      const message = { command: 'configure', domains: effectiveDomains(state.sites), enabled: state.enabled, profile: state.profile };
      try {
        const response = await chrome.runtime.sendNativeMessage(HOST, message);
        if (!response.ok) throw new Error(response.error);
        nativeState = response; nativeError = ''; nativeMissing = false;
        await chrome.action.setBadgeText({ text: response.running ? 'ON' : '' });
      } catch (e) {
        nativeState = null; nativeError = e.message;
        nativeMissing = /native messaging host.*not found|native host.*not found/i.test(e.message);
        await chrome.action.setBadgeText({ text: '!' });
        if (nativeMissing) { try { await installer.ensure(); } catch (error) { console.error(error); } }
      }
    } while (syncAgain);
  })();
  try { await pendingSync; } finally { pendingSync = null; }
}
async function observe(details) {
  const { state, psl } = await ready;
  if (!state.sites.length) return;
  let root, target;
  try {
    target = hostname(details.url);
    registrable(target, psl); // Never learn a public suffix as a global rule.
    if (details.type === 'main_frame') {
      const owner = state.sites.find(site => matches(target, site.domain));
      if (!owner) return; // Never treat a navigation to an unrelated site as a resource.
      root = owner.domain;
    } else if (details.tabId >= 0) {
      const tab = await chrome.tabs.get(details.tabId);
      root = hostname(tab.url || '');
    } else {
      // Service-worker requests have no tabId. Attribute only a direct selected
      // origin with an actually open tab; a shared CDN origin is ambiguous.
      root = hostname(details.initiator || '');
      const owner = state.sites.find(site => matches(root, site.domain));
      if (!owner) return;
      const tabs = await chrome.tabs.query({ url: [`*://*.${owner.domain}/*`, `*://${owner.domain}/*`] });
      if (!tabs.length) return;
    }
  } catch { return; }
  const site = state.sites.find(x => matches(root, x.domain));
  if (!site) return;
  let initiator = null;
  try { initiator = hostname(details.initiator || ''); } catch { }
  // A tab-bound request is browser-observed evidence even for cross-origin or
  // sandboxed frames. Do not require guessing its initiator's CDN family.
  await serial(async () => {
    if (learn(state.sites, root, target, Date.now(), { initiator, type: details.type, via: details.tabId >= 0 ? 'tab' : 'worker' })) {
      await save(state);
      // A short debounce avoids restarting the engine for each resource.
      if (!syncTimer) syncTimer = setTimeout(() => { syncTimer = null; void sync(); }, 4000);
    }
  });
}
let syncTimer = null;
async function rememberNavigation(details, failed = false) {
  if (details.type !== 'main_frame' || details.tabId < 0 || !chrome.storage.session) return;
  const { psl } = await ready;
  try {
    const host = hostname(details.url); registrable(host, psl);
    // One hostname per currently open tab, in memory only. Never save page paths.
    await chrome.storage.session.set({ [navigationKey(details.tabId)]: { host, failed } });
  } catch { }
}
chrome.webRequest.onBeforeRequest.addListener(d => {
  void rememberNavigation(d);
  void observe(d).catch(console.error);
}, { urls: ['http://*/*', 'https://*/*'] });
chrome.webRequest.onErrorOccurred?.addListener(d => { void rememberNavigation(d, true); }, { urls: ['http://*/*', 'https://*/*'] });
chrome.tabs.onRemoved?.addListener(id => { void chrome.storage.session?.remove(navigationKey(id)); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'sync') void sync(); });
chrome.runtime.onStartup.addListener(() => { void sync(); });
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await sync();
    if (nativeMissing) await chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
  })().catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  serial(async () => {
    const { state, psl } = await ready;
    let changed = true;
    let shouldSync = true;
    switch (message.action) {
      case 'view': changed = false; break;
      case 'snapshot': changed = false; shouldSync = false; break;
      case 'add': {
        const domain = registrable(hostname(message.domain), psl);
        if (!state.sites.some(x => x.domain === domain)) {
          if (state.sites.length >= 100) throw new Error('Лимит: 100 сайтов');
          state.sites.push({ domain, autoLearn: true, learned: {}, excluded: [] });
        }
        break;
      }
      case 'remove': state.sites = state.sites.filter(x => x.domain !== message.domain); break;
      case 'learning': {
        const site = state.sites.find(x => x.domain === message.domain);
        if (site) site.autoLearn = !!message.value;
        break;
      }
      case 'exclude': {
        const site = state.sites.find(x => x.domain === message.domain);
        if (site) {
          const host = hostname(message.host);
          if (matches(host, site.domain) || matches(site.domain, host)) throw new Error('Корневой сайт исключается кнопкой удаления');
          if (!site.excluded.includes(host)) site.excluded.push(host);
          delete site.learned[host];
        }
        break;
      }
      case 'restore': {
        const site = state.sites.find(x => x.domain === message.domain);
        if (site) site.excluded = site.excluded.filter(x => x !== message.host);
        break;
      }
      case 'enabled': state.enabled = !!message.value; break;
      case 'profile':
        if (!['balanced', 'sequence', 'fragment'].includes(message.value)) throw new Error('Неизвестный профиль');
        state.profile = message.value; break;
      case 'download': changed = false; await installer.ensure(true); break;
      case 'showInstaller': {
        changed = false;
        const download = await installer.inspect();
        if (!Number.isInteger(download.id)) throw new Error('Установщик ещё не скачан');
        await chrome.downloads.show(download.id); break;
      }
      case 'sync': changed = false; break;
      default: throw new Error('Неизвестная команда');
    }
    if (changed) await save(state);
    if (shouldSync) await sync();
    return { ok: true, state, domains: effectiveDomains(state.sites), nativeState, nativeError, nativeMissing, installer: await installationView(), seeds: {} };
  }).then(reply, e => reply({ ok: false, error: e.message }));
  return true;
});
