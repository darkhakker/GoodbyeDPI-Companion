export function installerText(download) {
  if (download.state === 'complete') return download.exists === false ? 'Скачанный файл удалён. Нажмите «Скачать повторно».' : 'Установщик скачан. Откройте его из загрузок браузера.';
  if (download.state === 'interrupted') return 'Скачивание не завершено. Проверьте соединение и нажмите «Скачать повторно».';
  if (download.state === 'in_progress') return download.total > 0 ? `Скачивание: ${Math.min(100, Math.round(100 * download.received / download.total))}%` : 'Установщик скачивается автоматически…';
  if (download.state === 'starting') return 'Начинаем скачивание установщика…';
  return 'Ожидаем загрузку компонентов Windows.';
}
