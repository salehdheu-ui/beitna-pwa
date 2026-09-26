/* شاشة الدخول — حساب مشترك في السحابة أو وضع محلي */

import { $, esc } from '../util.js';
import { setupHousehold, seedDemo, getState, prepareAccountSwitch } from '../store.js';
import { toast, openSheet } from '../ui.js';
import * as cloud from '../cloud.js';
import { langSheet } from './helper.js';
import { applyLangToDocument, currentLang, t } from '../i18n.js';

// ربط بيت محلي وافق صاحبه على رفعه يجب ألا يمسح عناصره قبل بدء المزامنة.
function hasPendingLocalUpload() {
  try { return localStorage.getItem('beitna:pending-upload') === '1'; }
  catch { return false; }
}

/** يعرض رمز الاسترداد ويُلزم المستخدم بتأكيد حفظه */
function showRecoveryCode(code, replaced = false, requireBackup = true) {
  return new Promise((resolve) => {
    openSheet(`
      <h3>🔑 ${esc(t('recovery_code'))}</h3>
      <p class="muted small" style="margin:0 0 12px">
        ${replaced ? esc(t('recovery_replaced')) : ''}
        ${esc(currentLang() === 'ar'
          ? 'احفظ هذا الرمز كخيار احتياطي. ويمكنك أيضًا استعادة كلمة المرور عبر بريدك الإلكتروني إذا فُعّل إرسال البريد.'
          : 'Keep this code as a backup. You can also reset your password by email when email delivery is enabled.')}
      </p>
      <div class="invite-code" id="rcode">${esc(code)}</div>
      <button class="btn soft block mt" data-copy>📋 ${esc(t('copy_code'))}</button>
      ${requireBackup ? `<label class="row" style="gap:8px;align-items:center;margin:14px 0">
        <input type="checkbox" id="rok"> <span class="small">${esc(t('saved_safe'))}</span></label>` : ''}
      <button class="btn block" data-done ${requireBackup ? 'disabled' : ''}>${esc(t('continue'))}</button>
    `, {
      onMount(el, close) {
        el.parentElement.onclick = (event) => {
          if (event.target === el.parentElement && !requireBackup) { close(); resolve(); }
        };
        const done = el.querySelector('[data-done]');
        const check = el.querySelector('#rok');
        if (check) check.onchange = (e) => { done.disabled = !e.target.checked; };
        el.querySelector('[data-copy]').onclick = async () => {
          try { await navigator.clipboard.writeText(code); toast(t('code_copied')); } catch { /* تجاهل */ }
        };
        done.onclick = () => { close(); resolve(); };
      },
    });
  });
}

