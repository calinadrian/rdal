// Marker painting shared by the map and the minimap: the game's icons (data/mapicons, data/icons) in each
// category's style, anima vent runes and quest step badges. onLoad runs when an icon finishes loading.
window.MapIcons = (onLoad) => {
  const images = {};
  function image(p) {
    if (!images[p]) {
      images[p] = new Image();
      images[p].onload = onLoad;
      images[p].src = '../../data/' + p;
    }
    return images[p].complete && images[p].naturalWidth ? images[p] : null;
  }

  // One map icon centred on (sx, sy) with size s, in the style of category k.
  function drawIcon(g, sx, sy, s, k, iconPath, ring, markerColor) {
    const tint = markerColor || k.color;
    const style = k.style === 'circle' ? 'circle' : iconPath && iconPath !== k.icon && iconPath.startsWith('mapicons/T_NavIcons') ? 'badge' : k.style;
    const img = style === 'circle' ? null : image(iconPath || k.icon);
    if (style !== 'badge' || !img) {
      g.beginPath();
      g.arc(sx, sy, s / 2, 0, Math.PI * 2);
      g.fillStyle = style === 'item' ? 'rgba(20,16,12,0.9)' : tint || '#888';
      g.fill();
      g.lineWidth = ring ? 2.5 : 1.5;
      g.strokeStyle = ring || (style === 'item' ? tint : 'rgba(0,0,0,0.85)');
      g.stroke();
      if (img) { const w = s * (style === 'item' ? 0.82 : 0.62); g.drawImage(img, sx - w / 2, sy - w / 2, w, w); }
    } else {
      g.drawImage(img, sx - s / 2, sy - s / 2, s, s);
      if (ring) {
        g.lineWidth = 2.5; g.strokeStyle = ring;
        if (iconPath?.startsWith('mapicons/T_NavIcons_Atlas')) {
          g.beginPath(); g.arc(sx, sy, s / 2 - 1, 0, Math.PI * 2); g.stroke();
        } else g.strokeRect(sx - s / 2, sy - s / 2, s, s);
      }
    }
  }

  const ventGlyphs = {};
  function ventGlyph(marker) {
    const key = marker.i + '|' + marker.color;
    if (ventGlyphs[key]) return ventGlyphs[key];
    const source = marker.ventType && image(marker.i);
    if (!source) return null;
    const probe = document.createElement('canvas');
    probe.width = source.naturalWidth; probe.height = source.naturalHeight;
    const p = probe.getContext('2d'); p.drawImage(source, 0, 0);
    const pixels = p.getImageData(0, 0, probe.width, probe.height).data;
    let left = probe.width, top = probe.height, right = -1, bottom = -1;
    for (let y = 0; y < probe.height; y++) for (let x = 0; x < probe.width; x++) {
      if (pixels[(y * probe.width + x) * 4 + 3] <= 8) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (right < left) return null;
    const width = right - left + 1, height = bottom - top + 1;
    const glyph = document.createElement('canvas'); glyph.width = glyph.height = 64;
    glyph.dataset.ventType = marker.ventType;
    const g = glyph.getContext('2d');
    const ratio = 64 / Math.max(width, height);
    g.drawImage(source, left, top, width, height, (64 - width * ratio) / 2, (64 - height * ratio) / 2, width * ratio, height * ratio);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = marker.color || '#a0a0a0'; g.fillRect(0, 0, 64, 64);
    return ventGlyphs[key] = glyph;
  }

  // A transparent circle frames the rune. A neutral hairline keeps the colored
  // outline readable over both light terrain and dark water without a solid disc.
  function paintVent(g, sx, sy, size, marker, hovered) {
    const rune = ventGlyph(marker);
    g.save();
    g.beginPath(); g.arc(sx, sy, size / 2, 0, Math.PI * 2);
    g.lineWidth = 4; g.strokeStyle = 'rgba(12,16,14,.85)'; g.stroke();
    g.lineWidth = hovered ? 2 : 1.5; g.strokeStyle = hovered ? '#fff' : marker.color || '#a0a0a0'; g.stroke();
    const glyphSize = Math.round(size * 0.66);
    if (rune) {
      g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = 2; g.shadowOffsetY = 1;
      g.drawImage(rune, sx - glyphSize / 2, sy - glyphSize / 2, glyphSize, glyphSize);
    } else if (!marker.ventType) {
      g.beginPath(); g.arc(sx, sy, 2, 0, Math.PI * 2); g.fillStyle = '#aaa'; g.fill();
    }
    g.restore();
  }

  function createVentIcon(marker) {
    const icon = document.createElement('canvas'); icon.width = icon.height = 44;
    icon.className = 'vent-rune-icon'; icon.setAttribute('aria-hidden', 'true');
    const draw = () => { const g = icon.getContext('2d'); g.clearRect(0, 0, 44, 44); paintVent(g, 22, 22, 40, marker, false); };
    draw();
    if (!ventGlyphs[marker.i + '|' + marker.color]) images[marker.i]?.addEventListener('load', draw, { once: true });
    return icon;
  }

  // A quest location: its step number (or ? for a pickup) in a disc, blue for your current step.
  function paintQuest(g, sx, sy, size, info, hovered) {
    g.font = info.pickup ? `700 ${size * 17 / 26}px Segoe UI` : `600 ${size * 11 / 26}px Segoe UI`;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const metrics = g.measureText(info.badge);
    g.beginPath();
    g.arc(sx, sy, size / 2, 0, Math.PI * 2);
    g.fillStyle = info.current ? '#16384f' : info.pickup ? '#3b321f' : '#252525'; g.fill();
    g.lineWidth = hovered || info.current || info.pickup ? 2 : 1;
    g.strokeStyle = hovered ? '#fff' : info.color; g.stroke();
    g.fillStyle = info.color;
    g.fillText(info.badge, sx + (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
      sy + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
    g.textAlign = 'center';
  }

  return { image, drawIcon, paintVent, createVentIcon, paintQuest };
};
