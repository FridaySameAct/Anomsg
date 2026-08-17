import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

const SNOWFLAKE = /^\d{17,20}$/;

// PATCH รับได้เฉพาะฟิลด์เหล่านี้ ฟิลด์อื่นทิ้ง
// ถ้าไม่ทำ whitelist จะมีคน PATCH createdBy เป็นตัวเองเพื่อยึดสิทธิ์
// หรือ PATCH guildId เพื่อย้าย task ข้ามเซิร์ฟเวอร์
const EDITABLE = ['name', 'description', 'done', 'assignee', 'dueDate'];

function cleanFields(input, { requireName }) {
  const out = {};

  if (input.name !== undefined || requireName) {
    const name = String(input.name ?? '').trim();
    if (name.length < 1 || name.length > 200) {
      throw new ValidationError('ชื่องานต้องยาว 1-200 ตัวอักษร');
    }
    out.name = name;
  }

  if (input.description !== undefined) {
    const description = String(input.description ?? '');
    if (description.length > 2000) throw new ValidationError('รายละเอียดยาวเกิน 2000 ตัวอักษร');
    out.description = description;
  }

  if (input.done !== undefined) out.done = Boolean(input.done);

  if (input.assignee !== undefined) {
    if (input.assignee === null || input.assignee === '') out.assignee = null;
    else if (!SNOWFLAKE.test(String(input.assignee))) throw new ValidationError('ผู้รับผิดชอบไม่ถูกต้อง');
    else out.assignee = String(input.assignee);
  }

  if (input.dueDate !== undefined) {
    if (input.dueDate === null || input.dueDate === '') out.dueDate = null;
    else {
      const date = new Date(input.dueDate);
      if (Number.isNaN(date.getTime())) throw new ValidationError('กำหนดส่งไม่ใช่วันที่ที่ถูกต้อง');
      out.dueDate = date;
    }
  }

  return out;
}

function assertCanEdit(task, actorId) {
  if (task.createdBy !== actorId && task.assignee !== actorId) {
    throw new ForbiddenError('แก้ไขได้เฉพาะคนสร้างหรือผู้รับผิดชอบ');
  }
}

// โหลด task พร้อมยืนยันว่าอยู่ใน guild ที่ผู้เรียกมีสิทธิ์เข้าถึง
// ตอบ NotFoundError เมื่อคนละ guild เพื่อไม่บอกใบ้ว่ามี task นี้อยู่จริง
async function loadInGuild(repo, taskId, guildId) {
  const task = await repo.findById(taskId);
  if (!task || task.guildId !== guildId) throw new NotFoundError('ไม่พบงานนี้');
  return task;
}

export function createTasksService(repo) {
  return {
    async listTasks({ guildId }) {
      return repo.findByGuild(guildId);
    },

    async listMyTasks({ guildId, actorId }) {
      return repo.findByAssignee(guildId, actorId);
    },

    async createTask({ guildId, actorId, data }) {
      const fields = cleanFields(data, { requireName: true });
      return repo.insert({
        guildId,
        name: fields.name,
        description: fields.description ?? '',
        done: fields.done ?? false,
        assignee: fields.assignee ?? null,
        dueDate: fields.dueDate ?? null,
        createdBy: actorId,
        createdAt: new Date(),
      });
    },

    async updateTask({ taskId, guildId, actorId, patch }) {
      const task = await loadInGuild(repo, taskId, guildId);
      assertCanEdit(task, actorId);

      // ตัวกรองนี้ซ้ำกับ cleanFields โดยตั้งใจ อย่าลบทิ้งเพราะดูเหมือนโค้ดตาย
      // ตอนนี้ cleanFields สร้าง out ทีละฟิลด์เองอยู่แล้วจึงกัน createdBy/guildId ได้สองชั้น
      // แต่ถ้าวันหน้ามีคนแก้ cleanFields ให้ทำ {...input} แทน ชั้นนี้คือด่านเดียวที่เหลือ
      const allowed = {};
      for (const key of EDITABLE) {
        if (patch[key] !== undefined) allowed[key] = patch[key];
      }
      return repo.updateById(taskId, cleanFields(allowed, { requireName: false }));
    },

    async deleteTask({ taskId, guildId, actorId }) {
      const task = await loadInGuild(repo, taskId, guildId);
      assertCanEdit(task, actorId);
      return repo.deleteById(taskId);
    },
  };
}
