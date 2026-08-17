import { createHmac } from 'node:crypto';
import {
  SESSION_COOKIE, STATE_COOKIE, clearCookie, clearStateCookie,
  readCookie, sessionCookie, signSession, verifySession,
} from '../lib/session.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

const SECRET = '0'.repeat(32); // 32 chars minimum

function makeToken(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(p).digest('base64url');
  return `${p}.${sig}`;
}

console.log('\n=== เซ็นแล้วตรวจกลับได้ ===');
{
  const token = signSession({ uid: '123', name: 'somchai', gid: 'g1' }, SECRET);
  const data = verifySession(token, SECRET);
  check('อ่าน uid กลับมาได้', data?.uid === '123');
  check('อ่าน guild กลับมาได้', data?.gid === 'g1');
  check('มีวันหมดอายุ', typeof data?.exp === 'number');
}

console.log('\n=== แก้ payload แล้วต้องไม่ผ่าน ===');
{
  const token = signSession({ uid: '123', name: 'somchai', gid: 'g1' }, SECRET);
  const [payload, sig] = token.split('.');
  const evil = Buffer.from(JSON.stringify({ uid: '999', name: 'hacker', gid: 'g1', exp: 9e12 }))
    .toString('base64url');
  check('payload ปลอมต้องไม่ผ่าน', verifySession(`${evil}.${sig}`, SECRET) === null);
  check('ลายเซ็นมั่วต้องไม่ผ่าน', verifySession(`${payload}.deadbeef`, SECRET) === null);
  check('secret คนละตัวต้องไม่ผ่าน', verifySession(token, '1'.repeat(32)) === null);
  check('ค่าเพี้ยนต้องไม่ crash', verifySession('ขยะ', SECRET) === null);
  check('ค่าว่างต้องไม่ผ่าน', verifySession('', SECRET) === null);
}

console.log('\n=== หมดอายุแล้วต้องไม่ผ่าน ===');
{
  const expired = signSession({ uid: '1', name: 'x', gid: 'g1' }, SECRET, -1000);
  check('token หมดอายุต้องไม่ผ่าน', verifySession(expired, SECRET) === null);
}

console.log('\n=== รูปแบบ cookie ===');
{
  // __Host- คือด่านสำคัญ: กัน sibling-subdomain (เช่น *.vercel.app ตัวอื่น) ยัด cookie ชื่อเดียวกันมา
  // ทับของจริงในเบราว์เซอร์ของเหยื่อได้ — browser ยอมรับ __Host- ก็ต่อเมื่อมี Secure + Path=/ + ไม่มี
  // Domain เท่านั้น เทสต์นี้จึง pin ทั้งชื่อ cookie และแอตทริบิวต์ที่ __Host- บังคับพร้อมกัน
  check('ชื่อ cookie มี __Host- prefix', SESSION_COOKIE === '__Host-anomsg_session', SESSION_COOKIE);
  const header = sessionCookie('abc');
  check('ขึ้นต้นด้วยชื่อ __Host- ที่ถูกต้อง', header.startsWith(`${SESSION_COOKIE}=`), header);
  check('เป็น HttpOnly', header.includes('HttpOnly'));
  check('เป็น Secure', header.includes('Secure'));
  check('SameSite=Lax', header.includes('SameSite=Lax'));
  check('Path=/ (ข้อบังคับของ __Host-)', header.includes('Path=/'), header);
  check('ไม่มี Domain (ข้อบังคับของ __Host-)', !header.includes('Domain='), header);
  check('มีอายุ 7 วัน', header.includes('Max-Age=604800'), header);
  check('clearCookie ตั้งอายุเป็น 0', clearCookie().includes('Max-Age=0'));
  check('clearCookie ใช้ชื่อ __Host- เดียวกับ sessionCookie', clearCookie().startsWith(`${SESSION_COOKIE}=`));
}

