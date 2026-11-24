// Imagen para redes sociales (1080×1350, formato 4:5) con el resumen de una pasada y sus QSOs.

const W = 1080, H = 1350;
const C = {
  bg1: '#0b1220', bg2: '#132447', panel: 'rgba(255,255,255,0.05)', line: '#2a3858',
  text: '#e6ecf7', muted: '#8d9abb', accent: '#4cc3ff', good: '#3ddc84', bad: '#ff5d6c', warn: '#ffb020',
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// ---- Maidenhead → lat/lon (centro del cuadro) y distancia ----
export function gridToLatLon(grid) {
  const g = String(grid || '').trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + (+g[2]) * 2;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + (+g[3]);
  if (g.length >= 6) {
    lon += (g.charCodeAt(4) - 65) * (2 / 24) + 1 / 24;
    lat += (g.charCodeAt(5) - 65) * (1 / 24) + 1 / 48;
  } else { lon += 1; lat += 0.5; }
  return { lat, lon };
}

export function gridDistanceKm(a, b) {
  const p = gridToLatLon(a), q = gridToLatLon(b);
  if (!p || !q) return null;
  const R = 6371, r = Math.PI / 180;
  const dLat = (q.lat - p.lat) * r, dLon = (q.lon - p.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * r) * Math.cos(q.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---- dibujo ----
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function fitText(ctx, text, maxW, size, weight = 700) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 12);
}

function skyplot(ctx, cx, cy, R, track, marks) {
  ctx.save();
  const pt = (az, el) => {
    const r = (90 - Math.max(0, el)) / 90 * R, a = az * Math.PI / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  ctx.strokeStyle = C.line; ctx.lineWidth = 2;
  for (const f of [1, 2 / 3, 1 / 3]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
  ctx.fillStyle = C.muted; ctx.font = `600 24px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [['N', 0], ['E', 90], ['S', 180], ['O', 270]].forEach(([t, az]) => { const [x, y] = pt(az, -14); ctx.fillText(t, x, y); });
  if (track?.length > 1) {
    ctx.strokeStyle = C.accent; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    track.forEach((p, i) => { const [x, y] = pt(p.az, p.el); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    const [ax, ay] = pt(track[0].az, 0), [lx, ly] = pt(track[track.length - 1].az, 0);
    ctx.fillStyle = C.good; ctx.beginPath(); ctx.arc(ax, ay, 11, 0, 7); ctx.fill();
    ctx.fillStyle = C.bad; ctx.beginPath(); ctx.arc(lx, ly, 11, 0, 7); ctx.fill();
  }
  for (const m of marks || []) {
    const [x, y] = pt(m.az, m.el);
    ctx.fillStyle = C.warn; ctx.strokeStyle = C.bg1; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param d {satName, alias, start, end, myCall, myGrid, qsos:[{call,grid,time,mode}], track, marks}
 * @returns HTMLCanvasElement
 */
export function renderPassImage(d) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // fondo con estrellas
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, C.bg2); g.addColorStop(1, C.bg1);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  let seed = [...(d.satName + d.start)].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`;
    ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, rnd() * 1.8 + 0.3, 0, 7); ctx.fill();
  }

  const P = 64;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

  // encabezado
  ctx.fillStyle = C.accent; ctx.font = `700 30px ${FONT}`;
  ctx.fillText('📡 QSOs VÍA SATÉLITE', P, 96);
  ctx.fillStyle = C.text; fitText(ctx, d.satName, W - 2 * P, 120, 800);
  ctx.fillText(d.satName, P, 216);
  const start = new Date(d.start);
  const dateTxt = start.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const utc = t => new Date(t).toISOString().slice(11, 16);
  ctx.fillStyle = C.muted; ctx.font = `500 32px ${FONT}`;
  ctx.fillText(`${d.alias ? `${d.alias} · ` : ''}${dateTxt}`, P, 268);
  ctx.fillText(`${utc(d.start)}${d.end && utc(d.end) !== utc(d.start) ? `–${utc(d.end)}` : ''} UTC`, P, 310);

  // carta del cielo (derecha) + estadísticas (izquierda)
  const top = 350;
  ctx.fillStyle = C.panel; roundRect(ctx, P, top, W - 2 * P, 420, 28); ctx.fill();
  skyplot(ctx, W - P - 220, top + 210, 170, d.track, d.marks);

  const dists = d.qsos.map(q => ({ q, km: gridDistanceKm(d.myGrid, q.grid) })).filter(x => x.km != null);
  const odx = [...dists].sort((a, b) => b.km - a.km)[0];
  const grids = new Set(d.qsos.map(q => (q.grid || '').slice(0, 4).toUpperCase()).filter(Boolean));
  const stats = [
    [String(d.qsos.length), d.qsos.length === 1 ? 'QSO' : 'QSOs'],
    [String(grids.size), grids.size === 1 ? 'grid' : 'grids'],
    ...(odx ? [[`${Math.round(odx.km).toLocaleString('es')} km`, `ODX · ${odx.q.call}`]] : []),
  ];
  stats.forEach(([v, k], i) => {
    const y = top + 110 + i * 118;
    ctx.fillStyle = C.text; fitText(ctx, v, 430, 64, 800); ctx.fillText(v, P + 40, y);
    ctx.fillStyle = C.muted; ctx.font = `600 26px ${FONT}`; ctx.fillText(k.toUpperCase(), P + 40, y + 38);
  });

  // lista de QSOs
  const listTop = top + 470;
  const footerH = 110;
  const qs = [...d.qsos].sort((a, b) => a.time - b.time);
  const twoCols = qs.length > 8;
  const cols = twoCols ? 2 : 1;
  const rowH = twoCols ? 46 : 58;
  const maxRows = Math.floor((H - footerH - listTop - 40) / rowH);
  const capacity = maxRows * cols;
  const shown = qs.length > capacity ? qs.slice(0, capacity - 1) : qs;
  const colW = (W - 2 * P - (cols - 1) * 24) / cols;
  ctx.fillStyle = C.panel; roundRect(ctx, P, listTop, W - 2 * P, H - footerH - listTop - 20, 28); ctx.fill();
  shown.forEach((q, i) => {
    const col = twoCols ? Math.floor(i / maxRows) : 0, row = twoCols ? i % maxRows : i;
    const x = P + 32 + col * (colW + 24), y = listTop + 56 + row * rowH;
    ctx.fillStyle = C.muted; ctx.font = `500 ${twoCols ? 24 : 26}px ${FONT}`; ctx.fillText(utc(q.time), x, y);
    ctx.fillStyle = C.text; ctx.font = `800 ${twoCols ? 28 : 34}px ${FONT}`; ctx.fillText(q.call, x + 100, y);
    const callW = ctx.measureText(q.call).width;
    ctx.fillStyle = C.accent; ctx.font = `600 26px ${FONT}`;
    const extra = [q.grid?.toUpperCase(), !twoCols && gridDistanceKm(d.myGrid, q.grid) != null ? `${Math.round(gridDistanceKm(d.myGrid, q.grid))} km` : ''].filter(Boolean).join(' · ');
    if (extra) ctx.fillText(extra, x + 100 + callW + 18, y);
  });
  if (shown.length < qs.length) {
    const i = shown.length, col = twoCols ? Math.floor(i / maxRows) : 0, row = twoCols ? i % maxRows : i;
    ctx.fillStyle = C.muted; ctx.font = `600 28px ${FONT}`;
    ctx.fillText(`+${qs.length - shown.length} más`, P + 32 + col * (colW + 24), listTop + 58 + row * rowH);
  }
  if (!qs.length) {
    ctx.fillStyle = C.muted; ctx.font = `500 30px ${FONT}`;
    ctx.fillText('Sin QSOs registrados en esta pasada', P + 32, listTop + 70);
  }

  // pie
  ctx.fillStyle = C.text; ctx.font = `800 40px ${FONT}`;
  const sig = `73 de ${d.myCall || '—'}`;
  ctx.fillText(sig, P, H - 52);
  if (d.myGrid) {
    const w = ctx.measureText(sig).width;
    ctx.fillStyle = C.muted; ctx.font = `600 30px ${FONT}`; ctx.fillText(d.myGrid, P + w + 20, H - 52);
  }
  ctx.textAlign = 'right'; ctx.fillStyle = C.muted; ctx.font = `500 24px ${FONT}`;
  ctx.fillText('SatTracker', W - P, H - 52);
  return cv;
}
