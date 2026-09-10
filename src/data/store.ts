/* IndexedDB, as a key/value store and nothing more.
   One object store, whole-section blobs. A section is a few hundred KB;
   splitting into pages buys nothing until libraries get much bigger. */

const NAME = 'reflex';
const STORE = 'kv';

let opening: Promise<IDBDatabase> | null = null;

/** Fallback when IndexedDB is unavailable or blocked. */
const memory: Record<string, unknown> = {};

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('no indexedDB'));
      return;
    }
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('indexedDB refused to open'));
    };
  });
  return opening;
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          resolve(request.result);
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error('indexedDB transaction failed'));
        };
      }),
  );
}

export function get<T>(key: string): Promise<T | undefined> {
  return transact<T>('readonly', (store) => store.get(key) as IDBRequest<T>).catch(
    () => memory[key] as T | undefined,
  );
}

export function put<T>(key: string, value: T): Promise<unknown> {
  memory[key] = value;
  return transact('readwrite', (store) => store.put(value, key)).catch(() => null);
}
