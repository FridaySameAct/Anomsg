// ทดสอบ handler /task และ /mytask ด้วย service ปลอมที่ inject เข้าไปตรงๆ
// (แบบเดียวกับ fetchImpl ใน lib/rate-limit.js และ repo ใน lib/tasks-service.js)
// ไม่ต้องมี MongoDB จริง แค่ตั้ง MONGODB_URI ปลอมให้ isTasksEnabled() คืน true
process.env.MONGODB_URI = 'mongodb://fake-host/fake-db';

import { OPT_ASSIGNEE, OPT_NAME, SUB_ADD, SUB_LIST } from '../lib/commands.js';
import { ValidationError } from '../lib/errors.js';
import { handleMyTask } from '../lib/mytask.js';
import { handleTask } from '../lib/task.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

// service ปลอมที่จำการเรียกแต่ละ method ไว้ จะได้ assert argument จริงที่ handler ส่งเข้าไป
// ไม่ใช่แค่ดูข้อความตอบกลับ เพราะข้อความอย่างเดียวพิสูจน์ไม่ได้ว่า argument ถูกต้อง
function fakeService({ listTasksResult = [], listMyTasksResult = [], createTaskResult = null, createTaskError = null } = {}) {
  const calls = { listTasks: [], listMyTasks: [], createTask: [] };
  return {
    calls,
    async listTasks(args) { calls.listTasks.push(args); return listTasksResult; },
    async listMyTasks(args) { calls.listMyTasks.push(args); return listMyTasksResult; },
    async createTask(args) {
      calls.createTask.push(args);
      if (createTaskError) throw createTaskError;
      return createTaskResult ?? { id: 't1', ...args.data };
    },
  };
}

// นับจำนวนครั้งที่ getService() ถูกเรียก เอาไว้พิสูจน์ว่า subcommand ที่ไม่รู้จัก
// ไม่เปิดการเชื่อมต่อฐานข้อมูลทิ้งเปล่าๆ
function makeGetService(service) {
  const state = { count: 0 };
  return { getService: async () => { state.count++; return service; }, state };
}

function interaction({ guildId = 'g1', actorId = 'actor-1', options } = {}) {
  const base = { member: { user: { id: actorId } }, data: { options } };
  if (guildId !== null) base.guild_id = guildId;
  return base;
}

async function json(res) {
  return res.json();
}

console.log('\n=== /task list: หลายงาน เอาเฉพาะยังไม่เสร็จ จำกัด 10 ===');
{
  const undone = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, name: `Task-${String(i + 1).padStart(2, '0')}`, done: false }));
  const done = [{ id: 'd1', name: 'Done task', done: true }, { id: 'd2', name: 'Done task 2', done: true }];
  const service = fakeService({ listTasksResult: [...done, ...undone] });
  const { getService } = makeGetService(service);

  const res = await handleTask({
    interaction: interaction({ options: [{ name: SUB_LIST, options: [] }] }),
    getService,
  });
  const body = await json(res);

  check('ยิง listTasks ด้วย guildId ที่ถูกต้อง', service.calls.listTasks[0]?.guildId === 'g1', JSON.stringify(service.calls.listTasks[0]));
  check('แสดงงานแรกสุด', body.data.content.includes('Task-01'), body.data.content);
  check('แสดงงานที่ 10', body.data.content.includes('Task-10'), body.data.content);
  check('ไม่แสดงงานที่ 11 (เกินโควตา 10)', !body.data.content.includes('Task-11'), body.data.content);
  check('ไม่แสดงงานที่ done แล้ว', !body.data.content.includes('Done task'), body.data.content);
  check('บอกจำนวนที่เหลือถูกต้อง (12 - 10 = 2)', body.data.content.includes('และอีก 2 งาน'), body.data.content);
}

console.log('\n=== /task list: ไม่มีงานค้าง -> ข้อความว่าง ===');
{
  const service = fakeService({ listTasksResult: [{ id: 'd1', name: 'Done', done: true }] });
  const { getService } = makeGetService(service);

  const res = await handleTask({
    interaction: interaction({ options: [{ name: SUB_LIST, options: [] }] }),
    getService,
  });
  const body = await json(res);

  check('แจ้งว่าไม่มีงานค้าง', body.data.content === 'ยังไม่มีงานค้างในเซิร์ฟเวอร์นี้ 🎉', body.data.content);
}

console.log('\n=== /task add: บันทึกด้วยข้อมูลถูกต้อง (มีคนรับผิดชอบ) ===');
{
  const service = fakeService();
  const { getService } = makeGetService(service);

  const res = await handleTask({
    interaction: interaction({
      guildId: 'guild-42',
      actorId: 'actor-99',
      options: [{
        name: SUB_ADD,
        options: [
          { name: OPT_NAME, value: 'ซื้อของเข้าบ้าน' },
          { name: OPT_ASSIGNEE, value: 'user-777' },
        ],
      }],
    }),
    getService,
  });
  const body = await json(res);
  const call = service.calls.createTask[0];

  check('เรียก createTask ครั้งเดียว', service.calls.createTask.length === 1);
  check('ส่ง guildId ถูกต้อง', call?.guildId === 'guild-42', JSON.stringify(call));
  check('ส่ง actorId ถูกต้อง', call?.actorId === 'actor-99', JSON.stringify(call));
  check('ส่งชื่องานถูกต้อง', call?.data?.name === 'ซื้อของเข้าบ้าน', JSON.stringify(call?.data));
  check('ส่ง assignee ถูกต้อง', call?.data?.assignee === 'user-777', JSON.stringify(call?.data));
  check('ตอบยืนยันพร้อมชื่องาน', body.data.content.includes('ซื้อของเข้าบ้าน') && body.data.content.includes('เรียบร้อย'), body.data.content);
}

