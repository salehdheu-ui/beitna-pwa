#!/usr/bin/env node
/* Integration test with local fake Google, Apple, and email responses.
   No credentials, user mail, or production data are involved. */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'beitna-auth-test-'));
const port = 34000 + crypto.randomInt(2000);
const base = `http://127.0.0.1:${port}`;
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const appleKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const sent = [];
let nonce = '';
let oauthCookie = '';

process.env.PORT = String(port);
process.env.DATA_DIR = path.join(temp, 'data');
process.env.OFFSITE_BACKUP_DIR = path.join(temp, 'offsite');
process.env.TRANSLATION_ENABLED = '0';
process.env.PUBLIC_ORIGIN = base;
process.env.GOOGLE_CLIENT_ID = 'google-test-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-test-secret';
process.env.APPLE_CLIENT_ID = 'apple.test.service';
process.env.APPLE_TEAM_ID = 'TESTTEAM01';
process.env.APPLE_KEY_ID = 'TESTKEY001';
process.env.APPLE_PRIVATE_KEY = appleKey.privateKey.export({ format: 'pem', type: 'pkcs8' });
process.env.RESEND_API_KEY = 're_test_only';
process.env.RESET_MAIL_FROM = 'test@example.test';

const nativeFetch = global.fetch;
const json = (body) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function signedToken(provider, profile) {
  const header = b64({ alg: 'RS256', kid: 'test-key' });
  const payload = b64({
    iss: provider === 'google' ? 'https://accounts.google.com' : 'https://appleid.apple.com',
    aud: provider === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.APPLE_CLIENT_ID,
    sub: profile.sub, email: profile.email, email_verified: true,
    name: profile.name || '', nonce, iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const input = `${header}.${payload}`;
  return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), rsa.privateKey).toString('base64url')}`;
}

global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/oauth2/v3/certs') || target.endsWith('/auth/keys')) return json({ keys: [jwk] });
  if (target === 'https://api.resend.com/emails') {
    sent.push(JSON.parse(options.body));
    return json({ id: 'fake-mail' });
  }
  if (target === 'https://oauth2.googleapis.com/token' || target === 'https://appleid.apple.com/auth/token') {
    const provider = target.includes('googleapis') ? 'google' : 'apple';
    const body = new URLSearchParams(options.body);
    if (provider === 'google') assert.equal(body.get('code_verifier')?.length, 43);
    if (provider === 'apple') {
      const [header, payload, signature] = body.get('client_secret').split('.');
      assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).sub, process.env.APPLE_CLIENT_ID);
      assert.equal(crypto.verify('sha256', Buffer.from(`${header}.${payload}`), {
        key: appleKey.publicKey, dsaEncoding: 'ieee-p1363',
      }, Buffer.from(signature, 'base64url')), true);
    }
    const code = body.get('code');
    const profile = code === 'existing'
      ? { sub: 'google-owner', email: 'owner@example.test', name: 'Owner' }
      : code === 'conflict'
        ? { sub: 'google-conflict', email: 'owner@example.test', name: 'Other' }
        : provider === 'apple'
          ? { sub: 'apple-new', email: 'apple@example.test' }
          : { sub: 'google-new', email: 'new@example.test', name: 'New user' };
    const issued = signedToken(provider, profile);
    if (code === 'bad-nonce') {
      const parts = issued.split('.');
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
      claims.nonce = 'wrong-nonce';
      const input = `${parts[0]}.${b64(claims)}`;
      return json({ id_token: `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), rsa.privateKey).toString('base64url')}` });
    }
    return json({ id_token: issued });
  }
  return nativeFetch(url, options);
};

require('../server/server.js');

async function request(route, { method = 'GET', body, token, cookie, form = false, redirect = 'follow' } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = form
    ? 'application/x-www-form-urlencoded' : 'application/json';
  const response = await nativeFetch(base + '/api' + route, {
    method, headers, redirect,
    body: body === undefined ? undefined : form ? new URLSearchParams(body) : JSON.stringify(body),
  });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  return { status: response.status, data, location: response.headers.get('location'),
    setCookie: response.headers.get('set-cookie') };
}

async function start(provider, token, link = false) {
  const response = await request(`/auth/${provider}/start`, { method: 'POST', body: { link }, token });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.match(response.setCookie, /HttpOnly; Secure; SameSite=None/);
  oauthCookie = response.setCookie.split(';')[0];
  const url = new URL(response.data.url);
  nonce = url.searchParams.get('nonce');
  assert.ok(nonce);
  assert.ok(url.searchParams.get('state'));
  return url.searchParams.get('state');
}

async function callback(provider, state, code) {
  const route = `/auth/${provider}/callback`;
  return provider === 'apple'
    ? request(route, { method: 'POST', body: { state, code }, form: true, redirect: 'manual', cookie: oauthCookie })
    : request(`${route}?state=${state}&code=${code}`, { redirect: 'manual', cookie: oauthCookie });
}

async function main() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await request('/health')).status === 200) break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  const providers = await request('/auth/providers');
  assert.deepEqual({ google: providers.data.google, apple: providers.data.apple,
    emailRecovery: providers.data.emailRecovery }, { google: true, apple: true, emailRecovery: true });

  const owner = await request('/signup', { method: 'POST', body: {
    email: 'owner@example.test', password: 'Old-password-123', displayName: 'Owner',
  } });
  assert.equal(owner.status, 200);

  let state = await start('google');
  let result = await request(`/auth/google/callback?state=${state}&code=new`, { redirect: 'manual' });
  assert.match(result.location, /auth_error=auth-failed/,
    'OAuth callback must require the initiating browser cookie');

  state = await start('google');
  result = await callback('google', state, 'new');
  assert.equal(result.status, 303);
  let ticket = new URL(result.location).hash.replace('#auth_ticket=', '');
  assert.equal((await request('/auth/ticket', { method: 'POST', body: { ticket } })).status, 401,
    'OAuth ticket must be bound to the initiating browser');
  let session = await request('/auth/ticket', { method: 'POST', body: { ticket }, cookie: oauthCookie });
  assert.equal(session.status, 200);
  const googleUid = session.data.uid;
  assert.equal((await request('/auth/ticket', { method: 'POST', body: { ticket } })).status, 401);
  result = await callback('google', state, 'new');
  assert.match(result.location, /auth_error=auth-failed/, 'OAuth state must be one-time');

  state = await start('google');
  result = await callback('google', state, 'bad-nonce');
  assert.match(result.location, /auth_error=auth-failed/, 'Mismatched nonce must be rejected');

  state = await start('google');
  result = await callback('google', state, 'new');
  ticket = new URL(result.location).hash.replace('#auth_ticket=', '');
  session = await request('/auth/ticket', { method: 'POST', body: { ticket }, cookie: oauthCookie });
  assert.equal(session.data.uid, googleUid, 'Google sub must identify the same user');

  state = await start('google');
  result = await callback('google', state, 'conflict');
  assert.match(result.location, /auth_error=auth-link-required/);

  state = await start('google', owner.data.token, true);
  result = await callback('google', state, 'existing');
  assert.match(result.location, /auth_linked=google/);
  state = await start('google');
  result = await callback('google', state, 'existing');
  ticket = new URL(result.location).hash.replace('#auth_ticket=', '');
  session = await request('/auth/ticket', { method: 'POST', body: { ticket }, cookie: oauthCookie });
  assert.equal(session.data.uid, owner.data.uid);

  state = await start('apple');
  result = await callback('apple', state, 'apple-new');
  ticket = new URL(result.location).hash.replace('#auth_ticket=', '');
  session = await request('/auth/ticket', { method: 'POST', body: { ticket }, cookie: oauthCookie });
  assert.equal(session.status, 200);
  assert.equal(session.data.email, 'apple@example.test');

  const unknown = await request('/account/reset/request', { method: 'POST', body: { email: 'unknown@example.test' } });
  const known = await request('/account/reset/request', { method: 'POST', body: { email: 'owner@example.test' } });
  assert.deepEqual(unknown.data, known.data, 'Do not reveal registered emails');
  assert.equal(sent.length, 1);
  const link = sent[0].text.match(/https?:\/\/[^\s]+#reset=([A-Za-z0-9_-]+)/);
  assert.ok(link, 'Reset email has a link');
  const code = link[1];
  const changed = await request('/account/reset/confirm', { method: 'POST', body: {
    code, password: 'New-password-456',
  } });
  assert.equal(changed.status, 200);
  assert.equal((await request('/account/reset/confirm', { method: 'POST', body: {
    code, password: 'Another-password',
  } })).status, 401, 'Reset link must be one-time');
  assert.equal((await request('/login', { method: 'POST', body: {
    email: 'owner@example.test', password: 'Old-password-123',
  } })).status, 401);
  assert.equal((await request('/login', { method: 'POST', body: {
    email: 'owner@example.test', password: 'New-password-456',
  } })).status, 200);
  assert.equal((await request('/me', { token: owner.data.token })).status, 401,
    'Old sessions must be revoked after reset');
  console.log('  [ok] Google, Apple, explicit linking, email reset and session revocation');
}

main().then(() => finish(0), (error) => {
  console.error(error); finish(1);
});

function finish(code) {
  /* tmp was just created above; never recursively remove a broader path. */
  if (path.dirname(temp) === os.tmpdir()) {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* لا يؤثر في نتيجة الفحص */ }
  }
  process.exit(code);
}
