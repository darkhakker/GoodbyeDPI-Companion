// PSL is bundled locally, including PRIVATE rules. No DNS enumeration is needed.
export function hostname(input) {
  const text = String(input ?? '').trim();
  if (!text || text.includes('*')) throw new Error('Введите домен или адрес сайта без *');
  const u = new URL(text.includes('://') ? text : `https://${text}`);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Нужен HTTP/HTTPS адрес');
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (h.length > 253 || !h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || !h.split('.').every(x => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))) throw new Error('Нужен публичный домен, не IP или localhost');
  return h;
}
export function parsePSL(text) {
  const rules = new Set(), wildcards = new Set(), exceptions = new Set();
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('//')) continue;
    const exception = line.startsWith('!'), wildcard = line.startsWith('*.');
    const value = new URL(`https://${line.replace(/^!|^\*\./, '')}`).hostname;
    (exception ? exceptions : wildcard ? wildcards : rules).add(value);
  }
  return { rules, wildcards, exceptions };
}
export function registrable(host, psl) {
  const labels = hostname(host).split('.');
  let size = 1;
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (psl.exceptions.has(suffix)) { size = labels.length - i - 1; break; }
    if (psl.rules.has(suffix)) size = Math.max(size, labels.length - i);
    if (i > 0 && psl.wildcards.has(suffix)) size = Math.max(size, labels.length - i + 1);
  }
  if (labels.length <= size) throw new Error('Нельзя добавить целую публичную доменную зону');
  return labels.slice(-size - 1).join('.');
}
export const matches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
export function effectiveDomains(sites) {
  const all = new Set();
  for (const site of sites) {
    all.add(site.domain);
    for (const domain of Object.keys(site.learned || {})) {
      if (!(site.excluded || []).some(x => matches(domain, x))) all.add(domain);
    }
  }
  const domains = [...all].sort();
  // Parent rules already include their descendants in GoodbyeDPI. Keep the exact
  // observation in learned, without restarting the engine for a redundant rule.
  return domains.filter(host => {
    for (let dot = host.indexOf('.'); dot >= 0; dot = host.indexOf('.', dot + 1)) {
      if (all.has(host.slice(dot + 1))) return false;
    }
    return true;
  });
}
export function learn(sites, rootHost, requestedHost, now = Date.now(), evidence = {}) {
  const site = sites.find(x => matches(rootHost, x.domain));
  if (!site || !site.autoLearn || requestedHost === site.domain || site.excluded.some(x => matches(requestedHost, x))) return false;
  if (Object.hasOwn(site.learned, requestedHost)) return false;
  if (Object.keys(site.learned).length >= 1000 || sites.reduce((count, value) => count + Object.keys(value.learned).length, 0) >= 10000) return false;
  if (!effectiveDomains(sites).some(parent => matches(requestedHost, parent)) && effectiveDomains(sites).length >= 2500) return false;
  site.learned[requestedHost] = { firstSeen: now, source: site.domain, ...evidence };
  return true;
}
