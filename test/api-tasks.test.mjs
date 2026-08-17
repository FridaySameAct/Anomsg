import { errorResponse } from '../lib/api-helpers.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

console.log('\n=== แปลง error เป็น HTTP ===');
{
  check('ValidationError -> 400', errorResponse(new ValidationError('x')).status === 400);
  check('ForbiddenError -> 403', errorResponse(new ForbiddenError('x')).status === 403);
  check('NotFoundError -> 404', errorResponse(new NotFoundError('x')).status === 404);
  check('error อื่น -> 500', errorResponse(new Error('boom')).status === 500);
}

console.log('\n=== ไม่ส่งรายละเอียดภายในออกไป ===');
{
  const res = errorResponse(new Error('connect ECONNREFUSED 10.0.0.1:27017'));
  const body = await res.json();
  check('ไม่มีข้อความ error ดิบหลุดออกไป', !body.error.includes('ECONNREFUSED'), body.error);
  check('ยังมีข้อความให้ผู้ใช้อ่าน', typeof body.error === 'string' && body.error.length > 0);
}

console.log('\n=== ข้อความของ error ที่ตั้งใจแสดง ต้องส่งถึงผู้ใช้ ===');
{
  const body = await errorResponse(new ValidationError('ชื่องานต้องยาว 1-200 ตัวอักษร')).json();
  check('ส่งข้อความ validation ตรงๆ', body.error.includes('1-200'), body.error);
}

// route ปฏิเสธก่อนแตะฐานข้อมูล จึงทดสอบได้โดยไม่ต้องมี MongoDB
console.log('\n=== route ต้องปฏิเสธก่อนแตะ DB ===');
{
  process.env.MONGODB_URI = 'mongodb://fake';
  process.env.SESSION_SECRET = 'test-secret';
  const tasks = await import('../api/tasks.js');

  const noCookie = new Request('https://x.test/api/tasks');
  check('ไม่มี session -> 401', (await tasks.GET(noCookie)).status === 401);

  // ใช้ค่าปลอมแบบ ASCII (ไม่ใช่ 'ปลอม.ปลอม' ตามร่างเดิม) เพราะ Headers ของ undici บังคับ ByteString
  // (Latin-1 เท่านั้น) ตัวอักษรไทยมี code point เกิน 255 ทำให้ new Request() throw ก่อนแตะโค้ดที่จะทดสอบเลย
  const badCookie = new Request('https://x.test/api/tasks', {
    headers: { cookie: 'anomsg_session=forged.forged' },
  });
  check('session ปลอม -> 401', (await tasks.GET(badCookie)).status === 401);
  check('POST ก็ต้องกัน', (await tasks.POST(noCookie)).status === 401);
  check('PATCH ก็ต้องกัน', (await tasks.PATCH(noCookie)).status === 401);
  check('DELETE ก็ต้องกัน', (await tasks.DELETE(noCookie)).status === 401);

  delete process.env.MONGODB_URI;
  check('ปิดระบบ task -> 503', (await tasks.GET(noCookie)).status === 503);
}

// api/tasks/me.js ไม่มีอยู่ใน route table ของ /api/tasks แต่ผ่าน context เดียวกัน (session + isTasksEnabled)
// ต้องกันเหมือนกันทุกประตู ไม่งั้นคนไม่ล็อกอินจะยิง /api/tasks/me ตรงๆ แล้วชน DB ได้ทั้งที่ /api/tasks กันไว้แล้ว
console.log('\n=== api/tasks/me.js ต้องปฏิเสธก่อนแตะ DB เหมือนกัน ===');
{
  process.env.MONGODB_URI = 'mongodb://fake';
  process.env.SESSION_SECRET = 'test-secret';
  const me = await import('../api/tasks/me.js');

  const noCookie = new Request('https://x.test/api/tasks/me');
  check('ไม่มี session -> 401', (await me.GET(noCookie)).status === 401);

  delete process.env.MONGODB_URI;
  check('ปิดระบบ task -> 503', (await me.GET(noCookie)).status === 503);
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
