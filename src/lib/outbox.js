// Laimikių siuntimo eilė.
// Laimikis pirmiausia išsaugomas telefone, tik tada siunčiamas. Be ryšio jis laukia eilėje
// ir išsiunčiamas grįžus ryšiui. Pakartotinis siuntimas saugus: serveris atpažįsta client_id.

export class PermanentError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Saugykla atmintyje – testams ir naršyklėms be IndexedDB.
export function memoryStore() {
  const m = new Map();
  return {
    async put(item) { m.set(item.clientId, structuredClone(item)); },
    async get(id) { return m.has(id) ? structuredClone(m.get(id)) : undefined; },
    async all() { return [...m.values()].map((x) => structuredClone(x)); },
    async delete(id) { m.delete(id); }
  };
}

export function idbStore(dbName = 'zvejybos-turnyrai', storeName = 'outbox') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName, { keyPath: 'clientId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const s = t.objectStore(storeName);
      const req = fn(s);
      t.oncomplete = () => { db.close(); resolve(req?.result); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
  };
  return {
    put: (item) => tx('readwrite', (s) => s.put(item)),
    get: (id) => tx('readonly', (s) => s.get(id)),
    all: () => tx('readonly', (s) => s.getAll()),
    delete: (id) => tx('readwrite', (s) => s.delete(id))
  };
}

export class Outbox {
  constructor(store, { onChange } = {}) {
    this.store = store;
    this.onChange = onChange || (() => {});
    this.flushing = null;
  }

  async add(item) {
    await this.store.put({ ...item, state: 'queued', error: null, addedAt: new Date().toISOString() });
    this.onChange();
  }

  async list() {
    const all = await this.store.all();
    return all.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }

  async pendingCount() {
    return (await this.list()).filter((x) => x.state === 'queued').length;
  }

  async dismiss(clientId) {
    await this.store.delete(clientId);
    this.onChange();
  }

  // Siunčia eilės įrašus po vieną. Laikina klaida (nėra ryšio) sustabdo siuntimą,
  // nuolatinė (pvz. pakartota nuotrauka) pažymima ir rodoma vartotojui.
  flush(send) {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const result = { sent: 0, failed: 0, stopped: false };
      try {
        for (const item of await this.list()) {
          if (item.state !== 'queued') continue;
          try {
            await send(item);
            await this.store.delete(item.clientId);
            result.sent++;
          } catch (err) {
            if (err instanceof PermanentError) {
              await this.store.put({ ...item, state: 'failed', error: err.message });
              result.failed++;
            } else {
              result.stopped = true;
              break;
            }
          } finally {
            this.onChange();
          }
        }
      } finally {
        this.flushing = null;
      }
      return result;
    })();
    return this.flushing;
  }
}
