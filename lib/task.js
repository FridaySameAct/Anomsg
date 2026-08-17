import { OPT_ASSIGNEE, OPT_NAME, SUB_ADD, SUB_LIST } from './commands.js';
import { isTasksEnabled } from './db.js';
import { ephemeral } from './discord.js';
import { formatTaskLine } from './mytask.js';
import { getTasksService } from './tasks-repo.js';
import { ValidationError } from './errors.js';

export async function handleTask({ interaction }) {
  if (!isTasksEnabled()) return ephemeral('ระบบ task ยังไม่ได้เปิดใช้งาน');
  if (!interaction.guild_id) return ephemeral('คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์');

  const sub = interaction.data.options?.[0];
  const guildId = interaction.guild_id;
  const actorId = interaction.member?.user?.id ?? interaction.user?.id;

  try {
    const service = await getTasksService();

    if (sub?.name === SUB_LIST) {
      const tasks = (await service.listTasks({ guildId })).filter((task) => !task.done);
      if (tasks.length === 0) return ephemeral('ยังไม่มีงานค้างในเซิร์ฟเวอร์นี้ 🎉');

      const shown = tasks.slice(0, 10).map(formatTaskLine).join('\n');
      const more = tasks.length > 10 ? `\n\nและอีก ${tasks.length - 10} งาน — ดูทั้งหมดด้วย /web` : '';
      return ephemeral(`**งานที่ยังไม่เสร็จ**\n${shown}${more}`);
    }

    if (sub?.name === SUB_ADD) {
      const args = sub.options ?? [];
      const name = args.find((option) => option.name === OPT_NAME)?.value;
      const assignee = args.find((option) => option.name === OPT_ASSIGNEE)?.value ?? null;

      const task = await service.createTask({ guildId, actorId, data: { name, assignee } });
      return ephemeral(`เพิ่มงาน "${task.name}" เรียบร้อย`);
    }

    return ephemeral('ไม่รู้จักคำสั่งย่อยนี้');
  } catch (err) {
    if (err instanceof ValidationError) return ephemeral(err.message);
    console.error('task command failed:', err);
    return ephemeral('ระบบ task ใช้ไม่ได้ชั่วคราว ลองใหม่อีกครั้ง');
  }
}
