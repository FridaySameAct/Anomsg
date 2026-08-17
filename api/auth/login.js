import { randomUUID } from 'node:crypto';
import { authorizeUrl } from '../../lib/oauth.js';

// __Host- บังคับให้ browser ยอมรับ cookie นี้เฉพาะกรณี Secure + Path=/ + ไม่มี Domain เท่านั้น
// กัน sibling-subdomain ตั้ง cookie ข้ามโดเมนย่อยมายัด state ปลอมใส่ victim ได้ (session fixation ผ่าน state)
const STATE_COOKIE = '__Host-anomsg_oauth';

export function GET(request) {
  const guildId = new URL(request.url).searchParams.get('guild') ?? '';
  if (!/^\d{17,20}$/.test(guildId)) {
    return new Response('guild ไม่ถูกต้อง', { status: 400 });
  }

  const state = `${randomUUID()}.${guildId}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl({ env: process.env, state }),
      // เก็บ state ไว้เทียบตอน callback เพื่อกัน CSRF ตอน login
      'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
