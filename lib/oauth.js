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
  let data;
  try {
    data = await res.json();
  } catch {
    // ห้าม log ข้อความ error ของ JSON.parse ตรงๆ เพราะ V8 ฝัง snippet ของ body ดิบมาในนั้นด้วย
    // (เช่น "<html>..." ถ้า upstream ตอบเป็น error page) นี่คือจุดเดียวที่ body ดิบจาก Discord จะหลุดไปที่ log ได้
    throw new Error(`token exchange returned invalid JSON (status ${res.status})`);
  }
  return data.access_token;
}

async function getJson(path, accessToken, fetchImpl) {
  const res = await fetchImpl(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${path} returned invalid JSON (status ${res.status})`);
  }
}

/**
 * แลก code เป็นตัวตน แล้วยืนยันว่าคนนี้อยู่ใน guild ที่ขอเข้าจริง
 * ด่านนี้คือความปลอดภัยหลัก guild id ไม่ใช่ความลับ ใครก็เดาได้
 */
export async function completeLogin({ code, guildId, env, fetchImpl = fetch }) {
  const accessToken = await exchangeCode(code, env, fetchImpl);
  const user = await getJson('/users/@me', accessToken, fetchImpl);
  // ด่านนี้คือจุดตรวจสิทธิ์เข้าเว็บทั้งระบบ ต้องได้ guild ครบทุกอันของผู้ใช้ ไม่ใช่แค่หน้าแรก
  // Discord จำกัดผู้ใช้แต่ละคนไว้สูงสุด 200 guild (ไม่มี Nitro จำกัดที่ 100) ขอ limit=200 ครั้งเดียว
  // จึงได้ครบเสมอ ไม่มีทางที่ผู้ใช้จริงจะมี guild เกินเลข 200 นี้ไปได้ — ห้าม "optimise" ค่านี้ลงในอนาคต
  // เพราะจะทำให้ผู้ใช้ที่อยู่ guild ลำดับหลังๆ ถูกมองไม่เห็นและปฏิเสธสิทธิ์ที่ควรได้ผิดๆ
  const guilds = await getJson('/users/@me/guilds?limit=200', accessToken, fetchImpl);

  if (!guilds.some((guild) => guild.id === guildId)) {
    throw new ForbiddenError('คุณไม่ได้อยู่ในเซิร์ฟเวอร์นี้');
  }
  return { uid: user.id, name: user.username, gid: guildId };
}
