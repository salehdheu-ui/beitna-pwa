/* ============================================================
   صور الاحتياجات والأعطال — محلية على الهاتف، وترحيل مؤقت للمالك
   لا تُضاف الصورة إلى مستند العنصر ولا إلى قاعدة بيانات الخادم.
   ============================================================ */

import {
  relayPantryImage, pullPantryImages, ackPantryImages,
  relayShoppingImage, pullShoppingImages, ackShoppingImages,
  relayFaultImage, pullFaultImages, ackFaultImages,
} from './cloud.js';
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
/* نحافظ على مفتاح صور الاحتياجات القديم حتى لا تختفي الصور الموجودة بعد التحديث. */
const localKey = (kind, id, householdId = activeHousehold()) =>
  kind === 'pantry' ? `${householdId}:${id}` : `${householdId}:${kind}:${id}`;

async function putImage(kind, id, dataUrl, pending, householdId = activeHousehold()) {
  return transaction('readwrite', (store) => store.put({
    id: localKey(kind, id, householdId), kind, itemId: String(id), householdId,
    dataUrl, pending: !!pending, updatedAt: Date.now(),
  }));
}

async function getLocalImage(kind, id) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(localKey(kind, id));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export const getPantryImage = (id) => getLocalImage('pantry', id);
export const getShoppingImage = (id) => getLocalImage('shopping', id);
export const getFaultImage = (id) => getLocalImage('fault', id);

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
  await putImage('pantry', id, dataUrl, true, householdId);
  relayPantryImage(id, dataUrl)
    .then(() => putImage('pantry', id, dataUrl, false, householdId))
    .catch(() => { /* تبقى pending وتُرسل في الدورة التالية */ });
  return true;
}

export async function saveAndRelayFaultImage(id, dataUrl) {
  if (!dataUrl) return false;
  const householdId = activeHousehold();
  await putImage('fault', id, dataUrl, true, householdId);
  relayFaultImage(id, dataUrl)
    .then(() => putImage('fault', id, dataUrl, false, householdId))
    .catch(() => { /* تبقى pending وتُرسل في الدورة التالية */ });
  return true;
}

export async function saveAndRelayShoppingImage(id, dataUrl) {
  if (!dataUrl) return false;
  const householdId = activeHousehold();
  await putImage('shopping', id, dataUrl, true, householdId);
  relayShoppingImage(id, dataUrl)
    .then(() => putImage('shopping', id, dataUrl, false, householdId))
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
      const kind = item.kind || 'pantry';
      const relay = kind === 'fault' ? relayFaultImage
        : kind === 'shopping' ? relayShoppingImage : relayPantryImage;
      await relay(item.itemId, item.dataUrl);
      await putImage(kind, item.itemId, item.dataUrl, false, householdId);
      sent++;
    } catch { break; }
  }
  return sent;
}

/** المالك ينزّل الصور المؤقتة إلى هاتفه، ثم يؤكد ليحذفها الخادم. */
export async function syncIncomingPantryImages() {
  return syncIncomingImages('pantry', pullPantryImages, ackPantryImages);
}

export async function syncIncomingFaultImages() {
  return syncIncomingImages('fault', pullFaultImages, ackFaultImages);
}

export async function syncIncomingShoppingImages() {
  return syncIncomingImages('shopping', pullShoppingImages, ackShoppingImages);
}

async function syncIncomingImages(kind, pull, ack) {
  if (!navigator.onLine) return 0;
  const householdId = activeHousehold();
  const result = await pull();
  const images = Array.isArray(result?.images) ? result.images : [];
  const saved = [];
  for (const image of images) {
    if (!image?.itemId || !image?.dataUrl) continue;
    await putImage(kind, image.itemId, image.dataUrl, false, householdId);
    saved.push(String(image.itemId));
  }
  if (saved.length) await ack(saved);
  return saved.length;
}

/** يملأ صور الصفوف بعد رسمها من IndexedDB المحلي. */
export async function hydratePantryImages(root) {
  return hydrateLocalImages(root, 'pantry', '[data-pantry-image]');
}

export async function hydrateFaultImages(root) {
  return hydrateLocalImages(root, 'fault', '[data-fault-image]');
}

export async function hydrateShoppingImages(root) {
  return hydrateLocalImages(root, 'shopping', '[data-shopping-image]');
}

async function hydrateLocalImages(root, kind, selector) {
  const nodes = [...(root?.querySelectorAll?.(selector) || [])];
  await Promise.all(nodes.map(async (node) => {
    const id = kind === 'fault' ? node.dataset.faultImage
      : kind === 'shopping' ? node.dataset.shoppingImage : node.dataset.pantryImage;
    const image = await getLocalImage(kind, id);
    if (!image?.dataUrl) return;
    node.src = image.dataUrl;
    node.hidden = false;
    if (kind === 'pantry') node.parentElement?.querySelector('[data-pantry-icon]')?.setAttribute('hidden', '');
    if (kind === 'fault') node.parentElement?.querySelector('[data-fault-placeholder]')?.setAttribute('hidden', '');
  }));
}
