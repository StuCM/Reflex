/* IndexedDB, as a key/value store and nothing more.
   One object store, whole-section blobs. A section is a few hundred KB;
   splitting into pages buys nothing until libraries get much bigger. */

const NAME = 'reflex';
const STORE = 'kv';
const TABLES = [STORE, 'plays', 'title_tags', 'smart_lists', 'hidden'];

let opening: Promise<IDBDatabase> | null = null;

/** Fallback when IndexedDB is unavailable or blocked. */
const memory: Record<string, unknown> = {};

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('no indexedDB'));
      return;
    }
    const request = indexedDB.open(NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      TABLES.forEach((table) => {
        if (!database.objectStoreNames.contains(table)) database.createObjectStore(table);
      });
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

async function transact<T>(
  table: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(table, mode);
    const request = run(transaction.objectStore(table));
    transaction.oncomplete = () => {
      resolve(request.result);
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('indexedDB transaction failed'));
    };
  });
}

export async function get<T>(key: string): Promise<T | undefined> {
  try {
    return await transact<T>(STORE, 'readonly', (store) => store.get(key) as IDBRequest<T>);
  } catch {
    return memory[key] as T | undefined;
  }
}

export async function put<T>(key: string, value: T): Promise<unknown> {
  memory[key] = value;
  try {
    return await transact(STORE, 'readwrite', (store) => store.put(value, key));
  } catch {
    return null;
  }
}

/** Every key of a table other than kv; a key is a tuple of strings. */
export async function keysIn(table: string): Promise<string[][]> {
  try {
    return await transact<string[][]>(
      table,
      'readonly',
      (store) => store.getAllKeys() as IDBRequest<string[][]>,
    );
  } catch {
    const prefix = `${table}\u0000`;
    return Object.keys(memory)
      .filter((key) => key.indexOf(prefix) === 0)
      .map((key) => key.slice(prefix.length).split('\u0000'));
  }
}

export async function putIn<T>(table: string, key: string[], value: T): Promise<unknown> {
  memory[`${table}\u0000${key.join('\u0000')}`] = value;
  try {
    return await transact(table, 'readwrite', (store) => store.put(value, key));
  } catch {
    return null;
  }
}
