// Readability preferences are independent of map zoom and save as soon as a slider changes.
window.MapAppearance = (() => {
  const keys = ['minimapButtons', 'minimapIcons', 'minimapText', 'questText', 'questWidth'];
  let sizes = { minimapButtons: 100, minimapIcons: 100, minimapText: 100, questText: 100, questWidth: 100 };
  function apply(value = {}) {
    sizes = Object.fromEntries(keys.map(key => {
      const n = Number(value?.[key]);
      const [min, max] = key === 'questWidth' ? [70, 200] : [80, 160];
      return [key, Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n / 10) * 10)) : 100];
    }));
    keys.forEach(key => document.documentElement.style.setProperty(
      '--' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + '-scale', sizes[key] / 100));
  }
  function bind(changed) {
    const refresh = () => keys.forEach(key => {
      document.getElementById('size-' + key).value = sizes[key];
      document.getElementById('size-' + key + '-value').textContent = sizes[key] + '%';
    });
    const save = value => {
      apply(value); Preferences.setJSON('displaySizes', sizes); refresh(); changed();
    };
    keys.forEach(key => document.getElementById('size-' + key).addEventListener('input', e =>
      save({ ...sizes, [key]: Number(e.target.value) })));
    document.getElementById('size-reset').onclick = () => save({});
    refresh();
  }
  apply(window.Preferences?.json('displaySizes', {}) || {});
  return { apply, bind, sizes: () => ({ ...sizes }) };
})();
