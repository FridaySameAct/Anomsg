import { clearCookie, clearStateCookie } from '../../lib/session.js';

export function POST() {
  // เคลียร์ทั้ง session cookie และ state cookie เผื่อมี oauth flow ที่ค้างไว้ไม่จบ (เช่นกดล็อกเอาต์
  // ระหว่างที่ยังไม่ได้กด callback) ไม่ให้ state เก่าเหลือ replay ได้
  return new Response(null, {
    status: 204,
    headers: [
      ['Set-Cookie', clearCookie()],
      ['Set-Cookie', clearStateCookie()],
    ],
  });
}
