/* شاشة الدخول / إنشاء البيت */

import { $, esc } from '../util.js';
import { setupHousehold, seedDemo } from '../store.js';
import { toast } from '../ui.js';

export function renderAuth(onDone) {
  const root = $('#authRoot');
  root.hidden = false;
  $('#shell').hidden = true;

  let mode = 'welcome'; // welcome | create | join

  const shell = (inner) => `
    <div class="auth-card">
      <div class="auth-logo">
        <div class="mark">🏡</div>
        <h1>بيتنا</h1>
        <p>إدارة المنزل بذكاء</p>
      </div>
      <div class="auth-box">${inner}</div>
      <p class="legal">بيتنا © ${new Date().getFullYear()} — صُمّم بحب لكل عائلة<br>بياناتك محفوظة على جهازك ولا تُرسل لأي خادم.</p>
    </div>`;

  function draw() {
    if (mode === 'welcome') {
      root.innerHTML = shell(`
        <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">أهلاً بك</h3>
        <p class="muted small" style="margin:0 0 18px">
          اختر إن كنت تريد إنشاء بيت جديد أو الانضمام إلى بيت موجود.
        </p>
        <button class="btn block" data-go="create">🏠 إنشاء بيت جديد</button>
        <div style="height:10px"></div>
        <button class="btn ghost block" data-go="join">🔑 لديّ كود دعوة</button>
      `);
    }

    if (mode === 'create') {
      root.innerHTML = shell(`
        <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">إنشاء بيت جديد</h3>
        <p class="muted small" style="margin:0 0 18px">
          أنت أول مَن يستخدم بيتنا في عائلتك. ستحصل على كود دعوة تشاركه مع الباقين.
        </p>
        <div id="err"></div>
        <div class="field">
          <label for="hname">اسم البيت</label>
          <input class="input" id="hname" placeholder="بيت أحمد وسارة" autocomplete="off">
        </div>
        <div class="field">
          <label for="mname">اسمك داخل التطبيق</label>
          <input class="input" id="mname" placeholder="أحمد" autocomplete="name">
        </div>
        <button class="btn block" data-submit>إنشاء البيت</button>
        <div class="auth-switch"><button data-go="welcome">رجوع</button></div>
      `);
    }

    if (mode === 'join') {
      root.innerHTML = shell(`
        <h3 style="margin:0 0 6px;font-size:19px;font-weight:800">الانضمام بكود دعوة</h3>
        <p class="muted small" style="margin:0 0 18px">
          إذا أعطاك شريكك كود دعوة، أدخله للدخول إلى بيته المشترك.
        </p>
        <div id="err"></div>
        <div class="field">
          <label for="code">كود الدعوة</label>
          <input class="input" id="code" placeholder="BEITNA-XXXXXX" style="direction:ltr;text-align:left" autocapitalize="characters" autocomplete="off">
        </div>
        <div class="field">
          <label for="mname">اسمك داخل التطبيق</label>
          <input class="input" id="mname" placeholder="سارة" autocomplete="name">
        </div>
        <button class="btn block" data-submit>الانضمام</button>
        <div class="auth-switch"><button data-go="welcome">رجوع</button></div>
      `);
    }
  }

  const err = (msg) => {
    const box = root.querySelector('#err');
    if (box) box.innerHTML = `<div class="err">${esc(msg)}</div>`;
  };

  root.onclick = (e) => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) { mode = goBtn.dataset.go; draw(); return; }

    if (e.target.closest('[data-submit]')) {
      const name = root.querySelector('#mname')?.value.trim() || '';
      if (mode === 'create') {
        const hname = root.querySelector('#hname')?.value.trim() || '';
        if (!hname) return err('اكتب اسم البيت');
        if (!name) return err('اكتب اسمك داخل التطبيق');
        setupHousehold({ householdName: hname, memberName: name });
        seedDemo();
        toast('تم إنشاء بيتك 🎉');
        finish();
      } else if (mode === 'join') {
        const code = root.querySelector('#code')?.value.trim().toUpperCase() || '';
        if (!/^BEITNA-[A-Z0-9]{4,10}$/.test(code)) return err('كود غير صحيح أو غير موجود');
        if (!name) return err('اكتب اسمك داخل التطبيق');
        setupHousehold({ householdName: 'بيتي', memberName: name, joinCode: code });
        toast('تم الانضمام إلى البيت ✓');
        finish();
      }
    }
  };

  function finish() {
    root.hidden = true;
    root.onclick = null;
    onDone();
  }

  draw();
}
