import { errorResponse, requireSession, unauthorized } from '../../lib/api-helpers.js';
import { isTasksEnabled } from '../../lib/db.js';
import { getTasksService } from '../../lib/tasks-repo.js';

export async function GET(request) {
  if (!isTasksEnabled()) return Response.json({ error: 'ระบบ task ยังไม่เปิดใช้งาน' }, { status: 503 });
  const session = requireSession(request);
  if (!session) return unauthorized();

  try {
    const service = await getTasksService();
    // actorId มาจาก session เท่านั้น ไม่รับจาก query string
    return Response.json(await service.listMyTasks({ guildId: session.gid, actorId: session.uid }));
  } catch (err) { return errorResponse(err); }
}
