import { SESSION_COOKIE, readCookie, verifySession } from '../lib/session.js';

export function GET(request) {
  const session = verifySession(readCookie(request, SESSION_COOKIE), process.env.SESSION_SECRET);
  if (!session) return Response.json({ error: 'ยังไม่ได้ล็อกอิน' }, { status: 401 });
  return Response.json({ uid: session.uid, name: session.name, gid: session.gid });
}
