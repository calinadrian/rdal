// Discovery state is player-specific; unknown records stay visible in Undiscovered mode.
window.MapDiscovery = (() => {
  const modes = Preferences.json('mapDiscoveryModes', {});
  let snapshot = Preferences.json('mapDiscoverySnapshot', null);
  const marked = Preferences.json('mapDiscoveryMarked', {});
  const scope = () => snapshot?.character || 'pending';
  const markerKey = marker => marker.discovery?.kind + '|' + (marker.discovery?.ids || []).join('|');
  const manuallyMarked = marker => !!marker.discovery?.ids?.length && (marked[scope()] || []).includes(markerKey(marker));
  let sources = {};
  const categories = ['lore', 'shrine'];
  const rebuild = () => {
    sources = Object.fromEntries(['journal', 'shrines', 'pois'].map(kind =>
      [kind, Array.isArray(snapshot?.[kind]) ? new Set(snapshot[kind].filter(id => typeof id === 'string')) : null]));
  };
  rebuild();
  function state(marker) {
    if (manuallyMarked(marker)) return 'discovered';
    const record = marker.discovery;
    if (!record?.ids?.length || !sources[record.kind]) return 'unknown';
    return record.ids.some(id => sources[record.kind].has(id)) ? 'discovered'
      : record.absenceMeansUndiscovered === false ? 'unknown' : 'undiscovered';
  }
  const mode = category => modes[category] === 'undiscovered' ? 'undiscovered' : 'all';
  return {
    mode, state, manuallyMarked,
    mark(marker, found) {
      if (!marker.discovery?.ids?.length) return;
      const keys = new Set(marked[scope()] || []);
      found ? keys.add(markerKey(marker)) : keys.delete(markerKey(marker));
      marked[scope()] = [...keys]; Preferences.setJSON('mapDiscoveryMarked', marked);
    },
    visible: marker => !categories.includes(marker.c) || mode(marker.c) === 'all' || state(marker) !== 'discovered',
    setMode(category, value) {
      if (!categories.includes(category) || !['all', 'undiscovered'].includes(value)) return;
      modes[category] = value; Preferences.setJSON('mapDiscoveryModes', modes);
    },
    ingest(data, markers) {
      if (!data || !/^[\da-f]{32}$/i.test(data.character || '')) return false;
      const session = typeof data.session === 'string' ? data.session : null;
      const same = snapshot?.character === data.character && (snapshot?.session || null) === session;
      const next = { character: data.character, session, at: Date.now() };
      if (!snapshot?.character && marked.pending?.length) {
        marked[data.character] = [...new Set([...(marked[data.character] || []), ...marked.pending])];
        delete marked.pending; Preferences.setJSON('mapDiscoveryMarked', marked);
      }
      for (const kind of ['journal', 'shrines', 'pois']) {
        const relevant = new Set(markers.flatMap(m => m.discovery?.kind === kind ? m.discovery.ids : []));
        next[kind] = Array.isArray(data[kind]) && data[kind].every(id => typeof id === 'string')
          ? [...new Set(data[kind].filter(id => relevant.has(id)))].sort()
          : same ? snapshot[kind] ?? null : null;
      }
      const changed = !same || ['journal', 'shrines', 'pois'].some(kind => JSON.stringify(next[kind]) !== JSON.stringify(snapshot[kind]));
      snapshot = next; rebuild();
      if (changed) Preferences.setJSON('mapDiscoverySnapshot', snapshot);
      return true;
    },
    summary(category, markers) {
      const rows = markers.filter(m => m.c === category);
      return { total: rows.length, discovered: rows.filter(m => state(m) === 'discovered').length,
        unknown: rows.filter(m => state(m) === 'unknown').length, at: snapshot?.at || null };
    },
  };
})();
