// ทดสอบ handler /task และ /mytask ด้วย service ปลอมที่ inject เข้าไปตรงๆ
// (แบบเดียวกับ fetchImpl ใน lib/rate-limit.js และ repo ใน lib/tasks-service.js)
// ไม่ต้องมี MongoDB จริง แค่ตั้ง MONGODB_URI ปลอมให้ isTasksEnabled() คืน true
process.env.MONGODB_URI = 'mongodb://fake-host/fake-db';

import { OPT_ASSIGNEE, OPT_NAME, SUB_ADD, SUB_LIST } from '../lib/commands.js';
import { ValidationError } from '../lib/errors.js';
import { handleMyTask } from '../lib/mytask.js';
import { handleTask } from '../lib/task.js';

const DEFERRED = 5; // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
const MESSAGE = 4; // CHANNEL_MESSAGE_WITH_SOURCE
const EPHEMERAL = 64;

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

// service ปลอมที่จำการเรียกแต่ละ method ไว้ จะได้ assert argument จริงที่ handler ส่งเข้าไป
// ไม่ใช่แค่ดูข้อความตอบกลับ เพราะข้อความอย่างเดียวพิสูจน์ไม่ได้ว่า argument ถูกต้อง
function fakeService({ listTasksResult = [], listMyTasksResult = [], createTaskResult = null, createTaskError = null, listTasksError = null } = {}) {
  const calls = { listTasks: [], listMyTasks: [], createTask: [] };
  return {
    calls,
    async listTasks(args) {
      calls.listTasks.push(args);
      if (listTasksError) throw listTasksError;
      return listTasksResult;
    },
    async listMyTasks(args) { calls.listMyTasks.push(args); return listMyTasksResult; },
    async createTask(args) {
      calls.createTask.push(args);
      if (createTaskError) throw createTaskError;
      return createTaskResult ?? { id: 't1', ...args.data };
    },
  };
}

// นับจำนวนครั้งที่ getService() ถูกเรียก เอาไว้พิสูจน์ว่าด่านที่ปฏิเสธก่อน
// ไม่เปิดการเชื่อมต่อฐานข้อมูลทิ้งเปล่าๆ
function makeGetService(service) {
  const state = { count: 0 };
  return { getService: async () => { state.count++; return service; }, state };
}

function interaction({ guildId = 'g1', actorId = 'actor-1', options } = {}) {
  const base = {
    application_id: 'app-123',
    token: 'interaction-token-abc',
    member: { user: { id: actorId } },
    data: { options },
  };
  if (guildId !== null) base.guild_id = guildId;
  return base;
}

/**
 * เรียก handler แล้วคืนทั้งคำตอบทันทีและผลที่ตามมาทีหลัง
 *
 * handler ตอบ type 5 กลับไปก่อนแล้วฝากงานที่เหลือไว้กับ defer() ตัวจริงคือ waitUntil ของ Vercel
 * เทสต์ใส่ตัวปลอมที่แค่เก็บ promise ไว้ให้ await ได้ จะได้ตรวจข้อความสุดท้ายที่ผู้ใช้เห็นจริง
 */
async function invoke(handler, args) {
  const deferred = [];
  const patches = [];
  const fetchImpl = async (url, init) => {
    patches.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };

  const res = await handler({ ...args, defer: (p) => deferred.push(p), fetchImpl });
  const immediate = await res.json();
  await Promise.all(deferred);

  return { immediate, patches, deferCount: deferred.length, final: patches[0]?.body?.content };
}

console.log('\n=== ตอบ "กำลังคิด..." ทันที แล้วค่อยส่งผลตามไป ===');
{
  const service = fakeService({ listTasksResult: [{ id: 'u1', name: 'Task-01', done: false }] });
  const { getService } = makeGetService(service);
  const { immediate, patches, deferCount, final } = await invoke(handleTask, {
    interaction: interaction({ options: [{ name: SUB_LIST, options: [] }] }),
    getService,
  });

  check('คำตอบแรกเป็น type 5 (deferred)', immediate.type === DEFERRED, JSON.stringify(immediate));
  check('ตั้ง ephemeral ตั้งแต่คำตอบแรก', immediate.data.flags === EPHEMERAL, String(immediate.data?.flags));
  check('คำตอบแรกไม่มี content (ยังไม่รู้ผล)', immediate.data.content === undefined);
  check('ฝากงานต่อไว้ 1 ชิ้น', deferCount === 1, String(deferCount));
  check('แก้ข้อความเดิมด้วย PATCH', patches[0]?.init.method === 'PATCH', patches[0]?.init.method);
  check(
    'ยิงไป webhook ของ interaction นั้น',
    patches[0]?.url === 'https://discord.com/api/v10/webhooks/app-123/interaction-token-abc/messages/@original',
    patches[0]?.url,
  );
  check('ไม่แนบ bot token (endpoint นี้ใช้ interaction token)', !JSON.stringify(patches[0]?.init.headers ?? {}).includes('Bot '));
  check('ปิด mention ในข้อความที่ตามไป', JSON.stringify(patches[0]?.body.allowed_mentions) === '{"parse":[]}');
  check('ผู้ใช้เห็นผลจริงในที่สุด', final.includes('Task-01'), final);
}

