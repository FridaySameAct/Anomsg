import { ForbiddenError } from '../../lib/errors.js';
import { completeLogin } from '../../lib/oauth.js';
import { readCookie, sessionCookie, signSession } from '../../lib/session.js';

// __Host- บังคับให้ browser ยอมรับ cookie นี้เฉพาะกรณี Secure + Path=/ + ไม่มี Domain เท่านั้น
// กัน sibling-subdomain ตั้ง cookie ข้ามโดเมนย่อยมายัด state ปลอมใส่ victim ได้ (session fixation ผ่าน state)
const STATE_COOKIE = '__Host-anomsg_oauth';

// state เดินทางผ่าน query string จึงหลุดไป browser history / Referer ของหน้า error / edge log ได้
// ต้องเคลียร์ cookie นี้ทุก terminal path ไม่ใช่แค่ทาง success ไม่งั้นมันจะ replay ซ้ำได้ตลอด 600 วิที่เหลือ
function clearStateCookie() {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = readCookie(request, STATE_COOKIE);

  if (!code || !state || state !== saved) {
    return new Response('การล็อกอินไม่ถูกต้อง กรุณาเริ่มใหม่จากคำสั่ง /web', {
      status: 400,
      headers: { 'Set-Cookie': clearStateCookie() },
    });
  }

  const guildId = state.split('.')[1];
  // ห้ามเชื่อ guildId ที่ round-trip ผ่าน cookie เฉยๆ แค่เพราะ state ตรงกัน ต้องเช็ครูปแบบซ้ำเหมือนตอน login
  // (เช่น cookie ถูกยัดข้ามโดเมนย่อยมาก่อน __Host- จะมีผล หรือ state ถูกประกอบขึ้นเองแบบผิดรูป)
  if (!/^\d{17,20}$/.test(guildId)) {
    return new Response('guild ไม่ถูกต้อง', {
      status: 400,
      headers: { 'Set-Cookie': clearStateCookie() },
    });
  }

  try {
    const session = await completeLogin({ code, guildId, env: process.env });
    const token = signSession(session, process.env.SESSION_SECRET);
    return new Response(null, {
      status: 302,
      headers: [
        // redirect ไปได้เฉพาะ path ภายในเว็บเรา ไม่รับ URL จาก query string
        ['Location', `/?guild=${encodeURIComponent(guildId)}`],
        ['Set-Cookie', sessionCookie(token)],
        ['Set-Cookie', clearStateCookie()],
      ],
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return new Response(err.message, { status: 403, headers: { 'Set-Cookie': clearStateCookie() } });
    }
    // ครอบคลุมทั้ง Discord ล้ม และ signSession โยนเพราะ SESSION_SECRET ตั้งค่าไม่ครบ/สั้นเกินไป
    // ต้องล้มดังๆ ด้วย 500 ห้ามปล่อยให้หลุดจนกลายเป็น session ปลอมได้
    console.error('oauth callback failed:', err);
    return new Response('ล็อกอินไม่สำเร็จ ลองใหม่อีกครั้ง', {
      status: 500,
      headers: { 'Set-Cookie': clearStateCookie() },
    });
  }
}
