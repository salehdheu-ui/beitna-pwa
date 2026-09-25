#!/usr/bin/env node
'use strict';

/* اختبار تكاملي لمسارات ما قبل الإطلاق. يشغّل خادمًا حقيقيًا بقاعدة مؤقتة
   ولا يلمس /data أو بيانات الإنتاج. */
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beitna-critical-'));
const dataDir = path.join(tmp, 'data');
const offsiteDir = path.join(tmp, 'offsite');
const port = 31000 + crypto.randomInt(2000);
const translationPort = port + 3000;
const base = `http://127.0.0.1:${port}/api`;
const adminCode = 'TEST-ADMIN-CODE';

let serverLog = '';
let child;
const translationServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${translationPort}`);
  const text = url.searchParams.get('q') || '';
  const target = (url.searchParams.get('langpair') || 'sw|ar').split('|')[1];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ responseStatus: 200, responseData: { translatedText: `${target}:${text}` } }));
});
translationServer.listen(translationPort, '127.0.0.1');

function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port), DATA_DIR: dataDir, OFFSITE_BACKUP_DIR: offsiteDir,
      ADMIN_PANEL_CODE_HASH: crypto.createHash('sha256').update(adminCode).digest('hex'),
      TOKEN_DAYS: '2',
      TRANSLATION_ENABLED: '1',
      TRANSLATION_API_URL: `http://127.0.0.1:${translationPort}/get`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });
}
startServer();

