import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { SESSION_COOKIE, readCookie, verifySession } from './session.js';

export function requireSession(request) {
  return verifySession(readCookie(request, SESSION_COOKIE), process.env.SESSION_SECRET);
}

export function errorResponse(err) {
  if (err instanceof ValidationError) return Response.json({ error: err.message }, { status: 400 });
  if (err instanceof ForbiddenError) return Response.json({ error: err.message }, { status: 403 });
  if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });

  // error ที่ไม่ได้ตั้งใจ อาจมีรายละเอียดภายในอย่าง host หรือ port ปนอยู่ ไม่ส่งออกไป
  console.error('unhandled api error:', err);
  return Response.json({ error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' }, { status: 500 });
}

export function unauthorized() {
  return Response.json({ error: 'ยังไม่ได้ล็อกอิน' }, { status: 401 });
}
