/* شاشة الدخول — حساب مشترك في السحابة أو وضع محلي */

import { $, esc } from '../util.js';
import { setupHousehold, seedDemo } from '../store.js';
import { toast, openSheet } from '../ui.js';
import * as cloud from '../cloud.js';
import { langSheet } from './helper.js';
import { applyLangToDocument } from '../i18n.js';

/** يعرض رمز الاسترداد ويُلزم المستخدم بتأكيد حفظه */
function showRecoveryCode(code, replaced = false) {
  return new Promise((resolve) => {
    openSheet(`
      <h3>🔑 رمز الاسترداد</h3>
      <p class="muted small" style="margin:0 0 12px">
        ${replaced ? 'رمزك السابق استُهلك، وهذا بديله.' : ''}
        احفظ هذا الرمز في مكان آمن. هو طريقك الوحيد لاستعادة حسابك إن نسيت كلمة المرور —
        الخادم لا يحفظه نصًا ولا يستطيع إرساله لك لاحقًا.
      </p>
      <div class="invite-code" id="rcode">${esc(code)}</div>
      <button class="btn soft block mt" data-copy>📋 نسخ الرمز</button>
      <label class="row" style="gap:8px;align-items:center;margin:14px 0">
        <input type="checkbox" id="rok"> <span class="small">حفظته في مكان آمن</span></label>
      <button class="btn block" data-done disabled>متابعة</button>
    `, {
      onMount(el, close) {
        const done = el.querySelector('[data-done]');
        el.querySelector('#rok').onchange = (e) => { done.disabled = !e.target.checked; };
        el.querySelector('[data-copy]').onclick = async () => {
          try { await navigator.clipboard.writeText(code); toast('نُسخ الرمز ✓'); } catch { /* تجاهل */ }
        };
        done.onclick = () => { close(); resolve(); };
      },
    });
  });
}

