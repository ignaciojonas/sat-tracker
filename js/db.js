// Almacenamiento local (IndexedDB): grabaciones, trozos de audio en curso y QSOs.
// Todo queda en el teléfono; nada se sube a ningún servidor.

const DB_NAME = 'sattracker';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      // grabación: {id, start, end, duration, mime, norad, satName, status:'recording'|'done'|'recovered', blob}
      db.createObjectStore('recordings', { keyPath: 'id' });
      // trozo de audio mientras se graba (por si el sistema mata la app a mitad de la pasada)
      const ch = db.createObjectStore('chunks', { keyPath: ['recId', 'seq'] });
      ch.createIndex('recId', 'recId');
      // QSO: {id, recId?, offset?, time, call, grid, rstSent, rstRcvd, mode, satName, lotwSat, freq, freqRx, note, exported}
      const q = db.createObjectStore('qsos', { keyPath: 'id' });
      q.createIndex('recId', 'recId');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const db = {
  async put(name, value) { return req2p((await store(name, 'readwrite')).put(value)); },
  async get(name, key) { return req2p((await store(name)).get(key)); },
  async all(name) { return req2p((await store(name)).getAll()); },
  async del(name, key) { return req2p((await store(name, 'readwrite')).delete(key)); },
  async byIndex(name, index, key) { return req2p((await store(name)).index(index).getAll(key)); },
  async delChunks(recId) {
    const s = await store('chunks', 'readwrite');
    return req2p(s.delete(IDBKeyRange.bound([recId, 0], [recId, Infinity])));
  },
};

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
