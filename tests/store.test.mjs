import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('store and unpacked IDs are exact and both compiled origins are generated', () => {
  const store = read('store-extension-id.txt').trim(), dev = read('extension-id.txt').trim();
  assert.match(store, /^[a-p]{32}$/); assert.match(dev, /^[a-p]{32}$/);
  assert.equal(store, 'aekknlficknemkbdbkfcmohdmdblbmhb'); assert.notEqual(store, dev);
  const code = read('native/BuildInfo.cs'); assert(code.includes(store)); assert(code.includes(dev));
  assert(read('installer/Install.ps1').includes('"chrome-extension://$storeId/"'));
});
test('first-run disclosure and privacy access exist in both entry points', () => {
  for (const file of ['popup.html','setup.html']) {
    const html = read(`extension/${file}`);
    assert(html.includes('id="consent"')); assert(html.includes('id="acceptConsent"'));
    assert(html.includes('id="workspace" hidden')); assert(html.includes('id="privacyLink"'));
  }
  assert(read('extension/background.js').includes('if (!state.privacyAccepted'));
});
test('privacy policy discloses local domain processing, native SID and fixed GitHub download', () => {
  const policy = read('docs/PRIVACY.md');
  for (const text of ['storage.local','storage.session','SID','GitHub','Limited Use']) assert(policy.includes(text));
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.version, '0.1.5');
  assert(!manifest.permissions.includes('cookies')); assert(!manifest.permissions.includes('history'));
});