async function request(pathname, { method = 'GET', token, body, adminToken } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (adminToken) headers.authorization = `Bearer ${adminToken}`;
  const res = await fetch(base + pathname, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* لا شيء */ }
  return { status: res.status, data };
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { if ((await request('/health')).status === 200) return; } catch { /* ننتظر */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('الخادم التجريبي لم يبدأ\n' + serverLog);
}

async function signup(name) {
  const email = `${name}@example.test`;
  const r = await request('/signup', {
    method: 'POST', body: { email, password: 'Strong-pass-123', displayName: name },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.token);
  return { ...r.data, email };
}

async function main() {
  await waitForServer();

  const owner = await signup('owner');
  const created = await request('/household', {
    method: 'POST', token: owner.token, body: { name: 'بيت الاختبار', memberName: 'المالك' },
  });
  assert.equal(created.status, 200);
  const firstFamilyCode = created.data.inviteCode;
  assert.match(firstFamilyCode, /^BEITNA-/);

  const helperCodeRes = await request('/household/helper-code', { method: 'POST', token: owner.token });
  assert.equal(helperCodeRes.status, 200);
  const firstHelperCode = helperCodeRes.data.helperCode;

  const helper = await signup('helper');
  const helperJoin = await request('/household/join', {
    method: 'POST', token: helper.token, body: { code: firstHelperCode, memberName: 'العاملة' },
  });
  assert.equal(helperJoin.status, 200);
  assert.equal(helperJoin.data.perm, 'helper');
  assert.equal(helperJoin.data.inviteCode, null, 'تسرّب كود الأسرة في رد الانضمام');

  /* حتى تعديل caps قديم/خاطئ لا يستطيع رفع الحدود الأمنية للعاملة. */
  const grant = await request(`/member/${helper.uid}/caps`, {
    method: 'POST', token: owner.token,
    body: { caps: { invite: true, members: true, prices: true, remove: true, occasions: 'write' } },
  });
  assert.equal(grant.status, 200);
  assert.equal(grant.data.caps.invite, false);
  const helperHouse = await request('/household', { token: helper.token });
  assert.equal(helperHouse.data.inviteCode, null);
  assert.equal(helperHouse.data.caps.members, false);
  assert.equal((await request('/prefs', {
    method: 'POST', token: helper.token, body: { language: 'sw' },
  })).status, 200);
  const helperWrite = await request('/write', {
    method: 'POST', token: helper.token,
    body: { ops: [{ col: 'shopping', id: '9001', op: 'set', data: {
      id: 9001, name: 'maziwa', quantity: 'pakiti mbili', sourceLang: 'sw',
    } }] },
  });
  assert.equal(helperWrite.data.applied, 1);
  const translatedSync = await request('/sync?since=0', { token: owner.token });
  const translatedItem = translatedSync.data.cols.shopping.find((x) => x.id === 9001);
  assert.equal(translatedItem.name, 'maziwa', 'لم يُحفظ النص الأصلي');
  assert.equal(translatedItem.translations.ar.name, 'ar:maziwa');
  assert.equal(translatedItem.translations.en.quantity, 'en:pakiti mbili');

  /* قائمة المالك تصل للعاملة بلغتها؛ العاملة تعلّم الناقص دون إضافة منتج. */
  const ownerPantry = await request('/write', {
    method: 'POST', token: owner.token,
    body: { ops: [{ col: 'pantry', id: '9101', op: 'set', data: {
      id: 9101, name: 'حليب', sourceLang: 'ar', stocked: true,
    } }] },
  });
  assert.equal(ownerPantry.data.applied, 1);
  let helperPantry;
  for (let i = 0; i < 30; i++) {
    const sync = await request('/sync?since=0', { token: helper.token });
    helperPantry = sync.data.cols.pantry.find((x) => x.id === 9101);
    if (helperPantry?.translations?.sw?.name) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(helperPantry.translations.sw.name, 'sw:حليب');
  assert.equal((await request('/write', {
    method: 'POST', token: helper.token,
    body: { ops: [{ col: 'pantry', id: '9101', op: 'merge', data: { stocked: false } }] },
  })).data.applied, 1);
  const afterToggle = await request('/sync?since=0', { token: helper.token });
  assert.equal(afterToggle.data.cols.pantry.find((x) => x.id === 9101).translations.sw.name, 'sw:حليب',
    'تغيير علامة المتوفر حذف ترجمة لغة العاملة');
  const deniedNewPantry = await request('/write', {
    method: 'POST', token: helper.token,
    body: { ops: [{ col: 'pantry', id: '9102', op: 'set', data: {
      id: 9102, name: 'mafuta', sourceLang: 'sw', stocked: true,
    } }] },
  });
  assert.equal(deniedNewPantry.data.applied, 0);
  assert.equal(deniedNewPantry.data.denied, 1);
  const ownerPantrySync = await request('/sync?since=0', { token: owner.token });
  assert.equal(ownerPantrySync.data.cols.pantry.find((x) => x.id === 9101).stocked, false);
  assert.equal(ownerPantrySync.data.cols.pantry.find((x) => x.id === 9102), undefined);

  /* شراء العنصر المرتبط يعيده متوفرًا في احتياجات المالك والعاملة. */
  assert.equal((await request('/write', {
    method: 'POST', token: owner.token,
    body: { ops: [{ col: 'shopping', id: '9201', op: 'set', data: {
      id: 9201, name: 'حليب', note: 'من قائمة الاحتياجات', pantryId: 9101, status: 'ناقص',
    } }] },
  })).data.applied, 1);
  assert.equal((await request('/write', {
    method: 'POST', token: owner.token,
    body: { ops: [{ col: 'shopping', id: '9201', op: 'merge', act: 'done', data: {
      status: 'تم الشراء',
    } }] },
  })).data.applied, 1);
  const afterPurchase = await request('/sync?since=0', { token: helper.token });
  const restoredPantry = afterPurchase.data.cols.pantry.find((x) => x.id === 9101);
  assert.equal(restoredPantry.stocked, true, 'لم يعد المنتج متوفرًا بعد شرائه');
  assert.equal(restoredPantry.translations.sw.name, 'sw:حليب', 'فُقدت الترجمة بعد إعادة المنتج متوفرًا');

  /* الصورة تمر مؤقتًا إلى المالك، ولا تدخل قاعدة البيانات أو المزامنة. */
  const tinyImage = 'data:image/jpeg;base64,' + Buffer.from('temporary-image').toString('base64');
  assert.equal((await request('/pantry-image/9101', {
    method: 'POST', token: helper.token, body: { dataUrl: tinyImage },
  })).status, 200);
  assert.equal((await request('/pantry-images', { token: helper.token })).status, 403);
  const relayedImages = await request('/pantry-images', { token: owner.token });
  assert.equal(relayedImages.data.images.length, 1);
  assert.equal(relayedImages.data.images[0].itemId, '9101');
  assert.equal(relayedImages.data.images[0].dataUrl, tinyImage);
  assert.equal((await request('/pantry-images/ack', {
    method: 'POST', token: owner.token, body: { itemIds: ['9101'] },
  })).status, 200);
  assert.equal((await request('/pantry-images', { token: owner.token })).data.images.length, 0);

  assert.equal((await request('/shopping-image/9001', {
    method: 'POST', token: helper.token, body: { dataUrl: tinyImage },
  })).status, 200);
  assert.equal((await request('/shopping-images', { token: helper.token })).status, 403);
  const relayedShoppingImages = await request('/shopping-images', { token: owner.token });
  assert.equal(relayedShoppingImages.data.images.length, 1);
  assert.equal(relayedShoppingImages.data.images[0].itemId, '9001');
  assert.equal(relayedShoppingImages.data.images[0].dataUrl, tinyImage);
  assert.equal((await request('/shopping-images/ack', {
    method: 'POST', token: owner.token, body: { itemIds: ['9001'] },
  })).status, 200);
  assert.equal((await request('/shopping-images', { token: owner.token })).data.images.length, 0);

  assert.equal((await request('/fault-image/9301', {
    method: 'POST', token: helper.token, body: { dataUrl: tinyImage },
  })).status, 200);
  assert.equal((await request('/fault-images', { token: helper.token })).status, 403);
  const relayedFaultImages = await request('/fault-images', { token: owner.token });
  assert.equal(relayedFaultImages.data.images.length, 1);
  assert.equal(relayedFaultImages.data.images[0].itemId, '9301');
  assert.equal((await request('/fault-images/ack', {
    method: 'POST', token: owner.token, body: { itemIds: ['9301'] },
  })).status, 200);
  assert.equal((await request('/fault-images', { token: owner.token })).data.images.length, 0);

  /* تخصيص المشتريات والأعطال للعاملة يعمل، لكن القدرات الحساسة تبقى ثابتة. */
  const limitedHelper = await request(`/member/${helper.uid}/caps`, {
    method: 'POST', token: owner.token,
    body: { caps: {
      shopping: 'read', faults: 'none', occasions: 'write',
      invite: true, members: true, prices: true, remove: true,
    } },
  });
  assert.equal(limitedHelper.status, 200);
  assert.equal(limitedHelper.data.caps.shopping, 'read');
  assert.equal(limitedHelper.data.caps.faults, 'none');
  assert.equal(limitedHelper.data.caps.occasions, 'none');
  assert.equal(limitedHelper.data.caps.prices, false);
  assert.equal((await request('/shopping-image/9002', {
    method: 'POST', token: helper.token, body: { dataUrl: tinyImage },
  })).status, 403);
  const blockedShopping = await request('/write', {
    method: 'POST', token: helper.token,
    body: { ops: [{ col: 'shopping', id: '9002', op: 'set', data: { name: 'blocked' } }] },
  });
  assert.equal(blockedShopping.data.applied, 0);
  assert.equal(blockedShopping.data.denied, 1);
  const blockedPantry = await request('/write', {
    method: 'POST', token: helper.token,
    body: { ops: [{ col: 'pantry', id: '9103', op: 'set', data: { name: 'blocked pantry' } }] },
  });
  assert.equal(blockedPantry.data.applied, 0);
  assert.equal(blockedPantry.data.denied, 1);
  const helperMe = await request('/me', { token: helper.token });
  assert.equal('token' in helperMe.data, false, 'أعاد /me رمز الجلسة بلا حاجة');
  const deniedOccasion = await request('/write', {
    method: 'POST', token: helper.token,
    body: { ops: [{ col: 'occasions', id: '1', op: 'set', data: { title: 'سري' } }] },
  });
  assert.equal(deniedOccasion.data.applied, 0);
  assert.equal(deniedOccasion.data.denied, 1);

  const formerOwner = await signup('former-owner');
  const memberJoin = await request('/household/join', {
    method: 'POST', token: formerOwner.token, body: { code: firstFamilyCode, memberName: 'عضو' },
  });
  assert.equal(memberJoin.data.perm, 'member');
  assert.equal(memberJoin.data.inviteCode, null);
  assert.equal((await request(`/member/${formerOwner.uid}/role`, {
    method: 'POST', token: owner.token, body: { perm: 'owner' },
  })).status, 200);
  assert.equal((await request(`/member/${formerOwner.uid}`, {
    method: 'DELETE', token: owner.token,
  })).status, 200);
  const rejoin = await request('/household/join', {
    method: 'POST', token: formerOwner.token, body: { code: firstFamilyCode, memberName: 'عاد' },
  });
  assert.equal(rejoin.data.perm, 'member', 'استعاد العضو المحذوف صلاحية owner');

  /* لا يستطيع آخر مالك مغادرة البيت أو حذف نفسه. */
  const lastOwnerDelete = await request(`/member/${owner.uid}`, { method: 'DELETE', token: owner.token });
  assert.equal(lastOwnerDelete.status, 400);
  assert.equal(lastOwnerDelete.data.error, 'last-owner');

  /* تدوير الكود يُبطل القديم، والإلغاء يُبطل الجديد. */
  const rotated = await request('/household/invite-code', { method: 'POST', token: owner.token });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.data.inviteCode, firstFamilyCode);
  const outsider = await signup('outsider');
  assert.equal((await request('/household/join', {
    method: 'POST', token: outsider.token, body: { code: firstFamilyCode, memberName: 'غريب' },
  })).status, 404);
  assert.equal((await request('/household/invite-code', { method: 'DELETE', token: owner.token })).status, 200);
  assert.equal((await request('/household/join', {
    method: 'POST', token: outsider.token, body: { code: rotated.data.inviteCode, memberName: 'غريب' },
  })).status, 404);

  const newHelper = await request('/household/helper-code', { method: 'POST', token: owner.token });
  assert.notEqual(newHelper.data.helperCode, firstHelperCode);
  assert.equal((await request('/household/join', {
    method: 'POST', token: outsider.token, body: { code: firstHelperCode, memberName: 'غريب' },
  })).status, 404);
  assert.equal((await request('/household/helper-code', { method: 'DELETE', token: owner.token })).status, 200);

  /* حذف العاملة من المالك يحذف حسابها كله ويسقط جلستها فورًا، بخلاف
     العضو العادي الذي يمكنه إعادة الانضمام بحسابه نفسه. */
  const deletedHelper = await request(`/member/${helper.uid}`, {
    method: 'DELETE', token: owner.token,
  });
  assert.equal(deletedHelper.status, 200);
  assert.equal(deletedHelper.data.accountDeleted, true);
  assert.equal((await request('/me', { token: helper.token })).status, 401);
  assert.equal((await request('/login', {
    method: 'POST', body: { email: helper.email, password: 'Strong-pass-123' },
  })).status, 401);

  /* تغيير كلمة المرور يُسقط كل الرموز السابقة ويعيد رمزًا للجلسة الحالية فقط. */
  const passwordChanged = await request('/account/password', {
    method: 'POST', token: formerOwner.token,
    body: { current: 'Strong-pass-123', password: 'New-strong-pass-456' },
  });
  assert.equal(passwordChanged.status, 200);
  assert.ok(passwordChanged.data.token);
  assert.equal((await request('/me', { token: formerOwner.token })).status, 401);
  assert.equal((await request('/me', { token: passwordChanged.data.token })).status, 200);

  /* النسخة اليدوية يجب أن تُكتب محليًا وخارجيًا وأن تكون JSON صالحًا. */
  const adminLogin = await request('/admin/login', { method: 'POST', body: { code: adminCode } });
  assert.equal(adminLogin.status, 200);
  const backup = await request('/admin/backup', { method: 'POST', adminToken: adminLogin.data.token });
  assert.equal(backup.status, 200, JSON.stringify(backup.data));
  const local = JSON.parse(fs.readFileSync(path.join(dataDir, 'backups', backup.data.file), 'utf8'));
  const offsite = JSON.parse(fs.readFileSync(path.join(offsiteDir, backup.data.file), 'utf8'));
  assert.deepEqual(Object.keys(local.users).sort(), Object.keys(offsite.users).sort());
  assert.equal(JSON.stringify(local).includes(tinyImage), false, 'تسرّبت صورة مؤقتة إلى النسخة الاحتياطية');

  /* اختبار استعادة فعلي: نتوقف، نتلف db.json، ثم يجب أن يقلع الخادم من
     أحدث نسخة ويقبل الجلسة والبيانات نفسها. */
  child.kill();
  await once(child, 'exit');
  fs.writeFileSync(path.join(dataDir, 'db.json'), '{ definitely-not-json');
  startServer();
  await waitForServer();
  const restored = await request('/me', { token: owner.token });
  assert.equal(restored.status, 200, 'فشلت الاستعادة من قاعدة تالفة');
  assert.equal(restored.data.household.name, 'بيت الاختبار');

  console.log('  [ok] الترجمة، الصلاحيات، الدعوات، الجلسات، والنسخ الاحتياطي اجتازت الاختبار التكاملي');
}

main().catch((error) => {
  console.error(error.stack || error);
  console.error(serverLog);
  process.exitCode = 1;
}).finally(() => {
  try { child?.kill(); } catch { /* تجاهل */ }
  try { translationServer.close(); } catch { /* تجاهل */ }
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* تجاهل */ } }, 200);
});
