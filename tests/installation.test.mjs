import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstaller } from '../extension/installation.js';
import { installerText } from '../extension/setup-state.js';
function fixture() {
  const storage = {}, records = new Map(), calls = [];
  let fail = false;
  const api = {
    storage: { local: { get: async key => ({ [key]: structuredClone(storage[key]) }), set: async value => Object.assign(storage, structuredClone(value)) } },
    downloads: {
      search: async ({ id }) => records.has(id) ? [records.get(id)] : [],
      download: async options => {
        calls.push(options); if (fail) throw new Error('NETWORK_FAILED');
        const id = calls.length; records.set(id, { id, state: 'in_progress', bytesReceived: 5, totalBytes: 10, exists: false }); return id;
      }
    }
  };
  return { storage, records, calls, api, setFail: value => { fail = value; }, installer: createInstaller(api, 'version', 'https://github.com/owner/repo/setup.exe') };
}
test('automatic install downloads exactly once, even for concurrent popup requests', async () => {
  const f = fixture();
  await Promise.all([f.installer.ensure(), f.installer.ensure(), f.installer.ensure()]);
  await f.installer.ensure();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].saveAs, false);
  assert.equal((await f.installer.inspect()).received, 5);
});
test('completed download survives worker restart without a second download', async () => {
  const f = fixture(); await f.installer.ensure();
  f.records.set(1, { id: 1, state: 'complete', exists: true, filename: 'setup.exe' });
  const restarted = createInstaller(f.api, 'version', 'https://github.com/owner/repo/setup.exe');
  const record = await restarted.ensure();
  assert.equal(record.state, 'complete'); assert.equal(f.calls.length, 1);
});
test('failed network requests are not retried in a loop; explicit retry works', async () => {
  const f = fixture(); f.setFail(true);
  assert.equal((await f.installer.ensure()).state, 'interrupted');
  await f.installer.ensure(); assert.equal(f.calls.length, 1);
  f.setFail(false); await f.installer.ensure(true); assert.equal(f.calls.length, 2);
});
test('removed downloads do not cause surprise repeat downloads', async () => {
  const f = fixture(); await f.installer.ensure();
  f.records.set(1, { id: 1, state: 'complete', exists: false });
  await f.installer.ensure(); assert.equal(f.calls.length, 1);
  await f.installer.ensure(true); assert.equal(f.calls.length, 2);
});
test('new release can download its own setup, old repository state never controls the URL', async () => {
  const f = fixture(); f.storage.repository = 'https://evil.invalid'; await f.installer.ensure();
  assert.equal(f.calls[0].url, 'https://github.com/owner/repo/setup.exe');
  const updated = createInstaller(f.api, 'new-version', 'https://github.com/owner/repo/new.exe');
  await updated.ensure(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].url, 'https://github.com/owner/repo/new.exe');
});
test('installation status describes download, completion and failure', () => {
  assert.match(installerText({ state: 'in_progress', received: 5, total: 10 }), /50%/);
  assert.match(installerText({ state: 'complete', exists: true }), /скачан/);
  assert.match(installerText({ state: 'interrupted' }), /не завершено/);
  assert.match(installerText({ state: 'complete', exists: false }), /удалён/);
});
test('interrupted worker startup exposes retry instead of remaining stuck forever', async () => {
  const f = fixture(); f.storage.installer = { tag: 'version', state: 'starting', startedAt: Date.now() - 60000 };
  assert.equal((await f.installer.ensure()).state, 'interrupted');
  assert.equal(f.calls.length, 0);
  await f.installer.ensure(true); assert.equal(f.calls.length, 1);
});
