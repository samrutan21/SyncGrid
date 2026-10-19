import type { ColumnTemplate, Project } from '../core/types';

/**
 * Storage interface. The app only talks to this interface, so the local
 * IndexedDB implementation can be swapped for a shared backend (Supabase,
 * Firebase, your own API) without touching the UI.
 */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  episodes: number;
}

export interface Store {
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<Project | undefined>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;

  /** Binary files: screenshots, evidence images/PDFs. */
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | undefined>;
  deleteBlobs(prefix: string): Promise<void>;
  listBlobKeys(prefix: string): Promise<string[]>;

  /** Local file handles (Chrome File System Access) for video files. */
  putHandle(key: string, handle: FileSystemFileHandle): Promise<void>;
  getHandle(key: string): Promise<FileSystemFileHandle | undefined>;

  listTemplates(): Promise<ColumnTemplate[]>;
  saveTemplate(t: ColumnTemplate): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* IndexedDB implementation                                            */
/* ------------------------------------------------------------------ */

const LEGACY_DB_NAME = 'cutsheet';
const DB_NAME = 'syncgrid';
const DB_VERSION = 1;
const STORES = ['projects', 'blobs', 'handles', 'templates'] as const;
type StoreName = (typeof STORES)[number];

/**
 * Copy a library saved under the previous name, then remove that database.
 * Runs once. Records already stored under the new name are left in place.
 */
export async function migrateLegacyDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined' || !indexedDB.databases) return;
  const names = (await indexedDB.databases()).map((d) => d.name);
  if (!names.includes(LEGACY_DB_NAME)) return;
  const legacy = await openNamed(LEGACY_DB_NAME);
  let current: IDBDatabase | null = null;
  try {
    const saved = await Promise.all(STORES.map(async (name) => [name, await readStore(legacy, name)] as const));
    if (saved.some(([, rows]) => rows.length)) {
      current = await openDB();
      for (const [name, rows] of saved) await writeMissing(current, name, rows);
    }
  } finally {
    legacy.close();
    current?.close();
  }
  await deleteNamed(LEGACY_DB_NAME);
}

function openNamed(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteNamed(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function readStore(db: IDBDatabase, name: StoreName): Promise<{ key: IDBValidKey; value: unknown }[]> {
  if (!db.objectStoreNames.contains(name)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readonly');
    const store = tx.objectStore(name);
    const keysReq = store.getAllKeys();
    const valuesReq = store.getAll();
    tx.oncomplete = () => resolve(keysReq.result.map((key, i) => ({ key, value: valuesReq.result[i] })));
    tx.onerror = () => reject(tx.error);
  });
}

function writeMissing(db: IDBDatabase, name: StoreName, rows: { key: IDBValidKey; value: unknown }[]): Promise<void> {
  if (!rows.length || !db.objectStoreNames.contains(name)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const store = tx.objectStore(name);
    let i = 0;
    const step = () => {
      if (i >= rows.length) return;
      const row = rows[i++];
      const found = store.getKey(row.key);
      found.onsuccess = () => {
        if (found.result === undefined) store.put(row.value, row.key);
        step();
      };
      found.onerror = () => reject(found.error);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    step();
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Additive only. Deleting or clearing a store here would wipe the
      // projects already saved in this browser the next time the app opens.
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDBStore implements Store {
  private dbp: Promise<IDBDatabase> | null = null;
  private db() {
    this.dbp ??= openDB();
    return this.dbp;
  }
  private async tx(name: StoreName, mode: IDBTransactionMode = 'readonly') {
    return (await this.db()).transaction(name, mode).objectStore(name);
  }
  private async keys(name: StoreName, prefix: string): Promise<string[]> {
    const s = await this.tx(name);
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
    return (await wrap(s.getAllKeys(range))) as string[];
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const s = await this.tx('projects');
    const all = (await wrap(s.getAll())) as Project[];
    return all
      .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, episodes: p.episodes.length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async loadProject(id: string) {
    return (await wrap((await this.tx('projects')).get(id))) as Project | undefined;
  }
  async saveProject(project: Project) {
    await wrap((await this.tx('projects', 'readwrite')).put(project, project.id));
  }
  async deleteProject(id: string) {
    await wrap((await this.tx('projects', 'readwrite')).delete(id));
    await this.deleteBlobs(`${id}/`);
  }

  async putBlob(key: string, blob: Blob) {
    await wrap((await this.tx('blobs', 'readwrite')).put(blob, key));
  }
  async getBlob(key: string) {
    return (await wrap((await this.tx('blobs')).get(key))) as Blob | undefined;
  }
  async deleteBlobs(prefix: string) {
    const keys = await this.keys('blobs', prefix);
    const s = await this.tx('blobs', 'readwrite');
    await Promise.all(keys.map((k) => wrap(s.delete(k))));
  }
  listBlobKeys(prefix: string) {
    return this.keys('blobs', prefix);
  }

  async putHandle(key: string, handle: FileSystemFileHandle) {
    await wrap((await this.tx('handles', 'readwrite')).put(handle, key));
  }
  async getHandle(key: string) {
    return (await wrap((await this.tx('handles')).get(key))) as FileSystemFileHandle | undefined;
  }

  async listTemplates() {
    return (await wrap((await this.tx('templates')).getAll())) as ColumnTemplate[];
  }
  async saveTemplate(t: ColumnTemplate) {
    await wrap((await this.tx('templates', 'readwrite')).put(t, t.id));
  }
  async deleteTemplate(id: string) {
    await wrap((await this.tx('templates', 'readwrite')).delete(id));
  }
}

export const store: Store = new IndexedDBStore();

/** Blob key helpers. Keys are prefixed with the project id so a project can be wiped or exported as a unit. */
export const blobKeys = {
  shot: (projectId: string, versionId: string, itemId: string) => `${projectId}/shot/${versionId}/${itemId}`,
  shotPrefix: (projectId: string, versionId: string) => `${projectId}/shot/${versionId}/`,
  evidence: (projectId: string, id: string) => `${projectId}/evidence/${id}`,
};
