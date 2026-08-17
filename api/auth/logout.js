import { clearCookie } from '../../lib/session.js';

export function POST() {
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie() } });
}
