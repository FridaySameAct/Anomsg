import { context, errorResponse, jsonNoStore, parseJsonBody, requireFound } from '../lib/api-helpers.js';
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

// context() คือการ์ดกลางที่ api/tasks.js และ api/tasks/me.js เรียกใช้ร่วมกัน (ไม่มีสำเนาแยกไฟล์แล้ว)
// อ่านแค่ env กับ session cookie ไม่แตะ DB เลย จึงเทสต์ตรงๆ ได้ทันทีโดยไม่มีความเสี่ยงเรื่อง network หรือ
// ต้องรอ mongoose.connect() timeout (~30 วินาที) เหมือนถ้าทดสอบผ่าน route เต็มรูปแบบ
console.log('\n=== context(): เทสต์การ์ดกลางตรงๆ โดยไม่ผ่าน route (เร็ว ไม่มี network) ===');
{
  process.env.MONGODB_URI = 'mongodb://fake';
  process.env.SESSION_SECRET = 'test-secret';

  const noCookie = new Request('https://x.test/api/tasks');
  const noSession = context(noCookie);
  check('ไม่มี session -> error 401', noSession.error?.status === 401);
  check('ไม่มี session -> ไม่คืน session ให้ route เดินต่อ', noSession.session === undefined);

  delete process.env.MONGODB_URI;
  const disabled = context(noCookie);
  check('ปิดระบบ task -> error 503', disabled.error?.status === 503);
}

console.log('\n=== jsonNoStore: ทุก JSON response ของ task ต้องมี Cache-Control: no-store ===');
{
  // ข้อมูล task ผูกกับ guild เดียว ถ้า browser cache ไว้แล้วผู้ใช้สลับ guild อาจเห็นข้อมูล guild เก่าค้าง
  const res = jsonNoStore({ ok: true });
  check('มี Cache-Control: no-store', res.headers.get('Cache-Control') === 'no-store');
}

console.log('\n=== parseJsonBody: body ต้องเป็น object เท่านั้น ไม่งั้น service จะพัง TypeError แล้วหลุดเป็น 500 ===');
{
  const okReq = new Request('https://x.test/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ name: 'ทำความสะอาด' }),
  });
  const okBody = await parseJsonBody(okReq);
  check('object ปกติ -> ผ่าน', okBody.name === 'ทำความสะอาด');

  const nullReq = new Request('https://x.test/api/tasks', { method: 'POST', body: 'null' });
  try {
    await parseJsonBody(nullReq);
    check('body เป็น null -> โยน ValidationError', false, 'ไม่ได้โยน');
  } catch (err) {
    check('body เป็น null -> โยน ValidationError', err instanceof ValidationError);
  }

  const malformedReq = new Request('https://x.test/api/tasks', { method: 'POST', body: '{not valid json' });
  try {
    await parseJsonBody(malformedReq);
    check('JSON พังรูปแบบ -> โยน ValidationError', false, 'ไม่ได้โยน');
  } catch (err) {
    check('JSON พังรูปแบบ -> โยน ValidationError', err instanceof ValidationError);
  }
}

console.log('\n=== requireFound: PATCH ต้องไม่ตอบ 200 body null เมื่อ task หายระหว่าง race กับ DELETE ===');
{
  const task = { id: 't1', name: 'x' };
  check('task ปกติ -> คืนค่าเดิม', requireFound(task) === task);

  try {
    requireFound(null);
    check('null -> โยน NotFoundError', false, 'ไม่ได้โยน');
  } catch (err) {
    check('null -> โยน NotFoundError', err instanceof NotFoundError);
  }
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
