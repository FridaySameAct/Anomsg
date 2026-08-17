import { isTasksEnabled } from './db.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { SESSION_COOKIE, readCookie, verifySession } from './session.js';

export function requireSession(request) {
  return verifySession(readCookie(request, SESSION_COOKIE), process.env.SESSION_SECRET);
}

// ข้อมูล task ผูกกับ guild เดียว ผู้ใช้คนเดียวกันสลับ guild ได้ระหว่าง session
// ถ้า browser หรือปุ่ม back cache คำตอบ JSON ไว้ อาจโชว์ task ของ guild เก่าทับ guild ใหม่ที่เพิ่งสลับไป
export function jsonNoStore(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return Response.json(data, { ...init, headers });
}

export function unauthorized() {
  return jsonNoStore({ error: 'ยังไม่ได้ล็อกอิน' }, { status: 401 });
}

// การ์ดกลางที่ทุก route ของ task ต้องผ่านก่อนแตะ service เสมอ ต้องมีจุดเดียว ห้ามก็อปปี้แยกไฟล์
// (api/tasks.js กับ api/tasks/me.js เคยมีสำเนาแยกกันมาก่อน) เพราะถ้าวันหน้ามีการ์ดเพิ่ม เช่นเช็ค Origin
// หรือเช็คสิทธิ์ guild ซ้ำ แล้วแก้แค่สำเนาเดียว อีก route จะหลุดการ์ดไปเงียบๆ
// ฟังก์ชันนี้อ่านแค่ env กับ session cookie ไม่แตะ DB เลย จึงเทสต์ตรงๆ ได้โดยไม่มีความเสี่ยงเรื่อง network
export function context(request) {
  if (!isTasksEnabled()) return { error: jsonNoStore({ error: 'ระบบ task ยังไม่เปิดใช้งาน' }, { status: 503 }) };
  const session = requireSession(request);
  if (!session) return { error: unauthorized() };
  return { session };
}

// รับ body เป็น object เท่านั้น — null, ตัวเลข, สตริง, หรือ JSON พังรูปแบบ ทำให้ service โยน TypeError
// ดิบๆ ตอนอ่าน property ของ input (เช่น input.name บน null) ซึ่งไม่ใช่ ValidationError เลยหลุดไปเป็น 500
// แทนที่จะเป็น 400 ทั้งที่ต้นเหตุคือ client ส่งข้อมูลผิดรูปแบบ
export async function parseJsonBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('รูปแบบข้อมูลไม่ถูกต้อง');
  }
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('รูปแบบข้อมูลไม่ถูกต้อง');
  }
  return body;
}

// แข่งกับ DELETE ที่ยิงพร้อมกัน: เอกสารอาจถูกลบไปแล้วหลัง service โหลดสิทธิ์เสร็จแต่ก่อน update จริง
// ถ้าปล่อยผ่าน client จะเห็น 200 กับ body null ทั้งที่ไม่มีอะไรถูกแก้จริง — ต้องตอบ 404 แทน
export function requireFound(task) {
  if (!task) throw new NotFoundError('ไม่พบงานนี้');
  return task;
}

export function errorResponse(err) {
  if (err instanceof ValidationError) return jsonNoStore({ error: err.message }, { status: 400 });
  if (err instanceof ForbiddenError) return jsonNoStore({ error: err.message }, { status: 403 });
  if (err instanceof NotFoundError) return jsonNoStore({ error: err.message }, { status: 404 });

  // error ที่ไม่ได้ตั้งใจ อาจมีรายละเอียดภายในอย่าง host หรือ port ปนอยู่ ไม่ส่งออกไป
  console.error('unhandled api error:', err);
  return jsonNoStore({ error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' }, { status: 500 });
}
