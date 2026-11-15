// Hands a picked plan file from the projects page to the editor (IndexedDB: survives the page change, holds big files).
const DB = 'spatial-handoff', ST = 'files';
const open = () => new Promise((ok, no) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
export async function putFile(file) {
  const db = await open();
  await new Promise((ok, no) => { const tx = db.transaction(ST, 'readwrite'); tx.objectStore(ST).put({ name: file.name, type: file.type, blob: file }, 'next'); tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
}
export async function takeFile() {
  const db = await open();
  const v = await new Promise((ok, no) => { const tx = db.transaction(ST, 'readwrite'), s = tx.objectStore(ST), g = s.get('next'); g.onsuccess = () => { s.delete('next'); ok(g.result); }; g.onerror = () => no(g.error); });
  return v ? new File([v.blob], v.name, { type: v.type }) : null;
}
