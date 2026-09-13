/* ============================================================
   الاشتراك في Web Push
   يجعل الإشعارات تصل والتطبيق مغلق تمامًا — لا تعتمد على بقاء
   الصفحة مفتوحة كما هو حال التذكيرات المحسوبة على الجهاز.
   ============================================================ */

import { pushPublicKey, savePushSubscription, dropPushSubscription, sendTestPush } from './cloud.js';
import { notificationsSupported } from './notify.js';

const K_ON = 'beitna:push-on';

export const pushSupported = () =>
  notificationsSupported() && 'PushManager' in window;

export const pushWanted = () => {
  try { return localStorage.getItem(K_ON) === '1'; } catch { return false; }
};
const remember = (on) => {
  try { localStorage.setItem(K_ON, on ? '1' : '0'); } catch { /* تجاهل */ }
};

function toUint8(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((r) => setTimeout(() => r(null), 6000)),
  ]).catch(() => null);
}

/** هل هذا الجهاز مشترك فعلًا الآن؟ */
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission !== 'granted') return 'needs-permission';
  const reg = await registration();
  if (!reg?.pushManager) return 'unsupported';
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return sub ? 'on' : 'off';
}

/** يشترك ويُبلّغ الخادم. يجب أن يُستدعى بعد منح إذن الإشعارات. */
export async function enablePush() {
  if (!pushSupported()) throw { code: 'unsupported' };
  const reg = await registration();
  if (!reg?.pushManager) throw { code: 'unsupported' };

  let sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) {
    const { key } = await pushPublicKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,                 // شرط المتصفحات: كل دفعة تُعرض
      applicationServerKey: toUint8(key),
    });
  }
  await savePushSubscription(sub.toJSON());
  remember(true);
  return true;
}

export async function disablePush() {
  remember(false);
  const reg = await registration();
  const sub = await reg?.pushManager?.getSubscription?.().catch(() => null);
  if (!sub) return true;
  try { await dropPushSubscription(sub.endpoint); } catch { /* الخادم قد ينظّفه لاحقًا */ }
  try { await sub.unsubscribe(); } catch { /* تجاهل */ }
  return true;
}

/** يعيد الاشتراك بصمت إن كان المستخدم مفعّلًا له — الاشتراكات تنتهي أحيانًا */
export async function refreshPush() {
  if (!pushWanted() || !pushSupported()) return;
  if (Notification.permission !== 'granted') return;
  try { await enablePush(); } catch { /* يُعاد في الجلسة القادمة */ }
}

export { sendTestPush };
