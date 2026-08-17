import { InteractionType, InteractionResponseType, verifyKey } from 'discord-interactions';
import { MYTASK, PING, SEND, TASK, WEB } from '../lib/commands.js';
import { ephemeral } from '../lib/discord.js';
import { handleMyTask } from '../lib/mytask.js';
import { handlePing } from '../lib/ping.js';
import { handleSend } from '../lib/send.js';
import { handleTask } from '../lib/task.js';
import { handleWeb } from '../lib/web.js';

// เพิ่มคำสั่งใหม่ = เพิ่ม definition ใน lib/commands.js แล้วมาผูก handler ตรงนี้
const HANDLERS = {
  [SEND]: handleSend,
  [PING]: handlePing,
  [WEB]: handleWeb,
  [MYTASK]: handleMyTask,
  [TASK]: handleTask,
};

// Discord เรียก GET ตอนเช็คว่า endpoint มีชีวิตอยู่ไหม
export function GET() {
  return new Response('Bot is online!', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const botToken = process.env.DISCORD_TOKEN;

  if (!publicKey || !botToken) {
    console.error('Missing DISCORD_PUBLIC_KEY or DISCORD_TOKEN env var');
    return new Response('Server misconfigured', { status: 500 });
  }

  // 1. อ่าน body ดิบแบบไม่ผ่าน parser — ต้องเป็นไบต์เดิมเป๊ะๆ ไม่งั้นลายเซ็นไม่ตรง
  const rawBody = await request.text();
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');

  if (!signature || !timestamp) {
    return new Response('Bad request signature', { status: 401 });
  }

  // 2. ตรวจลายเซ็น Ed25519 — verifyKey เป็น async ต้อง await ไม่งั้นได้ Promise ที่ truthy เสมอ
  const isValidRequest = await verifyKey(rawBody, signature, timestamp, publicKey);

  if (!isValidRequest) {
    // Discord จงใจยิงลายเซ็นผิดมาตอนบันทึก Endpoint URL และต้องการ 401 กลับไป
    return new Response('Bad request signature', { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new Response('Bad request body', { status: 400 });
  }

  // 3. ตอบ PING ด้วย PONG
  if (interaction.type === InteractionType.PING) {
    return Response.json({ type: InteractionResponseType.PONG });
  }

  // 4. ส่งต่อให้ handler ของคำสั่งนั้น
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const handler = HANDLERS[interaction.data?.name];
    if (handler) return handler({ interaction, env: process.env });
  }

  // 5. คำสั่งอื่นที่ยังไม่รองรับ — ต้องตอบอะไรกลับไปเสมอ ไม่งั้น Discord ขึ้น "did not respond"
  return ephemeral('ไม่รู้จักคำสั่งนี้');
}
