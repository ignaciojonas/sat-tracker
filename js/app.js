import { parseTLE, makeSatrec, tleEpoch, observer, look, findPasses, doppler, cardinal, cardinal8 } from './orbit.js';
import { SATS, BY_NORAD } from './sats.js';
import { db, uid } from './db.js';
import { Recorder, recoverOrphans, canRecord, extFor } from './recorder.js';
import { toADIF, adifMode, bandOf } from './adif.js';
import { renderPassImage, gridToLatLon as gridCenter } from './shareimg.js';

// ---------- utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* lleno */ } },
};
const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle';
const TLE_MAX_AGE = 12 * 3600e3;

const pad = n => String(n).padStart(2, '0');
const fmtTime = (d, sec = false) => new Date(d).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}) });
function fmtDay(d) {
  d = new Date(d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((new Date(d).setHours(0, 0, 0, 0) - today) / 86400e3);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  return d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return h ? `${h}h ${pad(m)}m` : `${m}:${pad(ss)}`;
}
const f3 = f => f.toFixed(3);
const fmtFreq = f => Array.isArray(f) ? `${f3(Math.min(...f))}–${f3(Math.max(...f))}` : f3(f);
const center = f => Array.isArray(f) ? (f[0] + f[1]) / 2 : f;
const deg = a => `${Math.round(a) % 360}°`;
const normDelta = d => ((d + 540) % 360) - 180;

function toast(msg, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

function maidenhead(lat, lon) {
  const U = 'ABCDEFGHIJKLMNOPQRSTUVWX';
  let L = lon + 180, A = lat + 90;
  const a = U[Math.floor(L / 20)], b = U[Math.floor(A / 10)];
  L %= 20; A %= 10;
  const c = Math.floor(L / 2), d = Math.floor(A);
  const e = U[Math.floor((L % 2) * 12)].toLowerCase(), f = U[Math.floor((A % 1) * 24)].toLowerCase();
  return a + b + c + d + e + f;
}

// ---------- estado ----------
const state = {
  loc: LS.get('loc', null),
  settings: { minEl: 10, hours: 48, decl: 0, showAll: false, night: false, myCall: '', ...LS.get('settings', {}) },
  favs: new Set(LS.get('favs', SATS.map(s => s.norad))),
  tle: LS.get('tle', null),
  sats: new Map(),
  passes: [],
  passesAt: 0,
  view: 'passes',
  trackNorad: LS.get('track', 25544),
  trackPasses: { norad: null, list: [] },
  heading: null, pitch: null, compassOn: false,
  wakeLock: null, installPrompt: null,
  recorder: new Recorder(),
};
const saveSettings = () => LS.set('settings', state.settings);
const saveFavs = () => LS.set('favs', [...state.favs]);
const obs = () => state.loc && observer(state.loc.lat, state.loc.lon, state.loc.alt || 0);

// ---------- TLE ----------
function buildSats() {
  state.sats.clear();
  if (!state.tle) return;
  for (const t of parseTLE(state.tle.text)) {
    const info = BY_NORAD.get(t.norad);
    const satrec = makeSatrec(t);
    if (!satrec) continue;
    state.sats.set(t.norad, { norad: t.norad, name: info?.name || t.name, alias: info?.alias || '', info, satrec, tle: t });
  }
  state.passesAt = 0;
}

async function loadTLE(force = false) {
  if (!state.tle) {
    try {
      const text = await (await fetch('data/amateur.tle')).text();
      state.tle = { text, ts: 0, src: 'copia incluida en la app' };
    } catch { /* sin copia */ }
  }
  buildSats();
  const stale = !state.tle || Date.now() - state.tle.ts > TLE_MAX_AGE;
  if (force || stale) {
    try {
      const r = await fetch(TLE_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (parseTLE(text).length < 10) throw new Error('respuesta inválida');
      state.tle = { text, ts: Date.now(), src: 'CelesTrak' };
      LS.set('tle', state.tle);
      buildSats();
      if (force) toast('Elementos orbitales (TLE) actualizados ✔');
    } catch (e) {
      if (force) toast(`No se pudo actualizar: ${e.message}`);
    }
  }
}

// ---------- pasadas ----------
function computePasses() {
  const o = obs();
  state.passes = [];
  state.passesAt = Date.now();
  if (!o) return;
  const start = new Date();
  for (const s of state.sats.values()) {
    if (!state.favs.has(s.norad)) continue;
    for (const p of findPasses(s.satrec, o, { start, hours: state.settings.hours, minEl: state.settings.minEl })) {
      state.passes.push({ ...p, norad: s.norad, id: `${s.norad}-${+p.aos}` });
    }
  }
  state.passes.sort((a, b) => a.aos - b.aos);
}

function ensurePasses() {
  const now = Date.now();
  if (now - state.passesAt > 20 * 60e3) computePasses();
  state.passes = state.passes.filter(p => p.los > now);
}

function trackPassesFor(norad) {
  const s = state.sats.get(norad), o = obs();
  if (!s || !o) return [];
  const tp = state.trackPasses;
  if (tp.norad !== norad || !tp.list.length || tp.list[0].los < Date.now()) {
    tp.norad = norad;
    tp.list = findPasses(s.satrec, o, { hours: 72, minEl: 0, max: 30 });
  }
  return tp.list;
}

// ---------- SVG ----------
function skyplot(track, { cur = null, size = 320 } = {}) {
  const c = size / 2, R = c - 22;
  const pt = (az, el) => {
    const r = (90 - Math.max(0, el)) / 90 * R, a = az * Math.PI / 180;
    return [c + r * Math.sin(a), c - r * Math.cos(a)];
  };
  const now = Date.now();
  const toPath = arr => arr.map((p, i) => (i ? 'L' : 'M') + pt(p.az, p.el).map(n => n.toFixed(1)).join(' ')).join('');
  const done = track.filter(p => p.t <= now), rest = track.filter(p => p.t >= now);
  if (done.length && rest.length) rest.unshift(done[done.length - 1]);
  const lbl = (t, az) => { const [x, y] = pt(az, -12); return `<text class="lbl" x="${x}" y="${y}">${t}</text>`; };
  let s = `<svg class="sky" viewBox="0 0 ${size} ${size}" role="img" aria-label="Carta del cielo">
    <circle class="ring" cx="${c}" cy="${c}" r="${R}"/><circle class="ring" cx="${c}" cy="${c}" r="${R * 2 / 3}"/><circle class="ring" cx="${c}" cy="${c}" r="${R / 3}"/>
    <line class="axis" x1="${c}" y1="${c - R}" x2="${c}" y2="${c + R}"/><line class="axis" x1="${c - R}" y1="${c}" x2="${c + R}" y2="${c}"/>
    ${lbl('N', 0)}${lbl('E', 90)}${lbl('S', 180)}${lbl('O', 270)}
    <text class="lbl" x="${c + 4}" y="${c - R * 2 / 3 + 8}" text-anchor="start">30°</text>
    <text class="lbl" x="${c + 4}" y="${c - R / 3 + 8}" text-anchor="start">60°</text>`;
  if (track.length) {
    if (done.length > 1) s += `<path class="track done" d="${toPath(done)}"/>`;
    if (rest.length > 1) s += `<path class="track" d="${toPath(rest)}"/>`;
    const [ax, ay] = pt(track[0].az, 0), [lx, ly] = pt(track[track.length - 1].az, 0);
    s += `<circle class="aos" cx="${ax}" cy="${ay}" r="6"/><circle class="los" cx="${lx}" cy="${ly}" r="6"/>`;
  }
  if (state.compassOn && state.heading != null) {
    const [hx, hy] = pt(state.heading, Math.max(0, state.pitch ?? 0));
    s += `<line class="head" x1="${c}" y1="${c}" x2="${hx}" y2="${hy}"/>`;
  }
  if (cur && cur.el >= 0) {
    const [x, y] = pt(cur.az, cur.el);
    s += `<circle class="sat" cx="${x}" cy="${y}" r="8"/>`;
  }
  return s + '</svg>';
}

function azGauge(az) {
  const c = 60, r = 48, a = az * Math.PI / 180;
  const x = c + r * Math.sin(a), y = c - r * Math.cos(a);
  return `<svg viewBox="0 0 120 130"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--line)" stroke-width="2"/>
    <text class="gauge-lbl" x="${c}" y="8">N</text><text class="gauge-lbl" x="116" y="${c + 3}">E</text>
    <text class="gauge-lbl" x="${c}" y="${c + r + 10}">S</text><text class="gauge-lbl" x="5" y="${c + 3}">O</text>
    <line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
    <circle cx="${x}" cy="${y}" r="6" fill="var(--accent)"/>
    <text class="gauge-lbl" x="${c}" y="128">Azimut (girar)</text></svg>`;
}

function elGauge(el) {
  const ox = 14, oy = 106, L = 92;
  const e = Math.max(-5, Math.min(90, el)) * Math.PI / 180;
  const dx = Math.cos(e), dy = -Math.sin(e);
  let elems = '';
  [0.15, 0.4, 0.6, 0.8, 1].forEach((f, i) => {
    const px = ox + dx * L * f, py = oy + dy * L * f, h = i === 0 ? 14 : 11 - i;
    elems += `<line x1="${px - dy * h}" y1="${py + dx * h}" x2="${px + dy * h}" y2="${py - dx * h}"/>`;
  });
  return `<svg viewBox="0 0 120 130">
    <path d="M${ox} ${oy - L} A${L} ${L} 0 0 1 ${ox + L} ${oy}" fill="none" stroke="var(--line)" stroke-width="2"/>
    <line x1="${ox}" y1="${oy}" x2="${ox + L + 4}" y2="${oy}" stroke="var(--muted)" stroke-width="1"/>
    <line x1="${ox}" y1="${oy}" x2="${ox}" y2="${oy - L - 4}" stroke="var(--muted)" stroke-width="1"/>
    <g class="yagi"><line x1="${ox}" y1="${oy}" x2="${ox + dx * L}" y2="${oy + dy * L}"/>${elems}</g>
    <text class="gauge-lbl" x="${ox + 6}" y="${oy - L - 2}" text-anchor="start">90°</text>
    <text class="gauge-lbl" x="60" y="128">Elevación (inclinar)</text></svg>`;
}

// ---------- frecuencias ----------
function modeBlock(m) {
  const rows = [];
  if (m.up != null) rows.push(`<span class="up">↑ Subida</span><span class="num">${fmtFreq(m.up)} MHz · ${esc(m.upMode || '')}${m.tone ? ` · CTCSS ${esc(m.tone)}` : ''}</span>`);
  if (m.down != null) rows.push(`<span class="down">↓ Bajada</span><span class="num">${fmtFreq(m.down)} MHz · ${esc(m.downMode || '')}</span>`);
  return `<div class="mode"><div class="mode-title">${esc(m.label)}</div><div class="freq">${rows.join('')}</div></div>`;
}

function freqSummary(s) {
  const m = s.info?.modes?.find(x => x.up != null) || s.info?.modes?.[0];
  if (!m) return '<div class="small muted" style="margin-top:6px">Sin datos de frecuencias</div>';
  return `<div class="freq small">${m.up != null ? `<span class="up">↑</span><span class="num">${fmtFreq(m.up)} ${esc(m.upMode || '')}${m.tone ? ` · ${esc(m.tone)}` : ''}</span>` : ''}
    ${m.down != null ? `<span class="down">↓</span><span class="num">${fmtFreq(m.down)} ${esc(m.downMode || '')}</span>` : ''}</div>`;
}

const statusBadge = s => s.info ? `<span class="badge ${esc(s.info.status.split(' ')[0])}">${esc(s.info.status)}</span>` : '';

function dopplerTable(s, p) {
  const modes = (s.info?.modes || []).filter(m => m.up != null || m.down != null);
  if (!modes.length) return '';
  const o = obs();
  const pts = [['AOS', p.aos], ['Máx', p.tca], ['LOS', p.los]].map(([k, t]) => [k, look(s.satrec, o, t)?.rangeRate ?? 0]);
  let h = '<h3>Frecuencias corregidas por Doppler</h3>';
  for (const m of modes) {
    h += `<div class="card"><div class="mode-title">${esc(m.label)}</div><table class="tbl"><tr><th></th>${pts.map(([k]) => `<th>${k}</th>`).join('')}</tr>`;
    if (m.up != null) h += `<tr><td class="freq"><span class="up">↑ TX</span></td>${pts.map(([, rr]) => `<td>${f3(doppler.up(center(m.up), rr))}</td>`).join('')}</tr>`;
    if (m.down != null) h += `<tr><td class="freq"><span class="down">↓ RX</span></td>${pts.map(([, rr]) => `<td>${f3(doppler.down(center(m.down), rr))}</td>`).join('')}</tr>`;
    h += `</table>${m.type === 'LINEAR' ? '<div class="small muted">Valores para el centro de la banda de paso.</div>' : ''}</div>`;
  }
  return h;
}

// ---------- guía de apuntado ----------
function maxAzRate(track) {
  let r = 0;
  for (let i = 1; i < track.length; i++) {
    const dt = (track[i].t - track[i - 1].t) / 1000;
    if (dt > 0) r = Math.max(r, Math.abs(normDelta(track[i].az - track[i - 1].az)) / dt);
  }
  return r;
}

function yagiGuide(s, p) {
  const o = obs();
  const steps = [];
  const fm = s.info?.modes?.find(m => m.type === 'FM' && m.up != null && m.down != null);
  const lin = s.info?.modes?.find(m => m.type === 'LINEAR');
  const rrA = look(s.satrec, o, p.aos)?.rangeRate ?? 0, rrL = look(s.satrec, o, p.los)?.rangeRate ?? 0;

  if (fm) steps.push(`<b>Preparación:</b> cargá en memorias la subida <b>${f3(fm.up)} MHz</b>${fm.tone ? ` con tono <b>${esc(fm.tone)}</b>` : ''} y la bajada <b>${f3(fm.down)} MHz</b> con sus correcciones Doppler (tabla de abajo). En FM con 5 W y una Yagi alcanza.`);
  steps.push(`<b>${fmtTime(+p.aos - 60e3)}</b> (1 min antes): apuntá la antena al <b>${cardinal8(p.aosAz)} — ${deg(p.aosAz)}</b>, casi horizontal (<b>0–5°</b> de elevación). Escuchá la bajada; aparece por el horizonte a las <b>${fmtTime(p.aos, true)}</b>.`);
  steps.push(`Seguilo de <b>${cardinal(p.aosAz)}</b> hacia <b>${cardinal(p.losAz)}</b>. Punto más alto a las <b>${fmtTime(p.tca, true)}</b>: al <b>${cardinal(p.tcaAz)} (${deg(p.tcaAz)})</b> levantando la antena a <b>${deg(p.maxEl)}</b>.`);
  const rate = maxAzRate(p.track);
  if (p.maxEl >= 70) {
    steps.push(`<b>Pasada casi cenital:</b> cerca del máximo el azimut gira hasta ${rate.toFixed(1)}°/s. En vez de girar 180° de golpe, usá el <i>volteo</i>: seguí levantando la antena más allá de la vertical (>90°) y continuá mirando hacia el ${cardinal8(p.losAz)} "de espaldas".`);
  } else if (p.maxEl < 20) {
    steps.push(`<b>Pasada baja (${deg(p.maxEl)}):</b> la señal será débil y la tapan edificios/árboles. Buscá horizonte despejado hacia el ${cardinal8(p.tcaAz)}.`);
  } else if (rate > 1.5) {
    steps.push(`Cerca del máximo el azimut cambia rápido (hasta ${rate.toFixed(1)}°/s): andá girando continuamente.`);
  }
  steps.push(`<b>Polarización:</b> la Yagi es lineal y el satélite rota. Si la señal se desvanece, girá la antena sobre el eje del boom (giro de muñeca) hasta recuperarla — suele cambiar durante la pasada.`);
  if (fm) {
    const vhfDown = fm.down < 300;
    const dA = (doppler.down(fm.down, rrA) - fm.down) * 1000, dL = (doppler.down(fm.down, rrL) - fm.down) * 1000;
    steps.push(`<b>Doppler bajada (${vhfDown ? '2 m' : '70 cm'}):</b> al inicio ~${dA > 0 ? '+' : ''}${dA.toFixed(1)} kHz (${f3(doppler.down(fm.down, rrA))}), al final ~${dL > 0 ? '+' : ''}${dL.toFixed(1)} kHz (${f3(doppler.down(fm.down, rrL))}). ${vhfDown ? 'En 2 m el corrimiento es chico: suele bastar la nominal.' : 'Andá bajando de a 5 kHz durante la pasada.'}`);
    if (fm.up > 300) {
      const uA = doppler.up(fm.up, rrA), uL = doppler.up(fm.up, rrL);
      steps.push(`<b>Doppler subida (70 cm):</b> transmití en ~${f3(uA)} al inicio y bajá hasta ~${f3(uL)} al final.`);
    }
    steps.push('Con una antena dual-band (tipo Arrow) usá un duplexor y escuchate en la bajada: si te oís, estás entrando. Llamadas cortas: indicativo y grid locator.');
  }
  if (lin) {
    steps.push(`<b>Transpondedor lineal${lin.inverting ? ' invertido' : ''}:</b> regla de oro — dejá fija la frecuencia en 2 m y corregí siempre el lado de 70 cm, así quedás en la misma frecuencia del satélite que tu corresponsal. Buscá tu propia señal (CW o "test") en la bajada.`);
  }
  steps.push(`<b>${fmtTime(p.los, true)}</b>: se pierde por el <b>${cardinal8(p.losAz)} (${deg(p.losAz)})</b>. Duración total ${fmtDur(p.los - p.aos)}.`);
  return `<ol class="guide">${steps.map(x => `<li>${x}</li>`).join('')}</ol>`;
}

function pointingTable(s, p) {
  const o = obs();
  const dur = (p.los - p.aos) / 1000;
  const step = dur <= 900 ? 30 : dur <= 2400 ? 60 : 180;
  const now = Date.now();
  let rows = '';
  let nowMarked = false;
  const times = [];
  for (let t = +p.aos; t < +p.los; t += step * 1000) times.push(t);
  times.push(+p.los);
  for (const t of times) {
    const l = look(s.satrec, o, new Date(t));
    if (!l) continue;
    const isNow = !nowMarked && now >= t && now < t + step * 1000;
    if (isNow) nowMarked = true;
    rows += `<tr class="${isNow ? 'now' : ''}"><td>${fmtTime(t, true)}</td><td>${deg(l.az)} ${cardinal(l.az)}</td><td>${deg(Math.max(0, l.el))}</td><td>${Math.round(l.range)} km</td></tr>`;
  }
  return `<table class="tbl"><tr><th>Hora</th><th>Azimut</th><th>Elev.</th><th>Distancia</th></tr>${rows}</table>`;
}

// ---------- vistas ----------
function needLocation() {
  return `<div class="card"><h2>📍 Necesito tu ubicación</h2>
    <p class="muted">Las pasadas dependen de dónde estés. Usá el GPS del teléfono o cargá latitud/longitud a mano.</p>
    <div class="btns"><button class="btn" data-action="gps">Usar mi ubicación</button>
    <button class="btn secondary" data-view="settings">Cargar a mano</button></div></div>`;
}

function passCard(p) {
  const s = state.sats.get(p.norad);
  const now = Date.now(), live = p.aos <= now && p.los > now;
  return `<div class="card tap ${live ? 'live' : ''}" data-pass="${p.id}">
    <div class="pass-head"><span class="name">${esc(s.name)}</span>${statusBadge(s)}
      <span class="when">${fmtDay(p.aos)} ${fmtTime(p.aos)}</span></div>
    <div class="row small muted"><span data-cd="${+p.aos}" data-end="${+p.los}"></span><span class="grow"></span><span>dura ${fmtDur(p.los - p.aos)}</span></div>
    <div class="pass-grid">
      <div class="kv"><div class="k">Aparece</div><div class="v">${cardinal(p.aosAz)} ${deg(p.aosAz)}</div></div>
      <div class="kv"><div class="k">Elev. máx</div><div class="v">${deg(p.maxEl)} <span class="small muted">${cardinal(p.tcaAz)}</span></div></div>
      <div class="kv"><div class="k">Se pone</div><div class="v">${cardinal(p.losAz)} ${deg(p.losAz)}</div></div>
    </div>
    <div class="elbar"><i style="width:${Math.min(100, p.maxEl / 90 * 100)}%"></i></div>
    ${freqSummary(s)}</div>`;
}

function viewPasses() {
  if (!state.loc) return needLocation();
  ensurePasses();
  if (!state.sats.size) return '<div class="empty">Cargando datos orbitales…</div>';
  const list = state.passes.slice(0, 60);
  return `<div class="row"><h2 class="grow">Próximas pasadas</h2>
      <span class="small muted">elev. ≥ ${state.settings.minEl}° · ${state.settings.hours} h</span></div>
    ${list.length ? list.map(passCard).join('') : '<div class="empty">No hay pasadas con esos filtros. Probá bajar la elevación mínima en Ajustes o marcar más satélites.</div>'}`;
}

function nextPassOf(norad) {
  return state.passes.find(p => p.norad === norad);
}

function satCard(s) {
  const fav = state.favs.has(s.norad);
  const np = nextPassOf(s.norad);
  return `<div class="card">
    <div class="row"><span class="name" style="font-weight:700;font-size:17px">${esc(s.name)}</span>
      <span class="small muted">${esc(s.alias)}</span><span class="grow"></span>${statusBadge(s)}</div>
    ${s.info?.note ? `<div class="small muted" style="margin:4px 0">${esc(s.info.note)}</div>` : ''}
    ${(s.info?.modes || []).map(modeBlock).join('')}
    <div class="small muted" style="margin-top:8px">NORAD ${s.norad}${np ? ` · próxima: ${fmtDay(np.aos)} ${fmtTime(np.aos)} (${deg(np.maxEl)})` : ''}</div>
    <div class="btns" style="margin-top:8px">
      <button class="btn secondary" data-fav="${s.norad}">${fav ? '★ En mis pasadas' : '☆ Agregar a pasadas'}</button>
      <button class="btn secondary" data-track="${s.norad}">🎯 Apuntar</button></div></div>`;
}

function viewSats() {
  if (state.loc) ensurePasses();
  const curated = SATS.map(x => state.sats.get(x.norad)).filter(Boolean);
  const missing = SATS.filter(x => !state.sats.has(x.norad));
  let h = `<h2>Satélites con repetidora</h2>
    <p class="small muted">Las frecuencias y el estado cambian: confirmá en <a href="https://www.amsat.org/status/" target="_blank" rel="noopener">AMSAT Live Status</a> antes de salir.</p>
    ${curated.map(satCard).join('')}`;
  if (missing.length) h += `<p class="small muted">Sin elementos orbitales actuales: ${missing.map(m => esc(m.name)).join(', ')}.</p>`;
  if (state.settings.showAll) {
    const others = [...state.sats.values()].filter(s => !s.info).sort((a, b) => a.name.localeCompare(b.name));
    h += `<h3>Otros satélites amateur (sin datos de frecuencia)</h3>${others.map(s => `<div class="card row">
      <span class="grow">${esc(s.name)} <span class="small muted">#${s.norad}</span></span>
      <button class="btn secondary" data-fav="${s.norad}">${state.favs.has(s.norad) ? '★' : '☆'}</button>
      <button class="btn secondary" data-track="${s.norad}">🎯</button></div>`).join('')}`;
  }
  return h;
}

function viewTrack() {
  if (!state.loc) return needLocation();
  const opts = [...state.sats.values()].filter(s => s.info || state.favs.has(s.norad) || s.norad === state.trackNorad)
    .sort((a, b) => (!!b.info - !!a.info) || a.name.localeCompare(b.name))
    .map(s => `<option value="${s.norad}" ${s.norad === state.trackNorad ? 'selected' : ''}>${esc(s.name)}${s.alias ? ` (${esc(s.alias)})` : ''}</option>`).join('');
  return `<label class="field"><span>Satélite</span><select id="trackSel">${opts}</select></label>
    <div id="trackLive"></div>
    <h3>Apuntar con el teléfono</h3>
    <div class="card" id="pointerCard">${pointerHTML()}</div>
    <h3>Grabar la pasada</h3>
    <div class="card">${recButton(state.trackNorad)}</div>
    <div class="btns"><button class="btn secondary" data-action="wakelock">${state.wakeLock ? '🔆 Pantalla siempre encendida ✓' : '🔆 Mantener pantalla encendida'}</button></div>`;
}

function trackLiveHTML() {
  const s = state.sats.get(state.trackNorad);
  if (!s) return '<div class="empty">Elegí un satélite.</div>';
  const o = obs(), now = Date.now();
  const l = look(s.satrec, o, new Date(now));
  if (!l) return '<div class="empty">No se pudo calcular la posición (¿TLE viejo o satélite reingresado?).</div>';
  const passes = trackPassesFor(s.norad);
  // la que está en curso, o la próxima que supere la elevación mínima configurada
  const p = passes.find(x => x.los > now && x.aos <= now)
    || passes.find(x => x.aos > now && x.maxEl >= state.settings.minEl)
    || passes.find(x => x.los > now);
  const live = p && p.aos <= now;
  let status;
  if (live) status = `<div class="countdown" style="color:var(--good)">EN EL AIRE · se pone en ${fmtDur(p.los - now)}</div>`;
  else if (p) status = `<div class="countdown">AOS en ${fmtDur(p.aos - now)}</div><div class="small muted" style="text-align:center">${fmtDay(p.aos)} ${fmtTime(p.aos, true)} por el ${cardinal8(p.aosAz)} (${deg(p.aosAz)}) · máx ${deg(p.maxEl)}</div>`;
  else status = '<div class="countdown muted">Sin pasadas en 72 h</div>';

  // Hacia dónde apuntar: posición actual si está arriba, si no el punto de aparición
  const tgt = live ? { az: l.az, el: l.el } : p ? { az: p.aosAz, el: 0 } : { az: l.az, el: l.el };
  state.target = tgt;

  const modes = (s.info?.modes || []).filter(m => m.up != null || m.down != null);
  const dop = modes.map(m => `<div class="mode"><div class="mode-title">${esc(m.label)}</div><div class="freq num">
      ${m.up != null ? `<span class="up">↑ TX</span><span>${f3(doppler.up(center(m.up), l.rangeRate))} MHz ${m.tone ? `<span class="small muted">· ${esc(m.tone)}</span>` : ''}</span>` : ''}
      ${m.down != null ? `<span class="down">↓ RX</span><span>${f3(doppler.down(center(m.down), l.rangeRate))} MHz</span>` : ''}</div></div>`).join('');

  return `${status}
    <div class="card"><div class="small muted" style="margin-bottom:6px">${live ? 'Posición actual del satélite' : `Apuntá aquí para esperarlo (AOS)`}</div>
    <div class="big">
      <div class="kv"><div class="k">Azimut</div><div class="v">${deg(tgt.az)} <small>${cardinal(tgt.az)}</small></div></div>
      <div class="kv"><div class="k">Elevación</div><div class="v">${deg(Math.max(0, tgt.el))}</div></div>
    </div>
    <div class="gauges">${azGauge(tgt.az)}${elGauge(Math.max(0, tgt.el))}</div>
    <div class="pass-grid">
      <div class="kv"><div class="k">Distancia</div><div class="v">${Math.round(l.range)} km</div></div>
      <div class="kv"><div class="k">Altura</div><div class="v">${Math.round(l.alt)} km</div></div>
      <div class="kv"><div class="k">${l.rangeRate < 0 ? 'Acercándose' : 'Alejándose'}</div><div class="v">${Math.abs(l.rangeRate).toFixed(2)} km/s</div></div>
    </div>
    ${!live ? `<div class="small muted" style="margin-top:6px">Ahora está a ${deg(l.az)} az / ${deg(l.el)} elev. (bajo el horizonte)</div>` : ''}
    </div>
    ${p ? `<div class="card">${skyplot(p.track, { cur: l })}<div class="small muted" style="text-align:center"><span style="color:var(--good)">●</span> aparece · <span style="color:var(--bad)">●</span> se pone · N arriba, E a la derecha</div>
      <div class="btns" style="margin-top:8px;justify-content:center"><button class="btn secondary" data-passobj="${s.norad}">Ver guía de esta pasada</button></div></div>` : ''}
    ${dop ? `<div class="card"><div class="small muted">Frecuencias con Doppler en este instante</div>${dop}</div>` : ''}`;
}

function pointerHTML() {
  if (!state.compassOn) {
    return `<p class="small muted">Sujetá el teléfono <b>plano sobre el boom</b> de la Yagi, con la parte de arriba del teléfono apuntando hacia los directores (hacia adelante). La app te dice cuánto girar y cuánto inclinar.</p>
      <button class="btn block" data-action="compass">Activar brújula</button>
      <p class="small muted">Declinación magnética configurada: ${state.settings.decl}° (Ajustes). Alejá el teléfono de metales e imanes.</p>`;
  }
  const t = state.target;
  if (state.heading == null || !t) return '<div class="empty">Esperando la brújula… mové el teléfono en forma de 8 para calibrar.</div>';
  const dAz = normDelta(t.az - state.heading);
  const dEl = Math.max(0, t.el) - (state.pitch ?? 0);
  const locked = Math.abs(dAz) < 8 && Math.abs(dEl) < 8;
  const hint = locked ? '¡Apuntado! 🎯' : [
    Math.abs(dAz) >= 8 ? `Girá ${Math.round(Math.abs(dAz))}° a la ${dAz > 0 ? 'derecha ➡️' : '⬅️ izquierda'}` : '',
    Math.abs(dEl) >= 8 ? `${dEl > 0 ? 'Subí ⬆️' : 'Bajá ⬇️'} ${Math.round(Math.abs(dEl))}°` : '',
  ].filter(Boolean).join(' · ');
  const elY = v => 110 - Math.max(-10, Math.min(90, v)) / 90 * 100;
  return `<div class="pointer ${locked ? 'locked' : ''}">
    <svg viewBox="0 0 260 145">
      <g transform="translate(70 62)">
        <circle r="56" fill="none" stroke="${locked ? 'var(--good)' : 'var(--line)'}" stroke-width="3"/>
        <g transform="rotate(${dAz.toFixed(1)})"><path d="M0 -50 L12 -20 L4 -20 L4 30 L-4 30 L-4 -20 L-12 -20 Z" fill="${locked ? 'var(--good)' : 'var(--accent)'}"/></g>
        <text class="gauge-lbl" y="70">rumbo ${deg(state.heading)} → ${deg(t.az)}</text>
      </g>
      <g transform="translate(170 0)">
        <rect x="20" y="10" width="20" height="100" rx="6" fill="var(--panel2)" stroke="var(--line)"/>
        <line x1="12" x2="48" y1="${elY(Math.max(0, t.el))}" y2="${elY(Math.max(0, t.el))}" stroke="var(--good)" stroke-width="4"/>
        <circle cx="30" cy="${elY(state.pitch ?? 0)}" r="7" fill="var(--accent)"/>
        <text class="gauge-lbl" x="70" y="${elY(Math.max(0, t.el)) + 3}">obj ${deg(Math.max(0, t.el))}</text>
        <text class="gauge-lbl" x="30" y="124">inclin. ${deg(state.pitch ?? 0)}</text>
      </g>
    </svg>
    <div class="hint">${hint}</div></div>
    <button class="btn secondary block" data-action="compass-off">Apagar brújula</button>`;
}

function viewSettings() {
  const L = state.loc || {};
  const age = state.tle?.ts ? fmtDur(Date.now() - state.tle.ts) : null;
  const iss = state.sats.get(25544);
  const epoch = iss ? tleEpoch(iss.tle) : null;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const sel = (key, vals, unit) => `<select data-setting="${key}">${vals.map(v => `<option value="${v}" ${state.settings[key] == v ? 'selected' : ''}>${v}${unit}</option>`).join('')}</select>`;
  return `<h2>Ajustes</h2>
  <div class="card"><h3 style="margin-top:0">🪪 Mi estación</h3>
    <label class="field"><span>Mi indicativo (va en el ADIF para LoTW / QRZ)</span>
      <input data-setting="myCall" autocapitalize="characters" autocomplete="off" value="${esc(state.settings.myCall)}" placeholder="LU1ABC"></label>
  </div>
  <div class="card"><h3 style="margin-top:0">📍 Ubicación</h3>
    <button class="btn block" data-action="gps">Usar GPS del teléfono</button>
    <div class="grid3" style="margin-top:8px">
      <label class="field"><span>Latitud</span><input id="lat" inputmode="decimal" value="${L.lat ?? ''}" placeholder="-34.60"></label>
      <label class="field"><span>Longitud</span><input id="lon" inputmode="decimal" value="${L.lon ?? ''}" placeholder="-58.38"></label>
      <label class="field"><span>Altura (m)</span><input id="alt" inputmode="decimal" value="${L.alt ?? 0}"></label>
    </div>
    <button class="btn secondary block" data-action="save-loc">Guardar ubicación</button>
    ${state.loc ? `<p class="small muted">Grid locator: <b>${maidenhead(L.lat, L.lon)}</b> · Sur y Oeste son negativos.</p>` : '<p class="small muted">Sur y Oeste son negativos.</p>'}
  </div>
  <div class="card"><h3 style="margin-top:0">Filtros de pasadas</h3>
    <div class="grid2">
      <label class="field"><span>Elevación máxima mínima</span>${sel('minEl', [0, 5, 10, 15, 20, 30, 45], '°')}</label>
      <label class="field"><span>Horizonte de predicción</span>${sel('hours', [12, 24, 48, 72], ' h')}</label>
    </div>
    <label class="switch"><span>Mostrar todos los satélites amateur de CelesTrak</span><input type="checkbox" data-setting="showAll" ${state.settings.showAll ? 'checked' : ''}></label>
  </div>
  <div class="card"><h3 style="margin-top:0">🧭 Brújula</h3>
    <label class="field"><span>Declinación magnética (° — Este positivo, Oeste negativo)</span>
      <input data-setting="decl" inputmode="decimal" value="${state.settings.decl}"></label>
    <p class="small muted">La brújula del teléfono marca el norte magnético. Consultá tu declinación en
      <a href="https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml" target="_blank" rel="noopener">NOAA</a>
      (ej.: Buenos Aires ≈ −9°, Madrid ≈ +1°, Ciudad de México ≈ +4°).</p>
  </div>
  <div class="card"><h3 style="margin-top:0">Pantalla</h3>
    <label class="switch"><span>Modo nocturno rojo (conserva visión nocturna)</span><input type="checkbox" data-setting="night" ${state.settings.night ? 'checked' : ''}></label>
  </div>
  <div class="card"><h3 style="margin-top:0">🛰️ Elementos orbitales (TLE)</h3>
    <p class="small muted">Fuente: ${esc(state.tle?.src || '—')} ${age ? `· descargados hace ${age}` : ''}<br>
      ${epoch ? `Época TLE de la ISS: ${epoch.toLocaleString('es')}` : ''}<br>${state.sats.size} satélites cargados. Se actualizan solos cada 12 h si hay conexión.</p>
    <button class="btn secondary block" data-action="update-tle">Actualizar ahora</button>
  </div>
  <div class="card"><h3 style="margin-top:0">📲 Instalar en el teléfono</h3>
    ${standalone ? '<p class="small">Ya está instalada ✔ Funciona sin conexión.</p>'
      : state.installPrompt ? '<button class="btn block" data-action="install">Instalar app</button>'
      : isIOS ? '<p class="small">En iPhone: abrí en <b>Safari</b> → botón <b>Compartir</b> → <b>Agregar a pantalla de inicio</b>.</p>'
      : '<p class="small">En Android/Chrome: menú ⋮ → <b>Instalar app</b> (o "Agregar a pantalla principal").</p>'}
  </div>
  <p class="small muted">Predicción con SGP4 (satellite.js). Datos orbitales de CelesTrak. Verificá estado y frecuencias en AMSAT antes de transmitir.</p>`;
}

function render() {
  document.body.classList.toggle('night', !!state.settings.night);
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  const L = state.loc;
  $('#locChip').textContent = L ? `📍 ${L.lat.toFixed(2)}, ${L.lon.toFixed(2)} · ${maidenhead(L.lat, L.lon).slice(0, 4)}` : '📍 Sin ubicación';
  const v = $('#view');
  const html = { passes: viewPasses, sats: viewSats, track: viewTrack, log: viewLog, settings: viewSettings }[state.view]();
  v.innerHTML = html;
  if (state.view === 'track') updateTrack();
  if (state.view === 'log') loadLog();
  tickCountdowns();
  updateRecBar();
}

function setView(view) {
  state.view = view;
  render();
  $('#view').scrollTop = 0;
}

// ---------- hoja de detalle de pasada ----------
function openPassSheet(p) {
  const s = state.sats.get(p.norad);
  const body = `<button class="close" data-action="close-sheet" aria-label="Cerrar">✕</button>
    <h2>${esc(s.name)} <span class="small muted">${esc(s.alias)}</span></h2>
    <div class="small muted">${fmtDay(p.aos)} · ${fmtTime(p.aos)}–${fmtTime(p.los)} · <span data-cd="${+p.aos}" data-end="${+p.los}"></span></div>
    <div class="card" style="margin-top:10px">${skyplot(p.track, { cur: look(s.satrec, obs(), new Date()) })}
      <div class="small muted" style="text-align:center"><span style="color:var(--good)">●</span> aparece · <span style="color:var(--bad)">●</span> se pone · N arriba, E a la derecha</div></div>
    <table class="tbl"><tr><th></th><th>Hora</th><th>Azimut</th><th>Elev.</th></tr>
      <tr><td>🟢 Aparece (AOS)</td><td>${fmtTime(p.aos, true)}</td><td>${deg(p.aosAz)} ${cardinal(p.aosAz)}</td><td>0°</td></tr>
      <tr><td>⬆️ Máximo</td><td>${fmtTime(p.tca, true)}</td><td>${deg(p.tcaAz)} ${cardinal(p.tcaAz)}</td><td>${deg(p.maxEl)}</td></tr>
      <tr><td>🔴 Se pone (LOS)</td><td>${fmtTime(p.los, true)}</td><td>${deg(p.losAz)} ${cardinal(p.losAz)}</td><td>0°</td></tr></table>
    <h3>Cómo apuntar la Yagi</h3><div class="card">${yagiGuide(s, p)}</div>
    <h3>Tabla de apuntado</h3><div class="card">${pointingTable(s, p)}</div>
    ${dopplerTable(s, p)}
    ${s.info ? `<h3>Frecuencias</h3><div class="card">${s.info.modes.map(modeBlock).join('')}</div>` : ''}
    <div class="btns"><button class="btn grow" data-track="${s.norad}">🎯 Seguir en vivo</button></div>
    <div style="margin-top:8px">${recButton(s.norad)}</div>`;
  $('#sheetBody').innerHTML = body;
  const d = $('#sheet');
  if (!d.open) d.showModal();
  d.scrollTop = 0;
  tickCountdowns();
}

// ---------- brújula / orientación ----------
function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null) return;
  const screenAngle = (screen.orientation?.angle ?? window.orientation ?? 0);
  h = (h + screenAngle + Number(state.settings.decl || 0) + 720) % 360;
  // suavizado
  state.heading = state.heading == null ? h : (state.heading + normDelta(h - state.heading) * 0.3 + 360) % 360;
  state.pitch = e.beta ?? 0;
  if (!onOrientation.raf) onOrientation.raf = requestAnimationFrame(() => {
    onOrientation.raf = 0;
    const pc = $('#pointerCard');
    if (pc && state.view === 'track') pc.innerHTML = pointerHTML();
  });
}

async function enableCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') throw new Error('permiso denegado');
    }
    if (!('ondeviceorientation' in window) && !('ondeviceorientationabsolute' in window)) throw new Error('este dispositivo no tiene brújula');
    window.addEventListener('deviceorientationabsolute', onOrientation, true);
    window.addEventListener('deviceorientation', onOrientation, true);
    state.compassOn = true;
    render();
  } catch (e) {
    toast(`Brújula: ${e.message}`);
  }
}

