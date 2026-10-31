import { installerText } from './setup-state.js';
const $ = id => document.getElementById(id);
let view;
async function call(action, data = {}) {
  $('error').textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({ action, ...data });
    if (!result?.ok) throw new Error(result?.error || 'Нет ответа расширения');
    view = result; render(); return result;
  } catch (e) { $('error').textContent = e.message; }
}
function button(text, handler, className = '') {
  const el = document.createElement('button'); el.textContent = text; el.className = className;
  el.addEventListener('click', handler); return el;
}
function render() {
  const { state, nativeState: n, nativeError, seeds } = view;
  $('status').textContent = n ? n.running ? 'Обход включён' : state.enabled && view.domains.length ? 'Движок не запущен' : 'Обход выключен' : 'Компонент Windows недоступен';
  $('detail').textContent = n ? n.errorDetail || `${view.domains.length} доменов в списке · поддомены включены` : view.nativeMissing ? 'Загружаем компоненты для первого запуска.' : nativeError;
  $('toggle').textContent = state.enabled ? 'Выключить' : 'Включить';
  $('profile').value = state.profile;
  $('toggle').disabled = !n;
  $('installation').hidden = !!n;
  $('installStatus').textContent = installerText(view.installer);
  $('downloadError').textContent = view.installer.error || '';
  $('showInstaller').disabled = view.installer.state !== 'complete' || view.installer.exists === false;
  $('retryDownload').disabled = ['starting', 'in_progress'].includes(view.installer.state);
  $('extensionId').textContent = `ID расширения: ${chrome.runtime.id}`;
  $('sites').replaceChildren(); $('empty').hidden = !!state.sites.length;
  for (const site of state.sites) {
    const card = document.createElement('section'); card.className = 'site';
    const row = document.createElement('div'); row.className = 'row';
    const title = document.createElement('h2'); title.textContent = site.domain;
    row.append(title, button('Удалить', () => call('remove', { domain: site.domain }), 'remove')); card.append(row);
    const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = site.autoLearn;
    check.addEventListener('change', () => call('learning', { domain: site.domain, value: check.checked }));
    label.append(check, ' Автоматически добавлять ресурсы сайта'); card.append(label);
    const hosts = document.createElement('div'); hosts.className = 'hosts';
    for (const host of [...new Set([...(seeds[site.domain] || []), ...Object.keys(site.learned)])].sort()) {
      if (site.excluded.includes(host)) continue;
      const line = document.createElement('div'); line.className = 'row';
      const span = document.createElement('span'); span.textContent = host;
      line.append(span, button('Исключить', () => call('exclude', { domain: site.domain, host }), 'exclude')); hosts.append(line);
    }
    for (const host of site.excluded) {
      const line = document.createElement('div'); line.className = 'row';
      const span = document.createElement('span'); span.textContent = `Исключён: ${host}`;
      line.append(span, button('Вернуть', () => call('restore', { domain: site.domain, host }), 'exclude')); hosts.append(line);
    }
    card.append(hosts); $('sites').append(card);
  }
}
$('add').addEventListener('submit', async e => { e.preventDefault(); if (await call('add', { domain: $('domain').value })) $('domain').value = ''; });
$('current').addEventListener('click', async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); await call('add', { domain: tab?.url || '' }); });
$('toggle').addEventListener('click', () => call('enabled', { value: !view.state.enabled }));
$('profile').addEventListener('change', () => call('profile', { value: $('profile').value }));
$('refresh').addEventListener('click', () => call('sync'));
$('showInstaller').addEventListener('click', () => call('showInstaller'));
$('retryDownload').addEventListener('click', () => call('download'));
setInterval(() => { if (view && !view.nativeState) void call('view'); }, 2000);
void call('view');
