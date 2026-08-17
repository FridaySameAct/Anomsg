// ทดสอบ handler จริงด้วย Ed25519 keypair ของจริง
import { generateKeyPairSync, sign as edSign } from 'node:crypto';

const HANDLER = new URL('../api/interactions.js', import.meta.url).href;

// --- สร้าง keypair แล้วดึง raw public key เป็น hex (รูปแบบเดียวกับที่ Discord ให้มา) ---
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
const PUBLIC_KEY_HEX = rawPub.toString('hex');

process.env.DISCORD_PUBLIC_KEY = PUBLIC_KEY_HEX;
process.env.DISCORD_TOKEN = 'fake-bot-token';

const { GET, POST } = await import(HANDLER);

function signed(bodyObj, { tamper = false } = {}) {
  const body = JSON.stringify(bodyObj);
  const timestamp = '1700000000';
  const sig = edSign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex');
  return new Request('https://example.com/api/interactions', {
    method: 'POST',
    headers: {
      'x-signature-ed25519': tamper ? 'ab'.repeat(32) : sig,
      'x-signature-timestamp': timestamp,
      'content-type': 'application/json',
    },
    body,
  });
}

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name} ${extra}`);
    fail++;
  }
}

// จับ fetch ที่ยิงไปหา Discord API และปลอมไฟล์ให้ตอนโหลด attachment
const ATTACHMENT_URL = 'https://cdn.discordapp.com/ephemeral-attachments/1/2/photo.jpg';
let captured = null;
let nextDiscordResponse = () => new Response('{"id":"123"}', { status: 200 });
let nextDownload = () => new Response('', { status: 404 });
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://cdn.discordapp.com/')) return nextDownload();
  captured = { url, init };
  return nextDiscordResponse();
};

// JPEG ขั้นต่ำที่มี APP1 (EXIF) ฝังพิกัดปลอมไว้ ใช้พิสูจน์ว่า EXIF ถูกลบจริง
const SECRET_EXIF = 'GPS-13.7563,100.5018';
function jpegWithExif() {
  const payload = Buffer.from(`Exif\0\0${SECRET_EXIF}`, 'latin1');
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, 0x00, 0x00]),
    payload,
  ]);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    app1,
    Buffer.from([0xff, 0xda, 0x00, 0x03, 0x00]), // SOS
    Buffer.from([0x11, 0x22, 0x33]), // ข้อมูลภาพ
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

function sendWithImage(attachment) {
  return signed({
    type: 2,
    channel_id: '999',
    data: {
      name: 'send',
      options: [{ name: 'image', value: 'att1' }],
      resolved: { attachments: { att1: attachment } },
    },
  });
}

console.log('\n=== 1. GET health check ===');
{
  const res = GET();
  check('status 200', res.status === 200, `got ${res.status}`);
  check('body = Bot is online!', (await res.text()) === 'Bot is online!');
}

console.log('\n=== 2. PING ลายเซ็นถูกต้อง -> PONG ===');
{
  const res = await POST(signed({ type: 1 }));
  const json = await res.json();
  check('status 200', res.status === 200, `got ${res.status}`);
  check('type = 1 (PONG)', json.type === 1, JSON.stringify(json));
}

console.log('\n=== 3. ลายเซ็นผิด -> ต้องได้ 401 (Discord ใช้ทดสอบตอนบันทึก Endpoint URL) ===');
{
  const res = await POST(signed({ type: 1 }, { tamper: true }));
  check('status 401', res.status === 401, `got ${res.status}`);
}

console.log('\n=== 4. ไม่มี header ลายเซ็น -> 401 ===');
{
  const req = new Request('https://example.com/api/interactions', {
    method: 'POST',
    body: '{"type":1}',
  });
  const res = await POST(req);
  check('status 401', res.status === 401, `got ${res.status}`);
}

console.log('\n=== 5. /send สำเร็จ ===');
{
  captured = null;
  nextDiscordResponse = () => new Response('{"id":"123"}', { status: 200 });
  const res = await POST(
    signed({
      type: 2,
      channel_id: '999',
      data: { name: 'send', options: [{ name: 'message', value: 'สวัสดี' }] },
    }),
  );
  const json = await res.json();
  check('เรียก Discord API ถูก endpoint', captured?.url === 'https://discord.com/api/v10/channels/999/messages', captured?.url);
  check('ใช้ Bot token ใน Authorization', captured?.init.headers.Authorization === 'Bot fake-bot-token');
  const sent = JSON.parse(captured.init.body);
  check('ส่ง content ถูกต้อง', sent.content === 'สวัสดี', JSON.stringify(sent));
  check('ปิด mention ทั้งหมด (กัน @everyone)', JSON.stringify(sent.allowed_mentions) === '{"parse":[]}', JSON.stringify(sent.allowed_mentions));
  check('ตอบ type 4', json.type === 4, JSON.stringify(json));
  check('ตอบแบบ ephemeral (flags 64)', json.data.flags === 64, String(json.data?.flags));
  check('ข้อความยืนยันสำเร็จ', json.data.content.includes('เรียบร้อย'), json.data?.content);
}

console.log('\n=== 6. Discord ตอบ 403 (บอทไม่มีสิทธิ์) -> ต้องไม่บอกว่าสำเร็จ ===');
{
  nextDiscordResponse = () => new Response('{"message":"Missing Permissions"}', { status: 403 });
  const res = await POST(
    signed({
      type: 2,
      channel_id: '999',
      data: { name: 'send', options: [{ name: 'message', value: 'hi' }] },
    }),
  );
  const json = await res.json();
  check('แจ้งว่าไม่มีสิทธิ์', json.data.content.includes('ไม่มีสิทธิ์'), json.data?.content);
  check('ไม่ได้บอกว่าสำเร็จ', !json.data.content.includes('เรียบร้อย'), json.data?.content);
  check('ยังเป็น ephemeral', json.data.flags === 64);
}

console.log('\n=== 6b. Discord ตอบ 401 (token ผิด) -> ต้องบอกให้ไปแก้ที่ไหน ===');
{
  nextDiscordResponse = () => new Response('{"message":"401: Unauthorized"}', { status: 401 });
  const res = await POST(
    signed({
      type: 2,
      channel_id: '999',
      data: { name: 'send', options: [{ name: 'message', value: 'hi' }] },
    }),
  );
  const json = await res.json();
  check('บอกว่าเป็นเรื่อง token', json.data.content.includes('token'), json.data?.content);
  check('บอกให้ไปแก้ที่ DISCORD_TOKEN', json.data.content.includes('DISCORD_TOKEN'), json.data?.content);
  check('ไม่ได้บอกว่าสำเร็จ', !json.data.content.includes('เรียบร้อย'), json.data?.content);
}

console.log('\n=== 6c. Discord ตอบ 404 (ไม่พบห้อง) ===');
{
  nextDiscordResponse = () => new Response('{"message":"Unknown Channel"}', { status: 404 });
  const res = await POST(
    signed({
      type: 2,
      channel_id: '999',
      data: { name: 'send', options: [{ name: 'message', value: 'hi' }] },
    }),
  );
  const json = await res.json();
  check('แจ้งว่าไม่พบห้อง', json.data.content.includes('ไม่พบห้อง'), json.data?.content);
}

console.log('\n=== 7. คำสั่งที่ไม่รู้จัก -> ต้องตอบกลับ ไม่เงียบ ===');
{
  const res = await POST(signed({ type: 2, channel_id: '999', data: { name: 'unknown' } }));
  const json = await res.json();
  check('มี response กลับ', json.type === 4, JSON.stringify(json));
  check('แจ้งไม่รู้จักคำสั่ง', json.data.content.includes('ไม่รู้จัก'), json.data?.content);
}

console.log('\n=== 8. /ping ===');
{
  captured = null;
  // สร้าง snowflake id จากเวลาปัจจุบันแบบเดียวกับที่ Discord ทำ
  const snowflake = ((BigInt(Date.now()) - 1420070400000n) << 22n).toString();
  const res = await POST(signed({ type: 2, id: snowflake, channel_id: '999', data: { name: 'ping' } }));
  const json = await res.json();
  check('ตอบ Pong', json.data.content.startsWith('Pong!'), json.data?.content);
  check('เป็น ephemeral', json.data.flags === 64, String(json.data?.flags));
  check('แสดง latency เป็นตัวเลข ms', /\(\d+ ms\)/.test(json.data.content), json.data?.content);
  check('ไม่ยิง Discord API (ไม่เปลืองโควตา)', captured === null, JSON.stringify(captured?.url));
}

console.log('\n=== 8b. /ping ที่ id พัง -> ยังตอบได้ ไม่ crash ===');
{
  const res = await POST(signed({ type: 2, id: 'ไม่ใช่ตัวเลข', channel_id: '999', data: { name: 'ping' } }));
  const json = await res.json();
  check('ยังตอบ Pong', json.data.content === 'Pong! 🏓', json.data?.content);
}

console.log('\n=== 8c. /send แนบรูปอย่างเดียว -> ต้องอัปโหลดใหม่และลบ EXIF ===');
{
  captured = null;
  nextDiscordResponse = () => new Response('{"id":"123"}', { status: 200 });
  const original = jpegWithExif();
  nextDownload = () => new Response(original, { status: 200 });

  const res = await POST(
    sendWithImage({ id: 'att1', url: ATTACHMENT_URL, size: original.length, content_type: 'image/jpeg' }),
  );
  const json = await res.json();

  check('ส่งสำเร็จ', json.data.content.includes('เรียบร้อย'), json.data?.content);
  const form = captured?.init.body;
  check('ส่งเป็น multipart ไม่ใช่ JSON', form instanceof FormData);
  check('ไม่ตั้ง Content-Type เอง (ต้องให้ fetch ใส่ boundary)', !('Content-Type' in captured.init.headers));

  const payload = JSON.parse(form.get('payload_json'));
  check('ปิด mention ไว้เหมือนเดิม', JSON.stringify(payload.allowed_mentions) === '{"parse":[]}');

  const file = form.get('files[0]');
  check('ชื่อไฟล์ถูกสุ่มใหม่ ไม่ใช่ชื่อเดิม', /^image-[0-9a-f]{8}\.jpg$/.test(file.name), file.name);

  const bytes = Buffer.from(await file.arrayBuffer());
  check('EXIF/พิกัด GPS ถูกลบออกจริง', !bytes.toString('latin1').includes(SECRET_EXIF));
  check('ยังเป็น JPEG ที่ถูกต้อง (มี SOI + SOS)', bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.indexOf(Buffer.from([0xff, 0xda])) !== -1);
  check('ข้อมูลภาพไม่ถูกแตะ', bytes.indexOf(Buffer.from([0x11, 0x22, 0x33])) !== -1);
  check('ไฟล์เล็กลงกว่าเดิม', bytes.length < original.length, `${bytes.length} vs ${original.length}`);
}

console.log('\n=== 8d. /send ข้อความ + รูปพร้อมกัน ===');
{
  captured = null;
  const original = jpegWithExif();
  nextDownload = () => new Response(original, { status: 200 });
  const req = signed({
    type: 2,
    channel_id: '999',
    data: {
      name: 'send',
      options: [
        { name: 'message', value: 'ดูรูปนี้สิ' },
        { name: 'image', value: 'att1' },
      ],
      resolved: {
        attachments: { att1: { id: 'att1', url: ATTACHMENT_URL, size: original.length, content_type: 'image/jpeg' } },
      },
    },
  });
  await POST(req);
  const payload = JSON.parse(captured.init.body.get('payload_json'));
  check('ข้อความไปด้วย', payload.content === 'ดูรูปนี้สิ', payload.content);
  check('รูปไปด้วย', captured.init.body.get('files[0]') !== null);
}

console.log('\n=== 8e. แนบไฟล์ที่ไม่ใช่ภาพ -> ต้องปฏิเสธ ===');
{
  captured = null;
  // แจ้ง content_type ว่าเป็นรูป แต่ไบต์จริงเป็นไฟล์อื่น ต้องดูจากไบต์ไม่ใช่คำแจ้ง
  nextDownload = () => new Response(Buffer.from('MZ\x90\x00 this is an exe'), { status: 200 });
  const res = await POST(
    sendWithImage({ id: 'att1', url: ATTACHMENT_URL, size: 100, content_type: 'image/jpeg' }),
  );
  const json = await res.json();
  check('ปฏิเสธไฟล์', json.data.content.includes('เฉพาะไฟล์ภาพ'), json.data?.content);
  check('ไม่ยิงไป Discord เลย', captured === null);
}

console.log('\n=== 8f. ไฟล์ใหญ่เกิน 8MB -> ปฏิเสธก่อนโหลด ===');
{
  captured = null;
  let downloaded = false;
  nextDownload = () => {
    downloaded = true;
    return new Response('', { status: 200 });
  };
  const res = await POST(
    sendWithImage({ id: 'att1', url: ATTACHMENT_URL, size: 9 * 1024 * 1024, content_type: 'image/jpeg' }),
  );
  const json = await res.json();
  check('แจ้งว่าไฟล์ใหญ่เกิน', json.data.content.includes('ใหญ่เกินไป'), json.data?.content);
  check('ไม่เสียเวลาโหลดไฟล์', downloaded === false);
}

console.log('\n=== 8g. ไม่ใส่ทั้งข้อความและรูป -> ปฏิเสธ ===');
{
  captured = null;
  const res = await POST(signed({ type: 2, channel_id: '999', data: { name: 'send' } }));
  const json = await res.json();
  check('บอกว่าต้องใส่อย่างน้อยหนึ่งอย่าง', json.data.content.includes('อย่างน้อย'), json.data?.content);
  check('ไม่ยิงไป Discord', captured === null);
}

console.log('\n=== 8h. โหลดรูปไม่สำเร็จ -> ต้องไม่บอกว่าสำเร็จ ===');
{
  captured = null;
  nextDownload = () => new Response('', { status: 403 });
  const res = await POST(
    sendWithImage({ id: 'att1', url: ATTACHMENT_URL, size: 100, content_type: 'image/jpeg' }),
  );
  const json = await res.json();
  check('แจ้งว่าโหลดรูปไม่สำเร็จ', json.data.content.includes('โหลดรูป'), json.data?.content);
  check('ไม่ได้บอกว่าสำเร็จ', !json.data.content.includes('เรียบร้อย'), json.data?.content);
}

console.log('\n=== 9. body พัง แต่ลายเซ็นถูก -> 400 ไม่ใช่ crash ===');
{
  const body = 'not json';
  const timestamp = '1700000000';
  const sig = edSign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex');
  const req = new Request('https://example.com/api/interactions', {
    method: 'POST',
    headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': timestamp },
    body,
  });
  const res = await POST(req);
  check('status 400', res.status === 400, `got ${res.status}`);
}

console.log('\n=== 10. ไม่มี env var -> 500 ไม่ใช่ปล่อยผ่าน ===');
{
  const saved = process.env.DISCORD_TOKEN;
  delete process.env.DISCORD_TOKEN;
  const res = await POST(signed({ type: 1 }));
  check('status 500', res.status === 500, `got ${res.status}`);
  process.env.DISCORD_TOKEN = saved;
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
