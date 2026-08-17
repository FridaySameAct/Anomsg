// ตัวช่วยเล็กๆ ที่ใช้ร่วมกันทุกคำสั่ง

import { InteractionResponseType, InteractionResponseFlags } from 'discord-interactions';

export const DISCORD_API = 'https://discord.com/api/v10';

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
