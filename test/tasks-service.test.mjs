import { createTasksService } from '../lib/tasks-service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

// repo ปลอมเก็บใน array ไม่ต้องมี MongoDB
function fakeRepo(seed = []) {
  let rows = seed.map((r) => ({ ...r }));
  let nextId = rows.length + 1;
  // เก็บ patch ที่ updateById ได้รับจริงทุกครั้ง ไว้เทสต์ชั้น whitelist โดยตรงที่จุดต่อกับ repo
  // ไม่ใช่แค่ดูผลลัพธ์ปลายทางหลัง Object.assign เพราะนั่นเทสต์รวมทั้งสองชั้นพร้อมกัน
  const updateCalls = [];
  return {
    updateCalls: () => updateCalls,
    async findByGuild(guildId) { return rows.filter((r) => r.guildId === guildId); },
    async findByAssignee(guildId, actorId) {
      return rows.filter((r) => r.guildId === guildId && r.assignee === actorId);
    },
    async findById(id) { return rows.find((r) => r.id === id) ?? null; },
    async insert(doc) { const row = { id: String(nextId++), ...doc }; rows.push(row); return row; },
    async updateById(id, patch) {
      updateCalls.push({ id, patch });
      const row = rows.find((r) => r.id === id);
      Object.assign(row, patch);
      return row;
    },
    async deleteById(id) { rows = rows.filter((r) => r.id !== id); },
  };
}

async function expectError(fn, type, label) {
  try { await fn(); check(label, false, 'ไม่ได้โยน error'); }
  catch (err) { check(label, err instanceof type, err.constructor.name); }
}

const OWNER = 'user-owner';
const ASSIGNEE = 'user-assignee';
const STRANGER = 'user-stranger';
const GUILD = 'guild-1';

function seeded() {
  return fakeRepo([
    { id: '1', guildId: GUILD, name: 'งานเก่า', done: false,
      createdBy: OWNER, assignee: ASSIGNEE, description: '', dueDate: null,
      createdAt: new Date('2026-01-01') },
    { id: '2', guildId: 'guild-other', name: 'ของอีกเซิร์ฟเวอร์', done: false,
      createdBy: OWNER, assignee: null, description: '', dueDate: null,
      createdAt: new Date('2026-01-01') },
  ]);
}

console.log('\n=== สร้าง task ===');
{
  const repo = seeded();
  const service = createTasksService(repo);
  const task = await service.createTask({ guildId: GUILD, actorId: OWNER, data: { name: 'งานใหม่' } });
  check('บันทึกชื่อถูก', task.name === 'งานใหม่');
  check('createdBy เป็นคนสร้าง', task.createdBy === OWNER);
  check('ผูกกับ guild ที่ส่งมา', task.guildId === GUILD);
  check('done เริ่มที่ false', task.done === false);
  check('assignee ว่างถ้าไม่ระบุ', task.assignee === null, String(task.assignee));
}

console.log('\n=== ตรวจข้อมูลขาเข้า ===');
{
  const service = createTasksService(seeded());
  await expectError(() => service.createTask({ guildId: GUILD, actorId: OWNER, data: { name: '' } }),
    ValidationError, 'ชื่อว่างต้องไม่ผ่าน');
  await expectError(() => service.createTask({ guildId: GUILD, actorId: OWNER, data: { name: 'x'.repeat(201) } }),
    ValidationError, 'ชื่อเกิน 200 ต้องไม่ผ่าน');
  await expectError(() => service.createTask({ guildId: GUILD, actorId: OWNER,
    data: { name: 'ok', description: 'x'.repeat(2001) } }),
    ValidationError, 'description เกิน 2000 ต้องไม่ผ่าน');
  await expectError(() => service.createTask({ guildId: GUILD, actorId: OWNER,
    data: { name: 'ok', assignee: 'ไม่ใช่ snowflake' } }),
    ValidationError, 'assignee ที่ไม่ใช่ snowflake ต้องไม่ผ่าน');
  await expectError(() => service.createTask({ guildId: GUILD, actorId: OWNER,
    data: { name: 'ok', dueDate: 'วันที่มั่ว' } }),
    ValidationError, 'dueDate ที่ parse ไม่ได้ต้องไม่ผ่าน');
}