console.log('\n=== /task list: หลายงาน เอาเฉพาะยังไม่เสร็จ จำกัด 10 ===');
{
  const undone = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, name: `Task-${String(i + 1).padStart(2, '0')}`, done: false }));
  const done = [{ id: 'd1', name: 'Done task', done: true }, { id: 'd2', name: 'Done task 2', done: true }];
  const service = fakeService({ listTasksResult: [...done, ...undone] });
  const { getService } = makeGetService(service);
  const { final } = await invoke(handleTask, {
    interaction: interaction({ options: [{ name: SUB_LIST, options: [] }] }),
    getService,
  });

  check('ยิง listTasks ด้วย guildId ที่ถูกต้อง', service.calls.listTasks[0]?.guildId === 'g1', JSON.stringify(service.calls.listTasks[0]));
  check('แสดงงานแรกสุด', final.includes('Task-01'), final);
  check('แสดงงานที่ 10', final.includes('Task-10'), final);
  check('ไม่แสดงงานที่ 11 (เกินโควตา 10)', !final.includes('Task-11'), final);
  check('ไม่แสดงงานที่ done แล้ว', !final.includes('Done task'), final);
  check('บอกจำนวนที่เหลือถูกต้อง (12 - 10 = 2)', final.includes('และอีก 2 งาน'), final);
}

console.log('\n=== /task list: ไม่มีงานค้าง -> ข้อความว่าง ===');
{
  const service = fakeService({ listTasksResult: [{ id: 'd1', name: 'Done', done: true }] });
  const { getService } = makeGetService(service);
  const { final } = await invoke(handleTask, {
    interaction: interaction({ options: [{ name: SUB_LIST, options: [] }] }),
    getService,
  });

  check('แจ้งว่าไม่มีงานค้าง', final === 'ยังไม่มีงานค้างในเซิร์ฟเวอร์นี้ 🎉', final);
}

console.log('\n=== /task add: บันทึกด้วยข้อมูลถูกต้อง (มีคนรับผิดชอบ) ===');
{
  const service = fakeService();
  const { getService } = makeGetService(service);
  const { final } = await invoke(handleTask, {
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
  const call = service.calls.createTask[0];

  check('เรียก createTask ครั้งเดียว', service.calls.createTask.length === 1);
  check('ส่ง guildId ถูกต้อง', call?.guildId === 'guild-42', JSON.stringify(call));
  check('ส่ง actorId ถูกต้อง', call?.actorId === 'actor-99', JSON.stringify(call));
  check('ส่งชื่องานถูกต้อง', call?.data?.name === 'ซื้อของเข้าบ้าน', JSON.stringify(call?.data));
  check('ส่ง assignee ถูกต้อง', call?.data?.assignee === 'user-777', JSON.stringify(call?.data));
  check('ตอบยืนยันพร้อมชื่องาน', final.includes('ซื้อของเข้าบ้าน') && final.includes('เรียบร้อย'), final);
}

console.log('\n=== /task add: ไม่ระบุคนรับผิดชอบ -> assignee เป็น null ===');
{
  const service = fakeService();
  const { getService } = makeGetService(service);
  await invoke(handleTask, {
    interaction: interaction({ options: [{ name: SUB_ADD, options: [{ name: OPT_NAME, value: 'งานไม่มีคนรับ' }] }] }),
    getService,
  });

  check('assignee เป็น null เมื่อไม่ระบุ', service.calls.createTask[0]?.data?.assignee === null, JSON.stringify(service.calls.createTask[0]?.data));
}

console.log('\n=== /task add: service โยน ValidationError -> ต้องเห็นข้อความนั้น ไม่ใช่ข้อความทั่วไป ===');
{
  const service = fakeService({ createTaskError: new ValidationError('ชื่องานต้องยาว 1-200 ตัวอักษร') });
  const { getService } = makeGetService(service);
  const { final } = await invoke(handleTask, {
    interaction: interaction({ options: [{ name: SUB_ADD, options: [{ name: OPT_NAME, value: '' }] }] }),
    getService,
  });

  check('เห็นข้อความ validation ตรงตัว', final === 'ชื่องานต้องยาว 1-200 ตัวอักษร', final);
  check('ไม่ใช่ข้อความ error ทั่วไป', !final.includes('ใช้ไม่ได้ชั่วคราว'), final);
}

console.log('\n=== error ที่ไม่คาดคิด -> ต้องไม่ค้างที่ "กำลังคิด..." ===');
{
  const service = fakeService({ listTasksError: new Error('ECONNREFUSED 10.0.0.1:27017') });
  const { getService } = makeGetService(service);
  const { immediate, final, patches } = await invoke(handleTask, {
    interaction: interaction({ options: [{ name: SUB_LIST, options: [] }] }),
    getService,
  });

  check('ยังตอบ deferred ตามปกติ', immediate.type === DEFERRED);
  check('ยังแก้ข้อความเดิมเสมอ (ไม่ปล่อยค้าง)', patches.length === 1, String(patches.length));
  check('บอกผู้ใช้ว่าระบบมีปัญหา', final === 'ระบบ task ใช้ไม่ได้ชั่วคราว ลองใหม่อีกครั้ง', final);
  check('ไม่หลุดรายละเอียดภายในไปหาผู้ใช้', !final.includes('ECONNREFUSED'), final);
}

console.log('\n=== /task <subcommand ที่ไม่รู้จัก> -> ตอบทันที ไม่ defer ไม่แตะฐานข้อมูล ===');
{
  const service = fakeService();
  const { getService, state } = makeGetService(service);
  const { immediate, deferCount, patches } = await invoke(handleTask, {
    interaction: interaction({ options: [{ name: 'bogus-sub', options: [] }] }),
    getService,
  });

  check('ตอบเป็นข้อความทันที ไม่ใช่ deferred', immediate.type === MESSAGE, String(immediate.type));
  check('ตอบว่าไม่รู้จักคำสั่งย่อย', immediate.data.content === 'ไม่รู้จักคำสั่งย่อยนี้', immediate.data.content);
  check('ไม่ฝากงานต่อเลย', deferCount === 0, String(deferCount));
  check('ไม่ยิง webhook ตามไป', patches.length === 0, String(patches.length));
  check('ไม่เรียก getService เลย (ไม่เปิด connection ทิ้งเปล่าๆ)', state.count === 0, String(state.count));
}

console.log('\n=== /mytask: มีงานที่มอบหมายให้ ===');
{
  const undone = Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, name: `MyTask-${i + 1}`, done: false }));
  const done = [{ id: 'md1', name: 'MyDone', done: true }];
  const service = fakeService({ listMyTasksResult: [...done, ...undone] });
  const { getService } = makeGetService(service);
  const { immediate, final } = await invoke(handleMyTask, {
    interaction: interaction({ guildId: 'g1', actorId: 'actor-5' }),
    getService,
  });

  check('ตอบ deferred ก่อนเหมือน /task', immediate.type === DEFERRED, String(immediate.type));
  check('ยิง listMyTasks ด้วย guildId/actorId ถูกต้อง', service.calls.listMyTasks[0]?.guildId === 'g1' && service.calls.listMyTasks[0]?.actorId === 'actor-5', JSON.stringify(service.calls.listMyTasks[0]));
  check('แสดงงานที่ยังไม่เสร็จ', final.includes('MyTask-1'), final);
  check('ไม่แสดงงานที่เสร็จแล้ว', !final.includes('MyDone'), final);
}

