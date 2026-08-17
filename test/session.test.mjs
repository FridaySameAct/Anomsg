import { clearCookie, readCookie, sessionCookie, signSession, verifySession } from '../lib/session.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

const SECRET = 'test-secret';

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
  check('secret คนละตัวต้องไม่ผ่าน', verifySession(token, 'other-secret') === null);
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

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
