import { ForbiddenError } from '../../lib/errors.js';
import { completeLogin } from '../../lib/oauth.js';
import { readCookie, sessionCookie, signSession } from '../../lib/session.js';

const STATE_COOKIE = 'anomsg_oauth';

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = readCookie(request, STATE_COOKIE);

  if (!code || !state || state !== saved) {
    return new Response('การล็อกอินไม่ถูกต้อง กรุณาเริ่มใหม่จากคำสั่ง /web', { status: 400 });
  }

  const guildId = state.split('.')[1];

  try {
    const session = await completeLogin({ code, guildId, env: process.env });
    const token = signSession(session, process.env.SESSION_SECRET);
    return new Response(null, {
      status: 302,
      headers: [
        // redirect ไปได้เฉพาะ path ภายในเว็บเรา ไม่รับ URL จาก query string
        ['Location', `/?guild=${encodeURIComponent(guildId)}`],
        ['Set-Cookie', sessionCookie(token)],
        ['Set-Cookie', `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`],
      ],
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response(err.message, { status: 403 });
    // ครอบคลุมทั้ง Discord ล้ม และ signSession โยนเพราะ SESSION_SECRET ตั้งค่าไม่ครบ/สั้นเกินไป
    // ต้องล้มดังๆ ด้วย 500 ห้ามปล่อยให้หลุดจนกลายเป็น session ปลอมได้
    console.error('oauth callback failed:', err);
    return new Response('ล็อกอินไม่สำเร็จ ลองใหม่อีกครั้ง', { status: 500 });
  }
}
