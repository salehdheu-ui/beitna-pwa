/* ============================================================
   Web Push — إرسال الإشعارات والتطبيق مغلق
   تعمية RFC 8291 (aes128gcm) وتوقيع VAPID (RFC 8292)
   بوحدة crypto الأصلية فقط، بلا أي مكتبة خارجية.
   ============================================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CURVE = 'prime256v1';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** HKDF مختصر كما في RFC 8188: جولة واحدة تكفي لأن الطول <= 32 */
function hkdf(salt, ikm, info, length) {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/* ---------- مفاتيح VAPID: تُولَّد مرة واحدة وتُحفظ ---------- */
function loadVapid(dataDir) {
  const file = path.join(dataDir, 'vapid.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.privatePem && saved.publicKey) return saved;
  } catch { /* نولّد */ }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: CURVE });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]);
  const out = {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: b64u(raw),
  };
  try { fs.writeFileSync(file, JSON.stringify(out), { mode: 0o600 }); }
  catch (e) { console.error('تعذّر حفظ مفاتيح VAPID', e); }
  return out;
}

/* ---------- توقيع JWT بخوارزمية ES256 ---------- */
/** توقيع Node يأتي بصيغة DER، وVAPID يطلب r||s خامًا بطول 64 */
function derToRaw(der) {
  let i = 2;
  if (der[1] & 0x80) i += der[1] & 0x7f;
  const readInt = () => {
    const len = der[i + 1];
    let start = i + 2;
    let size = len;
    while (size > 32) { start++; size--; }
    const buf = Buffer.alloc(32);
    der.copy(buf, 32 - size, start, start + size);
    i = i + 2 + len;
    return buf;
  };
  return Buffer.concat([readInt(), readInt()]);
}

function vapidHeader(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  }));
  const input = header + '.' + body;
  const der = crypto.createSign('SHA256').update(input).sign(vapid.privatePem);
  const jwt = input + '.' + b64u(derToRaw(der));
  return 'vapid t=' + jwt + ', k=' + vapid.publicKey;
}

/* ---------- التعمية ---------- */
/**
 * يبني جسم الرسالة المعمّى حسب RFC 8291.
 * salt و asPrivate اختياريان — يُمرَّران في الاختبار للمطابقة مع
 * متجهات RFC المعيارية، ويُولَّدان عشوائيًا في الإنتاج.
 */
function encryptPayload(plaintext, p256dh, authSecret, opts) {
  const o = opts || {};
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const salt = o.salt ? unb64u(o.salt) : crypto.randomBytes(16);

  const ecdh = crypto.createECDH(CURVE);
  if (o.asPrivate) ecdh.setPrivateKey(unb64u(o.asPrivate));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  /* المفتاح الأولي يربط طرفي المحادثة معًا فلا تصلح رسالة لمشترك آخر */
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info'), Buffer.from([0]), uaPublic, asPublic,
  ]);
  const ikm = hkdf(auth, shared, keyInfo, 32);

  const cek = hkdf(salt, ikm, Buffer.concat([
    Buffer.from('Content-Encoding: aes128gcm'), Buffer.from([0]),
  ]), 16);
  const nonce = hkdf(salt, ikm, Buffer.concat([
    Buffer.from('Content-Encoding: nonce'), Buffer.from([0]),
  ]), 12);

  /* 0x02 يعلّم آخر سجل — رسالتنا سجل واحد دائمًا */
  const padded = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head.writeUInt8(asPublic.length, 20);

  return Buffer.concat([head, asPublic, body]);
}

/* ---------- الإرسال عبر خدمة الدفع ---------- */
const https = require('https');
const http = require('http');

/**
 * يرسل إشعارًا معمّى إلى نقطة الاشتراك.
 * يرجع { ok, status }. الحالة 404 أو 410 تعني أن الاشتراك مات
 * فيجب حذفه — المتصفح ألغى تسجيله أو أُزيل التطبيق.
 */
function sendPush(subscription, payloadObj, vapid, opts) {
  const o = opts || {};
  const endpoint = subscription.endpoint;
  const body = encryptPayload(
    JSON.stringify(payloadObj), subscription.keys.p256dh, subscription.keys.auth
  );

  return new Promise((resolve) => {
    let url;
    try { url = new URL(endpoint); } catch { resolve({ ok: false, status: 0 }); return; }

    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      headers: {
        'content-type': 'application/octet-stream',
        'content-encoding': 'aes128gcm',
        'content-length': body.length,
        ttl: String(o.ttl == null ? 86400 : o.ttl),
        urgency: o.urgency || 'normal',
        authorization: vapidHeader(endpoint, vapid, o.subject || 'mailto:admin@localhost'),
      },
      timeout: 10000,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode }));
    });

    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0 }); });
    req.on('error', () => resolve({ ok: false, status: 0 }));
    req.end(body);
  });
}

module.exports = {
  loadVapid, vapidHeader, encryptPayload, sendPush,
  hkdf, b64u, unb64u, derToRaw,
};
