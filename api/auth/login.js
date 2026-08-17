import { randomUUID } from 'node:crypto';
import { authorizeUrl } from '../../lib/oauth.js';
import { SNOWFLAKE } from '../../lib/discord.js';
import { STATE_COOKIE } from '../../lib/session.js';

export function GET(request) {
  const guildId = new URL(request.url).searchParams.get('guild') ?? '';
  if (!SNOWFLAKE.test(guildId)) {
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
