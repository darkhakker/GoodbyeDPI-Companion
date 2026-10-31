import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hostname, parsePSL, registrable, matches, learn, effectiveDomains } from '../extension/domains.js';
const psl = parsePSL(readFileSync(new URL('../extension/public_suffix_list.dat', import.meta.url), 'utf8'));
const site = () => ({ domain: 'example.com', autoLearn: true, learned: {}, excluded: [] });
test('domain normalization, IDN and public suffix boundary', () => {
  assert.equal(registrable(hostname('https://www.tiktok.com/video/123'), psl), 'tiktok.com');
  assert.equal(registrable('a.b.example.co.uk', psl), 'example.co.uk');
  assert.equal(registrable('sub.user.github.io', psl), 'user.github.io');
  assert.equal(hostname('пример.рф'), 'xn--e1afmkfd.xn--p1ai');
  assert.throws(() => registrable('co.uk', psl));
  assert.throws(() => registrable('github.io', psl));
  for (const bad of ['localhost', '127.0.0.1', 'https://user:pass@example.com', '*.com', 'file:///c:/x']) assert.throws(() => hostname(bad));
});
test('subdomains do not match lookalikes or suffix injection', () => {
  assert(matches('a.b.tiktok.com', 'tiktok.com'));
  assert(!matches('eviltiktok.com', 'tiktok.com'));
  assert(!matches('tiktok.com.evil.org', 'tiktok.com'));
});
test('only requests from a selected site expand its domains', () => {
  const sites = [site()];
  assert(!learn(sites, 'unrelated.org', 'cdn.other.net'));
  assert(learn(sites, 'www.example.com', 'assets.example.com'));
  assert(sites[0].learned['assets.example.com']);
  assert(learn(sites, 'www.example.com', 'assets.shared-cdn.net', 1));
  assert.deepEqual(effectiveDomains(sites), ['assets.shared-cdn.net', 'example.com']);
  assert(!effectiveDomains(sites).includes('shared-cdn.net'));
  assert(!effectiveDomains(sites).includes('unrelated.org'));
});
test('excluded resources stay excluded after future requests', () => {
  const s = site(); s.excluded = ['ads.other.net'];
  assert(!learn([s], 'example.com', 'ads.other.net'));
  assert(!learn([s], 'example.com', 'sub.ads.other.net'));
  s.learned['ads.other.net'] = {};
  assert(!effectiveDomains([s]).includes('ads.other.net'));
});
test('learning can be disabled; empty list never implies all domains', () => {
  const s = site(); s.autoLearn = false;
  assert(!learn([s], 'example.com', 'cdn.other.net'));
  assert.deepEqual(effectiveDomains([]), []);
});
test('deleting a site deletes its resources unless another site also needs them', () => {
  const one = site(); one.learned['cdn.other.net'] = {};
  const two = { ...site(), domain: 'second.org', learned: { 'cdn.other.net': {} } };
  assert.deepEqual(effectiveDomains([two]), ['cdn.other.net', 'second.org']);
  assert.deepEqual(effectiveDomains([]), []);
});
test('TikTok starts without guessed CDN families and records each observed hostname exactly once', () => {
  assert.deepEqual(effectiveDomains([]), []);
  const sites = [{ ...site(), domain: 'tiktok.com' }];
  assert.deepEqual(effectiveDomains(sites), ['tiktok.com']);
  assert(learn(sites, 'www.tiktok.com', 'p19-common-sign.tiktokcdn.com', 1));
  assert(!learn(sites, 'www.tiktok.com', 'p19-common-sign.tiktokcdn.com', 2));
  assert.equal(sites[0].learned['p19-common-sign.tiktokcdn.com'].firstSeen, 1);
  assert.deepEqual(effectiveDomains(sites), ['p19-common-sign.tiktokcdn.com', 'tiktok.com']);
  assert(learn(sites, 'www.tiktok.com', 'tiktokcdn.com', 3));
  assert.deepEqual(effectiveDomains(sites), ['tiktok.com', 'tiktokcdn.com']);
  assert(sites[0].learned['p19-common-sign.tiktokcdn.com']);
});
test('growth is bounded and deterministic', () => {
  const s = site();
  for (let i = 0; i < 1005; i++) learn([s], 'example.com', `r${i}.other.net`);
  assert.equal(Object.keys(s.learned).length, 1000);
  assert.deepEqual(effectiveDomains([s]), effectiveDomains([s]).sort());
});
