// ทดสอบตัวจำกัดความถี่ โดยปลอม Upstash REST API ไม่ต้องต่อเน็ตจริง
import { checkRateLimit, isConfigured, RATE_LIMIT } from '../lib/rate-limit.js';

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

const ENV = {
  UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'fake-token',
  RATE_LIMIT_SALT: 'salt-a',
};

// counts = จำนวนที่ INCR จะคืนกลับมา ตามลำดับการเรียก
function fakeUpstash(counts) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const n = counts[calls.length - 1] ?? 1;
    return new Response(JSON.stringify([{ result: n }, { result: 1 }]), { status: 200 });
  };
  impl.calls = calls;
  return impl;
}

console.log('\n=== ยังไม่ได้ตั้งค่า Upstash -> ปล่อยผ่าน ไม่ยิง HTTP ===');
{
  let called = false;
  const res = await checkRateLimit({
    userId: 'u1',
    channelId: 'c1',
    env: {},
    fetchImpl: async () => {
      called = true;
      return new Response('[]');
    },
  });
  check('ปล่อยผ่าน', res.allowed === true);
  check('ระบุเหตุผลว่ายังไม่ตั้งค่า', res.skipped === 'unconfigured', res.skipped);
  check('ไม่ยิง HTTP เลย', called === false);
  check('isConfigured แยกออก', isConfigured({}) === false && isConfigured(ENV) === true);
}

console.log('\n=== ใต้ลิมิต -> ผ่าน ===');
{
  const impl = fakeUpstash([1, 1]);
  const res = await checkRateLimit({ userId: 'u1', channelId: 'c1', env: ENV, fetchImpl: impl });
  check('ผ่าน', res.allowed === true);
  check('ยิง 2 ครั้ง (นับคน แล้วนับห้อง)', impl.calls.length === 2, String(impl.calls.length));
}

console.log('\n=== คำสั่งที่ส่งไป Redis ถูกต้อง ===');
{
  const impl = fakeUpstash([1, 1]);
  await checkRateLimit({ userId: 'u1', channelId: 'c1', env: ENV, fetchImpl: impl });
  const [incr, expire] = impl.calls[0].body;

  check('ยิงไปที่ /pipeline', impl.calls[0].url === 'https://fake.upstash.io/pipeline');
  check('ใช้ Bearer token', impl.calls[0].init.headers.Authorization === 'Bearer fake-token');
  check('คำสั่งแรกเป็น INCR', incr[0] === 'INCR');
  check('คำสั่งที่สองเป็น EXPIRE ... NX', expire[0] === 'EXPIRE' && expire[3] === 'NX', JSON.stringify(expire));
  check('อายุ key = ความยาวหน้าต่างเวลา', expire[2] === String(RATE_LIMIT.windowSeconds), expire[2]);
}

console.log('\n=== ไม่เก็บ user id ดิบลง Redis ===');
{
  const impl = fakeUpstash([1, 1]);
  await checkRateLimit({
    userId: '123456789012345678',
    channelId: '987654321098765432',
    env: ENV,
    fetchImpl: impl,
  });
  const allKeys = impl.calls.map((c) => JSON.stringify(c.body)).join(' ');
  check('ไม่มี user id ดิบใน key', !allKeys.includes('123456789012345678'), allKeys);
  check('ไม่มี channel id ดิบใน key', !allKeys.includes('987654321098765432'));
  check('key ของคนขึ้นต้นด้วย rl:u:', impl.calls[0].body[0][1].startsWith('rl:u:'), impl.calls[0].body[0][1]);
  check('key ของห้องขึ้นต้นด้วย rl:c:', impl.calls[1].body[0][1].startsWith('rl:c:'));
}

console.log('\n=== salt ต่างกัน -> key ต่างกัน (ย้อนกลับไม่ได้) ===');
{
  const a = fakeUpstash([1, 1]);
  const b = fakeUpstash([1, 1]);
  await checkRateLimit({ userId: 'u1', channelId: 'c1', env: ENV, fetchImpl: a });
  await checkRateLimit({ userId: 'u1', channelId: 'c1', env: { ...ENV, RATE_LIMIT_SALT: 'salt-b' }, fetchImpl: b });
  check('key ไม่เหมือนกัน', a.calls[0].body[0][1] !== b.calls[0].body[0][1]);
}

console.log('\n=== คนเดียวส่งเกินลิมิต -> บล็อก และห้ามแตะตัวนับห้อง ===');
{
  const impl = fakeUpstash([RATE_LIMIT.perUser + 1]);
  const res = await checkRateLimit({ userId: 'u1', channelId: 'c1', env: ENV, fetchImpl: impl });
  check('ถูกบล็อก', res.allowed === false);
  check('ระบุว่าเป็นลิมิตของคน', res.scope === 'user', res.scope);
  check('ไม่ไปนับตัวนับห้อง (คนสแปมต้องไม่กินโควตาคนอื่น)', impl.calls.length === 1, String(impl.calls.length));
  check('บอกเวลารอเป็นวินาที', res.retryAfter >= 1 && res.retryAfter <= RATE_LIMIT.windowSeconds, String(res.retryAfter));
}

console.log('\n=== ห้องนั้นถูกใช้เกินลิมิต -> บล็อกที่ระดับห้อง ===');
{
  const impl = fakeUpstash([1, RATE_LIMIT.perChannel + 1]);
  const res = await checkRateLimit({ userId: 'u1', channelId: 'c1', env: ENV, fetchImpl: impl });
  check('ถูกบล็อก', res.allowed === false);
  check('ระบุว่าเป็นลิมิตของห้อง', res.scope === 'channel', res.scope);
}

console.log('\n=== ที่ลิมิตพอดี ยังส่งได้ ===');
{
  const impl = fakeUpstash([RATE_LIMIT.perUser, RATE_LIMIT.perChannel]);
  const res = await checkRateLimit({ userId: 'u1', channelId: 'c1', env: ENV, fetchImpl: impl });
  check(`ครั้งที่ ${RATE_LIMIT.perUser} ยังผ่าน`, res.allowed === true);
}

console.log('\n=== Redis ล่ม -> ปล่อยผ่าน ไม่ทำให้บอทตาย ===');
{
  const res = await checkRateLimit({
    userId: 'u1',
    channelId: 'c1',
    env: ENV,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  check('ปล่อยผ่าน', res.allowed === true);
  check('ระบุว่าเกิด error', res.skipped === 'error', res.skipped);
}

console.log('\n=== Redis ตอบ 500 -> ปล่อยผ่าน ===');
{
  const res = await checkRateLimit({
    userId: 'u1',
    channelId: 'c1',
    env: ENV,
    fetchImpl: async () => new Response('boom', { status: 500 }),
  });
  check('ปล่อยผ่าน', res.allowed === true);
  check('ระบุว่าเกิด error', res.skipped === 'error');
}

console.log('\n=== Redis ตอบกลับเป็น error object -> ปล่อยผ่าน ===');
{
  const res = await checkRateLimit({
    userId: 'u1',
    channelId: 'c1',
    env: ENV,
    fetchImpl: async () => new Response(JSON.stringify([{ error: 'ERR bad' }]), { status: 200 }),
  });
  check('ปล่อยผ่าน', res.allowed === true);
  check('ระบุว่าเกิด error', res.skipped === 'error');
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
