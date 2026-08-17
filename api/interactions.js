import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
  verifyKey,
} from 'discord-interactions';
import {
  MAX_IMAGE_BYTES,
  detectImageType,
  randomImageName,
  stripMetadata,
} from '../lib/image.js';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_EPOCH = 1420070400000;

// ดึงเวลาที่ Discord สร้าง interaction ออกมาจาก snowflake id
// เอาไว้วัดว่ากว่า function จะได้ประมวลผลช้าไปกี่ ms (เพดานของ Discord คือ 3 วินาที)
function interactionLatencyMs(id) {
  try {
    return Date.now() - (Number(BigInt(id) >> 22n) + DISCORD_EPOCH);
  } catch {
    return null;
  }
}

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

  // 4. จัดการคำสั่ง /ping — เช็คว่าบอทยังตอบอยู่และตอบช้าแค่ไหน
  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === 'ping'
  ) {
    const latency = interactionLatencyMs(interaction.id);
    return ephemeral(latency === null ? 'Pong! 🏓' : `Pong! 🏓 (${latency} ms)`);
  }

  // 5. จัดการคำสั่ง /send
  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === 'send'
  ) {
    const options = interaction.data.options;
    const messageContent = options?.find((option) => option.name === 'message')?.value;
    const imageId = options?.find((option) => option.name === 'image')?.value;
    const attachment = imageId ? interaction.data.resolved?.attachments?.[imageId] : undefined;
    const channelId = interaction.channel_id;

    if (!channelId) {
      return ephemeral('ไม่พบห้องปลายทาง ลองใหม่อีกครั้ง');
    }
    if (!messageContent && !attachment) {
      return ephemeral('ต้องใส่ข้อความหรือแนบรูปอย่างน้อยอย่างหนึ่ง');
    }

    const payload = {
      content: messageContent ?? '',
      // กัน /send @everyone ถูกใช้ก่อกวน — ข้อความยังแสดงตัวอักษรปกติแต่ไม่ ping ใคร
      allowed_mentions: { parse: [] },
    };

    const headers = { Authorization: `Bot ${botToken}` };
    let body;

    if (attachment) {
      if (attachment.size > MAX_IMAGE_BYTES) {
        return ephemeral(`ไฟล์ใหญ่เกินไป จำกัดที่ ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
      }

      let raw;
      try {
        // ต้องโหลดมาอัปโหลดใหม่ ส่ง URL ต่อเฉยๆ ไม่ได้ เพราะลิงก์ CDN ของ Discord
        // ถูกเซ็นด้วย ex/is/hm แล้วหมดอายุ รูปจะกลายเป็นลิงก์เสียในภายหลัง
        const download = await fetch(attachment.url, { signal: AbortSignal.timeout(2000) });
        if (!download.ok) {
          console.error(`Attachment download failed: ${download.status}`);
          return ephemeral('โหลดรูปจาก Discord ไม่สำเร็จ ลองใหม่อีกครั้ง');
        }
        raw = Buffer.from(await download.arrayBuffer());
      } catch (err) {
        console.error('Attachment download error:', err);
        return ephemeral('โหลดรูปไม่ทันเวลา ลองใช้ไฟล์ที่เล็กลง');
      }

      if (raw.length > MAX_IMAGE_BYTES) {
        return ephemeral(`ไฟล์ใหญ่เกินไป จำกัดที่ ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
      }

      const type = detectImageType(raw);
      if (!type) {
        return ephemeral('แนบได้เฉพาะไฟล์ภาพ JPEG, PNG, WebP หรือ GIF เท่านั้น');
      }

      // ลบ EXIF และตั้งชื่อไฟล์ใหม่แบบสุ่ม ชื่อไฟล์เดิมก็บอกตัวตนคนส่งได้เหมือนกัน
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      form.append(
        'files[0]',
        new Blob([stripMetadata(raw, type)], { type }),
        randomImageName(type),
      );
      body = form; // ห้ามตั้ง Content-Type เอง ต้องปล่อยให้ fetch ใส่ boundary ให้
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(payload);
    }

    try {
      const discordRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers,
        body,
      });

      if (!discordRes.ok) {
        const detail = await discordRes.text();
        console.error(`Discord API ${discordRes.status}: ${detail}`);

        if (discordRes.status === 401) {
          return ephemeral(
            'ส่งไม่สำเร็จ: bot token ไม่ถูกต้อง — ตรวจ DISCORD_TOKEN บน Vercel แล้ว redeploy',
          );
        }
        if (discordRes.status === 403) {
          return ephemeral('ส่งไม่สำเร็จ: บอทไม่มีสิทธิ์โพสต์ในห้องนี้');
        }
        if (discordRes.status === 404) {
          return ephemeral('ส่งไม่สำเร็จ: ไม่พบห้องนี้ หรือบอทไม่ได้อยู่ในเซิร์ฟเวอร์');
        }
        return ephemeral(`ส่งไม่สำเร็จ (error ${discordRes.status})`);
      }

      return ephemeral('ส่งแบบไม่ระบุตัวตนเรียบร้อยแล้ว!');
    } catch (err) {
      console.error('Error sending message:', err);
      return ephemeral('ส่งไม่สำเร็จ เกิดข้อผิดพลาดที่เซิร์ฟเวอร์');
    }
  }

  // 6. คำสั่งอื่นที่ยังไม่รองรับ — ต้องตอบอะไรกลับไปเสมอ ไม่งั้น Discord ขึ้น "did not respond"
  return ephemeral('ไม่รู้จักคำสั่งนี้');
}