console.log('\n=== state cookie (ย้ายมารวมกับ session cookie ที่นี่ กันก็อปปี้แยก login/callback/logout) ===');
{
  check('ชื่อ cookie มี __Host- prefix', STATE_COOKIE === '__Host-anomsg_oauth', STATE_COOKIE);
  const header = clearStateCookie();
  check('clearStateCookie ใช้ชื่อ __Host- ที่ถูกต้อง', header.startsWith(`${STATE_COOKIE}=`), header);
  check('clearStateCookie ตั้งอายุเป็น 0', header.includes('Max-Age=0'), header);
  check('clearStateCookie ยังคง Path=/ (ข้อบังคับของ __Host-)', header.includes('Path=/'), header);
  check('clearStateCookie ไม่มี Domain (ข้อบังคับของ __Host-)', !header.includes('Domain='), header);
}

console.log('\n=== อ่าน cookie จาก request ===');
{
  const req = new Request('https://x.test', { headers: { cookie: `a=1; ${SESSION_COOKIE}=xyz; b=2` } });
  check('อ่านค่าที่ต้องการได้', readCookie(req, SESSION_COOKIE) === 'xyz');
  check('ไม่มี cookie คืน null', readCookie(new Request('https://x.test'), SESSION_COOKIE) === null);
}

console.log('\n=== secret ว่างต้องถูกปฏิเสธ ===');
{
  try {
    signSession({ uid: '123', name: 'x', gid: 'g1' }, '');
    check('signSession ปฏิเสธ secret ว่าง', false);
  } catch {
    check('signSession ปฏิเสธ secret ว่าง', true);
  }
  check('verifySession ปฏิเสธ secret ว่าง', verifySession('token', '') === null);
}

