import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const path = root + 'extension/manifest.json';
let key;
if (existsSync(path)) key = JSON.parse(readFileSync(path, 'utf8')).key;
if (!key) key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const id = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)].map(x => String.fromCharCode(97 + (x >> 4), 97 + (x & 15))).join('');
const storeId = readFileSync(root + 'store-extension-id.txt', 'utf8').trim();
if (!/^[a-p]{32}$/.test(storeId)) throw new Error('Invalid Web Store extension ID');
const manifest = {
  manifest_version: 3, name: 'GoodbyeDPI Companion', version: '0.1.5', minimum_chrome_version: '120',
  homepage_url: 'https://github.com/darkhakker/GoodbyeDPI-Companion',
  description: 'Управление GoodbyeDPI для выбранных сайтов с локальным обнаружением ресурсов.',
  key, permissions: ['storage', 'nativeMessaging', 'webRequest', 'tabs', 'alarms', 'downloads'],
  host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'background.js', type: 'module' },
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  action: { default_popup: 'popup.html', default_title: 'GoodbyeDPI Companion', default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" }
};
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(root + 'native/BuildInfo.cs', `namespace GoodbyeDPICompanion { internal static class BuildInfo { public const string ExtensionId = "${id}"; public const string StoreExtensionId = "${storeId}"; public static bool IsAllowedOrigin(string origin) { return origin == "chrome-extension://" + ExtensionId + "/" || origin == "chrome-extension://" + StoreExtensionId + "/"; } } }\n`);
writeFileSync(root + 'extension-id.txt', id + '\n');
console.log(`Stable unpacked extension ID: ${id}`);
