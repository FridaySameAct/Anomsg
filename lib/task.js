import { OPT_ASSIGNEE, OPT_NAME, SUB_ADD, SUB_LIST } from './commands.js';
import { isTasksEnabled } from './db.js';
import { respondLater } from './defer.js';
import { ephemeral } from './discord.js';
import { ValidationError } from './errors.js';
import { formatTaskList } from './mytask.js';
import { getTasksService } from './tasks-repo.js';

async function runList({ guildId, getService }) {
  const service = await getService();
  const tasks = (await service.listTasks({ guildId })).filter((task) => !task.done);
  return formatTaskList('งานที่ยังไม่เสร็จ', tasks, 'ยังไม่มีงานค้างในเซิร์ฟเวอร์นี้ 🎉');
}

async function runAdd({ sub, guildId, actorId, getService }) {
  const args = sub.options ?? [];
  const name = args.find((option) => option.name === OPT_NAME)?.value;
  const assignee = args.find((option) => option.name === OPT_ASSIGNEE)?.value ?? null;

  try {
    const service = await getService();
    const task = await service.createTask({ guildId, actorId, data: { name, assignee } });
    return `เพิ่มงาน "${task.name}" เรียบร้อย`;
  } catch (err) {
    // ข้อความของ ValidationError เขียนไว้ให้ผู้ใช้อ่านโดยตรง ส่งต่อไปเลย
    // ส่วน error อื่นปล่อยให้ respondLater จับแล้วแปลงเป็นข้อความกลางแทน
    if (err instanceof ValidationError) return err.message;
    throw err;
  }
}

// getService/defer/fetchImpl รับ default เป็นตัวจริง เทสต์ inject ตัวปลอมแทนได้
// ตามแบบที่ lib/rate-limit.js (fetchImpl) และ lib/tasks-service.js (repo) ทำไว้แล้ว
export function handleTask({ interaction, env, getService = getTasksService, defer, fetchImpl }) {
  // สามด่านนี้ตอบได้ทันทีโดยไม่แตะฐานข้อมูล จึงไม่ต้องผ่าน "กำลังคิด..."
  if (!isTasksEnabled()) return ephemeral('ระบบ task ยังไม่ได้เปิดใช้งาน');
  if (!interaction.guild_id) return ephemeral('คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์');

  const sub = interaction.data.options?.[0];
  const guildId = interaction.guild_id;
  const actorId = interaction.member?.user?.id ?? interaction.user?.id;

  if (sub?.name !== SUB_LIST && sub?.name !== SUB_ADD) {
    return ephemeral('ไม่รู้จักคำสั่งย่อยนี้');
  }

  return respondLater({
    interaction,
    defer,
    fetchImpl,
    work: () =>
      sub.name === SUB_LIST
        ? runList({ guildId, getService })
        : runAdd({ sub, guildId, actorId, getService }),
  });
}
