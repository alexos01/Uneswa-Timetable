/* Small key-value store on the device: IndexedDB, or localStorage where IndexedDB
   is unavailable (some private windows). Values are plain JSON-safe objects.
   Every call resolves, even when storage is blocked: get() then gives null. */
const DB_NAME = 'uneswa-timetable';
const STORE = 'kv';

let dbPromise = null;
function open(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise(resolve=>{
    try{
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = ()=>req.result.createObjectStore(STORE);
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>resolve(null);
      req.onblocked = ()=>resolve(null);
    }catch{ resolve(null); }
  });
  return dbPromise;
}

function run(mode, fn){
  return open().then(db=>new Promise(resolve=>{
    if(!db) return resolve(undefined);
    try{
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = ()=>resolve(req ? req.result : undefined);
      tx.onerror = tx.onabort = ()=>resolve(undefined);
    }catch{ resolve(undefined); }
  }));
}

const LS_PREFIX = 'uneswa_kv_';
function lsGet(key){ try{ return JSON.parse(localStorage.getItem(LS_PREFIX+key) || 'null'); }catch{ return null; } }
function lsSet(key, value){ try{ localStorage.setItem(LS_PREFIX+key, JSON.stringify(value)); }catch{} }
function lsDel(key){ try{ localStorage.removeItem(LS_PREFIX+key); }catch{} }

export async function get(key){
  const db = await open();
  if(!db) return lsGet(key);
  const v = await run('readonly', s=>s.get(key));
  return v === undefined ? null : v;
}

export async function set(key, value){
  const db = await open();
  if(!db) return lsSet(key, value);
  await run('readwrite', s=>s.put(value, key));
}

export async function del(key){
  const db = await open();
  if(!db) return lsDel(key);
  await run('readwrite', s=>s.delete(key));
}
