// Hydrate preferences from settings.json before map/app initialization. Browser storage is a mirror
// and a migration source, so an existing installation keeps its choices on the first upgraded launch.
(() => {
  const keys = ['wishlist', 'columns', 'mapFollow', 'liveCreaturePool', 'liveCreatureFilter', 'mapCategories', 'mapViewport', 'navigation', 'mapDiscoveryModes', 'mapDiscoverySnapshot', 'mapDiscoveryMarked', 'questMapFilter', 'questBrowseMode', 'ventTypes', 'resourceTypes', 'recipeProgressSnapshot', 'armourChoices', 'trackedQuests', 'trackerCollapsed', 'worldFiltersOpen', 'dungeonFiltersOpen'];
  const values = {};
  window.Preferences = {
    get(key) { return values[key] ?? null; },
    json(key, fallback) { try { const value = JSON.parse(values[key]); return value ?? fallback; } catch { return fallback; } },
    set(key, value) {
      values[key] = String(value);
      try { localStorage.setItem(key, values[key]); } catch {}
      window.atlas.setPreferences?.({ [key]: values[key] }).catch(error => {
        console.warn('Could not save preference:', error);
        const status = document.querySelector('#status-progress');
        if (status) status.textContent = 'Could not save preferences: ' + error.message;
      });
    },
    setJSON(key, value) { this.set(key, JSON.stringify(value)); },
  };
  function script(src) {
    return new Promise((resolve, reject) => {
      const element = document.createElement('script');
      element.src = src; element.onload = resolve; element.onerror = reject; document.body.append(element);
    });
  }
  (async () => {
    let saved = {};
    try { saved = await window.atlas.getPreferences?.() || {}; } catch {}
    const migrated = {};
    for (const key of keys) {
      let local = null;
      try { local = localStorage.getItem(key); } catch {}
      const value = typeof saved[key] === 'string' ? saved[key] : local;
      if (value === null) continue;
      values[key] = value;
      try { localStorage.setItem(key, value); } catch {}
      if (saved[key] === undefined) migrated[key] = value;
    }
    if (Object.keys(migrated).length) {
      try { await window.atlas.setPreferences?.(migrated); } catch {}
    }
    await script('discovery.js');
    await script('recipe-progress.js');
    await script('map-icons.js');
    await script('map.js');
    await script('app.js');
  })().catch(error => console.error('Could not start AtlasLoot:', error));
})();
