import { ForbiddenError } from './errors.js';

const DISCORD_API = 'https://discord.com/api/v10';

export function redirectUri(env) {
  return `${env.PUBLIC_BASE_URL}/api/auth/callback`;
}

export function authorizeUrl({ env, state }) {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchangeCode(code, env, fetchImpl) {
  const res = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(env),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function getJson(path, accessToken, fetchImpl) {
  const res = await fetchImpl(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

/**
 * แลก code เป็นตัวตน แล้วยืนยันว่าคนนี้อยู่ใน guild ที่ขอเข้าจริง
 * ด่านนี้คือความปลอดภัยหลัก guild id ไม่ใช่ความลับ ใครก็เดาได้
 */
export async function completeLogin({ code, guildId, env, fetchImpl = fetch }) {
  const accessToken = await exchangeCode(code, env, fetchImpl);
  const user = await getJson('/users/@me', accessToken, fetchImpl);
  const guilds = await getJson('/users/@me/guilds', accessToken, fetchImpl);

  if (!guilds.some((guild) => guild.id === guildId)) {
    throw new ForbiddenError('คุณไม่ได้อยู่ในเซิร์ฟเวอร์นี้');
  }
  return { uid: user.id, name: user.username, gid: guildId };
}