export function renderAuth(onDone) {
  const root = $('#authRoot');
  root.hidden = false;
  $('#shell').hidden = true;

  let mode = 'welcome';   // welcome | signin | signup | household | join | localSetup
  let busy = false;
  let pendingName = '';

  const shell = (inner) => `
    <div class="auth-card">
      <div class="auth-logo">
        <div class="mark">🏡</div>
        <h1>بيتنا</h1>
        <p>إدارة المنزل بذكاء</p>
      </div>
      <div class="auth-box">${inner}</div>
      <p class="legal">بيتنا © ${new Date().getFullYear()} — صُمّم بحب لكل عائلة</p>
    </div>`;

  const views = {
    welcome: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">أهلاً بك</h3>
      <p class="muted small" style="margin:0 0 18px">
        سجّل دخولك ليتزامن بيتك بين كل الأجهزة — نفس حساب تطبيق الجوال.
      </p>
      <button class="btn block" data-go="signin">🔐 تسجيل الدخول</button>
      <div style="height:10px"></div>
      <button class="btn ghost block" data-go="signup">✨ إنشاء حساب جديد</button>
      <hr class="divider">
      <button class="btn soft block" data-go="localSetup">📱 استخدام بدون حساب (هذا الجهاز فقط)</button>
      <button class="btn ghost block mt-s" data-act="lang">🌐 Language / भाषा / භාෂාව</button>
      <p class="hint center" style="margin-top:10px">
        الوضع المحلي يعمل بدون إنترنت لكنه لا يتزامن مع بقية أفراد البيت.
      </p>
    `),

    signin: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">أهلاً بعودتك</h3>
      <p class="muted small" style="margin:0 0 18px">سجّل دخولك للوصول إلى بيتك المشترك.</p>
      <div id="err"></div>
      <div class="field"><label for="email">البريد الإلكتروني</label>
        <input class="input" id="email" type="email" inputmode="email" autocomplete="email" style="direction:ltr;text-align:left" placeholder="name@example.com"></div>
      <div class="field"><label for="pass">كلمة المرور</label>
        <input class="input" id="pass" type="password" autocomplete="current-password" style="direction:ltr;text-align:left"></div>
      <button class="btn block" data-submit>دخول</button>
      <div class="auth-switch">ليس لديك حساب؟ <button data-go="signup">حساب جديد</button></div>
      <div class="auth-switch"><button data-go="recover">نسيت كلمة المرور؟</button></div>
      <div class="auth-switch"><button data-go="welcome">رجوع</button></div>
    `),

    recover: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">استعادة الحساب</h3>
      <p class="muted small" style="margin:0 0 18px">
        أدخل رمز الاسترداد الذي ظهر لك عند إنشاء الحساب.
      </p>
      <div id="err"></div>
      <div class="field"><label for="email">البريد الإلكتروني</label>
        <input class="input" id="email" type="email" inputmode="email" autocomplete="email" style="direction:ltr;text-align:left" placeholder="name@example.com"></div>
      <div class="field"><label for="code">رمز الاسترداد</label>
        <input class="input" id="code" placeholder="XXXXX-XXXXX-XXXXX" autocapitalize="characters" style="direction:ltr;text-align:left"></div>
      <div class="field"><label for="pass">كلمة المرور الجديدة</label>
        <input class="input" id="pass" type="password" autocomplete="new-password" style="direction:ltr;text-align:left">
        <div class="hint">6 أحرف على الأقل</div></div>
      <button class="btn block" data-submit>استعادة الحساب</button>
      <p class="tiny muted mt">
        فقدت الرمز أيضًا؟ لا يمكن استعادة الحساب — الخادم لا يحفظ الرمز نصًا،
        ولا يرسل بريدًا. اطلب من فرد آخر في البيت دعوتك بحساب جديد.
      </p>
      <div class="auth-switch"><button data-go="signin">رجوع</button></div>
    `),

    signup: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">أنشئ حسابك الجديد</h3>
      <p class="muted small" style="margin:0 0 18px">حساب واحد يجمع كل أفراد البيت على كل الأجهزة.</p>
      <div id="err"></div>
      <div class="field"><label for="name">اسمك داخل التطبيق</label>
        <input class="input" id="name" placeholder="أحمد" autocomplete="name"></div>
      <div class="field"><label for="email">البريد الإلكتروني</label>
        <input class="input" id="email" type="email" inputmode="email" autocomplete="email" style="direction:ltr;text-align:left" placeholder="name@example.com"></div>
      <div class="field"><label for="pass">كلمة المرور</label>
        <input class="input" id="pass" type="password" autocomplete="new-password" style="direction:ltr;text-align:left">
        <div class="hint">6 أحرف على الأقل</div></div>
      <button class="btn block" data-submit>إنشاء الحساب</button>
      <div class="auth-switch">لديك حساب؟ <button data-go="signin">تسجيل الدخول</button></div>
      <div class="auth-switch"><button data-go="welcome">رجوع</button></div>
    `),

    household: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">بيتك في بيتنا</h3>
      <p class="muted small" style="margin:0 0 18px">
        اختر إن كنت تريد إنشاء بيت جديد أو الانضمام إلى بيت موجود.
      </p>
      <div id="err"></div>
      <div class="field"><label for="hname">اسم البيت</label>
        <input class="input" id="hname" placeholder="بيت أحمد وسارة"></div>
      <button class="btn block" data-submit>🏠 إنشاء البيت</button>
      <hr class="divider">
      <button class="btn ghost block" data-go="join">🔑 لديّ كود دعوة</button>
      <div class="auth-switch"><button data-go="logout">تسجيل خروج بحساب آخر</button></div>
    `),

    join: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">الانضمام بكود دعوة</h3>
      <p class="muted small" style="margin:0 0 18px">
        إذا أعطاك شريكك كود دعوة، أدخله للدخول إلى بيته المشترك.
      </p>
      <div id="err"></div>
      <div class="field"><label for="code">كود الدعوة</label>
        <input class="input" id="code" placeholder="BEITNA-XXXXXX" style="direction:ltr;text-align:left" autocapitalize="characters"></div>
      <button class="btn block" data-submit>الانضمام</button>
      <div class="auth-switch"><button data-go="household">رجوع</button></div>
    `),

    localSetup: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">وضع بدون حساب</h3>
      <p class="muted small" style="margin:0 0 18px">
        البيانات تُحفظ على هذا الجهاز فقط. يمكنك التحويل لحساب مشترك لاحقًا.
      </p>
      <div id="err"></div>
      <div class="field"><label for="hname">اسم البيت</label>
        <input class="input" id="hname" placeholder="بيت أحمد وسارة"></div>
      <div class="field"><label for="mname">اسمك داخل التطبيق</label>
        <input class="input" id="mname" placeholder="أحمد"></div>
      <button class="btn block" data-submit>ابدأ</button>
      <div class="auth-switch"><button data-go="welcome">رجوع</button></div>
    `),
  };

  const draw = () => { root.innerHTML = views[mode](); };
  const err = (msg) => {
    const box = root.querySelector('#err');
    if (box) box.innerHTML = `<div class="err">${esc(msg)}</div>`;
  };
  let busyTimer = null;
  const setBusy = (on, label) => {
    busy = on;
    const b = root.querySelector('[data-submit]');
    if (b) { b.disabled = on; if (on) b.textContent = label || 'لحظة...'; }
    clearTimeout(busyTimer);
    if (on) {
      /* إن تأخّرت العملية لأي سبب، نفكّ القفل ونخبر المستخدم بدل التعليق */
      busyTimer = setTimeout(() => {
        if (!busy) return;
        setBusy(false);
        draw();
        err('تأخّر الاتصال. تحقق من الإنترنت وأعد المحاولة.');
      }, 25000);
    }
  };

  root.onclick = async (e) => {
    if (e.target.closest('[data-act="lang"]')) {
      /* تختار العاملة لغتها قبل الدخول — لا تقرأ العربية */
      langSheet(() => { applyLangToDocument(); draw(); });
      return;
    }
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) {
      setBusy(false);
      const target = goBtn.dataset.go;
      if (target === 'logout') { await cloud.signOutCloud(); mode = 'welcome'; }
      else mode = target;
      draw();
      return;
    }
    if (!e.target.closest('[data-submit]') || busy) return;

    /* ---------- الوضع المحلي ---------- */
    if (mode === 'localSetup') {
      const hname = root.querySelector('#hname').value.trim();
      const mname = root.querySelector('#mname').value.trim();
      if (!hname) return err('اكتب اسم البيت');
      if (!mname) return err('اكتب اسمك داخل التطبيق');
      setupHousehold({ householdName: hname, memberName: mname });
      seedDemo();
      toast('تم إنشاء بيتك 🎉');
      return finish({ cloud: false });
    }

    /* ---------- تسجيل الدخول ---------- */
    if (mode === 'signin') {
      const email = root.querySelector('#email').value.trim();
      const pass = root.querySelector('#pass').value;
      if (!email || !pass) return err('البريد وكلمة المرور مطلوبان');
      setBusy(true, 'جارٍ الدخول...');
      try {
        if (!(await cloud.initCloud())) throw new Error('network');
        const user = await cloud.signIn(email, pass);
        pendingName = user.displayName || email.split('@')[0];
        const hid = await cloud.loadHouseholdId();
        setBusy(false);
        if (hid) return finishCloud(hid);
        mode = 'household'; draw();
      } catch (ex) {
        setBusy(false); err(cloud.arabicError(ex));
      }
      return;
    }

    /* ---------- حساب جديد ---------- */
    if (mode === 'signup') {
      const name = root.querySelector('#name').value.trim();
      const email = root.querySelector('#email').value.trim();
      const pass = root.querySelector('#pass').value;
      if (!name || !email || !pass) return err('كل الحقول مطلوبة');
      if (pass.length < 6) return err('كلمة المرور يجب 6 أحرف على الأقل');
      setBusy(true, 'جارٍ الإنشاء...');
      try {
        if (!(await cloud.initCloud())) throw new Error('network');
        const created = await cloud.signUp(email, pass, name);
        pendingName = name;
        setBusy(false);
        /* يُعرض مرة واحدة فقط — الخادم لا يحفظه نصًا ولا يرسل بريدًا */
        if (created?.recoveryCode) await showRecoveryCode(created.recoveryCode);
        mode = 'household'; draw();
      } catch (ex) {
        setBusy(false); err(cloud.arabicError(ex));
      }
      return;
    }

    /* ---------- استعادة الحساب ---------- */
    if (mode === 'recover') {
      const email = root.querySelector('#email').value.trim();
      const code = root.querySelector('#code').value.trim();
      const pass = root.querySelector('#pass').value;
      if (!email || !code || !pass) return err('كل الحقول مطلوبة');
      if (pass.length < 6) return err('كلمة المرور يجب 6 أحرف على الأقل');
      setBusy(true, 'جارٍ الاستعادة...');
      try {
        const u = await cloud.recoverAccount(email, code, pass);
        setBusy(false);
        if (u?.recoveryCode) await showRecoveryCode(u.recoveryCode, true);
        toast('تمت استعادة حسابك ✓');
        location.replace(location.origin + location.pathname);
      } catch (ex) {
        setBusy(false); err(cloud.arabicError(ex));
      }
      return;
    }

    /* ---------- إنشاء بيت ---------- */
    if (mode === 'household') {
      const hname = root.querySelector('#hname').value.trim();
      if (!hname) return err('اكتب اسم البيت');
      setBusy(true, 'جارٍ الإنشاء...');
      try {
        const hh = await cloud.createHousehold(hname, pendingName || 'مستخدم');
        setupHousehold({
          householdName: hh.name, memberName: pendingName, email: cloud.currentEmail() || '',
          inviteCode: hh.inviteCode, isOwner: true, cloud: true, resetData: true,
        });
        setBusy(false);
        toast('تم إنشاء بيتك 🎉');
        return finishCloud(hh.id, true);
      } catch (ex) {
        setBusy(false); err(cloud.arabicError(ex));
      }
      return;
    }

    /* ---------- الانضمام بكود ---------- */
    if (mode === 'join') {
      const code = root.querySelector('#code').value.trim().toUpperCase();
      if (!code) return err('أدخل كود الدعوة');
      setBusy(true, 'جارٍ الانضمام...');
      try {
        const hh = await cloud.joinHousehold(code, pendingName || 'مستخدم');
        setupHousehold({
          householdName: hh.name, memberName: pendingName, email: cloud.currentEmail() || '',
          inviteCode: hh.inviteCode, isOwner: false, cloud: true, resetData: true,
        });
        setBusy(false);
        toast('تم الانضمام إلى البيت ✓');
        return finishCloud(hh.id, true);
      } catch (ex) {
        setBusy(false);
        err(ex?.message === 'bad-code' ? 'كود غير صحيح أو غير موجود' : cloud.arabicError(ex));
      }
    }
  };

  async function finishCloud(hid, alreadySetUp = false) {
    if (!alreadySetUp) {
      const hh = await cloud.loadHousehold(hid);
      setupHousehold({
        householdName: hh?.name || 'بيتي', memberName: pendingName,
        email: cloud.currentEmail() || '', inviteCode: hh?.inviteCode || '',
        isOwner: false, cloud: true, resetData: true,
      });
    }
    finish({ cloud: true, hid });
  }

  function finish(result) {
    root.hidden = true;
    root.onclick = null;
    onDone(result);
  }

  draw();
}
