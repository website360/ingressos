"use client";

/**
 * Armazenamento offline do check-in (IndexedDB).
 *
 * Sem dependência externa: o que precisamos são dois object stores e algumas
 * operações. Uma biblioteca aqui seria mais código carregado no celular do
 * recepcionista do que o problema justifica.
 */

const DB_NAME = "ingressos-checkin";
const DB_VERSION = 1;
const STORE_MANIFEST = "manifests";
const STORE_QUEUE = "queue";

export interface OfflineTicket {
  /** SHA-256 do código do ingresso — o código em claro nunca é gravado. */
  h: string;
  n: string;
  c: string;
  r: string;
  s: string;
  u: boolean;
}

export interface OfflineManifest {
  eventId: string;
  event: {
    id: string;
    name: string;
    starts_at: string;
    ends_at: string;
    venue_name: string | null;
    allowed_radius_m: number;
    latitude: number | null;
    longitude: number | null;
  };
  generated_at: string;
  tickets: OfflineTicket[];
}

export interface QueuedCheckin {
  idempotency_key: string;
  event_id: string;
  token: string;
  checked_in_at: string;
  device_id: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_m?: number | null;
  override?: boolean;
  override_reason?: string | null;
  attendee_name?: string;
  synced: boolean;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_MANIFEST)) {
        db.createObjectStore(STORE_MANIFEST, { keyPath: "eventId" });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: "idempotency_key" });
        store.createIndex("synced", "synced");
        store.createIndex("event_id", "event_id");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = action(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

export const offlineDb = {
  async saveManifest(manifest: OfflineManifest) {
    await run(STORE_MANIFEST, "readwrite", (store) => store.put(manifest));
  },

  getManifest(eventId: string) {
    return run<OfflineManifest | undefined>(STORE_MANIFEST, "readonly", (store) =>
      store.get(eventId),
    );
  },

  async clearManifest(eventId: string) {
    await run(STORE_MANIFEST, "readwrite", (store) => store.delete(eventId));
  },

  async enqueue(item: QueuedCheckin) {
    await run(STORE_QUEUE, "readwrite", (store) => store.put(item));
  },

  getQueue() {
    return run<QueuedCheckin[]>(STORE_QUEUE, "readonly", (store) => store.getAll());
  },

  async markSynced(keys: string[]) {
    const db = await openDb();
    const transaction = db.transaction(STORE_QUEUE, "readwrite");
    const store = transaction.objectStore(STORE_QUEUE);

    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        const item = request.result as QueuedCheckin | undefined;
        if (item) store.put({ ...item, synced: true });
      };
    }

    return new Promise<void>((resolve) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
    });
  },

  async pending(): Promise<QueuedCheckin[]> {
    const all = await this.getQueue();
    return all.filter((item) => !item.synced);
  },
};

/** Hash do código, para comparar com o manifesto sem guardar o código. */
export async function hashCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Identificador estável do aparelho — entra na auditoria de cada check-in. */
export function getDeviceId(): string {
  const KEY = "ingressos:device-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
