// Satélites de radioaficionados con repetidoras/transpondedores conocidos.
// Frecuencias en MHz. El estado operativo cambia seguido: verificar en https://www.amsat.org/status/
//
// type:  'FM'     → repetidora FM (canal único)
//        'LINEAR' → transpondedor lineal SSB/CW (banda de paso)
//        'DIGI'   → digipeater / paquetes
// lotw:  nombre exacto que exige LoTW en SAT_NAME (null = no figura en la lista de LoTW).
// inverting: en transpondedores lineales, si la banda de bajada está invertida
//            (subir en uplink => bajar en downlink). Se usa LSB arriba / USB abajo.

export const SATS = [
  {
    norad: 25544, lotw: 'ARISS', name: 'ISS', alias: 'Estación Espacial Internacional',
    status: 'activo', note: 'Repetidora FM cruzada V/U (ARISS). Mucha demanda: llamadas cortas.',
    modes: [
      { type: 'FM', label: 'Repetidora FM voz', up: 145.990, upMode: 'FM', tone: '67.0 Hz', down: 437.800, downMode: 'FM' },
      { type: 'DIGI', label: 'APRS digipeater', up: 145.825, upMode: 'AFSK 1200', down: 145.825, downMode: 'AFSK 1200' },
      { type: 'FM', label: 'Voz ARISS / SSTV (eventos)', up: null, down: 145.800, downMode: 'FM' },
    ],
  },
  {
    norad: 27607, lotw: 'SO-50', name: 'SO-50', alias: 'SaudiSat-1C',
    status: 'activo', note: 'Tono 74.4 Hz arma el timer de 10 min; luego usar 67.0 Hz.',
    modes: [
      { type: 'FM', label: 'Repetidora FM', up: 145.850, upMode: 'FM', tone: '67.0 Hz (74.4 Hz armar)', down: 436.795, downMode: 'FM' },
    ],
  },
  {
    norad: 43017, lotw: 'AO-91', name: 'AO-91', alias: 'RadFxSat / Fox-1B',
    status: 'intermitente', note: 'Batería degradada: suele funcionar sólo con sol.',
    modes: [
      { type: 'FM', label: 'Repetidora FM', up: 435.250, upMode: 'FM', tone: '67.0 Hz', down: 145.960, downMode: 'FM' },
    ],
  },
  {
    norad: 43678, lotw: 'PO-101', name: 'PO-101', alias: 'Diwata-2B',
    status: 'programado', note: 'Se activa por horarios anunciados (@Diwata2PH).',
    modes: [
      { type: 'FM', label: 'Repetidora FM', up: 437.500, upMode: 'FM', tone: '141.3 Hz', down: 145.900, downMode: 'FM' },
    ],
  },
  {
    norad: 61781, lotw: 'AO-123', name: 'AO-123', alias: 'ASRTU-1',
    status: 'activo', note: 'Repetidora FM V/U.',
    modes: [
      { type: 'FM', label: 'Repetidora FM', up: 145.850, upMode: 'FM', tone: 'verificar', down: 435.400, downMode: 'FM' },
    ],
  },
  {
    norad: 22825, lotw: 'AO-27', name: 'AO-27', alias: 'EYESAT-A',
    status: 'intermitente', note: 'Satélite antiguo, actividad esporádica.',
    modes: [
      { type: 'FM', label: 'Repetidora FM', up: 145.850, upMode: 'FM', tone: '—', down: 436.795, downMode: 'FM' },
    ],
  },
  {
    norad: 44909, lotw: 'RS-44', name: 'RS-44', alias: 'DOSAAF-85',
    status: 'activo', note: 'Órbita alta (~1500 km): pasadas largas y alcance enorme. SSB/CW.',
    modes: [
      { type: 'LINEAR', label: 'Transpondedor lineal (invertido)', inverting: true,
        up: [145.935, 145.995], upMode: 'LSB/CW', down: [435.610, 435.670], downMode: 'USB/CW' },
      { type: 'FM', label: 'Baliza CW', up: null, down: 435.605, downMode: 'CW' },
    ],
  },
  {
    norad: 24278, lotw: 'FO-29', name: 'FO-29', alias: 'JAS-2',
    status: 'intermitente', note: 'Funciona según presupuesto de energía.',
    modes: [
      { type: 'LINEAR', label: 'Transpondedor lineal (invertido)', inverting: true,
        up: [145.900, 146.000], upMode: 'LSB/CW', down: [435.900, 435.800], downMode: 'USB/CW' },
      { type: 'FM', label: 'Baliza CW', up: null, down: 435.795, downMode: 'CW' },
    ],
  },
  {
    norad: 7530, lotw: 'AO-7', name: 'AO-7', alias: 'OSCAR 7',
    status: 'sólo con sol', note: 'Lanzado en 1974. Alterna Modo A y Modo B al azar.',
    modes: [
      { type: 'LINEAR', label: 'Modo B (U/V, invertido)', inverting: true,
        up: [432.125, 432.175], upMode: 'LSB/CW', down: [145.975, 145.925], downMode: 'USB/CW' },
      { type: 'LINEAR', label: 'Modo A (V/10m, no invertido)', inverting: false,
        up: [145.850, 145.950], upMode: 'USB/CW', down: [29.400, 29.500], downMode: 'USB/CW' },
      { type: 'FM', label: 'Baliza Modo B', up: null, down: 145.9775, downMode: 'CW' },
    ],
  },
  {
    norad: 39444, lotw: 'AO-73', name: 'AO-73', alias: 'FUNcube-1',
    status: 'sólo en eclipse', note: 'Transpondedor activo normalmente sólo en sombra.',
    modes: [
      { type: 'LINEAR', label: 'Transpondedor lineal (invertido)', inverting: true,
        up: [435.150, 435.130], upMode: 'LSB/CW', down: [145.950, 145.970], downMode: 'USB/CW' },
      { type: 'DIGI', label: 'Telemetría', up: null, down: 145.935, downMode: 'BPSK 1200' },
    ],
  },
  {
    norad: 50466, lotw: null, name: 'CAS-9', alias: 'XW-3',
    status: 'activo', note: 'Transpondedor lineal U/V.',
    modes: [
      { type: 'LINEAR', label: 'Transpondedor lineal (invertido)', inverting: true,
        up: [435.180, 435.200], upMode: 'LSB/CW', down: [145.875, 145.855], downMode: 'USB/CW' },
      { type: 'FM', label: 'Baliza CW', up: null, down: 145.835, downMode: 'CW' },
    ],
  },
  {
    norad: 60209, lotw: 'MO-122', name: 'MO-122', alias: 'MESAT-1',
    status: 'activo', note: 'Transpondedor lineal V/U.',
    modes: [
      { type: 'LINEAR', label: 'Transpondedor lineal (invertido)', inverting: true,
        up: [145.910, 145.940], upMode: 'LSB/CW', down: [435.840, 435.810], downMode: 'USB/CW' },
      { type: 'DIGI', label: 'Telemetría', up: null, down: 435.800, downMode: 'BPSK' },
    ],
  },
  {
    norad: 53109, lotw: 'IO-117', name: 'IO-117', alias: 'GreenCube',
    status: 'activo', note: 'Órbita MEO (~5800 km): pasadas de horas, Doppler bajo. Digipeater.',
    modes: [
      { type: 'DIGI', label: 'Digipeater', up: 435.310, upMode: 'GMSK 1200', down: 435.310, downMode: 'GMSK 1200' },
    ],
  },
  {
    norad: 57172, lotw: null, name: 'Umka-1', alias: 'RS40S',
    status: 'activo', note: 'Cubesat 3U de estudiantes de Podolsk (Rusia). Transmite imágenes SSTV seguido: sólo recepción, decodificá con una app de SSTV. Evento HAMFEST INDIA 2026: del sáb 28/11 04:40 UTC al dom 29/11 18:45 UTC, con eQSL por reportar una imagen recibida.',
    modes: [
      { type: 'FM', label: 'SSTV (sólo recepción)', up: null, down: 437.625, downMode: 'SSTV (FM)' },
    ],
  },
];

export const BY_NORAD = new Map(SATS.map(s => [s.norad, s]));
