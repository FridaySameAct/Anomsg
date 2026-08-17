import { OPT_IMAGE, OPT_MESSAGE } from './commands.js';
import { DISCORD_API, createDeadline, ephemeral } from './discord.js';
import {
  MAX_IMAGE_BYTES,
  detectImageType,
  randomImageName,
  stripMetadata,
} from './image.js';
import { checkRateLimit } from './rate-limit.js';

const TOO_LARGE = `ไฟล์ใหญ่เกินไป จำกัดที่ ${MAX_IMAGE_BYTES / 1024 / 1024} MB`;

/**
 * โหลดรูปจาก Discord มาลบ metadata แล้วประกอบเป็น multipart
 * คืน { form } เมื่อสำเร็จ หรือ { error } พร้อมข้อความที่จะแสดงให้ผู้ใช้
 */
async function prepareAttachment(attachment, payload, timeLeft) {
  // เชื่อขนาดที่ Discord แจ้งไปก่อนเพื่อไม่ต้องเสียเวลาโหลดของที่ยังไงก็ไม่ผ่าน
  if (attachment.size > MAX_IMAGE_BYTES) return { error: TOO_LARGE };

  let raw;
  try {
    // ต้องโหลดมาอัปโหลดใหม่ ส่ง URL ต่อเฉยๆ ไม่ได้ เพราะลิงก์ CDN ของ Discord
    // ถูกเซ็นด้วย ex/is/hm แล้วหมดอายุ รูปจะกลายเป็นลิงก์เสียในภายหลัง
    const download = await fetch(attachment.url, { signal: AbortSignal.timeout(timeLeft()) });
    if (!download.ok) {
      console.error(`Attachment download failed: ${download.status}`);
      return { error: 'โหลดรูปจาก Discord ไม่สำเร็จ ลองใหม่อีกครั้ง' };
    }
    raw = Buffer.from(await download.arrayBuffer());
  } catch (err) {
    console.error('Attachment download error:', err);
    return { error: 'โหลดรูปไม่ทันเวลา ลองใช้ไฟล์ที่เล็กลง' };
  }

  // เช็คของจริงอีกรอบ เผื่อ Discord แจ้งขนาดผิดหรือไม่ได้แจ้งมา
  if (raw.length > MAX_IMAGE_BYTES) return { error: TOO_LARGE };

  const type = detectImageType(raw);
  if (!type) return { error: 'แนบได้เฉพาะไฟล์ภาพ JPEG, PNG, WebP หรือ GIF เท่านั้น' };

  // ลบ EXIF และตั้งชื่อไฟล์ใหม่แบบสุ่ม ชื่อไฟล์เดิมก็บอกตัวตนคนส่งได้เหมือนกัน
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([stripMetadata(raw, type)], { type }), randomImageName(type));
  return { form };
}

export async function handleSend({ interaction, env }) {
  const timeLeft = createDeadline();

  const options = interaction.data.options;
  const messageContent = options?.find((option) => option.name === OPT_MESSAGE)?.value;
  const imageId = options?.find((option) => option.name === OPT_IMAGE)?.value;
  const attachment = imageId ? interaction.data.resolved?.attachments?.[imageId] : undefined;
  const channelId = interaction.channel_id;

  if (!channelId) {
    return ephemeral('ไม่พบห้องปลายทาง ลองใหม่อีกครั้ง');
  }
  if (!messageContent && !attachment) {
    return ephemeral('ต้องใส่ข้อความหรือแนบรูปอย่างน้อยอย่างหนึ่ง');
  }

  // เช็คก่อนโหลดรูป จะได้ไม่เสียเวลาและ bandwidth กับคำขอที่ยังไงก็ไม่ผ่าน
  const limit = await checkRateLimit({
    userId: interaction.member?.user?.id ?? interaction.user?.id,
    channelId,
    env,
  });

  if (!limit.allowed) {
    return ephemeral(
      limit.scope === 'user'
        ? `ส่งถี่เกินไป รออีก ${limit.retryAfter} วินาทีแล้วลองใหม่`
        : `ห้องนี้มีคนใช้ /send ถี่เกินไป รออีก ${limit.retryAfter} วินาที`,
    );
  }

  const payload = {
    content: messageContent ?? '',
    // กัน /send @everyone ถูกใช้ก่อกวน — ข้อความยังแสดงตัวอักษรปกติแต่ไม่ ping ใคร
    allowed_mentions: { parse: [] },
  };

  const headers = { Authorization: `Bot ${env.DISCORD_TOKEN}` };
  let body;

  if (attachment) {
    const prepared = await prepareAttachment(attachment, payload, timeLeft);
    if (prepared.error) return ephemeral(prepared.error);
    body = prepared.form; // ห้ามตั้ง Content-Type เอง ต้องปล่อยให้ fetch ใส่ boundary ให้
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }

  try {
    const discordRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeLeft()),
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
