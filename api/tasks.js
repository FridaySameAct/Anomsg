import { context, errorResponse, jsonNoStore, parseJsonBody, requireFound } from '../lib/api-helpers.js';
import { getTasksService } from '../lib/tasks-repo.js';

// context() (lib/api-helpers.js) คือแหล่งเดียวที่ดึง guild/actor — มาจาก session เสมอ ไม่รับจาก query
// string ไม่งั้นคนที่ล็อกอิน guild A จะยิง ?guild=B เพื่อดูงานของเซิร์ฟเวอร์อื่นได้

export async function GET(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    return jsonNoStore(await service.listTasks({ guildId: session.gid }));
  } catch (err) { return errorResponse(err); }
}

export async function POST(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    const data = await parseJsonBody(request);
    const task = await service.createTask({ guildId: session.gid, actorId: session.uid, data });
    return jsonNoStore(task, { status: 201 });
  } catch (err) { return errorResponse(err); }
}

export async function PATCH(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    const taskId = new URL(request.url).searchParams.get('id');
    const patch = await parseJsonBody(request);
    const task = await service.updateTask({ taskId, guildId: session.gid, actorId: session.uid, patch });
    return jsonNoStore(requireFound(task));
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
