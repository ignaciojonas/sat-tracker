// Grabación de audio de la pasada con MediaRecorder.
// El audio se guarda en trozos cada pocos segundos en IndexedDB: si el teléfono
// cierra la app a mitad de la pasada, la grabación se recupera al volver a abrirla.
import { db, uid } from './db.js';

const MIMES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

export function extFor(mime = '') {
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

async function assemble(rec) {
  const chunks = (await db.byIndex('chunks', 'recId', rec.id)).sort((a, b) => a.seq - b.seq);
  return new Blob(chunks.map(c => c.blob), { type: rec.mime || chunks[0]?.blob.type || 'audio/webm' });
}

export class Recorder {
  constructor() { this.rec = null; }

  get active() { return !!this.rec; }
  elapsed() { return this.rec ? Date.now() - this.rec.start : 0; }

  async start(meta) {
    if (this.rec) return this.rec;
    // Sin procesamiento: es audio de radio, no voz al micrófono de una llamada.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const mime = MIMES.find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48000 });
    const rec = { id: uid(), start: Date.now(), mime: mr.mimeType || mime, status: 'recording', ...meta };
    await db.put('recordings', rec);

    let seq = 0;
    this.pending = [];
    mr.ondataavailable = e => {
      if (e.data && e.data.size) this.pending.push(db.put('chunks', { recId: rec.id, seq: seq++, blob: e.data }));
    };
    mr.start(4000);

    // Medidor de nivel
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
    } catch { this.analyser = null; }

    Object.assign(this, { stream, mr, rec });
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    return rec;
  }

  /** nivel de audio 0..1 */
  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const v of this.buf) s += v * v;
    return Math.min(1, Math.sqrt(s / this.buf.length) * 4);
  }

  async stop() {
    if (!this.rec) return null;
    const { mr, stream, rec } = this;
    if (mr.state !== 'inactive') await new Promise(res => { mr.onstop = res; mr.stop(); });
    stream.getTracks().forEach(t => t.stop());
    this.ctx?.close().catch(() => {});
    await Promise.all(this.pending);
    const blob = await assemble(rec);
    const done = { ...rec, blob, end: Date.now(), duration: Date.now() - rec.start, status: 'done' };
    await db.put('recordings', done);
    await db.delChunks(rec.id);
    this.rec = null; this.mr = null; this.stream = null; this.analyser = null;
    return done;
  }
}

/** Junta grabaciones que quedaron a medias (la app se cerró grabando). */
export async function recoverOrphans() {
  const recs = (await db.all('recordings')).filter(r => r.status === 'recording');
  for (const r of recs) {
    const blob = await assemble(r);
    if (!blob.size) { await db.del('recordings', r.id); continue; }
    await db.put('recordings', { ...r, blob, status: 'recovered', end: null, duration: null });
    await db.delChunks(r.id);
  }
  return recs.length;
}
