import { clearCookie } from '../../lib/session.js';

// __Host- ต้องตรงกับชื่อที่ login.js/callback.js ใช้ตั้ง cookie ไว้ ไม่งั้นเคลียร์ไม่โดน
const STATE_COOKIE = '__Host-anomsg_oauth';

function clearStateCookie() {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

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
