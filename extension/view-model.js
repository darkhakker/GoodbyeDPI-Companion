// A popup may load new files while an older worker is still alive after an update.
// Domain rendering must not depend on optional installer metadata.
export function normalizeView(result) {
  if (!result?.ok) throw new Error(result?.error || 'Нет ответа расширения');
  if (!result.state || !Array.isArray(result.state.sites)) throw new Error('Не удалось прочитать список. Обновите расширение.');
  return {
    ...result,
    state: { ...result.state, sites: result.state.sites.map(site => ({
      ...site, learned: site.learned || {}, excluded: site.excluded || [], autoLearn: site.autoLearn !== false
    })) },
    domains: result.domains || [], seeds: result.seeds || {}, nativeState: result.nativeState || null,
    installer: result.installer || { state: 'idle' }
  };
}
