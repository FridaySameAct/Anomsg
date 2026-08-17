import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'anomsg_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
// ความยาวขั้นต่ำของ secret — ถ้า env var มีอยู่แต่เป็นค่าว่าง กุญแจ HMAC จะกลายเป็นค่าที่ใครก็เดาได้
// แล้วใครก็ปลอม session เป็นใครก็ได้ ต้องปฏิเสธให้ดังตั้งแต่ต้นทาง
const MIN_SECRET_LENGTH = 32;

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function usableSecret(secret) {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

export function signSession({ uid, name, gid }, secret, ttlSeconds = MAX_AGE_SECONDS) {
  if (!usableSecret(secret)) throw new Error('SESSION_SECRET must be at least 32 characters');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ uid, name, gid, exp })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(value, secret) {
  if (!usableSecret(secret)) {
    console.error('SESSION_SECRET is missing or too short — refusing every session');
    return null;
  }

  try {
    const parts = String(value).split('.');
    // ต้องเป็น payload.signature พอดี ไม่ได้ payload.signature.junk
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    if (!payload || !signature) return null;

    const expected = sign(payload, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    // เทียบแบบเวลาคงที่ กันการเดาลายเซ็นทีละไบต์
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);
    // exp ต้องเป็นตัวเลขจำกัด ไม่ได้ Infinity หรือตัวเลขบ้าๆ ที่ห่างไกลกว่าระยะเวลา
    if (!Number.isFinite(data.exp) || data.exp < now || data.exp > now + MAX_AGE_SECONDS) return null;
    // uid/name/gid ต้องเป็นสตริงจริง ไม่งั้น query ที่ใช้ gid จะกลายเป็น undefined
    // แล้ว MongoDB จะแปลงเป็น null ซึ่งไปแมตช์ข้าม guild ได้
    for (const key of ['uid', 'name', 'gid']) {
      if (typeof data[key] !== 'string' || data[key].length === 0) return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function sessionCookie(value) {
  // ต้องแน่ใจว่า value ไม่มี ; หรือ CR/LF จะได้ไม่ถูก extend ให้มีแอตทริบิวต์อื่นเพิ่มเติม
  if (typeof value !== 'string' || /[;,\r\n]/.test(value)) {
    throw new Error('Invalid cookie value');
  }
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  const found = [];
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) found.push(rest.join('='));
  }
  // เราตั้ง cookie นี้ครั้งเดียวด้วย Path=/ เสมอ ถ้าเจอซ้ำแปลว่ามีคนยัดของปลอมเข้ามา
  return found.length === 1 ? found[0] : null;
}
