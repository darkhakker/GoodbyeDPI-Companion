import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSite } from '../extension/current-site.js';
function api(tab, hint) {
  return { tabs: { query: async () => tab ? [tab] : [] }, storage: { session: { get: async key => ({ [key]: hint }) } } };
}
test('current site hint uses the actual active URL and hides for an already added domain', async () => {
  const browser = api({ id: 1, url: 'https://www.example.com/path' });
  assert.deepEqual(await currentSite(browser, []), { host: 'www.example.com', tabId: 1, failed: false });
  assert.equal(await currentSite(browser, [{ domain: 'example.com' }]), null);
});
test('failed navigation can be added from a real session hostname on a browser error page', async () => {
  assert.deepEqual(await currentSite(api({ id: 2, url: 'chrome-error://chromewebdata/' }, { host: 'unavailable.net', failed: true }), []), { host: 'unavailable.net', tabId: 2, failed: true });
  assert.equal(await currentSite(api({ id: 2, url: 'chrome-error://chromewebdata/' }), []), null);
});
test('pending address wins; internal browser pages never guess an old domain', async () => {
  const hint = { host: 'old-domain.net', failed: true };
  assert.equal((await currentSite(api({ id: 3, url: 'https://old-domain.net/', pendingUrl: 'https://new-domain.net/' }, hint), [])).host, 'new-domain.net');
  assert.equal(await currentSite(api({ id: 3, url: 'chrome://settings' }, hint), []), null);
  assert.equal(await currentSite(api({ id: 3, url: 'about:blank' }, hint), []), null);
  assert.equal(await currentSite(api(null), []), null);
});
