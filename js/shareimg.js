// Imagen para redes sociales (1080×1350, formato 4:5) con el resumen de una pasada y sus QSOs.

import { LAND } from './land.js';

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

// Punto a `distRad` (radianes de arco) desde lat/lon con rumbo `brg` (grados)
function destination(lat, lon, distRad, brg) {
  const r = Math.PI / 180, p1 = lat * r, l1 = lon * r, b = brg * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(distRad) + Math.cos(p1) * Math.sin(distRad) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(distRad) * Math.cos(p1), Math.cos(distRad) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / r, lon: l2 / r };
}

// Mapa: tierras, huella del satélite, traza en tierra, mi estación y los QSOs.
function qsoMap(ctx, x0, y0, w, h, { me, qsos, ground, footprint }) {
  ctx.save();
  roundRect(ctx, x0, y0, w, h, 20); ctx.fillStyle = '#0d1830'; ctx.fill(); ctx.clip();
  if (!me) {
    ctx.fillStyle = C.muted; ctx.font = `500 26px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Sin ubicación para el mapa', x0 + w / 2, y0 + h / 2);
    ctx.restore(); return;
  }
  const wrap = lon => ((lon - me.lon + 540) % 360) - 180 + me.lon; // longitudes cerca de la mía
  const R_E = 6371;
  // huella (zona desde donde se ve el satélite) en el momento del QSO central
  let fp = [];
  if (footprint) {
    const ang = Math.acos(R_E / (R_E + footprint.alt));
    for (let b = 0; b <= 360; b += 6) fp.push(destination(footprint.lat, footprint.lon, ang, b));
  }
  const spots = qsos.map(q => ({ q, p: gridToLatLon(q.grid) })).filter(s => s.p);
  // encuadre: mi estación, los QSOs y la huella
  const fit = [me, ...spots.map(s => s.p), ...fp].map(p => ({ lat: p.lat, lon: wrap(p.lon) }));
  let minLat = Math.min(...fit.map(p => p.lat)), maxLat = Math.max(...fit.map(p => p.lat));
  let minLon = Math.min(...fit.map(p => p.lon)), maxLon = Math.max(...fit.map(p => p.lon));
  const midLat = Math.max(-70, Math.min(70, (minLat + maxLat) / 2)), midLon = (minLon + maxLon) / 2;
  const kx = Math.cos(midLat * Math.PI / 180);
  let spanX = Math.max((maxLon - minLon) * kx, 26), spanY = Math.max(maxLat - minLat, 20);
  const s = Math.min(w / (spanX * 1.15), h / (spanY * 1.15));
  const cx = x0 + w / 2, cy = y0 + h / 2;
  const P = (lat, lon) => [cx + (wrap(lon) - midLon) * kx * s, cy - (lat - midLat) * s];

  // grilla cada 10°
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (let lat = -80; lat <= 80; lat += 10) { const y = P(lat, me.lon)[1]; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke(); }
  for (let lon = -180; lon < 180; lon += 10) {
    const x = cx + (((lon - midLon + 540) % 360) - 180) * kx * s;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); ctx.stroke();
  }
  // tierras (se dibuja cada anillo corrido ±360° para cubrir el antimeridiano)
  // Las longitudes de cada anillo se "desenrollan" para que no salten de +180 a -180 a mitad de camino.
  ctx.fillStyle = '#25406e'; ctx.strokeStyle = '#3d5f96'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  for (const ring of LAND) for (const off of [-360, 0, 360]) {
    ctx.beginPath();
    let lon = ring[0] / 10;
    for (let i = 0; i < ring.length; i += 2) {
      if (i) { let dl = ring[i] / 10 - ring[i - 2] / 10; if (dl > 180) dl -= 360; else if (dl < -180) dl += 360; lon += dl; }
      const x = cx + (lon + off - midLon) * kx * s, y = cy - (ring[i + 1] / 10 - midLat) * s;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // huella
  if (fp.length) {
    ctx.beginPath();
    fp.forEach((p, i) => { const [x, y] = P(p.lat, p.lon); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fillStyle = 'rgba(76,195,255,0.10)'; ctx.fill();
    ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(76,195,255,0.7)'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]);
  }
  // traza en tierra del satélite durante la pasada
  if (ground?.length > 1) {
    ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath();
    let prev = null;
    for (const g of ground) {
      const [x, y] = P(g.lat, g.lon);
      if (prev == null || Math.abs(wrap(g.lon) - prev) > 180) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      prev = wrap(g.lon);
    }
    ctx.stroke();
    // flecha de sentido al final
    const a = ground[ground.length - 2], b = ground[ground.length - 1];
    const [ax, ay] = P(a.lat, a.lon), [bx, by] = P(b.lat, b.lon);
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.fillStyle = C.accent; ctx.beginPath();
    ctx.moveTo(bx + 16 * Math.cos(ang), by + 16 * Math.sin(ang));
    ctx.lineTo(bx + 12 * Math.cos(ang + 2.4), by + 12 * Math.sin(ang + 2.4));
    ctx.lineTo(bx + 12 * Math.cos(ang - 2.4), by + 12 * Math.sin(ang - 2.4));
    ctx.closePath(); ctx.fill();
  }
  if (footprint) {
    const [x, y] = P(footprint.lat, footprint.lon);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = C.accent; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill(); ctx.stroke();
  }
  // enlaces y QSOs
  const [mx, my] = P(me.lat, me.lon);
  ctx.strokeStyle = 'rgba(255,176,32,0.75)'; ctx.lineWidth = 2.5;
  for (const { p } of spots) { const [x, y] = P(p.lat, p.lon); ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(x, y); ctx.stroke(); }
  const labels = spots.length <= 10;
  ctx.font = `700 20px ${FONT}`; ctx.textBaseline = 'middle';
  for (const { q, p } of spots) {
    const [x, y] = P(p.lat, p.lon);
    ctx.fillStyle = C.warn; ctx.strokeStyle = C.bg1; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); ctx.stroke();
    if (labels) {
      const right = x < x0 + w - 120;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(11,18,32,0.85)';
      ctx.strokeText(q.call, x + (right ? 13 : -13), y); ctx.fillStyle = C.text; ctx.fillText(q.call, x + (right ? 13 : -13), y);
    }
  }
  // mi estación
  ctx.fillStyle = C.good; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 7 : 16, a = -Math.PI / 2 + i * Math.PI / 5;
    const x = mx + r * Math.cos(a), y = my + r * Math.sin(a);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

/**
 * @param d {satName, alias, start, end, myCall, myGrid, myLoc, qsos:[{call,grid,time,mode}], track, marks, ground, footprint}
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

  // estadísticas en una franja
  const top = 340;
  const dists = d.qsos.map(q => ({ q, km: gridDistanceKm(d.myGrid, q.grid) })).filter(x => x.km != null);
  const odx = [...dists].sort((a, b) => b.km - a.km)[0];
  const grids = new Set(d.qsos.map(q => (q.grid || '').slice(0, 4).toUpperCase()).filter(Boolean));
  const stats = [
    [String(d.qsos.length), d.qsos.length === 1 ? 'QSO' : 'QSOs'],
    [String(grids.size), grids.size === 1 ? 'grid' : 'grids'],
    ...(odx ? [[`${Math.round(odx.km).toLocaleString('es')} km`, `ODX · ${odx.q.call}`]] : []),
  ];
  ctx.fillStyle = C.panel; roundRect(ctx, P, top, W - 2 * P, 116, 28); ctx.fill();
  const statW = (W - 2 * P) / 3;
  stats.forEach(([v, k], i) => {
    const x = P + 36 + i * statW;
    ctx.fillStyle = C.text; fitText(ctx, v, statW - 50, 54, 800); ctx.fillText(v, x, top + 64);
    ctx.fillStyle = C.muted; fitText(ctx, k.toUpperCase(), statW - 50, 22, 600); ctx.fillText(k.toUpperCase(), x, top + 96);
  });

  // mapa (izquierda) + carta del cielo (derecha)
  const visTop = top + 136, visH = 400;
  ctx.fillStyle = C.panel; roundRect(ctx, P, visTop, W - 2 * P, visH, 28); ctx.fill();
  const mapW = W - 2 * P - 360;
  qsoMap(ctx, P + 16, visTop + 16, mapW, visH - 32, { me: d.myLoc, qsos: d.qsos, ground: d.ground, footprint: d.footprint });
  skyplot(ctx, W - P - 172, visTop + visH / 2, 140, d.track, d.marks);

  // lista de QSOs
  const listTop = visTop + visH + 20;
  const footerH = 110;
  const qs = [...d.qsos].sort((a, b) => a.time - b.time);
  const singleRows = Math.floor((H - footerH - listTop - 40) / 58);
  const compact = qs.length > singleRows;
  const rowH = compact ? 46 : 58;
  const maxRows = Math.floor((H - footerH - listTop - 40) / rowH);
  const twoCols = qs.length > maxRows;
  const cols = twoCols ? 2 : 1;
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
