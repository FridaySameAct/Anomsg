import { isTasksEnabled } from './db.js';
import { ephemeral } from './discord.js';
import { getTasksService } from './tasks-repo.js';

// แสดง task เป็นบรรทัดเดียวต่ออัน ใช้ร่วมกับ /task list
export function formatTaskLine(task) {
  const box = task.done ? '✅' : '⬜';
  const due = task.dueDate ? ` · ครบ ${new Date(task.dueDate).toLocaleDateString('th-TH')}` : '';
  return `${box} ${task.name}${due}`;
}

export async function handleMyTask({ interaction }) {
  if (!isTasksEnabled()) return ephemeral('ระบบ task ยังไม่ได้เปิดใช้งาน');
  if (!interaction.guild_id) return ephemeral('คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์');

  const actorId = interaction.member?.user?.id ?? interaction.user?.id;

  try {
    const service = await getTasksService();
    const tasks = (await service.listMyTasks({ guildId: interaction.guild_id, actorId }))
      .filter((task) => !task.done);

    if (tasks.length === 0) return ephemeral('ยังไม่มีงานที่มอบหมายให้คุณในเซิร์ฟเวอร์นี้ 🎉');

    const shown = tasks.slice(0, 10).map(formatTaskLine).join('\n');
    const more = tasks.length > 10 ? `\n\nและอีก ${tasks.length - 10} งาน — ดูทั้งหมดด้วย /web` : '';
    return ephemeral(`**งานของคุณ**\n${shown}${more}`);
  } catch (err) {
    console.error('mytask failed:', err);
    return ephemeral('ระบบ task ใช้ไม่ได้ชั่วคราว ลองใหม่อีกครั้ง');
  }
}
