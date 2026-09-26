#!/usr/bin/env node
'use strict';
// Render the real household template with isolated data; never touch user storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('js/screens/more.js');
const start = source.indexOf('export function householdScreen()');
const end = source.indexOf('/* ============================ الإشعارات', start);
assert.ok(start >= 0 && end > start);
let cloud = false;
let owner = true;
const state = { household: { inviteCode: 'BEITNA-ABC234' }, members: [] };
const context = vm.createContext({ getState: () => state, isCloud: () => cloud,
  amOwner: () => owner, esc: (text) => String(text) });
vm.runInContext(source.slice(start, end).replace('export function', 'function'), context);
const render = () => vm.runInContext('householdScreen().html', context);
let html = render();
assert.ok(html.includes('data-act="link"'));
assert.ok(!html.includes('BEITNA-ABC234'), 'Legacy local codes must not be offered as real invitations');
assert.ok(!html.includes('data-act="copy"'));
assert.ok(!html.includes('data-act="regen"'));
assert.ok(!html.includes('id="emailInviteForm"'), 'Local homes cannot create email invitations');
cloud = true;
html = render();
assert.ok(html.includes('BEITNA-ABC234'));
assert.ok(html.includes('id="code" dir="ltr"'));
assert.ok(html.includes('data-act="join-family"'));
assert.ok(html.includes('data-act="regen"'));
assert.ok(html.includes('id="emailInviteForm"'), 'Cloud owners can invite by email');
assert.ok(html.includes('الطريقة الأولى: كود دعوة العائلة'));
assert.ok(html.includes('الطريقة الثانية: الدعوة بالإيميل'));
state.household.inviteCode = '';
html = render();
assert.match(html, /data-act="copy" disabled/);
assert.match(html, /data-act="share" disabled/);
owner = false;
html = render();
assert.ok(html.includes('اطلب كود الدعوة من مالك البيت'));
assert.ok(!html.includes('id="emailInviteForm"'), 'Non-owners cannot create email invitations');
assert.ok(!html.includes('data-act="regen"'));
assert.ok(source.includes("act === 'add-local-member' && !isCloud()"),
  'Joining another household must not accidentally open the local add-member dialog');
console.log('  [ok] Local, cloud, revoked and member invitation screens');

const authSource = read('js/screens/auth.js');
assert.equal((authSource.match(/resetData: !hasPendingLocalUpload\(\)/g) || []).length, 3,
  'Creating, joining and loading a cloud household must preserve an explicitly pending local upload');
const pendingStart = authSource.indexOf('function hasPendingLocalUpload()');
const pendingEnd = authSource.indexOf('\n}', pendingStart) + 2;
let pendingUpload = null;
const uploadContext = vm.createContext({ localStorage: { getItem: () => pendingUpload } });
vm.runInContext(authSource.slice(pendingStart, pendingEnd), uploadContext);
assert.equal(vm.runInContext('hasPendingLocalUpload()', uploadContext), false);
pendingUpload = '1';
assert.equal(vm.runInContext('hasPendingLocalUpload()', uploadContext), true);
console.log('  [ok] Explicit local-to-cloud linking preserves data before upload');

const storeSource = read('js/store.js');
const uploadStart = storeSource.indexOf('export function uploadLocalData(');
const uploadEnd = storeSource.indexOf('\n}', uploadStart) + 2;
const queued = [];
const dataContext = vm.createContext({ state: { shopping: [] }, mode: 'cloud',
  bridge: { save: (col, item) => queued.push({ col, item }) }, console,
  preserved: { shopping: [{ id: 42, name: 'حليب' }] } });
vm.runInContext(storeSource.slice(uploadStart, uploadEnd).replace('export function', 'function'), dataContext);
assert.equal(vm.runInContext('uploadLocalData(preserved)', dataContext), 1);
assert.equal(queued[0].item.name, 'حليب', 'First empty sync must not erase the pending local upload');
const appSource = read('js/app.js');
assert.ok(appSource.indexOf('localUpload = structuredClone(getState())') < appSource.indexOf('cloud.startSync(hid'));
console.log('  [ok] Local items are uploaded from the pre-sync snapshot');
