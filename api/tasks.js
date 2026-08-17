import { errorResponse, requireSession, unauthorized } from '../lib/api-helpers.js';
import { isTasksEnabled } from '../lib/db.js';
import { getTasksService } from '../lib/tasks-repo.js';

// guild มาจาก session เสมอ ไม่รับจาก query string
// ไม่งั้นคนที่ล็อกอิน guild A จะยิง ?guild=B เพื่อดูงานของเซิร์ฟเวอร์อื่นได้
function context(request) {
  if (!isTasksEnabled()) return { error: Response.json({ error: 'ระบบ task ยังไม่เปิดใช้งาน' }, { status: 503 }) };
  const session = requireSession(request);
  if (!session) return { error: unauthorized() };
  return { session };
}

export async function GET(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    return Response.json(await service.listTasks({ guildId: session.gid }));
  } catch (err) { return errorResponse(err); }
}

export async function POST(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    const data = await request.json();
    const task = await service.createTask({ guildId: session.gid, actorId: session.uid, data });
    return Response.json(task, { status: 201 });
  } catch (err) { return errorResponse(err); }
}

export async function PATCH(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    const taskId = new URL(request.url).searchParams.get('id');
    const patch = await request.json();
    const task = await service.updateTask({ taskId, guildId: session.gid, actorId: session.uid, patch });
    return Response.json(task);
  } catch (err) { return errorResponse(err); }
}

export async function DELETE(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    const taskId = new URL(request.url).searchParams.get('id');
    await service.deleteTask({ taskId, guildId: session.gid, actorId: session.uid });
    return new Response(null, { status: 204 });
  } catch (err) { return errorResponse(err); }
}