console.log('\n=== /task add: ไม่ระบุคนรับผิดชอบ -> assignee เป็น null ===');
{
  const service = fakeService();
  const { getService } = makeGetService(service);

  await handleTask({
    interaction: interaction({ options: [{ name: SUB_ADD, options: [{ name: OPT_NAME, value: 'งานไม่มีคนรับ' }] }] }),
    getService,
  });
  const call = service.calls.createTask[0];

  check('assignee เป็น null เมื่อไม่ระบุ', call?.data?.assignee === null, JSON.stringify(call?.data));
}

console.log('\n=== /task add: service โยน ValidationError -> ต้องเห็นข้อความนั้น ไม่ใช่ข้อความทั่วไป ===');
{
  const service = fakeService({ createTaskError: new ValidationError('ชื่องานต้องยาว 1-200 ตัวอักษร') });
  const { getService } = makeGetService(service);

  const res = await handleTask({
    interaction: interaction({ options: [{ name: SUB_ADD, options: [{ name: OPT_NAME, value: '' }] }] }),
    getService,
  });
  const body = await json(res);

  check('เห็นข้อความ validation ตรงตัว', body.data.content === 'ชื่องานต้องยาว 1-200 ตัวอักษร', body.data.content);
  check('ไม่ใช่ข้อความ error ทั่วไป', !body.data.content.includes('ใช้ไม่ได้ชั่วคราว'), body.data.content);
}

console.log('\n=== /task <subcommand ที่ไม่รู้จัก> -> ตอบปฏิเสธ และไม่แตะฐานข้อมูลเลย ===');
{
  const service = fakeService();
  const { getService, state } = makeGetService(service);

  const res = await handleTask({
    interaction: interaction({ options: [{ name: 'bogus-sub', options: [] }] }),
    getService,
  });
  const body = await json(res);

  check('ตอบว่าไม่รู้จักคำสั่งย่อย', body.data.content === 'ไม่รู้จักคำสั่งย่อยนี้', body.data.content);
  check('ไม่เรียก getService เลย (ไม่เปิด connection ทิ้งเปล่าๆ)', state.count === 0, String(state.count));
}

console.log('\n=== /mytask: มีงานที่มอบหมายให้ ===');
{
  const undone = Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, name: `MyTask-${i + 1}`, done: false }));
  const done = [{ id: 'md1', name: 'MyDone', done: true }];
  const service = fakeService({ listMyTasksResult: [...done, ...undone] });
  const { getService } = makeGetService(service);

  const res = await handleMyTask({
    interaction: interaction({ guildId: 'g1', actorId: 'actor-5' }),
    getService,
  });
  const body = await json(res);

  check('ยิง listMyTasks ด้วย guildId/actorId ถูกต้อง', service.calls.listMyTasks[0]?.guildId === 'g1' && service.calls.listMyTasks[0]?.actorId === 'actor-5', JSON.stringify(service.calls.listMyTasks[0]));
  check('แสดงงานที่ยังไม่เสร็จ', body.data.content.includes('MyTask-1'), body.data.content);
  check('ไม่แสดงงานที่เสร็จแล้ว', !body.data.content.includes('MyDone'), body.data.content);
}

console.log('\n=== /mytask: ไม่มีงานที่มอบหมายให้ ===');
{
  const service = fakeService({ listMyTasksResult: [] });
  const { getService } = makeGetService(service);

  const res = await handleMyTask({
    interaction: interaction({ guildId: 'g1', actorId: 'actor-nobody' }),
    getService,
  });
  const body = await json(res);

  check('แจ้งว่าไม่มีงานมอบหมาย', body.data.content === 'ยังไม่มีงานที่มอบหมายให้คุณในเซิร์ฟเวอร์นี้ 🎉', body.data.content);
}

console.log('\n=== DM (ไม่มี guild_id): /task และ /mytask ต้องปฏิเสธก่อนแตะฐานข้อมูล ===');
{
  const taskService = fakeService();
  const { getService: getTaskService, state: taskState } = makeGetService(taskService);
  const taskRes = await handleTask({
    interaction: interaction({ guildId: null, options: [{ name: SUB_LIST, options: [] }] }),
    getService: getTaskService,
  });
  const taskBody = await json(taskRes);
  check('/task แจ้งว่าใช้ได้เฉพาะในเซิร์ฟเวอร์', taskBody.data.content.includes('เฉพาะในเซิร์ฟเวอร์'), taskBody.data.content);
  check('/task ไม่แตะ getService เลยตอนเป็น DM', taskState.count === 0, String(taskState.count));

  const myTaskService = fakeService();
  const { getService: getMyTaskService, state: myTaskState } = makeGetService(myTaskService);
  const myTaskRes = await handleMyTask({
    interaction: interaction({ guildId: null }),
    getService: getMyTaskService,
  });
  const myTaskBody = await json(myTaskRes);
  check('/mytask แจ้งว่าใช้ได้เฉพาะในเซิร์ฟเวอร์', myTaskBody.data.content.includes('เฉพาะในเซิร์ฟเวอร์'), myTaskBody.data.content);
  check('/mytask ไม่แตะ getService เลยตอนเป็น DM', myTaskState.count === 0, String(myTaskState.count));
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
