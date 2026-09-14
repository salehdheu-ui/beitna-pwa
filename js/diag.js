/* ============================================================
   مقاييس الجلسة — تُقرأ من «الدعم ← حالة التطبيق»

   وُضعت لأن أعراضًا مثل «الصفحة تومض» لا يمكن تشخيصها بالوصف وحده:
   الرقم يفرّق بين إعادة تحميل كاملة للصفحة (loads يتصاعد) وبين
   إعادة رسم للشاشة (repaints يتصاعد) — وهما علّتان مختلفتان تمامًا.
   ============================================================ */

const K_LOADS = 'beitna:loads';

let loads = 1;
try {
  loads = Number(sessionStorage.getItem(K_LOADS) || 0) + 1;
  sessionStorage.setItem(K_LOADS, String(loads));
} catch { /* تجاهل */ }

export const diag = {
  loads,          // مرات تحميل الصفحة منذ فتح التطبيق
  repaints: 0,    // رسمات الشاشة
  skipped: 0,     // نبضات وصلت بلا جديد فلم تُرسم
  syncs: 0,       // نبضات المزامنة
  lastSync: 0,
  startedAt: Date.now(),
};

export const upMinutes = () => Math.max(1, Math.round((Date.now() - diag.startedAt) / 60000));