console.log('\n=== กฎสิทธิ์ในการแก้ ===');
{
  const service = createTasksService(seeded());
  const byOwner = await service.updateTask({ taskId: '1', guildId: GUILD, actorId: OWNER, patch: { done: true } });
  check('เจ้าของแก้ได้', byOwner.done === true);
}
{
  const service = createTasksService(seeded());
  const byAssignee = await service.updateTask({ taskId: '1', guildId: GUILD, actorId: ASSIGNEE, patch: { done: true } });
  check('assignee แก้ได้', byAssignee.done === true);
}
{
  const service = createTasksService(seeded());
  await expectError(() => service.updateTask({ taskId: '1', guildId: GUILD, actorId: STRANGER, patch: { done: true } }),
    ForbiddenError, 'คนอื่นแก้ไม่ได้');
  await expectError(() => service.deleteTask({ taskId: '1', guildId: GUILD, actorId: STRANGER }),
    ForbiddenError, 'คนอื่นลบไม่ได้');
}

console.log('\n=== ข้ามเซิร์ฟเวอร์ไม่ได้ ===');
{
  const service = createTasksService(seeded());
  await expectError(() => service.updateTask({ taskId: '2', guildId: GUILD, actorId: OWNER, patch: { done: true } }),
    NotFoundError, 'แก้ task ของ guild อื่นไม่ได้แม้เป็นเจ้าของ');
  await expectError(() => service.deleteTask({ taskId: '2', guildId: GUILD, actorId: OWNER }),
    NotFoundError, 'ลบ task ของ guild อื่นไม่ได้แม้เป็นเจ้าของ');
  const list = await service.listTasks({ guildId: GUILD });
  check('list เห็นเฉพาะ guild ตัวเอง', list.length === 1 && list[0].id === '1', JSON.stringify(list.map((t) => t.id)));
}

console.log('\n=== PATCH ต้องรับเฉพาะฟิลด์ที่อนุญาต ===');
{
  const repo = seeded();
  const service = createTasksService(repo);
  await service.updateTask({ taskId: '1', guildId: GUILD, actorId: OWNER,
    patch: { name: 'ชื่อใหม่', createdBy: STRANGER, guildId: 'guild-hijack', id: '999' } });
  const row = await repo.findById('1');
  check('name แก้ได้', row.name === 'ชื่อใหม่');
  check('createdBy แก้ไม่ได้ (กันยึดสิทธิ์)', row.createdBy === OWNER, row.createdBy);
  check('guildId แก้ไม่ได้ (กันย้ายข้ามเซิร์ฟเวอร์)', row.guildId === GUILD, row.guildId);

  // เช็คตรงจุดที่ patch วิ่งเข้า repo เลย ไม่ใช่แค่ผลลัพธ์ปลายทางหลัง persist
  // เพื่อยืนยันชั้น whitelist (EDITABLE loop) เอง ไม่ใช่แค่พึ่ง cleanFields ชั้นเดียว
  const calls = repo.updateCalls();
  check('เรียก updateById แค่ครั้งเดียว', calls.length === 1, String(calls.length));
  const sentPatch = calls[0].patch;
  check('patch ที่ยิงเข้า repo ไม่มี createdBy', !('createdBy' in sentPatch), JSON.stringify(sentPatch));
  check('patch ที่ยิงเข้า repo ไม่มี guildId', !('guildId' in sentPatch), JSON.stringify(sentPatch));
  check('patch ที่ยิงเข้า repo ไม่มี id', !('id' in sentPatch), JSON.stringify(sentPatch));
}

console.log('\n=== task ที่ assign ให้เรา ===');
{
  const service = createTasksService(seeded());
  const mine = await service.listMyTasks({ guildId: GUILD, actorId: ASSIGNEE });
  check('เห็นงานที่ถูก assign', mine.length === 1);
  const none = await service.listMyTasks({ guildId: GUILD, actorId: STRANGER });
  check('คนที่ไม่มีงานเห็นรายการว่าง', none.length === 0);
}

console.log('\n=== task ที่ไม่มีอยู่ ===');
{
  const service = createTasksService(seeded());
  await expectError(() => service.updateTask({ taskId: 'ไม่มีจริง', guildId: GUILD, actorId: OWNER, patch: { done: true } }),
    NotFoundError, 'แก้ task ที่ไม่มีต้องได้ NotFoundError');
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
