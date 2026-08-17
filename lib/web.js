import { isTasksEnabled } from './db.js';
import { ephemeral } from './discord.js';

// /web แค่คืนลิงก์ ไม่แตะ MongoDB เลย จึงเช็คแค่ flag กับ guild_id ก็พอ
export function handleWeb({ interaction, env }) {
  if (!isTasksEnabled()) {
    return ephemeral('ระบบ task ยังไม่ได้เปิดใช้งาน');
  }
  if (!interaction.guild_id) {
    return ephemeral('คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์');
  }
  const base = env.PUBLIC_BASE_URL;
  if (!base) {
    console.error('Missing PUBLIC_BASE_URL');
    return ephemeral('ระบบ task ตั้งค่าไม่ครบ');
  }
  return ephemeral(`เปิดหน้าจัดการ task: ${base}/?guild=${interaction.guild_id}`);
}
