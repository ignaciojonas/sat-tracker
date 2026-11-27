// Exportación ADIF 3.1 para Logbook of The World (vía TQSL) y QRZ Logbook (Importar ADIF).

const BANDS = [
  [28, 29.7, '10m'], [50, 54, '6m'], [144, 148, '2m'], [219, 225, '1.25m'],
  [420, 450, '70cm'], [902, 928, '33cm'], [1240, 1300, '23cm'], [2300, 2450, '13cm'],
  [3300, 3500, '9cm'], [5650, 5925, '6cm'], [10000, 10500, '3cm'],
];
export const bandOf = mhz => (BANDS.find(([a, b]) => mhz >= a && mhz <= b) || [])[2] || '';

/** Modo de emisión ADIF a partir del texto de modo del satélite ("LSB/CW" → SSB, "FM" → FM) */
export function adifMode(txt = '') {
  const t = txt.toUpperCase();
  if (t.startsWith('SSTV')) return 'SSTV';
  if (t.startsWith('FM')) return 'FM';
  if (t.startsWith('LSB') || t.startsWith('USB') || t.startsWith('SSB')) return 'SSB';
  if (t.startsWith('CW')) return 'CW';
  if (t.includes('AFSK') || t.includes('APRS')) return 'PKT';
  return 'FM';
}

const enc = new TextEncoder();
// ADIF es ASCII: quitamos acentos y caracteres raros de los textos libres
const ascii = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').trim();
const field = (name, value) => {
  const v = ascii(value);
  return v ? `<${name}:${enc.encode(v).length}>${v} ` : '';
};

const ymd = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const hms = d => `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}`;

export function toADIF(qsos, { myCall = '' } = {}) {
  const now = new Date();
  let out = `Exportado por SatTracker ${now.toISOString()}\n${field('ADIF_VER', '3.1.4')}${field('PROGRAMID', 'SatTracker')}${field('CREATED_TIMESTAMP', `${ymd(now)} ${hms(now)}`)}<EOH>\n\n`;
  for (const q of qsos) {
    const d = new Date(q.time);
    out += [
      field('CALL', q.call.toUpperCase()),
      field('QSO_DATE', ymd(d)),
      field('TIME_ON', hms(d)),
      field('BAND', q.freq ? bandOf(q.freq) : ''),
      field('FREQ', q.freq ? q.freq.toFixed(4) : ''),
      field('BAND_RX', q.freqRx ? bandOf(q.freqRx) : ''),
      field('FREQ_RX', q.freqRx ? q.freqRx.toFixed(4) : ''),
      field('MODE', q.mode),
      field('PROP_MODE', 'SAT'),
      field('SAT_NAME', q.lotwSat || q.satName),
      field('RST_SENT', q.rstSent),
      field('RST_RCVD', q.rstRcvd),
      field('GRIDSQUARE', (q.grid || '').toUpperCase()),
      field('MY_GRIDSQUARE', q.myGrid),
      field('STATION_CALLSIGN', (q.myCall || myCall || '').toUpperCase()),
      field('OPERATOR', (q.myCall || myCall || '').toUpperCase()),
      field('COMMENT', q.note),
    ].join('') + '<EOR>\n';
  }
  return out;
}
