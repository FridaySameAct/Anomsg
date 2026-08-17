import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  verifyKey,
} from 'discord-interactions';

const DISCORD_API = 'https://discord.com/api/v10';

// ตอบกลับแบบ ephemeral (เห็นคนเดียว) เพื่อไม่ให้คนอื่นรู้ว่าใครเป็นคนสั่ง
function ephemeral(content) {
  return Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: InteractionResponseFlags.EPHEMERAL,
    },
  });
}

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

  // 4. จัดการคำสั่ง /send
  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === 'send'
  ) {
    const messageContent = interaction.data.options?.find(
      (option) => option.name === 'message',
    )?.value;
    const channelId = interaction.channel_id;

    if (!messageContent || !channelId) {
      return ephemeral('ไม่พบข้อความหรือห้องปลายทาง ลองใหม่อีกครั้ง');
    }

    try {
      const discordRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: messageContent,
          // กัน /send @everyone ถูกใช้ก่อกวน — ข้อความยังแสดงตัวอักษรปกติแต่ไม่ ping ใคร
          allowed_mentions: { parse: [] },
        }),
      });

      if (!discordRes.ok) {
        const detail = await discordRes.text();
        console.error(`Discord API ${discordRes.status}: ${detail}`);

        if (discordRes.status === 403) {
          return ephemeral('ส่งไม่สำเร็จ: บอทไม่มีสิทธิ์โพสต์ในห้องนี้');
        }
        return ephemeral(`ส่งไม่สำเร็จ (error ${discordRes.status})`);
      }

      return ephemeral('ส่งข้อความแบบไม่ระบุตัวตนเรียบร้อยแล้ว!');
    } catch (err) {
      console.error('Error sending message:', err);
      return ephemeral('ส่งไม่สำเร็จ เกิดข้อผิดพลาดที่เซิร์ฟเวอร์');
    }
  }

  // 5. คำสั่งอื่นที่ยังไม่รองรับ — ต้องตอบอะไรกลับไปเสมอ ไม่งั้น Discord ขึ้น "did not respond"
  return ephemeral('ไม่รู้จักคำสั่งนี้');
}
