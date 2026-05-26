const DB_NAME = 'LCH_Photos_DB';
const STORE_NAME = 'photos';
const DB_VERSION = 1;

interface PhotoRecord {
  id: string;          // Usaremos el id del LogiEntry como key
  projectId: string;   // Para poder borrar fotos por proyecto
  base64Data: string;  // La imagen en base64 (con data:image/jpeg;base64,...)
}

class PhotoDatabaseService {
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
        console.error("IndexedDB Error:", event);
        reject(new Error("No se pudo abrir la base de datos local de fotos."));
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
    if (!this.db) throw new Error("La base de datos de fotos no se inicializó correctamente.");
    return this.db;
  }

  /**
   * Guarda o actualiza una foto en la base de datos local.
   */
  async savePhoto(id: string, projectId: string, base64Data: string): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const record: PhotoRecord = { id, projectId, base64Data };
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  }

  /**
   * Obtiene la cadena base64 de una foto.
   */
  async getPhoto(id: string): Promise<string | null> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.base64Data);
        } else {
          resolve(null);
        }
      };
      request.onerror = (e) => reject(e);
    });
  }

  /**
   * Genera un Object URL local y efímero a partir de la foto guardada en base64.
   * IMPORTANTE: Las URLs generadas deben ser liberadas con URL.revokeObjectURL() si dejan de usarse masivamente.
   */
  async getPhotoBlobUrl(id: string): Promise<string | null> {
    const base64 = await this.getPhoto(id);
    if (!base64) return null;

    try {
      // Extraer el tipo MIME y los datos si viene como data URI (data:image/jpeg;base64,...)
      let mime = 'image/jpeg';
      let b64Data = base64;
      
      if (base64.startsWith('data:')) {
        const parts = base64.split(',');
        mime = parts[0].split(':')[1].split(';')[0];
        b64Data = parts[1];
      }

      const byteCharacters = atob(b64Data);
      const byteArrays = [];
      
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
      }
      
      const blob = new Blob(byteArrays, { type: mime });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error("Error convirtiendo base64 a blob para la foto", id, e);
      return null;
    }
  }

  /**
   * Elimina una foto específica.
   */
  async deletePhoto(id: string): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  }

  /**
   * Obtiene todas las fotos de un proyecto específico (Útil para crear el .lchp).
   */
  async getPhotosByProject(projectId: string): Promise<PhotoRecord[]> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = (e) => reject(e);
    });
  }

  /**
   * Limpia toda la base de datos de fotos (peligroso).
   */
  async clearAll(): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  }
}

export const photoDB = new PhotoDatabaseService();
