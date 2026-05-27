const DB_NAME = 'LCH_APUs_DB';
const STORE_NAME = 'files';
const DB_VERSION = 1;

interface ApuFileRecord {
  id: string; // Nombre del archivo o ID único
  projectId: string;
  fileData: string; // base64
}

class ApuDatabaseService {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initDB();
  }

  private initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error("IndexedDB no está soportado en este entorno."));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error("IndexedDB APUs Error:", event);
        reject(new Error("No se pudo abrir la base de datos local de APUs."));
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
      };
    });
  }

  private async ensureDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) await this.initPromise;
    if (!this.db) throw new Error("La base de datos de APUs no se inicializó correctamente.");
    return this.db;
  }

  async saveFile(id: string, projectId: string, fileData: string): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const record: ApuFileRecord = { id, projectId, fileData };
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  }

  async getFile(id: string): Promise<string | null> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.fileData);
        } else {
          resolve(null);
        }
      };
      request.onerror = (e) => reject(e);
    });
  }

  async deleteFile(id: string): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  }
}

export const apuFilesDB = new ApuDatabaseService();
