/* ============================================================
   التذكيرات والإشعارات
   ملاحظة مهمة:
   على الجوال (أندرويد و iPhone) لا يعمل `new Notification()` إطلاقًا.
   الطريقة المدعومة الوحيدة هي ServiceWorkerRegistration.showNotification().
   و iPhone لا يمنح الإذن إلا بعد تثبيت التطبيق على الشاشة الرئيسية.
   ============================================================ */

import { getState, REMINDER_OFFSETS } from './store.js';
import { startOfDay, todayStart } from './util.js';

const SENT_KEY = 'beitna:sent:v1';

/* ---------- كشف البيئة ---------- */

/** يعمل كتطبيق مثبّت لا كصفحة داخل المتصفح (شرط الإشعارات على iPhone) */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
  window.navigator.standalone === true;

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** الإشعارات عبر Service Worker متاحة؟ */
export const notificationsSupported = () =>
  'Notification' in window &&
  'serviceWorker' in navigator &&
  typeof ServiceWorkerRegistration !== 'undefined' &&
  'showNotification' in ServiceWorkerRegistration.prototype;

export const notificationState = () =>
  (notificationsSupported() ? Notification.permission : 'unsupported');

/**
 * حالة الإشعارات بصيغة تفهمها الواجهة:
 * 'granted' | 'default' | 'denied' | 'ios-needs-install' | 'unsupported'
 */
export function notificationStatus() {
  if (!('Notification' in window)) {
    return (isIOS() && !isStandalone()) ? 'ios-needs-install' : 'unsupported';
  }
  if (!notificationsSupported()) return 'unsupported';
  if (isIOS() && !isStandalone() && Notification.permission !== 'granted') {
    return 'ios-needs-install';
  }
  return Notification.permission;
}

/* ---------- تسجيل الـ Service Worker ---------- */
let regPromise = null;
function ensureRegistration() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!regPromise) {
    regPromise = Promise.race([
      navigator.serviceWorker.ready,
      new Promise((res) => setTimeout(() => res(null), 6000)),
    ]).catch(() => null);
  }
  return regPromise;
}

/* ---------- طلب الإذن ---------- */
/** يجب استدعاؤها مباشرة داخل حدث لمس/نقر من المستخدم (شرط iPhone) */
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return false;
  try {
    const res = await Notification.requestPermission();
    if (res === 'granted') ensureRegistration();
    return res === 'granted';
  } catch { return false; }
}

/* ---------- عرض الإشعار ---------- */
function inQuietHours() {
  const h = new Date().getHours();
  return h >= 23 || h < 7;
}

/** يعرض إشعارًا. يرجع true عند النجاح. */
export async function show(title, body, extra = {}) {
  const s = getState();
  if (s.notifications.quietHours && !extra.force && inQuietHours()) return false;
  if (notificationState() !== 'granted') return false;

  const options = {
    body,
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-192.png',
    lang: 'ar',
    dir: 'rtl',
    tag: extra.tag || ('beitna-' + title),
    renotify: false,
    requireInteraction: false,
    silent: !s.notifications.sound,
    data: { url: extra.url || './', at: Date.now() },
  };
  /* Chrome يرفض الجمع بين silent و vibrate */
  if (!options.silent && s.notifications.vibration) options.vibrate = [60, 40, 60];

  const reg = await ensureRegistration();
  if (reg?.showNotification) {
    try {
      await reg.showNotification(title, options);
      return true;
    } catch (e) {
      console.warn('تعذّر عرض الإشعار عبر Service Worker', e);
    }
  }

  /* منفذ احتياطي لسطح المكتب فقط — الجوال لا يقبل هذا الشكل */
  try { new Notification(title, options); return true; }
  catch { return false; }
}

/** إشعار تجريبي يتجاهل وضع الهدوء — لزر «تجربة» في الإعدادات */
export function testNotification() {
  return show('بيتنا ✓', 'الإشعارات تعمل على هذا الجهاز.', { tag: 'beitna-test', force: true });
}

/* ---------- سجل ما أُرسل ---------- */
function sentSet() {
  try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) || '[]')); }
  catch { return new Set(); }
}
function markSent(set) {
  try { localStorage.setItem(SENT_KEY, JSON.stringify([...set].slice(-300))); } catch { /* تجاهل */ }
}

/** فحص التذكيرات المستحقة الآن */
export function checkReminders() {
  const s = getState();
  if (notificationState() !== 'granted') return;

  const sent = sentSet();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = todayStart();
  let changed = false;

  if (s.notifications.occasionAlerts) {
    s.occasions.filter((o) => !o.done).forEach((o) => {
      (o.reminderOffsets || []).forEach((offId) => {
        const off = REMINDER_OFFSETS.find((r) => r.id === offId);
        if (!off) return;
        const fireDay = startOfDay(o.dateMillis) - off.days * 86400000;
        if (fireDay !== today) return;
        const [h, m] = (o.reminderTime || '09:00').split(':').map(Number);
        const fireMin = h * 60 + m;
        if (nowMin < fireMin || nowMin > fireMin + 90) return;
        const key = `occ:${o.id}:${offId}:${today}`;
        if (sent.has(key)) return;
        sent.add(key); changed = true;
        show('لديك مناسبة: ' + o.title,
          off.days === 0 ? 'المناسبة اليوم 🎉' : off.label,
          { tag: key, url: './#/occasions/' + o.id });
      });
    });
  }

  if (s.notifications.shoppingReminders) {
    const urgent = s.shopping.filter((i) => i.priority === 'ضروري' && i.status !== 'تم الشراء');
    if (urgent.length && nowMin >= 17 * 60 && nowMin <= 19 * 60) {
      const key = `shop:${today}`;
      if (!sent.has(key)) {
        sent.add(key); changed = true;
        show('🛒 عناصر ضرورية', `يوجد ${urgent.length} عنصر ضروري لم يُشترَ بعد`,
          { tag: key, url: './#/shopping' });
      }
    }
  }

  if (s.notifications.dailySummary && nowMin >= 7 * 60 && nowMin <= 9 * 60) {
    const key = `sum:${today}`;
    if (!sent.has(key)) {
      sent.add(key); changed = true;
      const open = s.faults.filter((f) => f.status !== 'تم الإصلاح').length;
      const shop = s.shopping.filter((i) => i.status !== 'تم الشراء').length;
      show('☀️ ملخص بيتنا اليوم', `${shop} مشتريات ناقصة • ${open} أعطال تحتاج متابعة`,
        { tag: key, url: './#/home' });
    }
  }

  if (changed) markSent(sent);
}

/** إشعار فوري بنشاط فرد آخر من البيت */
export function notifyPartner(text) {
  const s = getState();
  if (!s.notifications.partnerActivity) return;
  show('بيتنا — نشاط جديد', text, { tag: 'beitna-activity', url: './#/home' });
}

export function startReminderLoop() {
  checkReminders();
  setInterval(checkReminders, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkReminders();
  });
}
