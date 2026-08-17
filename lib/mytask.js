import { isTasksEnabled } from './db.js';
import { respondLater } from './defer.js';
import { ephemeral } from './discord.js';
import { getTasksService } from './tasks-repo.js';

// แสดง task เป็นบรรทัดเดียวต่ออัน ใช้ร่วมกับ /task list
export function formatTaskLine(task) {
  const box = task.done ? '✅' : '⬜';
  const due = task.dueDate ? ` · ครบ ${new Date(task.dueDate).toLocaleDateString('th-TH')}` : '';
  return `${box} ${task.name}${due}`;
}

// ตัดให้เหลือ 10 บรรทัดแล้วบอกว่ายังมีอีกกี่งาน ใช้ทั้ง /mytask และ /task list
export function formatTaskList(heading, tasks, emptyText) {
  if (tasks.length === 0) return emptyText;
  const shown = tasks.slice(0, 10).map(formatTaskLine).join('\n');
  const more = tasks.length > 10 ? `\n\nและอีก ${tasks.length - 10} งาน — ดูทั้งหมดด้วย /web` : '';
  return `**${heading}**\n${shown}${more}`;
}

async function runMyTask({ interaction, getService }) {
  const actorId = interaction.member?.user?.id ?? interaction.user?.id;
  const service = await getService();
  const tasks = (await service.listMyTasks({ guildId: interaction.guild_id, actorId }))
    .filter((task) => !task.done);

  return formatTaskList('งานของคุณ', tasks, 'ยังไม่มีงานที่มอบหมายให้คุณในเซิร์ฟเวอร์นี้ 🎉');
}

// getService/defer/fetchImpl รับ default เป็นตัวจริง เทสต์ inject ตัวปลอมแทนได้
// ตามแบบที่ lib/rate-limit.js (fetchImpl) และ lib/tasks-service.js (repo) ทำไว้แล้ว
export function handleMyTask({ interaction, env, getService = getTasksService, defer, fetchImpl }) {
  // สองด่านนี้ตอบได้ทันทีโดยไม่แตะฐานข้อมูล จึงไม่ต้องผ่าน "กำลังคิด..."
  // ตอบตรงๆ ให้ผู้ใช้เห็นผลเร็วกว่ารอ round trip ที่ไม่จำเป็น
  if (!isTasksEnabled()) return ephemeral('ระบบ task ยังไม่ได้เปิดใช้งาน');
  if (!interaction.guild_id) return ephemeral('คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์');

  return respondLater({
    interaction,
    defer,
    fetchImpl,
    work: () => runMyTask({ interaction, getService }),
  });
}
