// Only a fixed release asset is downloaded. No code or installer is executed here.
export function createInstaller(api, tag, url) {
  let pending;
  const store = async value => { await api.storage.local.set({ installer: value }); return value; };
  async function inspect() {
    const { installer } = await api.storage.local.get('installer');
    if (!installer || installer.tag !== tag) return { tag, state: 'idle' };
    if (installer.state === 'starting' && Date.now() - (installer.startedAt || 0) > 30000) {
      return store({ ...installer, state: 'interrupted', error: 'Загрузка не началась. Нажмите «Скачать повторно».' });
    }
    if (Number.isInteger(installer.id)) {
      const [download] = await api.downloads.search({ id: installer.id });
      if (download) return store({ ...installer, state: download.state, exists: download.exists,
        filename: download.filename, received: download.bytesReceived, total: download.totalBytes,
        error: download.error || '' });
    }
    return installer;
  }
  async function ensure(force = false) {
    if (pending) return pending;
    pending = (async () => {
      const current = await inspect();
      if (['starting', 'in_progress'].includes(current.state)) return current;
      if (!force && current.state !== 'idle') return current;
      await store({ tag, state: 'starting', startedAt: Date.now() });
      try {
        const id = await api.downloads.download({ url, filename: 'GoodbyeDPI-Companion-Setup.exe',
          conflictAction: 'uniquify', saveAs: false });
        await store({ tag, id, state: 'in_progress' });
        return inspect();
      } catch (e) { return store({ tag, state: 'interrupted', error: e.message }); }
    })();
    try { return await pending; } finally { pending = null; }
  }
  return { inspect, ensure };
}
