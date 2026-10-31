import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { normalizeView } from '../extension/view-model.js';
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.textContent = ''; this.value = ''; this.hidden = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}
function documentFixture() {
  const ids = ['error', 'status', 'detail', 'toggle', 'profile', 'installation', 'installStatus', 'downloadError', 'showInstaller', 'retryDownload', 'sites', 'empty', 'add', 'domain', 'current', 'refresh'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  return { elements, getElementById: id => { if (!elements[id]) throw new Error(`Unexpected UI element: ${id}`); return elements[id]; }, createElement: tag => new Element(tag) };
}
const state = () => ({ enabled: true, profile: 'balanced', sites: [{ domain: 'tiktok.com', autoLearn: true, learned: {}, excluded: [] }] });
test('popup renders legacy worker replies, adds domains and restores the list after reopening', async () => {
  const previous = { document: globalThis.document, chrome: globalThis.chrome, setInterval: globalThis.setInterval };
  const saved = state(); let failure = false;
  const api = { runtime: { sendMessage: async message => {
    if (failure) return { ok: false, error: 'Временная ошибка связи' };
    if (message.action === 'add' && !saved.sites.some(s => s.domain === message.domain)) saved.sites.push({ domain: message.domain, autoLearn: true });
    return structuredClone({ ok: true, state: saved, domains: saved.sites.map(x => x.domain), nativeState: { running: true } });
  } }, tabs: {} };
  try {
    globalThis.setInterval = () => 0;
    globalThis.chrome = api; globalThis.document = documentFixture();
    await import('../extension/popup.js?test=open'); await pause(0);
    let elements = globalThis.document.elements;
    assert.equal(elements.error.textContent, '');
    assert.equal(elements.sites.children.length, 1);
    assert.equal(elements.sites.children[0].children[0].children[0].textContent, 'tiktok.com');
    assert.equal(elements.empty.hidden, true);
    elements.domain.value = 'example.com';
    await elements.add.listeners.submit({ preventDefault() {} });
    assert.equal(elements.domain.value, '');
    assert.equal(elements.sites.children.length, 2);
    assert.equal(elements.error.textContent, '');
    failure = true;
    await elements.refresh.listeners.click();
    assert.equal(elements.sites.children.length, 2);
    assert.equal(elements.error.textContent, 'Временная ошибка связи');
    failure = false;
    globalThis.document = documentFixture();
    await import('../extension/popup.js?test=reopen'); await pause(0);
    elements = globalThis.document.elements;
    assert.equal(elements.sites.children.length, 2);
    assert.equal(elements.empty.hidden, true);
    assert.equal(elements.installation.hidden, true);
  } finally { Object.assign(globalThis, previous); }
});
test('optional install metadata does not prevent saved domains from rendering', () => {
  const view = normalizeView({ ok: true, state: state(), nativeState: { running: true } });
  assert.equal(view.state.sites[0].domain, 'tiktok.com');
  assert.equal(view.installer.state, 'idle');
  assert.deepEqual(view.seeds, {});
});
test('invalid state reports an error without fabricating an empty saved list', () => {
  assert.throws(() => normalizeView({ ok: true }), /Не удалось прочитать список/);
  assert.throws(() => normalizeView({ ok: false, error: 'save failed' }), /save failed/);
});
