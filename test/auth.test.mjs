import { completeLogin } from '../lib/oauth.js';
import { ForbiddenError } from '../lib/errors.js';
import { SESSION_COOKIE, sessionCookie, signSession } from '../lib/session.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

// ต้องตรงกับชื่อ cookie จริงใน api/auth/login.js, api/auth/callback.js, api/auth/logout.js
const STATE_COOKIE = '__Host-anomsg_oauth';

const ENV = {
  DISCORD_CLIENT_ID: 'app-1',
  DISCORD_CLIENT_SECRET: 'secret-1',
  PUBLIC_BASE_URL: 'https://anomsg.test',
};

// guild id แบบ snowflake จริง (17-20 หลัก) ใช้ตอนต้องผ่าน guard รูปแบบใน callback.js
const GUILD = '123456789012345678';

// จำลอง Discord: token -> identity -> guild list
// หมายเหตุ: ต้องตัด query string ก่อนเทียบด้วย endsWith เพราะ getJson ต่อ ?limit=200 เข้าไปที่ path ของ
// guilds แล้ว (ดู lib/oauth.js) ถ้าเทียบทั้ง URL ตรงๆ mock นี้จะไม่แมตช์ endpoint นั้นอีกต่อไป
function fakeDiscord({ guildIds = ['g1'] } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const path = String(url).split('?')[0];
    if (path.endsWith('/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'tok-1' }), { status: 200 });
    }
    if (path.endsWith('/users/@me')) {
      return new Response(JSON.stringify({ id: 'u1', username: 'somchai' }), { status: 200 });
    }
    if (path.endsWith('/users/@me/guilds')) {
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
  // ด่านตรวจสิทธิ์ทั้งระบบพึ่ง guild list หน้าเดียวว่าครบ — ต้องขอ limit=200 เสมอ (ดูเหตุผลเต็มใน lib/oauth.js)
  check('ขอรายชื่อ guild ด้วย limit=200 เพื่อให้ได้หน้าเดียวครบเสมอ',
    impl.calls.some((c) => c.url.includes('/users/@me/guilds') && c.url.includes('limit=200')));
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

console.log('\n=== lib/oauth.js: upstream ตอบ 200 แต่ body ไม่ใช่ JSON -> ห้าม log body ดิบ ===');
{
  // ตอบ 200 (res.ok = true) แต่เป็น HTML ไม่ใช่ JSON — จำลองกรณี edge/proxy ของ Discord ตอบ error page มาแทน
  const impl = async (url) => (String(url).endsWith('/oauth2/token')
    ? new Response('<html><body>upstream error page, ควรไม่หลุดไป log</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
    : new Response('{}', { status: 200 }));
  try {
    await completeLogin({ code: 'c1', guildId: 'g1', env: ENV, fetchImpl: impl });
    check('ต้องโยน error', false, 'ไม่ได้โยน');
  } catch (err) {
    check('ต้องโยน error', err instanceof Error);
    // JSON.parse ของ V8 ฝัง snippet ของ input ดิบไว้ในข้อความ error (เช่น "<html>...") ถ้าปล่อยให้ error
    // นั้นหลุดไปที่ console.error ตรงๆ จะกลายเป็นจุดเดียวที่ raw body จาก Discord รั่วไปที่ log
    check('ข้อความ error ไม่มี body ดิบของ upstream หลุดออกมา', !err.message.includes('<html'), err.message);
    check('ข้อความ error บอกบริบทที่เป็นประโยชน์แทน (สถานะ)', /invalid JSON/i.test(err.message), err.message);
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

  const good = loginGET(new Request(`https://anomsg.test/api/auth/login?guild=${GUILD}`));
  check('guild ถูกต้อง -> 302', good.status === 302);
  check('redirect ไปหน้า Discord authorize', good.headers.get('location')?.startsWith('https://discord.com/oauth2/authorize?'));
  check('ตั้ง state cookie แบบ __Host- ไว้เทียบตอน callback', good.headers.get('set-cookie')?.includes(`${STATE_COOKIE}=`));
}

console.log('\n=== callback.js: ต้องเช็ค state กับ cookie ก่อนแตะ Discord (กัน CSRF) และเคลียร์ cookie ทุกทางที่ล้ม ===');
{
  const noState = await callbackGET(new Request('https://anomsg.test/api/auth/callback?code=c1'));
  check('ไม่มี state -> 400', noState.status === 400);
  check('เคลียร์ state cookie แม้ไม่มี state',
    (noState.headers.getSetCookie?.() ?? []).some((h) => h.startsWith(`${STATE_COOKIE}=`) && h.includes('Max-Age=0')));

  const noCode = await callbackGET(new Request(`https://anomsg.test/api/auth/callback?state=s1.${GUILD}`, {
    headers: { cookie: `${STATE_COOKIE}=s1.${GUILD}` },
  }));
  check('ไม่มี code -> 400', noCode.status === 400);
  check('เคลียร์ state cookie แม้ไม่มี code',
    (noCode.headers.getSetCookie?.() ?? []).some((h) => h.startsWith(`${STATE_COOKIE}=`) && h.includes('Max-Age=0')));

  const mismatched = await callbackGET(new Request(`https://anomsg.test/api/auth/callback?code=c1&state=attacker.${GUILD}`, {
    headers: { cookie: `${STATE_COOKIE}=real.${GUILD}` },
  }));
  check('state ไม่ตรงกับ cookie -> 400', mismatched.status === 400);
  check('เคลียร์ state cookie แม้ state ไม่ตรง',
    (mismatched.headers.getSetCookie?.() ?? []).some((h) => h.startsWith(`${STATE_COOKIE}=`) && h.includes('Max-Age=0')));
}

console.log('\n=== callback.js: guildId ที่ฝังใน state ต้องเป็น snowflake ที่ถูกรูปแบบ แม้ state จะตรงกับ cookie เป๊ะ ===');
{
  // จำลองการโจมตี session fixation ผ่าน sibling-subdomain: state ตรงกับ cookie เป๊ะ (ผ่าน CSRF check)
  // แต่ guild id ที่ฝังอยู่ข้างในผิดรูปแบบ ต้องไม่เชื่อมันแค่เพราะ string ตรงกัน ต้องเช็คซ้ำเหมือนตอน login
  const originalFetch = globalThis.fetch;
  // ตั้ง mock ไว้เผื่อ guard หายแล้วโค้ดพยายามเดินหน้าไปคุย Discord ต่อ จะได้ไม่ใช่การยิงเน็ตจริง
  globalThis.fetch = fakeDiscord({ guildIds: ['not-a-guild-id'] });
  try {
    const evilState = 'abc.not-a-guild-id';
    const res = await callbackGET(new Request(`https://anomsg.test/api/auth/callback?code=c1&state=${evilState}`, {
      headers: { cookie: `${STATE_COOKIE}=${evilState}` },
    }));
    check('guildId ผิดรูปแบบใน state -> 400', res.status === 400, res.status);
    check('เคลียร์ state cookie แม้ guildId ผิดรูปแบบ',
      (res.headers.getSetCookie?.() ?? []).some((h) => h.startsWith(`${STATE_COOKIE}=`) && h.includes('Max-Age=0')));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('\n=== callback.js: guild ที่ผู้ใช้ไม่ได้อยู่ -> 403 ไม่ตั้ง session cookie แต่เคลียร์ state cookie ===');
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeDiscord({ guildIds: ['g-other'] });
  try {
    const res = await callbackGET(new Request(`https://anomsg.test/api/auth/callback?code=c1&state=s1.${GUILD}`, {
      headers: { cookie: `${STATE_COOKIE}=s1.${GUILD}` },
    }));
    const setCookies = res.headers.getSetCookie?.() ?? [];
    check('ไม่ได้อยู่ guild -> 403', res.status === 403);
    check('ไม่ตั้ง anomsg_session cookie', !setCookies.some((h) => h.startsWith(`${SESSION_COOKIE}=`)));
    check('เคลียร์ state cookie เมื่อ 403', setCookies.some((h) => h.startsWith(`${STATE_COOKIE}=`) && h.includes('Max-Age=0')));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('\n=== callback.js: SESSION_SECRET ตั้งค่าไม่ครบ/สั้นเกิน -> 500 ต้องไม่หลุดเป็น session ปลอม แต่ยังเคลียร์ state cookie ===');
{
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.SESSION_SECRET;
  globalThis.fetch = fakeDiscord({ guildIds: [GUILD] });
  process.env.SESSION_SECRET = 'short'; // < 32 ตัวอักษร ทำให้ signSession โยน
  try {
    const res = await callbackGET(new Request(`https://anomsg.test/api/auth/callback?code=c1&state=s1.${GUILD}`, {
      headers: { cookie: `${STATE_COOKIE}=s1.${GUILD}` },
    }));
    const setCookies = res.headers.getSetCookie?.() ?? [];
    check('SESSION_SECRET สั้นเกินไป -> 500 ไม่ใช่ 200/302', res.status === 500);
    check('ไม่มี session cookie หลุดออกมา', !setCookies.some((h) => h.startsWith(`${SESSION_COOKIE}=`)));
    check('เคลียร์ state cookie เมื่อ 500', setCookies.some((h) => h.startsWith(`${STATE_COOKIE}=`) && h.includes('Max-Age=0')));
  } finally {
    globalThis.fetch = originalFetch;
    process.env.SESSION_SECRET = originalSecret;
  }
}

console.log('\n=== callback.js: ล็อกอินสำเร็จ -> redirect เป็น path ภายในเท่านั้น (กัน open redirect) ===');
{
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = '0'.repeat(32);
  globalThis.fetch = fakeDiscord({ guildIds: [GUILD] });
  try {
    const res = await callbackGET(new Request(`https://anomsg.test/api/auth/callback?code=c1&state=s1.${GUILD}`, {
      headers: { cookie: `${STATE_COOKIE}=s1.${GUILD}` },
    }));
    const location = res.headers.get('location') ?? '';
    check('ล็อกอินสำเร็จ -> 302', res.status === 302);
    check('redirect เป็น path สัมพัทธ์ที่ขึ้นต้นด้วย / เท่านั้น', location.startsWith('/') && !location.startsWith('//'));
    check('ไม่มี host แปลกปลอมใน redirect', !/^https?:/i.test(location));
    const setCookies = res.headers.getSetCookie?.() ?? [];
    check('ตั้ง session cookie', setCookies.some((h) => h.startsWith(`${SESSION_COOKIE}=`)));
    check('ล้าง state cookie', setCookies.some((h) => h.startsWith(`${STATE_COOKIE}=`) && h.includes('Max-Age=0')));
  } finally {
    globalThis.fetch = originalFetch;
    process.env.SESSION_SECRET = originalSecret;
  }
}

console.log('\n=== logout.js: POST -> 204 พร้อมล้างทั้ง session cookie และ state cookie ===');
{
  const res = logoutPOST();
  const setCookies = res.headers.getSetCookie?.() ?? [];
  check('logout คืน 204', res.status === 204);
  check('logout ล้าง session cookie', setCookies.some((h) => h.startsWith(`${SESSION_COOKIE}=`) && h.includes('Max-Age=0')));
  check('logout ล้าง state cookie ด้วย (เผื่อ oauth flow ค้างไว้ไม่จบ)',
    setCookies.some((h) => h.startsWith(`${STATE_COOKIE}=`) && h.includes('Max-Age=0')));
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
