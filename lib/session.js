import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'anomsg_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signSession({ uid, name, gid }, secret, ttlSeconds = MAX_AGE_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ uid, name, gid, exp })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(value, secret) {
  try {
    const [payload, signature] = String(value).split('.');
    if (!payload || !signature) return null;

    const expected = sign(payload, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    // เทียบแบบเวลาคงที่ กันการเดาลายเซ็นทีละไบต์
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function sessionCookie(value) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}
