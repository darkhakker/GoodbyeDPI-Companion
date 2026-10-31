import { hostname, matches } from './domains.js';
export const navigationKey = id => `navigation-hint:${id}`;
export async function currentSite(api, sites) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  const key = navigationKey(tab.id);
  const saved = await api.storage?.session?.get(key);
  const hint = saved?.[key];
  let host;
  for (const url of [tab.pendingUrl, tab.url]) {
    if (!url) continue;
    try { host = hostname(url); break; } catch { }
  }
  if (!host && /^(chrome-error:|edge-error:|about:neterror)/.test(tab.url || '')) {
    if (hint?.failed) host = hint.host;
  }
  if (!host || sites.some(site => matches(host, site.domain))) return null;
  return { host, tabId: tab.id, failed: hint?.failed === true && hint.host === host };
}
