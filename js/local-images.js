/* ============================================================
   صور قائمة الاحتياجات — محلية على الهاتف، وترحيل مؤقت للمالك
   لا تُضاف الصورة إلى مستند المنتج ولا إلى قاعدة بيانات الخادم.
   ============================================================ */

import { relayPantryImage, pullPantryImages, ackPantryImages } from './cloud.js';
import { getHouseholdId } from './store.js';

const DB_NAME = 'beitna-local-images';
const STORE = 'pantry';
const MAX_SIDE = 720;
const TARGET_BYTES = 150 * 1024;

let dbPromise = null;
function openDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function transaction(mode, run) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let value = null;
    try { value = run(store); } catch { resolve(null); return; }
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => resolve(null);
  });
}

const activeHousehold = () => String(getHouseholdId() || 'local');
const localKey = (id, householdId = activeHousehold()) => `${householdId}:${id}`;

async function putImage(id, dataUrl, pending, householdId = activeHousehold()) {
  return transaction('readwrite', (store) => store.put({
    id: localKey(id, householdId), itemId: String(id), householdId,
    dataUrl, pending: !!pending, updatedAt: Date.now(),
  }));
}

export async function getPantryImage(id) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(localKey(id));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function allImages() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

/** تصغير الصورة على الهاتف قبل أي نقل. */
export async function compressPantryImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return '';
  let bitmap;
  let objectUrl = '';
  if ('createImageBitmap' in window) bitmap = await createImageBitmap(file);
  else {
    objectUrl = URL.createObjectURL(file);
    bitmap = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image); image.onerror = reject; image.src = objectUrl;
    });
  }
  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  if (objectUrl) URL.revokeObjectURL(objectUrl);

  let quality = 0.72;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > TARGET_BYTES * 1.37 && quality > 0.36) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl;
}

/** يحفظ محليًا أولًا؛ فشل الشبكة يبقيها معلّقة لإرسال لاحق. */
export async function saveAndRelayPantryImage(id, dataUrl) {
  if (!dataUrl) return false;
  const householdId = activeHousehold();
  await putImage(id, dataUrl, true, householdId);
  relayPantryImage(id, dataUrl)
    .then(() => putImage(id, dataUrl, false, householdId))
    .catch(() => { /* تبقى pending وتُرسل في الدورة التالية */ });
  return true;
}

export async function flushPendingPantryImages() {
  if (!navigator.onLine) return 0;
  const householdId = activeHousehold();
  const pending = (await allImages())
    .filter((item) => item.pending && item.householdId === householdId).slice(0, 4);
  let sent = 0;
  for (const item of pending) {
    try {
      await relayPantryImage(item.itemId, item.dataUrl);
      await putImage(item.itemId, item.dataUrl, false, householdId);
      sent++;
    } catch { break; }
  }
  return sent;
}

/** المالك ينزّل الصور المؤقتة إلى هاتفه، ثم يؤكد ليحذفها الخادم. */
export async function syncIncomingPantryImages() {
  if (!navigator.onLine) return 0;
  const householdId = activeHousehold();
  const result = await pullPantryImages();
  const images = Array.isArray(result?.images) ? result.images : [];
  const saved = [];
  for (const image of images) {
    if (!image?.itemId || !image?.dataUrl) continue;
    await putImage(image.itemId, image.dataUrl, false, householdId);
    saved.push(String(image.itemId));
  }
  if (saved.length) await ackPantryImages(saved);
  return saved.length;
}

/** يملأ صور الصفوف بعد رسمها من IndexedDB المحلي. */
export async function hydratePantryImages(root) {
  const nodes = [...(root?.querySelectorAll?.('[data-pantry-image]') || [])];
  await Promise.all(nodes.map(async (node) => {
    const image = await getPantryImage(node.dataset.pantryImage);
    if (!image?.dataUrl) return;
    node.src = image.dataUrl;
    node.hidden = false;
  }));
}
