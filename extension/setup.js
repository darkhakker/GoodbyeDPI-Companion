import { installerText } from './setup-state.js';
const $ = id => document.getElementById(id);
let busy = false;
async function refresh(action = 'view') {
  if (busy) return; busy = true;
  try {
    const view = await chrome.runtime.sendMessage({ action });
    if (!view?.ok) throw new Error(view?.error || 'Нет ответа расширения');
    $('status').textContent = view.nativeState ? 'Компоненты установлены' : 'Подготавливаем первый запуск';
    $('progress').textContent = view.nativeState ? 'Можно закрыть эту вкладку и включить обход в расширении.' : installerText(view.installer);
    $('show').disabled = view.installer.state !== 'complete' || view.installer.exists === false;
    $('retry').disabled = ['starting', 'in_progress'].includes(view.installer.state) || !!view.nativeState;
    $('error').textContent = view.installer.error || '';
  } catch (e) { $('error').textContent = e.message; } finally { busy = false; }
}
$('show').addEventListener('click', () => refresh('showInstaller'));
$('retry').addEventListener('click', () => refresh('download'));
setInterval(() => void refresh(), 2000);
void refresh();
