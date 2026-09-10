/* التذكيرات والإشعارات داخل المتصفح */

import { getState, REMINDER_OFFSETS } from './store.js';
import { startOfDay, todayStart } from './util.js';

const SENT_KEY = 'beitna:sent:v1';

export const notificationState = () =>
  ('Notification' in window ? Notification.permission : 'unsupported');

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch { return false; }
}

function sentSet() {
  try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) || '[]')); }
  catch { return new Set(); }
}
function markSent(set) {
  try { localStorage.setItem(SENT_KEY, JSON.stringify([...set].slice(-300))); } catch { /* تجاهل */ }
}

function show(title, body) {
  const s = getState();
  if (s.notifications.quietHours) {
    const h = new Date().getHours();
    if (h >= 23 || h < 7) return;
  }
  if (notificationState() !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon: 'assets/icons/icon-192.png',
      badge: 'assets/icons/icon-192.png',
      silent: !s.notifications.sound,
      tag: 'beitna-' + title,
    });
    n.onclick = () => { window.focus(); n.close(); };
    if (s.notifications.vibration) navigator.vibrate?.([60, 40, 60]);
  } catch { /* تجاهل */ }
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
        show('لديك مناسبة: ' + o.title, off.days === 0 ? 'المناسبة اليوم 🎉' : off.label);
      });
    });
  }

  if (s.notifications.shoppingReminders) {
    const urgent = s.shopping.filter((i) => i.priority === 'ضروري' && i.status !== 'تم الشراء');
    if (urgent.length && nowMin >= 17 * 60 && nowMin <= 19 * 60) {
      const key = `shop:${today}`;
      if (!sent.has(key)) {
        sent.add(key); changed = true;
        show('🛒 عناصر ضرورية', `يوجد ${urgent.length} عنصر ضروري لم يُشترَ بعد`);
      }
    }
  }

  if (s.notifications.dailySummary && nowMin >= 7 * 60 && nowMin <= 9 * 60) {
    const key = `sum:${today}`;
    if (!sent.has(key)) {
      sent.add(key); changed = true;
      const open = s.faults.filter((f) => f.status !== 'تم الإصلاح').length;
      const shop = s.shopping.filter((i) => i.status !== 'تم الشراء').length;
      show('☀️ ملخص بيتنا اليوم', `${shop} مشتريات ناقصة • ${open} أعطال تحتاج متابعة`);
    }
  }

  if (changed) markSent(sent);
}

/** إشعار فوري بنشاط فرد آخر من البيت */
export function notifyPartner(text) {
  const s = getState();
  if (!s.notifications.partnerActivity) return;
  show('بيتنا — نشاط جديد', text);
}

export function startReminderLoop() {
  checkReminders();
  setInterval(checkReminders, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkReminders();
  });
}
