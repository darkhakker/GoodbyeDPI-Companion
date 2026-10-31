import { installerText } from './setup-state.js';
import { normalizeView } from './view-model.js';
import { matches } from './domains.js';
import { currentSite } from './current-site.js';
const $ = id => document.getElementById(id);
let view;
const expandedSites = new Set();
let candidate;
async function updateSuggestion() {
  try { candidate = await currentSite(chrome, view.state.sites); } catch { candidate = null; }
  $('suggestion').hidden = !candidate;
  $('suggestionDomain').textContent = candidate?.host || '';
}
async function call(action, data = {}) {
  $('error').textContent = '';
  try {
    const result = normalizeView(await chrome.runtime.sendMessage({ action, ...data }));
    view = result; render(); await updateSuggestion(); return result;
  } catch (e) { $('error').textContent = e.message; }
}
function button(text, handler, className = '') {
  const el = document.createElement('button'); el.textContent = text; el.className = className;
  el.addEventListener('click', handler); return el;
}
function render() {
  const { state, nativeState: n } = view;
  $('status').textContent = n ? n.running ? 'Обход включён' : state.enabled && view.domains.length ? 'Движок не запущен' : 'Обход выключен' : 'Компонент Windows недоступен';
  $('detail').textContent = n?.errorDetail || '';
  $('detail').hidden = !$('detail').textContent;
  $('toggle').textContent = state.enabled ? 'Выключить' : 'Включить';
  $('profile').value = state.profile;
  $('toggle').disabled = !n;
  $('installation').hidden = !!n;
  $('installStatus').textContent = installerText(view.installer);
  $('downloadError').textContent = view.installer.error || '';
  $('showInstaller').disabled = view.installer.state !== 'complete' || view.installer.exists === false;
  $('retryDownload').disabled = ['starting', 'in_progress'].includes(view.installer.state);
  $('sites').replaceChildren(); $('empty').hidden = !!state.sites.length;
  for (const site of state.sites) {
    const card = document.createElement('section'); card.className = 'site';
    const row = document.createElement('div'); row.className = 'row';
    const title = document.createElement('h2'); title.textContent = site.domain;
    row.append(title, button('Удалить', () => call('remove', { domain: site.domain }), 'remove')); card.append(row);
    const resources = document.createElement('details');
    resources.open = expandedSites.has(site.domain);
    resources.addEventListener('toggle', () => { if (resources.open) expandedSites.add(site.domain); else expandedSites.delete(site.domain); });
    const summary = document.createElement('summary'); summary.textContent = `Обнаружено: ${Object.keys(site.learned).filter(host => !site.excluded.includes(host)).length}`; resources.append(summary);
    const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = site.autoLearn;
    check.addEventListener('change', () => call('learning', { domain: site.domain, value: check.checked }));
    label.append(check, ' Добавлять автоматически'); resources.append(label);
    const hosts = document.createElement('div'); hosts.className = 'hosts';
    for (const host of Object.keys(site.learned).sort()) {
      if (site.excluded.includes(host)) continue;
      const line = document.createElement('div'); line.className = 'row';
      const span = document.createElement('span'); span.textContent = host;
      line.append(span);
      if (!matches(host, site.domain)) line.append(button('Исключить', () => call('exclude', { domain: site.domain, host }), 'exclude'));
      hosts.append(line);
    }
    for (const host of site.excluded) {
      const line = document.createElement('div'); line.className = 'row';
      const span = document.createElement('span'); span.textContent = `Исключён: ${host}`;
      line.append(span, button('Вернуть', () => call('restore', { domain: site.domain, host }), 'exclude')); hosts.append(line);
    }
    resources.append(hosts); card.append(resources); $('sites').append(card);
  }
}
$('add').addEventListener('submit', async e => { e.preventDefault(); if (await call('add', { domain: $('domain').value })) $('domain').value = ''; });
$('suggestionAdd').addEventListener('click', async () => {
  if (!candidate) return;
  const { host, tabId, failed } = candidate;
  $('suggestionAdd').disabled = true;
  try {
    const result = await call('add', { domain: host });
    if (result?.nativeState?.running && failed) { try { await chrome.tabs.reload(tabId); } catch { } }
  } finally { $('suggestionAdd').disabled = false; }
});
$('toggle').addEventListener('click', () => call('enabled', { value: !view.state.enabled }));
$('profile').addEventListener('change', () => call('profile', { value: $('profile').value }));
$('refresh').addEventListener('click', () => call('sync'));
$('showInstaller').addEventListener('click', () => call('showInstaller'));
$('retryDownload').addEventListener('click', () => call('download'));
setInterval(() => { if (view && !view.nativeState) void call('view'); }, 2000);
let refreshTimer;
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes.state) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      let result = await chrome.runtime.sendMessage({ action: 'snapshot' });
      if (!result?.ok) result = await chrome.runtime.sendMessage({ action: 'view' });
      view = normalizeView(result); render(); await updateSuggestion();
    } catch { /* Keep the already rendered list on transient worker restarts. */ }
  }, 150);
});
void call('view');
