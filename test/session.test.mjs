import { createHmac } from 'node:crypto';
import { clearCookie, readCookie, sessionCookie, signSession, verifySession } from '../lib/session.js';

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
  const header = sessionCookie('abc');
  check('เป็น HttpOnly', header.includes('HttpOnly'));
  check('เป็น Secure', header.includes('Secure'));
  check('SameSite=Lax', header.includes('SameSite=Lax'));
  check('มีอายุ 7 วัน', header.includes('Max-Age=604800'), header);
  check('clearCookie ตั้งอายุเป็น 0', clearCookie().includes('Max-Age=0'));
}

console.log('\n=== อ่าน cookie จาก request ===');
{
  const req = new Request('https://x.test', { headers: { cookie: 'a=1; anomsg_session=xyz; b=2' } });
  check('อ่านค่าที่ต้องการได้', readCookie(req, 'anomsg_session') === 'xyz');
  check('ไม่มี cookie คืน null', readCookie(new Request('https://x.test'), 'anomsg_session') === null);
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
  // Sign with valid secret, then verify with short secret
  const validToken = signSession({ uid: '123', name: 'x', gid: 'g1' }, SECRET);
  check('verifySession ปฏิเสธ short secret', verifySession(validToken, 'short') === null);
}

console.log('\n=== payload ที่ขาด uid/name/gid ต้องไม่ผ่าน ===');
{
  const validExp = Math.floor(Date.now() / 1000) + 3600;
  check('payload ขาด uid ต้องไม่ผ่าน', verifySession(makeToken({ name: 'x', gid: 'g1', exp: validExp }), SECRET) === null);
  check('payload ขาด name ต้องไม่ผ่าน', verifySession(makeToken({ uid: '1', gid: 'g1', exp: validExp }), SECRET) === null);
  check('payload ขาด gid ต้องไม่ผ่าน', verifySession(makeToken({ uid: '1', name: 'x', exp: validExp }), SECRET) === null);
  check('payload uid ว่าง ต้องไม่ผ่าน', verifySession(makeToken({ uid: '', name: 'x', gid: 'g1', exp: validExp }), SECRET) === null);
}

console.log('\n=== exp เป็น Infinity ต้องไม่ผ่าน ===');
{
  // JSON.stringify(Infinity) becomes null, so encode literal 1e999 as raw JSON text
  const rawJson = '{"uid":"1","name":"x","gid":"g1","exp":1e999}';
  const p = Buffer.from(rawJson).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(p).digest('base64url');
  check('exp = 1e999 (Infinity) ต้องไม่ผ่าน', verifySession(`${p}.${sig}`, SECRET) === null);
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
  const req = new Request('https://x.test', { headers: { cookie: 'anomsg_session=first; anomsg_session=second' } });
  check('cookie ซ้ำต้องคืน null', readCookie(req, 'anomsg_session') === null);
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
