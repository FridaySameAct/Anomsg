import { ForbiddenError } from '../../lib/errors.js';
import { completeLogin } from '../../lib/oauth.js';
import { SNOWFLAKE } from '../../lib/discord.js';
import { STATE_COOKIE, clearStateCookie, readCookie, sessionCookie, signSession } from '../../lib/session.js';

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
  if (!SNOWFLAKE.test(guildId)) {
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
