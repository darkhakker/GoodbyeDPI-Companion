import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve('extension');
const output = resolve('store/images'); mkdirSync(output, { recursive: true });
const baseState = {
  privacyAccepted: true, enabled: true, profile: 'balanced', revision: 1,
  sites: [{ domain: 'tiktok.com', autoLearn: true, excluded: [], learned: {
    'p19-common-sign.tiktokcdn.com': { source: 'tiktok.com', firstSeen: 1793420000000, via: 'tab', type: 'media' },
    'static.tiktok.com': { source: 'tiktok.com', firstSeen: 1793420000001, via: 'tab', type: 'image' }
  } }]
};
function bootstrap(scenario) {
  const state = structuredClone(baseState);
  if (scenario === 'consent') { state.privacyAccepted = false; state.enabled = false; state.sites = []; }
  const result = { ok: true, state, domains: ['tiktok.com', 'p19-common-sign.tiktokcdn.com'], nativeState: { running: true, version: '0.1.5' }, installer: { state: 'idle' }, seeds: {} };
  if (scenario === 'consent') result.nativeState = null;
  return `Object.defineProperty(window,'chrome',{value:{runtime:{sendMessage:async()=>(${JSON.stringify(result)})},tabs:{query:async()=>[{id:1,url:${JSON.stringify(scenario === 'suggestion' ? 'https://example.org/' : 'https://www.tiktok.com/')}}]},storage:{session:{get:async()=>({})},onChanged:{addListener:()=>{}}}}});`;
}
function presentation(scenario, theme) {
  const copy = {
    suggestion: ['Текущий сайт.<br>Сразу в список.', 'Добавляйте домен активной вкладки.<br>Управляйте локальным GoodbyeDPI<br>из компактного окна.', 'ДОБАВЛЕНИЕ ТЕКУЩЕГО САЙТА'],
    resources: ['Ресурсы страницы.<br>Только реальные.', 'Точные имена появляются после<br>реальных запросов страницы —<br>в том числе при загрузке видео.', 'ОБНАРУЖЕНИЕ БЕЗ УГАДЫВАНИЯ'],
    consent: ['Сначала согласие.<br>Затем работа.', 'Домены обрабатываются на устройстве.<br>Компонент Windows устанавливается<br>с вашим подтверждением.', 'ПРОЗРАЧНЫЙ ПЕРВЫЙ ЗАПУСК']
  }[scenario];
  return readFileSync('store/render/screen.html','utf8').replaceAll('__SCENARIO__',scenario).replaceAll('__TITLE__',copy[0]).replaceAll('__BODY__',copy[1]).replaceAll('__EYEBROW__',copy[2]);
}
function promo(large) { return readFileSync(large ? 'store/render/promo-large.html' : 'store/render/promo-small.html','utf8'); }
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname.startsWith('/extension/')) {
    const path = resolve(root, url.pathname.slice('/extension/'.length));
    if (!path.startsWith(root + '\\') && !path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    if (!existsSync(path)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(path)] || 'text/plain; charset=utf-8');
    res.end(readFileSync(path)); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/popup') {
    const html = readFileSync(resolve(root, 'popup.html'), 'utf8').replace('<html lang="ru">', `<html lang="ru"><base href="/extension/"><script>${bootstrap(url.searchParams.get('scenario'))}</script>`);
    res.end(html); return;
  }
  if (url.pathname === '/promo') { res.end(promo(url.searchParams.get('large') === '1')); return; }
  res.end(presentation(url.searchParams.get('scenario') || 'suggestion', url.searchParams.get('theme') || 'dark'));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-background-networking', '--no-first-run'] });
try {
  for (const [scenario, theme, file] of [['suggestion','dark','01-current-site-dark-1280x800.png'],['resources','light','02-resources-light-1280x800.png'],['consent','dark','03-first-run-1280x800.png']]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: theme });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/?scenario=${scenario}&theme=${theme}`);
    const frame = page.frameLocator('iframe');
    await frame.locator(scenario === 'consent' ? '#consent' : '#sites .site').waitFor({ state: 'visible' });
    if (scenario === 'resources') await frame.locator('.site summary').click();
    const height = await frame.locator('body').evaluate(el => Math.ceil(el.getBoundingClientRect().height));
    const scale = Math.min(1.15, 680 / height);
    await page.locator('iframe').evaluate((el, data) => { el.style.height = `${data.height}px`; el.style.transform = `scale(${data.scale})`; el.parentElement.style.height = `${data.height * data.scale}px`; el.parentElement.style.width = `${380 * data.scale}px`; }, { height, scale });
    const bg = await frame.locator('body').evaluate(el => getComputedStyle(el).color);
    if (errors.length) throw new Error(errors.join('; '));
    await page.screenshot({ path: resolve(output, file), type: 'png' });
    console.log(`${file}: popup height=${height}, foreground=${bg}`);
    await page.close();
  }
  for (const [large, width, height, file] of [[false,440,280,'promo-small-440x280.png'],[true,1400,560,'promo-marquee-1400x560.png']]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/promo?large=${large ? 1 : 0}`);
    await page.screenshot({ path: resolve(output, file), type: 'png' }); await page.close();
  }
  copyFileSync(resolve(root, 'icons/icon128.png'), resolve(output, 'store-icon-128.png'));
} finally { await browser.close(); server.close(); }
