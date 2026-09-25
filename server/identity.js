/* OAuth 2.0 / OpenID Connect for Google and Apple. No browser-supplied
   identity is trusted: authorization codes are exchanged and ID tokens are
   verified against each provider's signing keys on the server. */
const crypto = require('crypto');

const publicUrl = new URL(process.env.PUBLIC_ORIGIN || 'https://beitna.saher.cloud');
if (publicUrl.protocol !== 'https:' &&
    !(publicUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname))) {
  throw new Error('PUBLIC_ORIGIN must use HTTPS outside local development');
}
const ORIGIN = publicUrl.origin;
const GOOGLE_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
const APPLE_ID = String(process.env.APPLE_CLIENT_ID || '').trim();
const APPLE_TEAM = String(process.env.APPLE_TEAM_ID || '').trim();
const APPLE_KEY_ID = String(process.env.APPLE_KEY_ID || '').trim();
const APPLE_KEY = String(process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const enabled = {
  google: !!(GOOGLE_ID && GOOGLE_SECRET),
  apple: !!(APPLE_ID && APPLE_TEAM && APPLE_KEY_ID && APPLE_KEY),
};
const pending = new Map();
const tickets = new Map();
const keyCache = new Map();

const random = () => crypto.randomBytes(32).toString('base64url');
const callback = (provider) => `${ORIGIN}/api/auth/${provider}/callback`;
const timestamp = () => Math.floor(Date.now() / 1000);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function prune(map, ttl) {
  const cutoff = Date.now() - ttl;
  for (const [key, value] of map) if (value.at < cutoff) map.delete(key);
  while (map.size > 1000) map.delete(map.keys().next().value);
}

function start(provider, linkUid = null) {
  if (!enabled[provider]) throw new Error('auth-not-configured');
  prune(pending, 10 * 60000);
  const state = random();
  const nonce = random();
  const verifier = provider === 'google' ? random() : null;
  pending.set(state, { provider, nonce, verifier, linkUid, at: Date.now() });
  const url = new URL(provider === 'google'
    ? 'https://accounts.google.com/o/oauth2/v2/auth'
    : 'https://appleid.apple.com/auth/authorize');
  url.searchParams.set('client_id', provider === 'google' ? GOOGLE_ID : APPLE_ID);
  url.searchParams.set('redirect_uri', callback(provider));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider === 'google' ? 'openid email profile' : 'name email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  if (provider === 'google') {
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
  } else {
    url.searchParams.set('response_mode', 'form_post');
  }
  return url.href;
}

function takeState(provider, state) {
  const flow = pending.get(state);
  pending.delete(state);
  if (!flow || flow.provider !== provider || Date.now() - flow.at > 10 * 60000) {
    throw new Error('auth-state-invalid');
  }
  return flow;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000), cache: 'no-store' });
  if (!response.ok) throw new Error('auth-provider-error');
  const data = await response.json();
  if (!data || typeof data !== 'object') throw new Error('auth-provider-error');
  return data;
}

function appleSecret() {
  const issuedAt = timestamp();
  const input = `${b64({ alg: 'ES256', kid: APPLE_KEY_ID })}.${b64({
    iss: APPLE_TEAM, iat: issuedAt, exp: issuedAt + 3600,
    aud: 'https://appleid.apple.com', sub: APPLE_ID,
  })}`;
  const signature = crypto.sign('sha256', Buffer.from(input), {
    key: APPLE_KEY, dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${input}.${signature}`;
}

async function signingKeys(provider) {
  const cached = keyCache.get(provider);
  if (cached && cached.until > Date.now()) return cached.keys;
  const url = provider === 'google'
    ? 'https://www.googleapis.com/oauth2/v3/certs'
    : 'https://appleid.apple.com/auth/keys';
  const data = await fetchJson(url);
  if (!Array.isArray(data.keys) || !data.keys.length) throw new Error('auth-provider-error');
  keyCache.set(provider, { keys: data.keys, until: Date.now() + 3600000 });
  return data.keys;
}

async function verifyIdToken(provider, token, nonce) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts.some((part) => part.length > 12000)) throw new Error('bad');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256' || !header.kid) throw new Error('bad');
    let keys = await signingKeys(provider);
    let jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA' &&
      (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
    if (!jwk) {
      keyCache.delete(provider); // The provider may have rotated its signing key.
      keys = await signingKeys(provider);
      jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA' &&
        (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
    }
    if (!jwk) throw new Error('bad');
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
      key, Buffer.from(parts[2], 'base64url'));
    const clientId = provider === 'google' ? GOOGLE_ID : APPLE_ID;
    const issuer = provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com']
      : ['https://appleid.apple.com'];
    if (!valid || !issuer.includes(claims.iss) || claims.aud !== clientId ||
      !Number.isFinite(claims.exp) || claims.exp <= timestamp() ||
      !Number.isFinite(claims.iat) || claims.iat > timestamp() + 60 ||
      claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub ||
      typeof claims.email !== 'string' || !claims.email ||
      ![true, 'true'].includes(claims.email_verified)) throw new Error('bad');
    return { sub: claims.sub, email: String(claims.email).trim().toLowerCase(),
      name: provider === 'google' ? String(claims.name || '').trim().slice(0, 80) : '' };
  } catch (error) {
    if (error.message === 'auth-provider-error') throw error;
    throw new Error('auth-token-invalid');
  }
}

async function complete(provider, state, code) {
  const flow = takeState(provider, state);
  if (!code || String(code).length > 4096) throw new Error('auth-code-invalid');
  const body = new URLSearchParams({
    client_id: provider === 'google' ? GOOGLE_ID : APPLE_ID,
    client_secret: provider === 'google' ? GOOGLE_SECRET : appleSecret(),
    code: String(code), grant_type: 'authorization_code', redirect_uri: callback(provider),
  });
  if (flow.verifier) body.set('code_verifier', flow.verifier);
  const response = await fetchJson(provider === 'google'
    ? 'https://oauth2.googleapis.com/token' : 'https://appleid.apple.com/auth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  return { ...await verifyIdToken(provider, response.id_token, flow.nonce), linkUid: flow.linkUid };
}

function issueTicket(uid, state) {
  prune(tickets, 2 * 60000);
  const ticket = random();
  tickets.set(ticket, { uid, state, at: Date.now() });
  return ticket;
}

function takeTicket(ticket, state) {
  const key = String(ticket || '');
  const value = tickets.get(key);
  if (!value || !state || value.state !== state) return null;
  tickets.delete(key);
  return Date.now() - value.at <= 2 * 60000 ? value.uid : null;
}

module.exports = { enabled, origin: ORIGIN, start, complete, issueTicket, takeTicket };
