import * as S from '../vendor/satellite.esm.js';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const C_KMS = 299792.458;

export function parseTLE(text) {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      const l1 = lines[i + 1], l2 = lines[i + 2];
      out.push({ name: lines[i].trim(), norad: parseInt(l1.slice(2, 7), 10), l1, l2 });
      i += 2;
    }
  }
  return out;
}

export function makeSatrec(tle) {
  try { return S.twoline2satrec(tle.l1, tle.l2); } catch { return null; }
}

/** TLE epoch as Date */
export function tleEpoch(tle) {
  const yy = parseInt(tle.l1.slice(18, 20), 10);
  const doy = parseFloat(tle.l1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86400000);
}

function rawLook(satrec, obs, date) {
  const pv = S.propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  const gmst = S.gstime(date);
  const ecf = S.eciToEcf(pv.position, gmst);
  const la = S.ecfToLookAngles(obs, ecf);
  return { az: (la.azimuth * DEG + 360) % 360, el: la.elevation * DEG, range: la.rangeSat, eci: pv.position, gmst };
}

/** obs: {lat, lon, alt(m)} in degrees */
export function observer(lat, lon, altM = 0) {
  return { latitude: lat * RAD, longitude: lon * RAD, height: altM / 1000 };
}

/** Full look data including range-rate (km/s, + = alejándose) and subsatellite point */
export function look(satrec, obs, date = new Date()) {
  const a = rawLook(satrec, obs, date);
  if (!a) return null;
  const b = rawLook(satrec, obs, new Date(date.getTime() + 1000));
  const rangeRate = b ? (b.range - a.range) : 0;
  const geo = S.eciToGeodetic(a.eci, a.gmst);
  return {
    az: a.az, el: a.el, range: a.range, rangeRate,
    lat: S.degreesLat(geo.latitude), lon: S.degreesLong(geo.longitude), alt: geo.height,
  };
}

export const doppler = {
  /** frecuencia a la que hay que escuchar (MHz) */
  down: (f, rr) => f * (1 - rr / C_KMS),
  /** frecuencia a la que hay que transmitir para que el satélite reciba f (MHz) */
  up: (f, rr) => f / (1 - rr / C_KMS),
};

function elAt(satrec, obs, t) {
  const a = rawLook(satrec, obs, new Date(t));
  return a ? a.el : -90;
}

function bisect(satrec, obs, t0, t1) {
  // el(t0) and el(t1) have opposite signs; find zero crossing to ~1s
  let e0 = elAt(satrec, obs, t0);
  while (t1 - t0 > 1000) {
    const m = (t0 + t1) / 2;
    const em = elAt(satrec, obs, m);
    if ((em >= 0) === (e0 >= 0)) { t0 = m; e0 = em; } else { t1 = m; }
  }
  return (t0 + t1) / 2;
}

function findMax(satrec, obs, a, b) {
  // ternary search for max elevation in [a, b]
  for (let i = 0; i < 40 && b - a > 1000; i++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (elAt(satrec, obs, m1) < elAt(satrec, obs, m2)) a = m1; else b = m2;
  }
  return (a + b) / 2;
}

/**
 * Predice pasadas.
 * @returns [{aos, los, tca, maxEl, aosAz, losAz, tcaAz, track:[{t,az,el}], inProgress}]
 */
export function findPasses(satrec, obs, { start = new Date(), hours = 48, minEl = 0, step = 60, max = 50 } = {}) {
  const passes = [];
  const t0 = start.getTime();
  const tEnd = t0 + hours * 3600e3;
  const dt = step * 1000;
  let prevT = t0, prevEl = elAt(satrec, obs, t0);
  let aos = prevEl >= 0 ? t0 : null;
  const inProgressAtStart = prevEl >= 0;

  for (let t = t0 + dt; t <= tEnd + dt && passes.length < max; t += dt) {
    const el = elAt(satrec, obs, t);
    if (prevEl < 0 && el >= 0) {
      aos = bisect(satrec, obs, prevT, t);
    } else if (prevEl >= 0 && el < 0 && aos !== null) {
      const los = bisect(satrec, obs, prevT, t);
      const p = buildPass(satrec, obs, aos, los, aos === t0 && inProgressAtStart);
      if (p.maxEl >= minEl) passes.push(p);
      aos = null;
    }
    prevT = t; prevEl = el;
  }
  return passes;
}

function buildPass(satrec, obs, aos, los, inProgress) {
  const tca = findMax(satrec, obs, aos, los);
  const track = [];
  const n = Math.max(20, Math.min(200, Math.round((los - aos) / 10000)));
  for (let i = 0; i <= n; i++) {
    const t = aos + (los - aos) * i / n;
    const a = rawLook(satrec, obs, new Date(t));
    if (a) track.push({ t, az: a.az, el: Math.max(0, a.el) });
  }
  const A = rawLook(satrec, obs, new Date(aos));
  const L = rawLook(satrec, obs, new Date(los));
  const T = rawLook(satrec, obs, new Date(tca));
  return {
    aos: new Date(aos), los: new Date(los), tca: new Date(tca),
    maxEl: T.el, aosAz: A.az, losAz: L.az, tcaAz: T.az,
    track, inProgress,
  };
}

const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const CARD_LONG = { N: 'Norte', NE: 'Noreste', E: 'Este', SE: 'Sudeste', S: 'Sur', SO: 'Sudoeste', O: 'Oeste', NO: 'Noroeste' };
export const cardinal = az => CARD[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
export const cardinal8 = az => CARD_LONG[['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((az % 360) + 360) % 360 / 45) % 8]];
