// ตัวช่วยเล็กๆ ที่ใช้ร่วมกันทุกคำสั่ง

import { InteractionResponseType, InteractionResponseFlags } from 'discord-interactions';

export const DISCORD_API = 'https://discord.com/api/v10';

// รูปแบบ Discord snowflake id (user/guild/channel ฯลฯ ใช้รูปแบบเดียวกันหมด) — เดิมก็อปปี้แยกไว้
// 3 ที่ (lib/tasks-service.js, api/auth/login.js, api/auth/callback.js) ย้ายมารวมที่นี่เพราะเป็น
// ตัวช่วยเกี่ยวกับ Discord id โดยตรง ไม่ใช่เรื่อง session/cookie
export const SNOWFLAKE = /^\d{17,20}$/;

const DISCORD_EPOCH = 1420070400000;

// Discord ตัดที่ 3 วินาที เผื่อเวลาไว้ให้ Vercel ส่ง response กลับด้วย
const OUTBOUND_BUDGET_MS = 2500;

// ตอบกลับแบบ ephemeral (เห็นคนเดียว) เพื่อไม่ให้คนอื่นรู้ว่าใครเป็นคนสั่ง
export function ephemeral(content) {
  return Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: InteractionResponseFlags.EPHEMERAL,
    },
  });
}

/**
 * ตอบทันทีว่า "กำลังคิด..." เพื่อซื้อเวลาเพิ่มจาก 3 วินาทีเป็น 15 นาที
 *
 * Discord บังคับให้ response แรกมาถึงภายใน 3 วินาที เกินกว่านั้น token ถูกยกเลิกทันที
 * ยืดไม่ได้ แต่ response แรกไม่จำเป็นต้องเป็นคำตอบจริง พอตอบ type 5 ไปแล้ว
 * interaction token ใช้แก้ข้อความนี้ได้อีก 15 นาที ซึ่งเหลือเฟือสำหรับงานที่ต้องรอ MongoDB
 *
 * ต้องใส่ flag ephemeral ตั้งแต่ตอนนี้ ไม่ใช่ตอนแก้ข้อความทีหลัง — Discord ยึดตามครั้งแรก
 * ถ้าลืม ข้อความ "กำลังคิด..." จะโผล่ให้ทั้งห้องเห็น
 */
export function deferredEphemeral() {
  return Response.json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: InteractionResponseFlags.EPHEMERAL },
  });
}

/**
 * แทนที่ข้อความ "กำลังคิด..." ด้วยคำตอบจริง
 *
 * ใช้ interaction token ยืนยันตัวตน ไม่ต้องแนบ bot token — endpoint นี้เป็น webhook
 * applicationId มากับ payload ของ interaction อยู่แล้ว จึงไม่ต้องพึ่ง env var เพิ่ม
 */
export async function editOriginal({ applicationId, token, content }, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${DISCORD_API}/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) {
    // ล้มตรงนี้แปลว่าผู้ใช้ค้างอยู่ที่ "กำลังคิด..." ตลอดไป ต้องเห็นใน log ให้ได้
    console.error(`edit original message failed: ${res.status}`);
  }
  return res.ok;
}

// ดึงเวลาที่ Discord สร้าง interaction ออกมาจาก snowflake id
// เอาไว้วัดว่ากว่า function จะได้ประมวลผลช้าไปกี่ ms
export function interactionLatencyMs(id) {
  try {
    return Date.now() - (Number(BigInt(id) >> 22n) + DISCORD_EPOCH);
  } catch {
    return null;
  }
}

/**
 * คืนฟังก์ชันที่บอกว่าเหลือเวลาให้ยิงออกนอกอีกกี่ ms
 *
 * ใช้งบก้อนเดียวร่วมกันทุก request ใน interaction นั้น ถ้าโหลดรูปกินไป 1.8 วินาที
 * การยิงข้อความต่อจะเหลือเวลาแค่ 0.7 วินาที ไม่ใช่ตั้ง timeout แยกอันละ 2 วินาที
 * ซึ่งรวมกันแล้วทะลุเพดาน 3 วินาทีของ Discord ได้
 */
export function createDeadline(budgetMs = OUTBOUND_BUDGET_MS) {
  const expiresAt = Date.now() + budgetMs;
  return () => Math.max(200, expiresAt - Date.now());
}
