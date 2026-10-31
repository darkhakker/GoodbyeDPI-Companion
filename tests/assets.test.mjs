import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('manifest icons are real PNG files at every declared size', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  for (const size of [16, 32, 48, 128]) {
    const file = readFileSync(new URL(`../extension/${manifest.icons[size]}`, import.meta.url));
    assert.equal(file.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(file.readUInt32BE(16), size); assert.equal(file.readUInt32BE(20), size);
  }
  assert(manifest.action.default_icon['16']);
});
test('current-site Add card is above the status and the CSS declares light and dark palettes', () => {
  const html = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert(html.indexOf('id="suggestion"') < html.indexOf('class="status"'));
  assert(html.indexOf('id="suggestionDomain"') < html.indexOf('id="suggestionAdd"'));
  const css = readFileSync(new URL('../extension/popup.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-color-scheme:dark/);
  assert.match(css, /color-scheme:light dark/);
  assert.match(css, /--bg:#f7f9fc/); assert.match(css, /--bg:#101827/);
});
