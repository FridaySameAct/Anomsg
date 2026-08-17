import { context, errorResponse, jsonNoStore } from '../../lib/api-helpers.js';
import { getTasksService } from '../../lib/tasks-repo.js';

// ใช้ context() ตัวเดียวกับ api/tasks.js (lib/api-helpers.js) ห้ามแยกก็อปปี้การ์ดของตัวเอง
// เพราะ route นี้คืน task จริง การ์ดที่หายไปแค่ครึ่งไฟล์จะรั่วข้อมูลข้าม guild ได้เหมือนกัน
export async function GET(request) {
  const { session, error } = context(request);
  if (error) return error;

  try {
    const service = await getTasksService();
    // actorId มาจาก session เท่านั้น ไม่รับจาก query string
    return jsonNoStore(await service.listMyTasks({ guildId: session.gid, actorId: session.uid }));
  } catch (err) { return errorResponse(err); }
}