export function renderAuth(onDone, { initialMode = 'welcome', resetCode = '', initialError = '' } = {}) {
  const root = $('#authRoot');
  root.hidden = false;
  $('#shell').hidden = true;

  let mode = initialMode;   // welcome | signin | signup | recoverEmail | recover | reset | household | join | localSetup
  let busy = false;
  let pendingName = cloud.currentDisplayName() || '';
  let providers = { google: false, emailRecovery: false };

  const providerButtons = () => `
    ${providers.google ? `<div class="auth-providers">
      <button type="button" class="google-signin" data-oauth="google" aria-label="${esc(currentLang() === 'ar' ? 'الدخول عبر Google' : 'Continue with Google')}" title="${esc(currentLang() === 'ar' ? 'الدخول عبر Google' : 'Continue with Google')}"><img src="assets/icons/google-signin.svg" width="48" height="48" alt="" aria-hidden="true"></button>
    </div>` : ''}`;

  const shell = (inner) => `
    <div class="auth-card">
      <div class="auth-logo">
        <div class="mark">🏡</div>
        <h1>${esc(t('app_name'))}</h1>
        <p>${esc(t('tagline'))}</p>
      </div>
      <div class="auth-box">${inner}</div>
      <p class="legal">${esc(t('app_name'))} © ${new Date().getFullYear()} — ${esc(t('legal'))}</p>
    </div>`;

  const views = {
    welcome: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">${esc(t('welcome_title'))}</h3>
      <p class="muted small" style="margin:0 0 18px">${esc(t('welcome_sub'))}</p>
      <button class="btn block" data-go="signin">🔐 ${esc(t('login'))}</button>
      <div style="height:10px"></div>
      <button class="btn ghost block" data-go="signup">✨ ${esc(t('signup'))}</button>
      <div data-external-holder>${providerButtons()}</div>
      <hr class="divider">
      <button class="btn soft block" data-go="localSetup">📱 ${esc(t('use_local'))}</button>
      <button class="btn ghost block mt-s" data-act="lang">🌐 ${esc(t('language'))}</button>
      <p class="hint center" style="margin-top:10px">
        ${esc(t('local_hint'))}
      </p>
    `),

    signin: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">${esc(t('login'))}</h3>
      <p class="muted small" style="margin:0 0 18px">${esc(t('welcome_sub'))}</p>
      <div id="err"></div>
      <div class="field"><label for="email">${esc(t('email'))}</label>
        <input class="input" id="email" type="email" inputmode="email" autocomplete="email" style="direction:ltr;text-align:left" placeholder="name@example.com"></div>
      <div class="field"><label for="pass">${esc(t('password'))}</label>
        <input class="input" id="pass" type="password" autocomplete="current-password" style="direction:ltr;text-align:left"></div>
      <button class="btn block" data-submit>${esc(t('enter'))}</button>
      <div data-external-holder>${providerButtons()}</div>
      <div class="auth-switch">${esc(t('no_account'))} <button data-go="signup">${esc(t('signup'))}</button></div>
      <div class="auth-switch"><button data-forgot data-go="${providers.emailRecovery ? 'recoverEmail' : 'recover'}">${esc(t('forgot_password'))}</button></div>
      <div class="auth-switch"><button data-go="welcome">${esc(t('back'))}</button></div>
    `),

    recoverEmail: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">${esc(t('recover_account'))}</h3>
      <p class="muted small">${esc(currentLang() === 'ar' ? 'أدخل بريدك وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.' : 'Enter your email and we will send a link to set a new password.')}</p>
      <div id="err"></div>
      <div class="field"><label for="email">${esc(t('email'))}</label>
        <input class="input" id="email" type="email" inputmode="email" autocomplete="email" style="direction:ltr;text-align:left" placeholder="name@example.com"></div>
      <button class="btn block" data-submit>${esc(currentLang() === 'ar' ? 'إرسال رابط الاستعادة' : 'Send reset link')}</button>
      <div class="auth-switch"><button data-go="recover">${esc(currentLang() === 'ar' ? 'لديّ رمز الاسترداد القديم' : 'I have a recovery code')}</button></div>
      <div class="auth-switch"><button data-go="signin">${esc(t('back'))}</button></div>
    `),

    resetSent: () => shell(`
      <h3>${esc(currentLang() === 'ar' ? 'تحقق من بريدك' : 'Check your inbox')}</h3>
      <p class="muted small">${esc(currentLang() === 'ar' ? 'إذا كان البريد مسجّلًا، سيصلك رابط صالح لمدة 15 دقيقة. افحص الرسائل غير المرغوبة أيضًا.' : 'If the address has an account, a link valid for 15 minutes will arrive. Check your spam folder too.')}</p>
      <button class="btn ghost block" data-go="recover">${esc(currentLang() === 'ar' ? 'استخدم رمز الاسترداد بدلًا من ذلك' : 'Use a recovery code instead')}</button>
      <div class="auth-switch"><button data-go="signin">${esc(t('back'))}</button></div>
    `),

    reset: () => shell(`
      <h3>${esc(t('new_password'))}</h3>
      <div id="err"></div>
      <div class="field"><label for="pass">${esc(t('new_password'))}</label>
        <input class="input" id="pass" type="password" autocomplete="new-password" style="direction:ltr;text-align:left"></div>
      <div class="field"><label for="pass2">${esc(currentLang() === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password')}</label>
        <input class="input" id="pass2" type="password" autocomplete="new-password" style="direction:ltr;text-align:left"></div>
      <button class="btn block" data-submit>${esc(t('recover_account'))}</button>
    `),

    recover: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">${esc(t('recover_account'))}</h3>
      <p class="muted small" style="margin:0 0 18px">${esc(t('recover_prompt'))}</p>
      <div id="err"></div>
      <div class="field"><label for="email">${esc(t('email'))}</label>
        <input class="input" id="email" type="email" inputmode="email" autocomplete="email" style="direction:ltr;text-align:left" placeholder="name@example.com"></div>
      <div class="field"><label for="code">${esc(t('recovery_code'))}</label>
        <input class="input" id="code" placeholder="XXXXX-XXXXX-XXXXX" autocapitalize="characters" style="direction:ltr;text-align:left"></div>
      <div class="field"><label for="pass">${esc(t('new_password'))}</label>
        <input class="input" id="pass" type="password" autocomplete="new-password" style="direction:ltr;text-align:left">
        <div class="hint">${esc(t('pass_hint'))}</div></div>
      <button class="btn block" data-submit>${esc(t('recover_account'))}</button>
      <p class="tiny muted mt" data-recovery-help>${esc(providers.emailRecovery
        ? (currentLang() === 'ar' ? 'إن لم يعد الرمز لديك، استخدم رابط الاستعادة بالبريد.' : 'If you lost the code, use the email reset link.')
        : (currentLang() === 'ar' ? 'إذا فقدت الرمز أيضًا، فلا يمكن استعادة الحساب حتى تُفعّل خدمة البريد.' : 'If you also lost the code, recovery needs email delivery to be enabled.'))}</p>
      <div class="auth-switch" data-email-recovery ${providers.emailRecovery ? '' : 'hidden'}><button data-go="recoverEmail">${esc(currentLang() === 'ar' ? 'استعادة عبر البريد' : 'Recover by email')}</button></div>
      <div class="auth-switch"><button data-go="signin">${esc(t('back'))}</button></div>
    `),

    signup: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">${esc(t('signup'))}</h3>
      <p class="muted small" style="margin:0 0 18px">${esc(t('welcome_sub'))}</p>
      <div id="err"></div>
      <div class="field"><label for="name">${esc(t('display_name'))}</label>
        <input class="input" id="name" placeholder="${esc(t('your_name'))}" autocomplete="name"></div>
      <div class="field"><label for="email">${esc(t('email'))}</label>
        <input class="input" id="email" type="email" inputmode="email" autocomplete="email" style="direction:ltr;text-align:left" placeholder="name@example.com"></div>
      <div class="field"><label for="pass">${esc(t('password'))}</label>
        <input class="input" id="pass" type="password" autocomplete="new-password" style="direction:ltr;text-align:left">
        <div class="hint">${esc(t('pass_hint'))}</div></div>
      <button class="btn block" data-submit>${esc(t('create_account'))}</button>
      <div data-external-holder>${providerButtons()}</div>
      <div class="auth-switch">${esc(t('have_account'))} <button data-go="signin">${esc(t('login'))}</button></div>
      <div class="auth-switch"><button data-go="welcome">${esc(t('back'))}</button></div>
    `),

    household: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">${esc(t('home_setup_title'))}</h3>
      <p class="muted small" style="margin:0 0 18px">${esc(t('home_setup_sub'))}</p>
      <div id="err"></div>
      <div class="field"><label for="hname">${esc(t('home_name'))}</label>
        <input class="input" id="hname" placeholder="${esc(t('home_name'))}"></div>
      <button class="btn block" data-submit>🏠 ${esc(t('create_home'))}</button>
      <hr class="divider">
      <button class="btn ghost block" data-go="join">🔑 ${esc(t('have_invite'))}</button>
      <div class="auth-switch"><button data-go="logout">${esc(t('logout_other'))}</button></div>
    `),

    join: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">${esc(t('join_title'))}</h3>
      <p class="muted small" style="margin:0 0 18px">${esc(t('join_sub'))}</p>
      <div id="err"></div>
      <div class="field"><label for="code">${esc(t('invite_code'))}</label>
        <input class="input" id="code" placeholder="BEITNA-XXXXXX" style="direction:ltr;text-align:left" autocapitalize="characters"></div>
      <button class="btn block" data-submit>${esc(t('join'))}</button>
      <div class="auth-switch"><button data-go="household">${esc(t('back'))}</button></div>
    `),

    localSetup: () => shell(`
      <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">${esc(t('local_title'))}</h3>
      <p class="muted small" style="margin:0 0 18px">${esc(t('local_sub'))}</p>
      <div id="err"></div>
      <div class="field"><label for="hname">${esc(t('home_name'))}</label>
        <input class="input" id="hname" placeholder="${esc(t('home_name'))}"></div>
      <div class="field"><label for="mname">${esc(t('display_name'))}</label>
        <input class="input" id="mname" placeholder="${esc(t('your_name'))}"></div>
      <button class="btn block" data-submit>${esc(t('start'))}</button>
      <div class="auth-switch"><button data-go="welcome">${esc(t('back'))}</button></div>
    `),
  };

  const draw = () => {
    root.innerHTML = views[mode]();
  };
  const err = (msg) => {
    const box = root.querySelector('#err');
    if (box) box.innerHTML = `<div class="err">${esc(msg)}</div>`;
  };
  let busyTimer = null;
  const setBusy = (on, label) => {
    busy = on;
    const b = root.querySelector('[data-submit]');
    if (b) { b.disabled = on; if (on) b.textContent = label || t('please_wait'); }
    clearTimeout(busyTimer);
    if (on) {
      /* إن تأخّرت العملية لأي سبب، نفكّ القفل ونخبر المستخدم بدل التعليق */
      busyTimer = setTimeout(() => {
        if (!busy) return;
        setBusy(false);
        draw();
        err(t('connection_slow'));
      }, 25000);
    }
  };

  root.onclick = async (e) => {
    if (e.target.closest('[data-act="lang"]')) {
      /* تختار العاملة لغتها قبل الدخول — لا تقرأ العربية */
      langSheet(() => { applyLangToDocument(); draw(); });
      return;
    }
    const external = e.target.closest('[data-oauth]');
    if (external && !busy) {
      setBusy(true, t('please_wait'));
      try { await cloud.startExternalLogin(external.dataset.oauth); }
      catch (ex) { setBusy(false); err(cloud.arabicError(ex)); }
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

    if (mode === 'recoverEmail') {
      const email = root.querySelector('#email').value.trim();
      if (!email) return err(t('required'));
      setBusy(true, t('please_wait'));
      try {
        await cloud.requestPasswordReset(email);
        setBusy(false); mode = 'resetSent'; draw();
      } catch (ex) { setBusy(false); err(cloud.arabicError(ex)); }
      return;
    }

    if (mode === 'reset') {
      const pass = root.querySelector('#pass').value;
      const confirm = root.querySelector('#pass2').value;
      if (pass.length < 6) return err(t('password_short'));
      if (pass !== confirm) return err(currentLang() === 'ar' ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
      setBusy(true, t('please_wait'));
      try {
        await cloud.confirmPasswordReset(resetCode, pass);
        location.replace(location.origin + location.pathname);
      } catch (ex) { setBusy(false); err(cloud.arabicError(ex)); }
      return;
    }

    /* ---------- الوضع المحلي ---------- */
    if (mode === 'localSetup') {
      const hname = root.querySelector('#hname').value.trim();
      const mname = root.querySelector('#mname').value.trim();
      if (!hname || !mname) return err(t('required'));
      setupHousehold({ householdName: hname, memberName: mname });
      seedDemo();
      toast(t('home_created'));
      return finish({ cloud: false });
    }

    /* ---------- تسجيل الدخول ---------- */
    if (mode === 'signin') {
      const email = root.querySelector('#email').value.trim();
      const pass = root.querySelector('#pass').value;
      if (!email || !pass) return err(t('required'));
      setBusy(true, t('please_wait'));
      try {
        if (!(await cloud.initCloud())) throw new Error('network');
        const user = await cloud.signIn(email, pass);
        pendingName = user.displayName || email.split('@')[0];
        if (cloud.pendingFamilyInvitation()) return finish({ cloud: true, invitation: true });
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
      if (!name || !email || !pass) return err(t('required'));
      if (pass.length < 6) return err(t('password_short'));
      setBusy(true, t('please_wait'));
      try {
        if (!(await cloud.initCloud())) throw new Error('network');
        const created = await cloud.signUp(email, pass, name);
        pendingName = name;
        setBusy(false);
        /* يُعرض مرة واحدة فقط — الخادم لا يحفظه نصًا ولا يرسل بريدًا */
        if (created?.recoveryCode) await showRecoveryCode(created.recoveryCode, false, !providers.emailRecovery);
        if (cloud.pendingFamilyInvitation()) return finish({ cloud: true, invitation: true });
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
      if (!email || !code || !pass) return err(t('required'));
      if (pass.length < 6) return err(t('password_short'));
      setBusy(true, t('please_wait'));
      try {
        const u = await cloud.recoverAccount(email, code, pass);
        setBusy(false);
        if (u?.recoveryCode) await showRecoveryCode(u.recoveryCode, true, !providers.emailRecovery);
        toast(t('account_restored'));
        location.replace(location.origin + location.pathname);
      } catch (ex) {
        setBusy(false); err(cloud.arabicError(ex));
      }
      return;
    }

    /* ---------- إنشاء بيت ---------- */
    if (mode === 'household') {
      const hname = root.querySelector('#hname').value.trim();
      if (!hname) return err(t('required'));
      setBusy(true, t('please_wait'));
      try {
        const hh = await cloud.createHousehold(hname, pendingName || t('user_default'));
        setupHousehold({
          householdName: hh.name, memberName: pendingName, email: cloud.currentEmail() || '',
          inviteCode: hh.inviteCode, isOwner: true, cloud: true, resetData: !hasPendingLocalUpload(),
        });
        setBusy(false);
        toast(t('home_created'));
        return finishCloud(hh.id, true);
      } catch (ex) {
        setBusy(false); err(cloud.arabicError(ex));
      }
      return;
    }

    /* ---------- الانضمام بكود ---------- */
    if (mode === 'join') {
      const code = root.querySelector('#code').value.trim().toUpperCase();
      if (!code) return err(t('required'));
      setBusy(true, t('please_wait'));
      try {
        const hh = await cloud.joinHousehold(code, pendingName || t('user_default'));
        setupHousehold({
          householdName: hh.name, memberName: pendingName, email: cloud.currentEmail() || '',
          inviteCode: hh.inviteCode, isOwner: false, cloud: true, resetData: !hasPendingLocalUpload(),
        });
        setBusy(false);
        toast(t('joined_home'));
        return finishCloud(hh.id, true);
      } catch (ex) {
        setBusy(false);
        err(ex?.message === 'bad-code' ? t('invalid_invite') : cloud.arabicError(ex));
      }
    }
  };

  async function finishCloud(hid, alreadySetUp = false) {
    if (!alreadySetUp) {
      const hh = await cloud.loadHousehold(hid);
      setupHousehold({
        householdName: hh?.name || t('app_name'), memberName: pendingName,
        email: cloud.currentEmail() || '', inviteCode: hh?.inviteCode || '',
        isOwner: false, cloud: true, resetData: !hasPendingLocalUpload(),
      });
    }
    /* اختيار العاملة قبل الدخول يصبح تفضيل حساب دائمًا بعد نجاح الجلسة. */
    cloud.saveNotificationPrefs({ language: currentLang() });
    finish({ cloud: true, hid });
  }

  function finish(result) {
    if (result?.invitation && getState().household?.cloud) prepareAccountSwitch();
    root.hidden = true;
    root.onclick = null;
    onDone(result);
  }

  draw();
  if (initialError) err(cloud.arabicError({ code: initialError }));
  cloud.authProviders().then((available) => {
    providers = available;
    root.querySelectorAll('[data-external-holder]').forEach((holder) => {
      holder.innerHTML = providerButtons();
    });
    const forgot = root.querySelector('[data-forgot]');
    if (forgot) forgot.dataset.go = providers.emailRecovery ? 'recoverEmail' : 'recover';
    const emailRecovery = root.querySelector('[data-email-recovery]');
    if (emailRecovery) emailRecovery.hidden = !providers.emailRecovery;
    const recoveryHelp = root.querySelector('[data-recovery-help]');
    if (recoveryHelp) recoveryHelp.textContent = providers.emailRecovery
      ? (currentLang() === 'ar' ? 'إن لم يعد الرمز لديك، استخدم رابط الاستعادة بالبريد.' : 'If you lost the code, use the email reset link.')
      : (currentLang() === 'ar' ? 'إذا فقدت الرمز أيضًا، فلا يمكن استعادة الحساب حتى تُفعّل خدمة البريد.' : 'If you also lost the code, recovery needs email delivery to be enabled.');
  }).catch(() => {});
}
