import { completeLogin } from '../lib/oauth.js';
import { ForbiddenError } from '../lib/errors.js';
import { SESSION_COOKIE, sessionCookie, signSession } from '../lib/session.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

const ENV = {
  DISCORD_CLIENT_ID: 'app-1',
  DISCORD_CLIENT_SECRET: 'secret-1',
  PUBLIC_BASE_URL: 'https://anomsg.test',
};

// จำลอง Discord: token -> identity -> guild list
function fakeDiscord({ guildIds = ['g1'] } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'tok-1' }), { status: 200 });
    }
    if (String(url).endsWith('/users/@me')) {
      return new Response(JSON.stringify({ id: 'u1', username: 'somchai' }), { status: 200 });
    }
    if (String(url).endsWith('/users/@me/guilds')) {
      return new Response(JSON.stringify(guildIds.map((id) => ({ id }))), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  impl.calls = calls;
  return impl;
}

console.log('\n=== ล็อกอินสำเร็จเมื่ออยู่ในเซิร์ฟเวอร์จริง ===');
{
  const impl = fakeDiscord({ guildIds: ['g1', 'g2'] });
  const session = await completeLogin({ code: 'c1', guildId: 'g1', env: ENV, fetchImpl: impl });
  check('ได้ uid', session.uid === 'u1');
  check('ได้ชื่อ', session.name === 'somchai');
  check('ผูกกับ guild ที่ขอ', session.gid === 'g1');
  // หมายเหตุ: ต้อง stringify body ด้วย String() ไม่ใช่ JSON.stringify() เพราะ exchangeCode ส่ง body เป็น
  // URLSearchParams ซึ่งไม่มี property แบบ enumerable ให้ JSON.stringify มองเห็น (ได้ "{}" เสมอ) ทำให้เช็คแบบ
  // JSON.stringify(c.init).includes(...) ล้มเหลวเสมอไม่ว่าโค้ดจะถูกหรือผิด — ไม่ได้ pin อะไรเลย
  check('ไม่ส่ง client secret ไปที่อื่นนอกจาก token endpoint',
    impl.calls.filter((c) => `${String(c.init?.body ?? '')} ${JSON.stringify(c.init?.headers ?? {})}`.includes('secret-1')).length === 1);
}

console.log('\n=== ไม่ได้อยู่ในเซิร์ฟเวอร์ -> ต้องปฏิเสธ ===');
{
  const impl = fakeDiscord({ guildIds: ['g-other'] });
  try {
    await completeLogin({ code: 'c1', guildId: 'g1', env: ENV, fetchImpl: impl });
    check('ต้องโยน ForbiddenError', false, 'ไม่ได้โยน');
  } catch (err) {
    check('ต้องโยน ForbiddenError', err instanceof ForbiddenError, err.constructor.name);
  }
}

console.log('\n=== Discord ปฏิเสธ code -> ต้องไม่สร้าง session ===');
{
  const impl = async (url) => (String(url).endsWith('/oauth2/token')
    ? new Response('{"error":"invalid_grant"}', { status: 400 })
    : new Response('{}', { status: 200 }));
  try {
    await completeLogin({ code: 'bad', guildId: 'g1', env: ENV, fetchImpl: impl });
    check('ต้องโยน error', false, 'ไม่ได้โยน');
  } catch (err) {
    check('ต้องโยน error', err instanceof Error);
    // เช็คแค่ err instanceof Error ไม่พอ: ถ้าเอา guard !res.ok ออกจาก exchangeCode, access_token จะเป็น
    // undefined แล้วโค้ดพัง (crash) ที่ guilds.some (เพราะ mock คืน "{}" ให้ endpoint อื่นด้วย) ซึ่งก็เป็น
    // Error เหมือนกัน ทำให้เทสต์ผ่านโดยบังเอิญไม่ได้ pin guard ตัวจริง จึงต้องเช็คข้อความที่ guard สร้างขึ้นตรงๆ
    check('ข้อความยืนยันว่า token exchange ล้มเหลว (ไม่ใช่ crash จากที่อื่นโดยบังเอิญ)',
      /token exchange failed/.test(err.message), err.message);
  }
}

// ---- ชั้น HTTP: api/auth/login.js, api/auth/callback.js, api/auth/logout.js, api/me.js ----
// ทดสอบตรงนี้ได้โดยไม่แตะเครือข่ายจริง เพราะ route อ่าน process.env ตอนถูกเรียก (ไม่ใช่ตอน import)
// จึงตั้งค่า env ปลอมก่อนเรียก handler ได้เสมอ ส่วนกรณีที่ route ต้องคุย Discord จริง (fetchImpl ของ
// completeLogin default เป็น global fetch เพราะ callback.js ไม่มีช่องให้ inject) จะสลับ globalThis.fetch
// เป็นตัวปลอมชั่วคราวแล้วคืนค่าเดิมทันทีหลังใช้ ไม่มีคำขอออกเน็ตจริงเกิดขึ้น

process.env.DISCORD_CLIENT_ID = ENV.DISCORD_CLIENT_ID;
process.env.DISCORD_CLIENT_SECRET = ENV.DISCORD_CLIENT_SECRET;
process.env.PUBLIC_BASE_URL = ENV.PUBLIC_BASE_URL;

const { GET: loginGET } = await import('../api/auth/login.js');
const { GET: callbackGET } = await import('../api/auth/callback.js');
const { POST: logoutPOST } = await import('../api/auth/logout.js');
const { GET: meGET } = await import('../api/me.js');

console.log('\n=== login.js: guild ต้องเป็นตัวเลข 17-20 หลัก ===');
{
  const bad1 = loginGET(new Request('https://anomsg.test/api/auth/login?guild=abc'));
  check('guild ไม่ใช่ตัวเลข -> 400', bad1.status === 400);

  const bad2 = loginGET(new Request('https://anomsg.test/api/auth/login'));
  check('ไม่มี guild เลย -> 400', bad2.status === 400);

  const good = loginGET(new Request('https://anomsg.test/api/auth/login?guild=123456789012345678'));
  check('guild ถูกต้อง -> 302', good.status === 302);
  check('redirect ไปหน้า Discord authorize', good.headers.get('location')?.startsWith('https://discord.com/oauth2/authorize?'));
  check('ตั้ง state cookie ไว้เทียบตอน callback', good.headers.get('set-cookie')?.includes('anomsg_oauth='));
}

console.log('\n=== callback.js: ต้องเช็ค state กับ cookie ก่อนแตะ Discord (กัน CSRF) ===');
{
  const noState = await callbackGET(new Request('https://anomsg.test/api/auth/callback?code=c1'));
  check('ไม่มี state -> 400', noState.status === 400);

  const noCode = await callbackGET(new Request('https://anomsg.test/api/auth/callback?state=s1.g1', {
    headers: { cookie: 'anomsg_oauth=s1.g1' },
  }));
  check('ไม่มี code -> 400', noCode.status === 400);

  const mismatched = await callbackGET(new Request('https://anomsg.test/api/auth/callback?code=c1&state=attacker.g1', {
    headers: { cookie: 'anomsg_oauth=real.g1' },
  }));
  check('state ไม่ตรงกับ cookie -> 400', mismatched.status === 400);
}

console.log('\n=== callback.js: guild ที่ผู้ใช้ไม่ได้อยู่ -> 403 ไม่ตั้ง session cookie ===');
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeDiscord({ guildIds: ['g-other'] });
  try {
    const res = await callbackGET(new Request('https://anomsg.test/api/auth/callback?code=c1&state=s1.g1', {
      headers: { cookie: 'anomsg_oauth=s1.g1' },
    }));
    check('ไม่ได้อยู่ guild -> 403', res.status === 403);
    check('ไม่ตั้ง anomsg_session cookie', !(res.headers.getSetCookie?.() ?? []).some((h) => h.startsWith(`${SESSION_COOKIE}=`)));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('\n=== callback.js: SESSION_SECRET ตั้งค่าไม่ครบ/สั้นเกิน -> 500 ต้องไม่หลุดเป็น session ปลอม ===');
{
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.SESSION_SECRET;
  globalThis.fetch = fakeDiscord({ guildIds: ['g1'] });
  process.env.SESSION_SECRET = 'short'; // < 32 ตัวอักษร ทำให้ signSession โยน
  try {
    const res = await callbackGET(new Request('https://anomsg.test/api/auth/callback?code=c1&state=s1.g1', {
      headers: { cookie: 'anomsg_oauth=s1.g1' },
    }));
    check('SESSION_SECRET สั้นเกินไป -> 500 ไม่ใช่ 200/302', res.status === 500);
    check('ไม่มี session cookie หลุดออกมา', !(res.headers.getSetCookie?.() ?? []).some((h) => h.startsWith(`${SESSION_COOKIE}=`)));
  } finally {
    globalThis.fetch = originalFetch;
    process.env.SESSION_SECRET = originalSecret;
  }
}

console.log('\n=== callback.js: ล็อกอินสำเร็จ -> redirect เป็น path ภายในเท่านั้น (กัน open redirect) ===');
{
  const originalFetch = globalThis.fetch;
  process.env.SESSION_SECRET = '0'.repeat(32);
  globalThis.fetch = fakeDiscord({ guildIds: ['g1'] });
  try {
    const res = await callbackGET(new Request('https://anomsg.test/api/auth/callback?code=c1&state=s1.g1', {
      headers: { cookie: 'anomsg_oauth=s1.g1' },
    }));
    const location = res.headers.get('location') ?? '';
    check('ล็อกอินสำเร็จ -> 302', res.status === 302);
    check('redirect เป็น path สัมพัทธ์ที่ขึ้นต้นด้วย / เท่านั้น', location.startsWith('/') && !location.startsWith('//'));
    check('ไม่มี host แปลกปลอมใน redirect', !/^https?:/i.test(location));
    const setCookies = res.headers.getSetCookie?.() ?? [];
    check('ตั้ง session cookie', setCookies.some((h) => h.startsWith(`${SESSION_COOKIE}=`)));
    check('ล้าง state cookie', setCookies.some((h) => h.startsWith('anomsg_oauth=') && h.includes('Max-Age=0')));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('\n=== logout.js: POST -> 204 พร้อมล้าง cookie ===');
{
  const res = logoutPOST();
  check('logout คืน 204', res.status === 204);
  check('logout ล้าง session cookie', res.headers.get('set-cookie')?.includes('Max-Age=0'));
}

console.log('\n=== api/me.js: ไม่มี session -> 401, มี session ที่เซ็นถูกต้อง -> คืนข้อมูล ===');
{
  process.env.SESSION_SECRET = '1'.repeat(32);
  const noCookieRes = meGET(new Request('https://anomsg.test/api/me'));
  check('ไม่มี cookie -> 401', noCookieRes.status === 401);

  const token = signSession({ uid: 'u1', name: 'somchai', gid: 'g1' }, process.env.SESSION_SECRET);
  const cookieHeader = sessionCookie(token).split(';')[0];
  const okRes = meGET(new Request('https://anomsg.test/api/me', { headers: { cookie: cookieHeader } }));
  const body = await okRes.json();
  check('มี session ถูกต้อง -> 200', okRes.status === 200);
  check('คืน uid ตรง', body.uid === 'u1');
  check('คืน gid ตรง', body.gid === 'g1');
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