console.log('\n=== secret สั้นเกินไป (< 32) ต้องถูกปฏิเสธ ===');
{
  try {
    signSession({ uid: '123', name: 'x', gid: 'g1' }, 'short');
    check('signSession ปฏิเสธ short secret', false);
  } catch {
    check('signSession ปฏิเสธ short secret', true);
  }
  // สำคัญ: ถ้าเซ็นด้วย SECRET (ยาวพอ) แล้วตรวจด้วย secret สั้น ลายเซ็นจะไม่ตรงอยู่แล้ว
  // ทำให้ timingSafeEqual ปฏิเสธไปก่อน guard ความยาว secret จะได้ทำงาน — เทสต์แบบนั้นไม่ pin guard จริง
  // ต้องจำลองผู้โจมตี: ปลอม token ด้วย secret สั้นตัวเดียวกันทั้งสองฝั่ง (เซ็นและตรวจ)
  // ลายเซ็นจะ "ตรง" เป๊ะ มีแต่ guard ความยาว secret เท่านั้นที่ปฏิเสธได้
  const SHORT_SECRET = 'short';
  const forgedPayload = Buffer.from(JSON.stringify({ uid: 'attacker', name: 'evil', gid: 'g1', exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url');
  const forgedSig = createHmac('sha256', SHORT_SECRET).update(forgedPayload).digest('base64url');
  const forgedToken = `${forgedPayload}.${forgedSig}`;
  check('verifySession ปฏิเสธ short secret แม้ลายเซ็นตรง', verifySession(forgedToken, SHORT_SECRET) === null);
}

console.log('\n=== payload ที่ขาด uid/name/gid ต้องไม่ผ่าน ===');
{
  const validExp = Math.floor(Date.now() / 1000) + 3600;
  check('payload ขาด uid ต้องไม่ผ่าน', verifySession(makeToken({ name: 'x', gid: 'g1', exp: validExp }), SECRET) === null);
  check('payload ขาด name ต้องไม่ผ่าน', verifySession(makeToken({ uid: '1', gid: 'g1', exp: validExp }), SECRET) === null);
  check('payload ขาด gid ต้องไม่ผ่าน', verifySession(makeToken({ uid: '1', name: 'x', exp: validExp }), SECRET) === null);
  check('payload uid ว่าง ต้องไม่ผ่าน', verifySession(makeToken({ uid: '', name: 'x', gid: 'g1', exp: validExp }), SECRET) === null);
}

console.log('\n=== exp ที่ไม่ใช่ตัวเลขจำกัด ต้องไม่ผ่าน ===');
{
  // exp = 1e999 กลายเป็น Infinity ตอน JSON.parse แต่ก็ยังโดน bound check (exp > now+MAX+60) จับอยู่ดี
  // เพราะ Infinity > ตัวเลขจำกัดใดๆ เป็น true เสมอ — เทสต์นี้ยังต้องผ่านเพื่อกันการถดถอย (defense-in-depth)
  // แต่ "ไม่ได้" พิสูจน์ว่า Number.isFinite ทำงานจริง เพราะลบ Number.isFinite ออกเทสต์นี้ก็ยังผ่าน
  const rawJson = '{"uid":"1","name":"x","gid":"g1","exp":1e999}';
  const p = Buffer.from(rawJson).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(p).digest('base64url');
  check('exp = 1e999 (Infinity) ต้องไม่ผ่าน', verifySession(`${p}.${sig}`, SECRET) === null);

  // เทสต์ที่ pin Number.isFinite จริง: exp เป็นสตริงที่ไม่ใช่ตัวเลข (เช่น "abc")
  // การเทียบ 'abc' < now และ 'abc' > (now+MAX+60) ทั้งคู่ได้ false (JS แปลง 'abc' เป็น NaN แล้ว NaN
  // เทียบกับอะไรก็ false เสมอ) จึงหลุด bound check ไปได้ทั้งสองข้าง — มีแต่ Number.isFinite เท่านั้น
  // ที่จับได้ ไม่มีทาง encode NaN ผ่าน JSON ได้ตรงๆ (ไม่ใช่ syntax ที่ JSON รองรับ) สตริงจึงเป็นทางเดียว
  // ที่จะสร้าง input จริงที่หลบ bound check แต่โดน Number.isFinite จับ
  const nonNumericExp = Buffer.from(JSON.stringify({ uid: '1', name: 'x', gid: 'g1', exp: 'abc' })).toString('base64url');
  const nonNumericSig = createHmac('sha256', SECRET).update(nonNumericExp).digest('base64url');
  check('exp เป็นสตริงไม่ใช่ตัวเลข ต้องไม่ผ่าน', verifySession(`${nonNumericExp}.${nonNumericSig}`, SECRET) === null);
}

console.log('\n=== exp เกินกว่า max age ต้องไม่ผ่าน ===');
{
  const futureExp = Math.floor(Date.now() / 1000) + (8 * 24 * 60 * 60);
  const p = Buffer.from(JSON.stringify({ uid: '1', name: 'x', gid: 'g1', exp: futureExp })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(p).digest('base64url');
  check('exp เกินกว่า 7 วัน ต้องไม่ผ่าน', verifySession(`${p}.${sig}`, SECRET) === null);
}

console.log('\n=== token ที่มีส่วน 3 ส่วนขึ้นไป ต้องไม่ผ่าน ===');
{
  const token = signSession({ uid: '123', name: 'x', gid: 'g1' }, SECRET);
  check('token + .junk ต้องไม่ผ่าน', verifySession(token + '.junk', SECRET) === null);
}

console.log('\n=== cookie ซ้ำต้องไม่ผ่าน ===');
{
  const req = new Request('https://x.test', { headers: { cookie: `${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second` } });
  check('cookie ซ้ำต้องคืน null', readCookie(req, SESSION_COOKIE) === null);
}

console.log('\n=== sessionCookie ต้องปฏิเสธค่า invalid ===');
{
  try {
    sessionCookie('abc;def');
    check('sessionCookie ปฏิเสธ ; ในค่า', false);
  } catch {
    check('sessionCookie ปฏิเสธ ; ในค่า', true);
  }
  try {
    sessionCookie('abc\r\ndef');
    check('sessionCookie ปฏิเสธ CR/LF ในค่า', false);
  } catch {
    check('sessionCookie ปฏิเสธ CR/LF ในค่า', true);
  }
  try {
    sessionCookie('abc,def');
    check('sessionCookie ปฏิเสธ comma ในค่า', false);
  } catch {
    check('sessionCookie ปฏิเสธ comma ในค่า', true);
  }
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
