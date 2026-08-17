// จำกัดความถี่ของ /send ด้วย Upstash Redis ผ่าน REST API
//
// เก็บเฉพาะ "ตัวนับ" ที่หมดอายุใน 1 นาที ไม่ใช่ log และ id ถูก HMAC ก่อนเสมอ
// ต่อให้ข้อมูลใน Redis หลุดก็ย้อนกลับเป็น user id ไม่ได้ บอทจึงยังไม่ระบุตัวตนเหมือนเดิม

import { createHmac } from 'node:crypto';

export const RATE_LIMIT = {
  windowSeconds: 60,
  perUser: 5, // กันคนเดียวสแปมรัว
  perChannel: 15, // กันหลายคนรุมถล่มห้องเดียวกัน
};

function fingerprint(value, salt) {
  return createHmac('sha256', salt).update(String(value)).digest('hex').slice(0, 24);
}

export function isConfigured(env) {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

// นับขึ้นหนึ่งแล้วตั้งอายุให้ key เฉพาะครั้งแรกของหน้าต่างเวลา (EXPIRE ... NX)
// รวมสองคำสั่งไว้ใน pipeline เดียวเพื่อให้เหลือ HTTP รอบเดียว
async function bump(key, env, fetchImpl) {
  const res = await fetchImpl(`${env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, String(RATE_LIMIT.windowSeconds), 'NX'],
    ]),
    signal: AbortSignal.timeout(1000),
  });

  if (!res.ok) throw new Error(`Upstash responded ${res.status}`);

  const results = await res.json();
  if (results?.[0]?.error) throw new Error(results[0].error);

  return Number(results?.[0]?.result ?? 0);
}

/**
 * ตรวจว่ายังส่งได้อยู่ไหม คืน { allowed, scope, retryAfter }
 *
 * ปล่อยผ่านเสมอเมื่อยังไม่ได้ตั้งค่า Upstash หรือติดต่อ Redis ไม่ได้ (fail-open)
 * เพราะตัวจำกัดความถี่ล่มไม่ควรทำให้บอททั้งตัวใช้งานไม่ได้
 *
 * นับของผู้ใช้ก่อนแล้วค่อยนับของห้อง ถ้าคนนั้นโดนบล็อกแล้วจะไม่ไปแตะตัวนับของห้องเลย
 * ไม่งั้นคนสแปมคนเดียวจะกินโควตาห้องจนคนอื่นส่งไม่ได้ตามไปด้วย
 */
export async function checkRateLimit({ userId, channelId, env, fetchImpl = fetch }) {
  if (!isConfigured(env)) return { allowed: true, skipped: 'unconfigured' };

  const salt = env.RATE_LIMIT_SALT || env.DISCORD_TOKEN || '';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const window = Math.floor(nowSeconds / RATE_LIMIT.windowSeconds);
  const retryAfter = RATE_LIMIT.windowSeconds - (nowSeconds % RATE_LIMIT.windowSeconds);

  try {
    if (userId) {
      const used = await bump(`rl:u:${fingerprint(userId, salt)}:${window}`, env, fetchImpl);
      if (used > RATE_LIMIT.perUser) return { allowed: false, scope: 'user', retryAfter };
    }

    if (channelId) {
      const used = await bump(`rl:c:${fingerprint(channelId, salt)}:${window}`, env, fetchImpl);
      if (used > RATE_LIMIT.perChannel) return { allowed: false, scope: 'channel', retryAfter };
    }
  } catch (err) {
    console.error('Rate limit check failed, allowing through:', err);
    return { allowed: true, skipped: 'error' };
  }

  return { allowed: true };
}
