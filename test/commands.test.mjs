// กันไม่ให้ definition ของคำสั่งกับ handler หลุดจากกันเงียบๆ
// เทสต์ชุดนี้มีไว้จับกรณีที่เปลี่ยนชื่อคำสั่ง/option ที่เดียวแล้วลืมอีกที่
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import {
  COMMAND_DEFINITIONS,
  OPT_IMAGE,
  OPT_MESSAGE,
  PING,
  SEND,
} from '../lib/commands.js';

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

const byName = (name) => COMMAND_DEFINITIONS.find((c) => c.name === name);

console.log('\n=== คำสั่งที่โค้ดอ้างถึง ต้องมีอยู่จริงใน definition ===');
{
  check(`มีคำสั่ง /${SEND}`, Boolean(byName(SEND)));
  check(`มีคำสั่ง /${PING}`, Boolean(byName(PING)));
  check('ไม่มีชื่อคำสั่งซ้ำ', new Set(COMMAND_DEFINITIONS.map((c) => c.name)).size === COMMAND_DEFINITIONS.length);
}

console.log('\n=== option ที่ handler อ่าน ต้องมีอยู่จริงใน definition ===');
{
  const names = (byName(SEND).options ?? []).map((o) => o.name);
  check(`/send มี option "${OPT_MESSAGE}"`, names.includes(OPT_MESSAGE), names.join(', '));
  check(`/send มี option "${OPT_IMAGE}"`, names.includes(OPT_IMAGE), names.join(', '));
  check('ไม่มีชื่อ option ซ้ำ', new Set(names).size === names.length);
  check('image เป็นชนิด attachment (11)', byName(SEND).options.find((o) => o.name === OPT_IMAGE).type === 11);
  check('message เป็นชนิด string (3)', byName(SEND).options.find((o) => o.name === OPT_MESSAGE).type === 3);
}

console.log('\n=== definition ต้องผ่านกฎของ Discord ===');
{
  for (const command of COMMAND_DEFINITIONS) {
    check(`/${command.name} ชื่อถูกกฎ (a-z0-9-_ ไม่เกิน 32)`, /^[-_a-z0-9]{1,32}$/.test(command.name));
    check(
      `/${command.name} คำอธิบายยาว 1-100`,
      command.description.length >= 1 && command.description.length <= 100,
      String(command.description.length),
    );

    const options = command.options ?? [];
    check(`/${command.name} มี option ไม่เกิน 25`, options.length <= 25);

    // Discord บังคับให้ option ที่ required ต้องมาก่อน option ที่ไม่ required
    const firstOptional = options.findIndex((o) => !o.required);
    const requiredAfterOptional =
      firstOptional !== -1 && options.slice(firstOptional).some((o) => o.required);
    check(`/${command.name} เรียง required ก่อน optional`, !requiredAfterOptional);
  }
}

console.log('\n=== ทุกคำสั่งที่ประกาศไว้ ต้องมี handler รับจริง ===');
{
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  process.env.DISCORD_PUBLIC_KEY = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
  process.env.DISCORD_TOKEN = 'fake-bot-token';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const { POST } = await import('../api/interactions.js');
  globalThis.fetch = async () => new Response('{"id":"1"}', { status: 200 });

  for (const command of COMMAND_DEFINITIONS) {
    // คำสั่งที่มี subcommand (เช่น /task) ต้องส่ง subcommand แรกไปด้วย ไม่งั้นตกไปที่
    // กิ่ง "ไม่รู้จักคำสั่งย่อยนี้" ของ handler เอง ซึ่งบังเอิญมีคำว่า "ไม่รู้จักคำสั่ง" ทับกับ
    // ข้อความ router ตอนไม่มี handler เลย ทำให้เช็คผ่านผิดๆ
    const firstSub = (command.options ?? []).find((o) => o.type === 1);
    const data = firstSub
      ? { name: command.name, options: [{ name: firstSub.name, type: 1, options: [] }] }
      : { name: command.name };
    const body = JSON.stringify({
      type: 2,
      id: '1',
      channel_id: '999',
      guild_id: 'g1',
      data,
    });
    const timestamp = '1700000000';
    const sig = edSign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex');
    const res = await POST(
      new Request('https://example.com/api/interactions', {
        method: 'POST',
        headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': timestamp },
        body,
      }),
    );
    const json = await res.json();
    check(
      `/${command.name} มี handler (ไม่ตกไปที่ "ไม่รู้จักคำสั่งนี้")`,
      !json.data?.content?.includes('ไม่รู้จักคำสั่ง'),
      json.data?.content,
    );
  }
}

console.log('\n=== คำสั่ง task ต้องปิดตัวเองเมื่อยังไม่ตั้ง MONGODB_URI ===');
{
  delete process.env.MONGODB_URI;
  const { handleWeb } = await import('../lib/web.js');
  const res = handleWeb({ interaction: { guild_id: 'g1' }, env: { PUBLIC_BASE_URL: 'https://x.test' } });
  const json = await res.json();
  check('/web แจ้งว่ายังไม่เปิดใช้งาน', json.data.content.includes('ยังไม่ได้เปิดใช้งาน'), json.data?.content);
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
