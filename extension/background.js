import { hostname, parsePSL, registrable, matches, SEEDS, effectiveDomains, learn } from './domains.js';
import { RELEASE_TAG, SETUP_URL } from './config.js';
import { createInstaller } from './installation.js';
const HOST = 'org.goodbyedpi.companion';
const installer = createInstaller(chrome, RELEASE_TAG, SETUP_URL);
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
        if (nativeMissing) await installer.ensure();
      }
    } while (syncAgain);
  })();
  try { await pendingSync; } finally { pendingSync = null; }
}
async function observe(details) {
  if (details.tabId < 0) return;
  const { state, psl } = await ready;
  if (!state.sites.length) return;
  let tab;
  try { tab = await chrome.tabs.get(details.tabId); } catch { return; }
  let root, target;
  try {
    root = hostname(tab.url || ''); target = hostname(details.url);
    registrable(target, psl); // Never learn a public suffix as a global rule.
  } catch { return; }
  // Only subresources of an explicitly tracked top-level page can expand a site.
  // Exclude navigations to unrelated pages and opaque/background requests.
  if (details.type === 'main_frame') return;
  const site = state.sites.find(x => matches(root, x.domain));
  if (!site) return;
  if (details.initiator && details.initiator !== 'null') {
    let initiator;
    try { initiator = hostname(details.initiator); } catch { return; }
    const related = [site.domain, ...(SEEDS[site.domain] || []), ...Object.keys(site.learned)];
    if (!related.some(x => matches(initiator, x))) return;
  } else return;
  await serial(async () => {
    if (learn(state.sites, root, target)) {
      await save(state);
      // A short debounce avoids restarting the engine for each resource.
      if (!syncTimer) syncTimer = setTimeout(() => { syncTimer = null; void sync(); }, 4000);
    }
  });
}
let syncTimer = null;
chrome.webRequest.onBeforeRequest.addListener(d => { void observe(d).catch(console.error); }, { urls: ['http://*/*', 'https://*/*'] });
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
    switch (message.action) {
      case 'view': changed = false; break;
      case 'add': {
        const domain = registrable(hostname(message.domain), psl);
        if (state.sites.length >= 100) throw new Error('Лимит: 100 сайтов');
        if (!state.sites.some(x => x.domain === domain)) state.sites.push({ domain, autoLearn: true, learned: {}, excluded: [] });
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
    await sync();
    return { ok: true, state, domains: effectiveDomains(state.sites), nativeState, nativeError, nativeMissing, installer: await installer.inspect(), seeds: SEEDS };
  }).then(reply, e => reply({ ok: false, error: e.message }));
  return true;
});