console.log('\n=== /mytask: ไม่มีงานที่มอบหมายให้ ===');
{
  const service = fakeService({ listMyTasksResult: [] });
  const { getService } = makeGetService(service);
  const { final } = await invoke(handleMyTask, {
    interaction: interaction({ guildId: 'g1', actorId: 'actor-nobody' }),
    getService,
  });

  check('แจ้งว่าไม่มีงานมอบหมาย', final === 'ยังไม่มีงานที่มอบหมายให้คุณในเซิร์ฟเวอร์นี้ 🎉', final);
}

console.log('\n=== DM (ไม่มี guild_id): ตอบทันที ไม่ defer ไม่แตะฐานข้อมูล ===');
{
  const { getService: getTaskService, state: taskState } = makeGetService(fakeService());
  const taskResult = await invoke(handleTask, {
    interaction: interaction({ guildId: null, options: [{ name: SUB_LIST, options: [] }] }),
    getService: getTaskService,
  });
  check('/task ตอบทันที ไม่ deferred', taskResult.immediate.type === MESSAGE, String(taskResult.immediate.type));
  check('/task แจ้งว่าใช้ได้เฉพาะในเซิร์ฟเวอร์', taskResult.immediate.data.content.includes('เฉพาะในเซิร์ฟเวอร์'), taskResult.immediate.data.content);
  check('/task ไม่ฝากงานต่อ', taskResult.deferCount === 0);
  check('/task ไม่แตะ getService เลยตอนเป็น DM', taskState.count === 0, String(taskState.count));

  const { getService: getMyTaskService, state: myTaskState } = makeGetService(fakeService());
  const myResult = await invoke(handleMyTask, {
    interaction: interaction({ guildId: null }),
    getService: getMyTaskService,
  });
  check('/mytask ตอบทันที ไม่ deferred', myResult.immediate.type === MESSAGE, String(myResult.immediate.type));
  check('/mytask แจ้งว่าใช้ได้เฉพาะในเซิร์ฟเวอร์', myResult.immediate.data.content.includes('เฉพาะในเซิร์ฟเวอร์'), myResult.immediate.data.content);
  check('/mytask ไม่ฝากงานต่อ', myResult.deferCount === 0);
  check('/mytask ไม่แตะ getService เลยตอนเป็น DM', myTaskState.count === 0, String(myTaskState.count));
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
