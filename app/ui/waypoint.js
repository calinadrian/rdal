// Shared bearing math and destination readout for the map and game overlay.
window.Waypoint = (() => {
  function bearing(target, player) {
    if (!target || !player || player.ok === false) return null;
    const dx = target.x - player.x, dy = target.y - player.y;
    if (![dx, dy, player.yaw].every(Number.isFinite)) return null;
    const distance = Math.hypot(dx, dy) / 100;
    return { distance, arrived: distance <= 10,
      angle: ((Math.atan2(dy, dx) * 180 / Math.PI - player.yaw + 540) % 360) - 180 };
  }
  function mount(id, parent, clear) {
    const box = document.createElement('div'); box.id = id; box.className = 'waypoint'; box.hidden = true;
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 40 40'); arrow.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS(arrow.namespaceURI, 'path');
    shape.setAttribute('d', 'M20 3 34 33 20 26 6 33Z'); arrow.append(shape);
    const text = document.createElement('div'), name = document.createElement('strong'), status = document.createElement('span');
    text.append(name, status); box.append(arrow, text);
    if (clear) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Stop';
      button.setAttribute('aria-label', 'Stop navigation'); button.onclick = clear; box.append(button);
    }
    parent.append(box);
    return (target, player) => {
      box.hidden = !target;
      if (!target) return;
      name.textContent = target.n || 'Selected location';
      const b = target.blocked ? null : bearing(target, player);
      arrow.style.visibility = b && !b.arrived ? 'visible' : 'hidden';
      arrow.style.transform = `rotate(${b?.angle || 0}deg)`;
      status.textContent = target.blocked || (!b ? 'Waiting for your character' : b.arrived ? 'Arrived · within 10 m'
        : `${b.distance >= 1000 ? (b.distance / 1000).toFixed(1) + ' km' : Math.round(b.distance) + ' m'} · Direct bearing`);
    };
  }
  return { bearing, mount };
})();