function disableCompass() {
  window.removeEventListener('deviceorientationabsolute', onOrientation, true);
  window.removeEventListener('deviceorientation', onOrientation, true);
  state.compassOn = false; state.heading = null;
  render();
}

async function toggleWakeLock() {
  try {
    if (state.wakeLock) { await state.wakeLock.release(); state.wakeLock = null; }
    else if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    } else throw new Error('no soportado en este navegador');
    state._wantWake = !!state.wakeLock;
  } catch (e) { toast(`Pantalla: ${e.message}`); }
  render();
}

// ---------- ubicación ----------
function setLoc(lat, lon, alt) {
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { toast('Coordenadas inválidas'); return; }
  state.loc = { lat: +(+lat).toFixed(5), lon: +(+lon).toFixed(5), alt: +alt || 0 };
  LS.set('loc', state.loc);
  state.trackPasses.norad = null;
  computePasses();
  render();
}

function useGPS() {
  if (!navigator.geolocation) return toast('Geolocalización no disponible');
  toast('Obteniendo ubicación…', 15000);
  navigator.geolocation.getCurrentPosition(
    pos => { setLoc(pos.coords.latitude, pos.coords.longitude, pos.coords.altitude || 0); toast('Ubicación actualizada ✔'); },
    err => toast(`No se pudo obtener la ubicación: ${err.message}`),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

// ---------- grabación ----------
const myGrid = () => state.loc ? maidenhead(state.loc.lat, state.loc.lon) : '';
const utcHMS = t => new Date(t).toISOString().slice(11, 19);
const utcInput = t => new Date(t).toISOString().slice(0, 19);
const stamp = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; };

function recButton(norad) {
  if (!canRecord()) return '<p class="small muted">Este navegador no permite grabar audio.</p>';
  const r = state.recorder;
  if (r.active) {
    return `<p class="small" style="margin-top:0">🔴 Grabando <b>${esc(r.rec.satName)}</b>…</p>
      <div class="btns"><button class="btn grow" data-action="qso-mark">＋ Marcar QSO</button>
      <button class="btn secondary" data-action="rec-stop">■ Detener</button></div>`;
  }
  return `<button class="btn block rec" data-action="rec-start" data-norad="${norad}">🎙️ Grabar pasada</button>
    <p class="small muted">Graba por el micrófono del teléfono (acercalo al parlante del equipo) o con un cable de audio.
    En cada contacto tocá <b>＋ Marcar QSO</b>: queda la hora exacta y una marca en el audio para volver a escucharlo.
    La pantalla queda encendida; si se bloquea, el sistema puede cortar la grabación.</p>`;
}

async function startRecording(norad) {
  const s = state.sats.get(norad);
  try {
    await state.recorder.start({ norad, satName: s?.name || String(norad), lotwSat: s?.info?.lotw || '', myGrid: myGrid() });
    if (!state.wakeLock && 'wakeLock' in navigator) await toggleWakeLock();
    toast('🔴 Grabando');
  } catch (e) {
    toast(`No se pudo grabar: ${e.name === 'NotAllowedError' ? 'permiso de micrófono denegado' : e.message}`, 5000);
  }
  render();
}

async function stopRecording() {
  try {
    const r = await state.recorder.stop();
    if (r) toast(`Grabación guardada (${fmtDur(r.duration)}). Está en la pestaña Log.`, 4000);
  } catch (e) { toast(`Error al guardar: ${e.message}`, 5000); }
  render();
}

function updateRecBar() {
  const bar = $('#recbar'), r = state.recorder;
  bar.hidden = !r.active;
  document.body.classList.toggle('recording', r.active);
  if (!r.active) return;
  $('#recTime').textContent = fmtDur(r.elapsed());
  $('#recSat').textContent = r.rec.satName;
}
setInterval(() => {
  if (state.recorder.active) $('#recLevel').style.width = `${Math.round(state.recorder.level() * 100)}%`;
}, 120);

// ---------- QSOs ----------
// Sin indicativo propio cargado no puede haber contacto: todo cuenta como escucha.
const isListen = q => !!q.listen || !state.settings.myCall;
function satModes(norad) {
  return (state.sats.get(norad)?.info?.modes || BY_NORAD.get(norad)?.modes || []).filter(m => m.down != null);
}

function modeOptions(norad, sel = 0) {
  const ms = satModes(norad);
  return ms.length ? ms.map((m, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(m.label)}</option>`).join('')
    : '<option value="-1">(sin datos: cargá frecuencias)</option>';
}

function applySatMode(norad, idx) {
  const m = satModes(norad)[idx];
  if (!m) return;
  $('#q_freq').value = m.up != null ? f3(center(m.up)) : ''; // sólo recepción: sin subida
  $('#q_freqRx').value = f3(center(m.down));
  const mode = adifMode(m.upMode || m.downMode);
  $('#q_mode').value = mode;
  // satélite o modo sólo de recepción (sin subida): es una escucha
  const cb = $('#q_listen');
  if (cb && !cb.disabled && m.up == null) cb.checked = true;
  updateBandHint();
}

function updateBandHint() {
  const tx = parseFloat($('#q_freq')?.value), rx = parseFloat($('#q_freqRx')?.value);
  const h = $('#q_bands');
  if (h) h.textContent = `Banda TX: ${bandOf(tx) || '—'} · Banda RX: ${bandOf(rx) || '—'}`;
}

function openQsoForm(draft) {
  const q = { rstSent: '59', rstRcvd: '59', mode: 'FM', call: '', grid: '', note: '', ...draft };
  const norad = q.norad ?? state.recorder.rec?.norad ?? state.trackNorad;
  q.norad = norad;
  state.qsoDraft = q;
  const satOpts = [...SATS.map(x => x.norad), ...(SATS.some(x => x.norad === norad) ? [] : [norad])]
    .map(n => `<option value="${n}" ${n === norad ? 'selected' : ''}>${esc(state.sats.get(n)?.name || BY_NORAD.get(n)?.name || q.satName || n)}</option>`).join('');
  $('#sheetBody').innerHTML = `<button class="close" data-action="close-sheet" aria-label="Cerrar">✕</button>
    <h2>${q.id ? 'Editar QSO' : 'Nuevo QSO'}</h2>
    ${q.recId ? `<p class="small muted">Marca en la grabación: ${fmtDur(q.offset || 0)}</p>` : ''}
    <div class="grid2">
      <label class="field"><span>Indicativo *</span><input id="q_call" autocapitalize="characters" autocomplete="off" value="${esc(q.call)}" placeholder="LU1ABC"></label>
      <label class="field"><span>Grid locator</span><input id="q_grid" autocapitalize="characters" autocomplete="off" value="${esc(q.grid)}" placeholder="GF05"></label>
      <label class="field"><span>RST enviado</span><input id="q_rstSent" inputmode="numeric" value="${esc(q.rstSent)}"></label>
      <label class="field"><span>RST recibido</span><input id="q_rstRcvd" inputmode="numeric" value="${esc(q.rstRcvd)}"></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Satélite</span><select id="q_sat">${satOpts}</select></label>
      <label class="field"><span>Repetidora / transpondedor</span><select id="q_smode">${modeOptions(norad, q.smode ?? 0)}</select></label>
      <label class="field"><span>TX (subida) MHz</span><input id="q_freq" inputmode="decimal" value="${q.freq ? f3(q.freq) : ''}"></label>
      <label class="field"><span>RX (bajada) MHz</span><input id="q_freqRx" inputmode="decimal" value="${q.freqRx ? f3(q.freqRx) : ''}"></label>
      <label class="field"><span>Modo</span><select id="q_mode">${['FM', 'SSB', 'CW', 'SSTV', 'PKT', 'DATA'].map(m => `<option ${m === q.mode ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="field"><span>Fecha y hora (UTC)</span><input id="q_time" type="datetime-local" step="1" value="${utcInput(q.time)}"></label>
    </div>
    <div class="small muted" id="q_bands"></div>
    <label class="switch"><span>🎧 Solo escucha (no hubo contacto)
      <div class="small muted">${state.settings.myCall ? 'Se muestra en la imagen pero no se exporta a LoTW/QRZ.' : 'No cargaste tu indicativo en Ajustes: todo queda como escucha.'}</div></span>
      <input type="checkbox" id="q_listen" ${isListen(q) ? 'checked' : ''} ${state.settings.myCall ? '' : 'disabled'}></label>
    <label class="field"><span>Nota</span><input id="q_note" value="${esc(q.note)}" placeholder="opcional"></label>
    <button class="btn block" data-action="qso-save">Guardar</button>`;
  if (!q.id) applySatMode(norad, q.smode ?? 0);
  updateBandHint();
  const d = $('#sheet');
  if (!d.open) d.showModal();
  if (!q.call) setTimeout(() => $('#q_call')?.focus(), 50);
}

async function saveQsoForm() {
  const q = state.qsoDraft;
  const call = $('#q_call').value.trim().toUpperCase();
  if (!/^[A-Z0-9/]{3,15}$/.test(call) || !/[0-9]/.test(call) || !/[A-Z]/.test(call)) { toast('Revisá el indicativo'); $('#q_call').focus(); return; }
  const time = Date.parse(`${$('#q_time').value}Z`);
  if (Number.isNaN(time)) { toast('Fecha/hora inválida'); return; }
  const norad = +$('#q_sat').value;
  const s = state.sats.get(norad);
  const rec = { ...q,
    id: q.id || uid(), call,
    grid: $('#q_grid').value.trim().toUpperCase(),
    rstSent: $('#q_rstSent').value.trim(), rstRcvd: $('#q_rstRcvd').value.trim(),
    norad, satName: s?.name || BY_NORAD.get(norad)?.name || q.satName || String(norad),
    lotwSat: (s?.info || BY_NORAD.get(norad))?.lotw || '',
    smode: +$('#q_smode').value,
    freq: parseFloat($('#q_freq').value.replace(',', '.')) || null,
    freqRx: parseFloat($('#q_freqRx').value.replace(',', '.')) || null,
    mode: $('#q_mode').value, time, note: $('#q_note').value.trim(),
    myGrid: q.myGrid || myGrid(), myCall: state.settings.myCall || '',
    listen: state.settings.myCall ? $('#q_listen').checked : !!q.listen,
    exported: false,
  };
  if (q.recId && q.recStart) rec.offset = Math.max(0, time - q.recStart);
  await db.put('qsos', rec);
  $('#sheet').close();
  toast(isListen(rec) ? `Escucha de ${call} guardada ✔` : `QSO con ${call} guardado ✔`);
  if (state.view === 'log') loadLog();
}

async function editQso(id) {
  const q = await db.get('qsos', id);
  if (!q) return;
  const r = q.recId ? await db.get('recordings', q.recId) : null;
  openQsoForm({ ...q, recStart: r?.start });
}

async function deleteQso(id) {
  const q = await db.get('qsos', id);
  if (!q || !confirm(isListen(q) ? `¿Borrar la escucha de ${q.call}?` : `¿Borrar el QSO con ${q.call}?`)) return;
  await db.del('qsos', id);
  loadLog();
}

function markQso() {
  const r = state.recorder;
  if (!r.active) return openQsoForm({ time: Date.now() });
  const now = Date.now();
  openQsoForm({ recId: r.rec.id, recStart: r.rec.start, offset: now - r.rec.start, time: now, norad: r.rec.norad });
}

async function qsoAtAudio(recId) {
  const rec = await db.get('recordings', recId);
  const a = $(`#audio-${CSS.escape(recId)}`);
  const offset = Math.round((a?.currentTime || 0) * 1000);
  a?.pause();
  openQsoForm({ recId, recStart: rec.start, offset, time: rec.start + offset, norad: rec.norad });
}

function seekAudio(recId, offset) {
  const a = $(`#audio-${CSS.escape(recId)}`);
  if (!a) return;
  a.currentTime = Math.max(0, offset / 1000 - 3);
  a.play().catch(() => {});
}

// ---------- archivos ----------
async function shareOrDownload(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

async function downloadRecording(id) {
  const r = await db.get('recordings', id);
  if (!r?.blob) return;
  await shareOrDownload(new File([r.blob], `${r.satName}_${stamp(r.start)}.${extFor(r.mime)}`, { type: r.blob.type || r.mime }));
}

async function deleteRecording(id) {
  const r = await db.get('recordings', id);
  if (!r || !confirm(`¿Borrar la grabación de ${r.satName} del ${new Date(r.start).toLocaleString('es')}? No se puede deshacer. Los QSOs marcados se conservan.`)) return;
  await db.del('recordings', id);
  loadLog();
}

async function exportAdif(all) {
  if (!state.settings.myCall) return toast('Cargá tu indicativo en Ajustes: sin él todo queda como escucha y no se exporta', 5000);
  // las escuchas no son contactos: no van a LoTW/QRZ
  const qsos = (await db.all('qsos')).filter(q => !isListen(q) && (all || !q.exported)).sort((a, b) => a.time - b.time);
  if (!qsos.length) return toast(all ? 'Todavía no hay QSOs (las escuchas no se exportan)' : 'No hay QSOs nuevos para exportar');
  const text = toADIF(qsos, { myCall: state.settings.myCall });
  const ok = await shareOrDownload(new File([text], `sattracker_${stamp(Date.now())}.adi`, { type: 'text/plain' }));
  if (!ok) return;
  for (const q of qsos) await db.put('qsos', { ...q, exported: true });
  toast(`${qsos.length} QSO(s) exportados ✔`);
  loadLog();
}

// ---------- imagen para redes ----------
// Agrupa QSOs sueltos por satélite y pasada (QSOs a menos de 25 min entre sí)
const looseKey = q => `${q.norad}|${Math.floor(q.time / (25 * 60e3))}`;

async function shareImageFor({ recId, key }) {
  const all = await db.all('qsos');
  let qsos, rec = null;
  if (recId) {
    rec = await db.get('recordings', recId);
    qsos = all.filter(q => q.recId === recId);
  } else {
    const recIds = new Set((await db.all('recordings')).map(r => r.id));
    qsos = all.filter(q => (!q.recId || !recIds.has(q.recId)) && looseKey(q) === key);
  }
  const times = qsos.map(q => q.time);
  const norad = rec?.norad ?? qsos[0]?.norad;
  const start = rec?.start ?? Math.min(...times);
  const end = rec?.end ?? (times.length ? Math.max(...times) : null);
  const s = state.sats.get(norad);
  const myG = rec?.myGrid || qsos[0]?.myGrid || myGrid();
  const myLoc = gridCenter(myG);
  let track = [], marks = [], ground = [], footprint = null;
  const o = myLoc ? observer(myLoc.lat, myLoc.lon, 0) : obs();
  if (s && o) {
    const ref = times.length ? times[Math.floor(times.length / 2)] : start;
    const pass = findPasses(s.satrec, o, { start: new Date(ref - 30 * 60e3), hours: 1.5, minEl: 0 })
      .find(p => +p.aos - 5 * 60e3 <= ref && ref <= +p.los + 5 * 60e3);
    if (pass) track = pass.track;
    marks = qsos.map(q => { const l = look(s.satrec, o, new Date(q.time)); return l && { ...l, listen: isListen(q) }; }).filter(l => l && l.el > -2);
    // traza en tierra de la pasada (o ±8 min alrededor de los QSOs) y huella en el QSO central
    const t0 = pass ? +pass.aos : ref - 8 * 60e3, t1 = pass ? +pass.los : ref + 8 * 60e3;
    for (let t = t0; t <= t1; t += 20e3) { const l = look(s.satrec, o, new Date(t)); if (l) ground.push({ lat: l.lat, lon: l.lon }); }
    const c = look(s.satrec, o, new Date(ref));
    if (c && c.el > -2) footprint = { lat: c.lat, lon: c.lon, alt: c.alt };
  }
  const cv = renderPassImage({
    satName: rec?.satName || qsos[0]?.satName || s?.name || '', alias: s?.alias || '',
    start, end, myCall: state.settings.myCall || '', myGrid: myG,
    myLoc: myLoc || (state.loc && { lat: state.loc.lat, lon: state.loc.lon }), qsos: qsos.map(q => ({ ...q, listen: isListen(q) })), track, marks, ground, footprint,
  });
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const name = `${(rec?.satName || qsos[0]?.satName || 'sat').replace(/[^\w-]/g, '')}_${stamp(start)}.png`;
  state.shareFile = new File([blob], name, { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  $('#sheetBody').innerHTML = `<button class="close" data-action="close-sheet" aria-label="Cerrar">✕</button>
    <h2>Imagen para redes</h2>
    ${state.settings.myCall ? '' : '<p class="small" style="color:var(--warn)">Cargá tu indicativo en Ajustes para que aparezca en la imagen.</p>'}
    <img src="${url}" alt="Resumen de la pasada" style="width:100%;border-radius:12px;border:1px solid var(--line)">
    <button class="btn block" data-action="img-share" style="margin-top:10px">📤 Compartir / guardar</button>
    <p class="small muted">En el teléfono abre el menú para compartir (Instagram, WhatsApp, X, Facebook…) o guardar en Fotos.</p>`;
  const d = $('#sheet');
  if (!d.open) d.showModal();
  d.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
}

// ---------- vista Log ----------
function viewLog() {
  return `<div class="row"><h2 class="grow">Log y grabaciones</h2>
    <button class="btn secondary" data-action="qso-new">＋ QSO manual</button></div>
    <div id="logBody"><div class="empty">Cargando…</div></div>`;
}

let logUrls = [];
async function loadLog() {
  const body = $('#logBody');
  if (!body) return;
  const [recs, qsos] = await Promise.all([db.all('recordings'), db.all('qsos')]);
  logUrls.forEach(u => URL.revokeObjectURL(u));
  logUrls = [];
  const recIds = new Set(recs.map(r => r.id));
  const contacts = qsos.filter(q => !isListen(q));
  const pending = contacts.filter(q => !q.exported).length;

  const qsoRows = list => list.sort((a, b) => a.time - b.time).map(q => `<tr>
      <td>${utcHMS(q.time)}</td><td>${isListen(q) ? '🎧' : '🤝'} <b>${esc(q.call)}</b><div class="small muted">${esc(q.grid)} ${esc(q.mode)}</div></td>
      <td class="small">${esc(q.rstSent)}/${esc(q.rstRcvd)}<div>${isListen(q) ? 'escucha' : q.exported ? '✓ export.' : '<span style="color:var(--warn)">nuevo</span>'}</div></td>
      <td class="nowrap">${q.recId && recIds.has(q.recId) ? `<button class="mini" data-action="seek" data-rec="${esc(q.recId)}" data-offset="${q.offset || 0}">▶ ${fmtDur(q.offset || 0)}</button>` : ''}
        <button class="mini" data-action="qso-edit" data-qso="${esc(q.id)}">✎</button>
        <button class="mini" data-action="qso-del" data-qso="${esc(q.id)}">🗑</button></td></tr>`).join('');
  const table = list => list.length ? `<table class="tbl"><tr><th>UTC</th><th>Indicativo</th><th>RST</th><th></th></tr>${qsoRows(list)}</table>` : '';

  let h = `<div class="card">
    <div class="row"><b class="grow">Exportar para LoTW / QRZ</b><span class="small muted">${contacts.length} QSO · ${pending} nuevos${qsos.length > contacts.length ? ` · ${qsos.length - contacts.length} escuchas` : ''}</span></div>
    ${state.settings.myCall ? '' : '<p class="small" style="color:var(--warn)">Cargá tu indicativo en Ajustes antes de exportar.</p>'}
    <div class="btns" style="margin-top:8px"><button class="btn grow" data-action="export-new" ${pending ? '' : 'disabled'}>⬇ ADIF nuevos (${pending})</button>
      <button class="btn secondary" data-action="export-all" ${qsos.length ? '' : 'disabled'}>Todos</button></div>
    <details class="small muted" style="margin-top:8px"><summary>¿Cómo los subo?</summary>
      <p><b>LoTW:</b> pasá el archivo .adi a la compu, abrilo con <b>TQSL</b> → "Sign a log and upload it automatically", elegí tu Station Location. LoTW exige el nombre exacto del satélite (la ISS va como <b>ARISS</b>; la app lo pone sola).</p>
      <p><b>QRZ:</b> en qrz.com → Logbook → <b>Settings</b> → <b>ADIF Import</b>, subí el .adi.</p>
      <p>El audio no se sube a ninguno de los dos: queda en tu teléfono para confirmar indicativos y grids escuchando de nuevo.</p></details>
  </div>`;

  for (const r of recs.sort((a, b) => b.start - a.start)) {
    const url = r.blob ? URL.createObjectURL(r.blob) : '';
    if (url) logUrls.push(url);
    const rq = qsos.filter(q => q.recId === r.id);
    h += `<div class="card">
      <div class="row"><b>${esc(r.satName)}</b><span class="small muted">${fmtDay(r.start)} ${fmtTime(r.start)}</span><span class="grow"></span>
        ${r.status === 'recovered' ? '<span class="badge intermitente">recuperada</span>' : r.status === 'recording' ? '<span class="badge live">grabando</span>' : `<span class="small muted">${fmtDur(r.duration)}</span>`}</div>
      ${url ? `<audio id="audio-${esc(r.id)}" controls preload="metadata" src="${url}"></audio>` : ''}
      ${table(rq)}
      ${r.status === 'recording' ? '' : `<div class="btns" style="margin-top:8px">
        <button class="btn secondary grow" data-action="qso-here" data-rec="${esc(r.id)}">＋ QSO en este punto</button>
        <button class="btn secondary" data-action="share-img" data-rec="${esc(r.id)}" aria-label="Imagen para redes">🖼</button>
        <button class="btn secondary" data-action="rec-dl" data-rec="${esc(r.id)}" aria-label="Descargar audio">⬇</button>
        <button class="btn secondary" data-action="rec-del" data-rec="${esc(r.id)}" aria-label="Borrar grabación">🗑</button></div>`}
    </div>`;
  }
  const loose = qsos.filter(q => !q.recId || !recIds.has(q.recId));
  if (loose.length) {
    h += '<h3>QSOs sin grabación</h3>';
    const groups = new Map();
    for (const q of loose) {
      const k = looseKey(q);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(q);
    }
    for (const [k, list] of [...groups].sort((a, b) => b[1][0].time - a[1][0].time)) {
      h += `<div class="card"><div class="row"><b>${esc(list[0].satName)}</b><span class="small muted">${fmtDay(list[0].time)}</span><span class="grow"></span>
        <button class="btn secondary" data-action="share-group" data-key="${esc(k)}">🖼 Imagen</button></div>${table(list)}</div>`;
    }
  }
  if (!recs.length && !qsos.length) h += '<div class="empty">Todavía no hay grabaciones ni QSOs.<br>Grabá una pasada desde la pestaña <b>Apuntar</b>.</div>';
  body.innerHTML = h;
}

// ---------- eventos ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-view],[data-pass],[data-passobj],[data-track],[data-fav],[data-action],#locChip');
  if (!el) return;
  if (el.id === 'locChip') return setView('settings');
  if (el.dataset.view) return setView(el.dataset.view);
  if (el.dataset.pass) {
    const p = state.passes.find(x => x.id === el.dataset.pass);
    if (p) openPassSheet(p);
    return;
  }
  if (el.dataset.passobj) {
    const now = Date.now(), list = trackPassesFor(+el.dataset.passobj);
    const p = list.find(x => x.los > now && x.aos <= now)
      || list.find(x => x.aos > now && x.maxEl >= state.settings.minEl) || list.find(x => x.los > now);
    if (p) openPassSheet({ ...p, norad: +el.dataset.passobj });
    return;
  }
  if (el.dataset.track) {
    state.trackNorad = +el.dataset.track; LS.set('track', state.trackNorad);
    $('#sheet').open && $('#sheet').close();
    return setView('track');
  }
  if (el.dataset.fav) {
    const n = +el.dataset.fav;
    state.favs.has(n) ? state.favs.delete(n) : state.favs.add(n);
    saveFavs(); computePasses(); render();
    return;
  }
  switch (el.dataset.action) {
    case 'gps': return useGPS();
    case 'save-loc': return setLoc(parseFloat($('#lat').value.replace(',', '.')), parseFloat($('#lon').value.replace(',', '.')), parseFloat($('#alt').value) || 0);
    case 'update-tle': el.disabled = true; await loadTLE(true); computePasses(); return render();
    case 'compass': return enableCompass();
    case 'compass-off': return disableCompass();
    case 'wakelock': return toggleWakeLock();
    case 'close-sheet': return $('#sheet').close();
    case 'rec-start': return startRecording(+el.dataset.norad || state.trackNorad);
    case 'rec-stop': return stopRecording();
    case 'qso-mark': return markQso();
    case 'qso-new': return openQsoForm({ time: Date.now() });
    case 'qso-here': return qsoAtAudio(el.dataset.rec);
    case 'qso-edit': return editQso(el.dataset.qso);
    case 'qso-del': return deleteQso(el.dataset.qso);
    case 'qso-save': return saveQsoForm();
    case 'seek': return seekAudio(el.dataset.rec, +el.dataset.offset);
    case 'rec-dl': return downloadRecording(el.dataset.rec);
    case 'rec-del': return deleteRecording(el.dataset.rec);
    case 'export-new': return exportAdif(false);
    case 'export-all': return exportAdif(true);
    case 'share-img': return shareImageFor({ recId: el.dataset.rec });
    case 'share-group': return shareImageFor({ key: el.dataset.key });
    case 'img-share': return state.shareFile && shareOrDownload(state.shareFile);
    case 'install':
      if (state.installPrompt) { state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; render(); }
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q_freq' || e.target.id === 'q_freqRx') updateBandHint();
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'q_sat') { $('#q_smode').innerHTML = modeOptions(+t.value); return applySatMode(+t.value, 0); }
  if (t.id === 'q_smode') return applySatMode(+$('#q_sat').value, +t.value);
  if (t.id === 'trackSel') {
    state.trackNorad = +t.value; LS.set('track', state.trackNorad);
    return updateTrack();
  }
  const key = t.dataset.setting;
  if (!key) return;
  state.settings[key] = t.type === 'checkbox' ? t.checked
    : key === 'decl' ? parseFloat(t.value.replace(',', '.')) || 0
    : key === 'myCall' ? (t.value = t.value.trim().toUpperCase())
    : +t.value;
  saveSettings();
  if (key === 'minEl' || key === 'hours') computePasses();
  if (key === 'night') document.body.classList.toggle('night', state.settings.night);
});

$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') e.target.close(); });

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); state.installPrompt = e;
  if (state.view === 'settings') render();
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    if (state.wakeLock === null && state._wantWake) toggleWakeLock();
    ensurePasses();
  }
});

// ---------- reloj ----------
function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll('[data-cd]').forEach(el => {
    const a = +el.dataset.cd, b = +el.dataset.end;
    el.textContent = now < a ? `en ${fmtDur(a - now)}` : now < b ? `🟢 EN CURSO · quedan ${fmtDur(b - now)}` : 'terminada';
    el.style.color = now >= a && now < b ? 'var(--good)' : '';
  });
}

function updateTrack() {
  const tl = $('#trackLive');
  if (tl) tl.innerHTML = trackLiveHTML();
}

let lastMinute = -1;
function tick() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  tickCountdowns();
  updateRecBar();
  if (state.view === 'track') updateTrack();
  if (now.getMinutes() !== lastMinute) {
    lastMinute = now.getMinutes();
    if (state.view === 'passes' && state.loc) {
      const before = state.passes.length;
      ensurePasses();
      if (state.passes.length !== before) render();
    }
  }
}

// ---------- arranque ----------
(async function main() {
  render();
  recoverOrphans().then(n => n && toast(`Se recuperaron ${n} grabación(es) que quedaron a medias`)).catch(() => {});
  await loadTLE();
  computePasses();
  render();
  setInterval(tick, 1000);
  tick();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
