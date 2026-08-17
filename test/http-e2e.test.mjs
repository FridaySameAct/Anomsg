// ทดสอบผ่าน HTTP จริง: จำลอง adapter ของ Vercel + จำลองการตรวจ endpoint ของ Discord เป๊ะๆ
// ใช้ DISCORD_PUBLIC_KEY ตัวจริงจาก .env ไม่ได้ใช้ keypair ปลอม
import { createServer } from 'node:http';
import { sign as edSign, generateKeyPairSync } from 'node:crypto';

const { GET, POST } = await import(new URL('../api/interactions.js', import.meta.url).href);

// ---- adapter แบบเดียวกับที่ Vercel แปลง IncomingMessage -> Web Request ----
function toWebRequest(req, body) {
  return new Request(`https://localhost${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
}

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  let webRes;
  try {
    webRes = req.method === 'GET' ? await GET() : await POST(toWebRequest(req, body));
  } catch (err) {
    console.error('handler พัง:', err);
    res.writeHead(500).end('handler threw');
    return;
  }
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
  res.end(Buffer.from(await webRes.arrayBuffer()));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}/api/interactions`;
console.log(`เซิร์ฟเวอร์ทดสอบรันที่ ${BASE}\n`);

let pass = 0;
let fail = 0;
const check = (n, c, e = '') => (c ? (console.log(`  PASS  ${n}`), pass++) : (console.log(`  FAIL  ${n} ${e}`), fail++));

// ---- จำลองฝั่ง Discord: เซ็นด้วย private key แล้วให้ handler ตรวจด้วย public key คู่กัน ----
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
process.env.DISCORD_PUBLIC_KEY = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
process.env.DISCORD_TOKEN = 'fake-token-for-http-test';

async function discordSends(bodyObj, { validSig }) {
  const body = JSON.stringify(bodyObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = validSig
    ? edSign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex')
    : edSign(null, Buffer.from('ข้อความอื่นที่ไม่ตรง', 'utf8'), privateKey).toString('hex');

  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Ed25519': sig,
      'X-Signature-Timestamp': timestamp,
      'User-Agent': 'Discord-Interactions/1.0 (+https://discord.com)',
    },
    body,
  });
  return res;
}

console.log('=== ขั้นตอนตรวจ endpoint ของ Discord (ตอนกด Save URL) ===');
console.log('-- 1) ยิง PING ลายเซ็นถูกต้อง คาดหวัง 200 + {"type":1} --');
{
  const res = await discordSends({ type: 1 }, { validSig: true });
  const text = await res.text();
  check('HTTP 200', res.status === 200, `got ${res.status}`);
  check('content-type เป็น JSON', (res.headers.get('content-type') || '').includes('application/json'), res.headers.get('content-type'));
  check('body = {"type":1}', JSON.parse(text).type === 1, text);
}

console.log('-- 2) ยิงลายเซ็นผิด คาดหวัง 401 (ถ้าไม่ใช่ Discord จะไม่ยอมบันทึก URL) --');
{
  const res = await discordSends({ type: 1 }, { validSig: false });
  check('HTTP 401', res.status === 401, `got ${res.status}`);
}

console.log('-- 3) ยิงลายเซ็นผิดซ้ำด้วย payload คำสั่งจริง คาดหวัง 401 --');
{
  const res = await discordSends(
    { type: 2, channel_id: '1', data: { name: 'send', options: [{ name: 'message', value: 'x' }] } },
    { validSig: false },
  );
  check('HTTP 401', res.status === 401, `got ${res.status}`);
}

console.log('\n=== ทดสอบเพิ่มเติมผ่าน HTTP จริง ===');
console.log('-- 4) GET (เช็คว่ามีชีวิต) --');
{
  const res = await fetch(BASE);
  check('HTTP 200', res.status === 200, `got ${res.status}`);
  check('ข้อความถูกต้อง', (await res.text()) === 'Bot is online!');
}

console.log('-- 5) body ภาษาไทย/emoji ต้องเซ็นผ่าน (ทดสอบ UTF-8 หลายไบต์) --');
{
  let sentBody = null;
  globalThis.fetch_original = globalThis.fetch;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('discord.com')) {
      sentBody = JSON.parse(init.body);
      return new Response('{"id":"1"}', { status: 200 });
    }
    return realFetch(url, init);
  };

  const msg = 'สวัสดีครับ 🎉 ทดสอบ multi-byte';
  const res = await discordSends(
    { type: 2, channel_id: '555', data: { name: 'send', options: [{ name: 'message', value: msg }] } },
    { validSig: true },
  );
  const json = await res.json();
  check('ลายเซ็นผ่านแม้ body เป็น UTF-8 หลายไบต์', res.status === 200 && json.type === 4, `${res.status} ${JSON.stringify(json)}`);
  check('ข้อความส่งถึง Discord ครบถ้วนไม่เพี้ยน', sentBody?.content === msg, JSON.stringify(sentBody?.content));
  globalThis.fetch = realFetch;
}

server.close();
console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
