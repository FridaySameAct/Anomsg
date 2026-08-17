import { jsonNoStore } from '../lib/api-helpers.js';
import { SESSION_COOKIE, readCookie, verifySession } from '../lib/session.js';

export function GET(request) {
  const session = verifySession(readCookie(request, SESSION_COOKIE), process.env.SESSION_SECRET);
  if (!session) return jsonNoStore({ error: 'ยังไม่ได้ล็อกอิน' }, { status: 401 });
  // no-store: uid/gid ผูกกับ guild ที่ล็อกอินอยู่ ถ้า cache ไว้แล้วสลับ guild อาจโชว์ session เก่าค้าง
  return jsonNoStore({ uid: session.uid, name: session.name, gid: session.gid });
}
