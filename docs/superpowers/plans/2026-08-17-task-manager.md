# Task Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มระบบจัดการ task ผูกกับ Discord server เข้า Anomsg พร้อมหน้าเว็บสำหรับ add/edit และคำสั่ง `/web` `/task` `/mytask`

**Architecture:** กฎสิทธิ์ทั้งหมดอยู่ใน `lib/tasks-service.js` ที่รับ repository เข้ามา ทำให้ทดสอบได้โดยไม่ต้องมี MongoDB จริง ทั้ง API ฝั่งเว็บและคำสั่ง Discord เรียก service ตัวเดียวกัน หน้าเว็บเป็นไฟล์นิ่งใน `public/` ที่คุยกับ JSON API ไม่มี build step ยืนยันตัวตนด้วย Discord OAuth2 เก็บ session เป็น signed cookie แบบ stateless

**Tech Stack:** Node 20+ ESM, Vercel Functions (Web Handler signature), mongoose + MongoDB Atlas, discord-interactions, vanilla JS/CSS

**Spec:** `docs/superpowers/specs/2026-08-17-task-manager-design.md`

## Global Constraints

- `npm test` ต้องรันได้โดย **ไม่ต้องใช้เน็ต ไม่ต้องใช้ token จริง ไม่ต้องมี MongoDB** — เทสต์ทุกไฟล์ต้องรักษาคุณสมบัตินี้
- ไฟล์ทุกไฟล์ที่ไม่ใช่ endpoint ต้องอยู่ **นอก `/api`** เพราะ Vercel deploy ทุกไฟล์ใน `/api` เป็น function
- ชื่อคำสั่งและ option ประกาศใน `lib/commands.js` ที่เดียว **ห้าม hardcode ซ้ำที่อื่น**
- `/send` **ห้ามแตะฐานข้อมูล task** ทั้งอ่านและเขียน ห้าม import ข้ามกัน
- `actorId` มาจาก session cookie หรือ `interaction.member.user.id` เสมอ **ห้ามรับจาก query string หรือ body**
- `updateTask` รับเฉพาะ `name` `description` `done` `assignee` `dueDate` — ฟิลด์อื่นทิ้ง
- ข้อมูลจากผู้ใช้ใส่เข้า DOM ผ่าน **`textContent` เท่านั้น** ห้าม `innerHTML`
- ไม่ตั้ง `MONGODB_URI` = ปิดฟีเจอร์ task ทั้งชุด บอทเดิมต้องทำงานครบ
- commit message เป็นภาษาอังกฤษ ไม่มี co-author trailer
- เทสต์เขียนสไตล์เดียวกับของเดิม: ฟังก์ชัน `check()` ในไฟล์ แล้วจบด้วย `process.exit(fail === 0 ? 0 : 1)`

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/errors.js` | `ValidationError` `ForbiddenError` `NotFoundError` |
| `lib/tasks-service.js` | ตรรกะ + กฎสิทธิ์ + การตรวจข้อมูล (รับ repo เข้ามา) |
| `lib/models/task.js` | mongoose schema |
| `lib/db.js` | cache connection บน `globalThis` |
| `lib/tasks-repo.js` | repo จริงด้วย mongoose + `getTasksService()` |
| `lib/web.js` | handler `/web` |
| `lib/task.js` | handler `/task list`, `/task add` |
| `lib/mytask.js` | handler `/mytask` |
| `lib/session.js` | เซ็น/ตรวจ session cookie |
| `api/me.js` | `GET /api/me` |
| `api/auth/login.js` `api/auth/callback.js` `api/auth/logout.js` | OAuth2 |
| `api/tasks.js` `api/tasks/me.js` | REST endpoints |
| `public/index.html` `public/app.js` `public/style.css` | หน้าเว็บ |

---

# เฟส 1 — Discord ใช้งานได้ครบ (Task 1-5)

จบเฟสนี้แล้ว merge และใช้งานจริงได้เลย ยังไม่มีเว็บ

---

### Task 1: Error types และ tasks-service (กฎสิทธิ์)

หัวใจของทั้งระบบ ทำก่อนทุกอย่างเพราะที่เหลือขึ้นกับตัวนี้

**Files:**
- Create: `lib/errors.js`
- Create: `lib/tasks-service.js`
- Test: `test/tasks-service.test.mjs`
- Modify: `package.json` (เพิ่มไฟล์เทสต์เข้า script `test`)

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `class ValidationError extends Error`, `ForbiddenError`, `NotFoundError` จาก `lib/errors.js`
  - `createTasksService(repo)` คืน object ที่มี:
    - `listTasks({ guildId }) → Promise<Task[]>`
    - `listMyTasks({ guildId, actorId }) → Promise<Task[]>`
    - `createTask({ guildId, actorId, data }) → Promise<Task>`
    - `updateTask({ taskId, guildId, actorId, patch }) → Promise<Task>`
    - `deleteTask({ taskId, guildId, actorId }) → Promise<void>`
  - repo interface ที่ Task 3 ต้อง implement:
    - `findByGuild(guildId) → Promise<Task[]>`
    - `findByAssignee(guildId, actorId) → Promise<Task[]>`
    - `findById(taskId) → Promise<Task|null>`
    - `insert(doc) → Promise<Task>`
    - `updateById(taskId, patch) → Promise<Task>`
    - `deleteById(taskId) → Promise<void>`
  - รูปร่าง Task: `{ id, guildId, name, description, done, assignee, dueDate, createdBy, createdAt }`

- [ ] **Step 1: เขียน `lib/errors.js`**

```js
// error ที่ service โยนออกมา route แปลงเป็น HTTP อีกที service ไม่รู้จัก HTTP
export class ValidationError extends Error {}
export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}
```

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `test/tasks-service.test.mjs`:

```js
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
  return {
    rows: () => rows,
    async findByGuild(guildId) { return rows.filter((r) => r.guildId === guildId); },
    async findByAssignee(guildId, actorId) {
      return rows.filter((r) => r.guildId === guildId && r.assignee === actorId);
    },
    async findById(id) { return rows.find((r) => r.id === id) ?? null; },
    async insert(doc) { const row = { id: String(nextId++), ...doc }; rows.push(row); return row; },
    async updateById(id, patch) {
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
```

- [ ] **Step 3: รันเทสต์ให้เห็นว่าล้ม**

Run: `node test/tasks-service.test.mjs`
Expected: FAIL — `Cannot find module '../lib/tasks-service.js'`

- [ ] **Step 4: เขียน `lib/tasks-service.js` ให้ผ่าน**

```js
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
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `node test/tasks-service.test.mjs`
Expected: PASS ทุกเคส `FAIL: 0`

- [ ] **Step 6: ต่อเทสต์เข้า npm test**

แก้ `package.json` script `test` ให้มี `node test/tasks-service.test.mjs &&` ต่อจาก `node test/commands.test.mjs &&`

Run: `npm test`
Expected: ทุกชุดผ่าน

- [ ] **Step 7: Commit**

```bash
git add lib/errors.js lib/tasks-service.js test/tasks-service.test.mjs package.json
git commit -m "Feat: task service with ownership rules and field whitelist"
```

---

### Task 2: MongoDB model, connection cache และ repo

**Files:**
- Create: `lib/models/task.js`
- Create: `lib/db.js`
- Create: `lib/tasks-repo.js`
- Modify: `package.json` (เพิ่ม dependency `mongoose`)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `createTasksService(repo)` จาก Task 1
- Produces:
  - `isTasksEnabled() → boolean` — จริงเมื่อมี `MONGODB_URI`
  - `getTasksService() → Promise<service>` — ต่อ DB แล้วคืน service ที่ผูกกับ repo จริง

ไม่มีเทสต์อัตโนมัติสำหรับ task นี้ เพราะเป็นชั้นที่คุยกับ MongoDB จริง ซึ่งขัดกับข้อบังคับว่าเทสต์ต้องรันออฟไลน์ ตรรกะทั้งหมดอยู่ใน Task 1 แล้วและมีเทสต์ครบ ชั้นนี้บางมากโดยตั้งใจ

- [ ] **Step 1: ติดตั้ง mongoose**

```bash
npm install mongoose
```

- [ ] **Step 2: เขียน `lib/models/task.js`**

```js
import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  name: { type: String, required: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 2000 },
  done: { type: Boolean, default: false },
  assignee: { type: String, default: null },
  dueDate: { type: Date, default: null },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// query หลัก: task ของเซิร์ฟเวอร์นี้ แยกเสร็จ/ไม่เสร็จ เรียงตามกำหนดส่ง
taskSchema.index({ guildId: 1, done: 1, dueDate: 1 });

export const TaskModel = mongoose.models.Task ?? mongoose.model('Task', taskSchema);
```

- [ ] **Step 3: เขียน `lib/db.js`**

```js
import mongoose from 'mongoose';

// cache connection ไว้บน globalThis แล้วใช้ซ้ำตลอดอายุ instance
// ห้ามเรียก connect() ตอนโหลด module ไม่งั้นทุก cold start จะเปิด connection ใหม่
// จนเต็ม pool ของ Atlas M0 ที่จำกัด 500 connections
const cache = (globalThis._anomsgMongo ??= { conn: null, promise: null });

export function isTasksEnabled() {
  return Boolean(process.env.MONGODB_URI);
}

export async function connectDb() {
  if (cache.conn) return cache.conn;
  cache.promise ??= mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false });
  cache.conn = await cache.promise;
  return cache.conn;
}
```

- [ ] **Step 4: เขียน `lib/tasks-repo.js`**

```js
import { connectDb } from './db.js';
import { TaskModel } from './models/task.js';
import { createTasksService } from './tasks-service.js';

function toTask(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    guildId: doc.guildId,
    name: doc.name,
    description: doc.description,
    done: doc.done,
    assignee: doc.assignee,
    dueDate: doc.dueDate,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
  };
}

const repo = {
  async findByGuild(guildId) {
    const docs = await TaskModel.find({ guildId }).sort({ done: 1, dueDate: 1 }).lean();
    return docs.map(toTask);
  },
  async findByAssignee(guildId, actorId) {
    const docs = await TaskModel.find({ guildId, assignee: actorId }).sort({ done: 1, dueDate: 1 }).lean();
    return docs.map(toTask);
  },
  async findById(taskId) {
    if (!/^[0-9a-f]{24}$/i.test(String(taskId))) return null; // กัน CastError จาก id มั่ว
    return toTask(await TaskModel.findById(taskId).lean());
  },
  async insert(doc) {
    return toTask((await TaskModel.create(doc)).toObject());
  },
  async updateById(taskId, patch) {
    return toTask(await TaskModel.findByIdAndUpdate(taskId, patch, { new: true }).lean());
  },
  async deleteById(taskId) {
    await TaskModel.findByIdAndDelete(taskId);
  },
};

export async function getTasksService() {
  await connectDb();
  return createTasksService(repo);
}
```

- [ ] **Step 5: เพิ่ม env ใน `.env.example`**

```
# --- ระบบ task (ไม่บังคับ) ---
# ถ้าเว้นว่างไว้ ฟีเจอร์ task จะถูกปิดทั้งชุด บอทเดิมยังทำงานปกติ
MONGODB_URI=
```

- [ ] **Step 6: ยืนยันว่าไม่ทำของเดิมพัง**

Run: `npm test`
Expected: ทุกชุดผ่านเหมือนเดิม (ไฟล์ใหม่ยังไม่ถูก import จากที่ไหน)

- [ ] **Step 7: Commit**

```bash
git add lib/models/task.js lib/db.js lib/tasks-repo.js package.json package-lock.json .env.example
git commit -m "Feat: MongoDB model and repository with cached serverless connection"
```

---

### Task 3: ประกาศคำสั่งใหม่ใน lib/commands.js

**Files:**
- Modify: `lib/commands.js`
- Modify: `test/commands.test.mjs`

**Interfaces:**
- Consumes: ไม่มี
- Produces: constant `WEB = 'web'`, `TASK = 'task'`, `MYTASK = 'mytask'`, `OPT_NAME = 'name'`, `OPT_ASSIGNEE = 'assignee'`, `SUB_LIST = 'list'`, `SUB_ADD = 'add'` และ definition ใน `COMMAND_DEFINITIONS`

- [ ] **Step 1: เพิ่ม constant และ definition ใน `lib/commands.js`**

ต่อท้าย constant เดิม:

```js
export const WEB = 'web';
export const TASK = 'task';
export const MYTASK = 'mytask';

export const OPT_NAME = 'name';
export const OPT_ASSIGNEE = 'assignee';

export const SUB_LIST = 'list';
export const SUB_ADD = 'add';
```

เพิ่มใน `OPTION_TYPE`:

```js
  SUB_COMMAND: 1,
  USER: 6,
```

เพิ่มสามรายการเข้า `COMMAND_DEFINITIONS` ต่อจาก `PING`:

```js
  {
    name: WEB,
    description: 'เปิดลิงก์หน้าเว็บสำหรับจัดการ task',
  },
  {
    name: MYTASK,
    description: 'ดู task ที่มอบหมายให้คุณในเซิร์ฟเวอร์นี้',
  },
  {
    name: TASK,
    description: 'จัดการ task ของเซิร์ฟเวอร์นี้',
    options: [
      {
        name: SUB_LIST,
        type: OPTION_TYPE.SUB_COMMAND,
        description: 'ดู task ที่ยังไม่เสร็จ',
      },
      {
        name: SUB_ADD,
        type: OPTION_TYPE.SUB_COMMAND,
        description: 'เพิ่ม task ใหม่',
        options: [
          {
            name: OPT_NAME,
            type: OPTION_TYPE.STRING,
            description: 'ชื่องาน',
            required: true,
            min_length: 1,
            max_length: 200,
          },
          {
            name: OPT_ASSIGNEE,
            type: OPTION_TYPE.USER,
            description: 'ผู้รับผิดชอบ (ไม่บังคับ)',
            required: false,
          },
        ],
      },
    ],
  },
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าล้ม**

Run: `node test/commands.test.mjs`
Expected: FAIL — `/web`, `/mytask`, `/task` ตกไปที่ "ไม่รู้จักคำสั่งนี้" เพราะยังไม่มี handler

นี่คือเทสต์ที่เราตั้งใจให้จับกรณีนี้ตั้งแต่แรก — ยืนยันว่ามันทำงาน

- [ ] **Step 3: บันทึกว่าเทสต์จับได้ แล้วปล่อยล้มไว้ก่อน**

ยังไม่ต้องแก้ให้ผ่านใน task นี้ — handler มาใน Task 4 และ 5
อย่า commit ตอนที่เทสต์ยังล้ม ให้ทำ Task 4 ต่อทันทีแล้ว commit พร้อมกัน

---

### Task 4: handler `/web` และ `/mytask`

**Files:**
- Create: `lib/web.js`
- Create: `lib/mytask.js`
- Modify: `api/interactions.js` (เพิ่มเข้า `HANDLERS`)

**Interfaces:**
- Consumes: `ephemeral` จาก `lib/discord.js`, `isTasksEnabled` และ `getTasksService` จาก Task 2, constant จาก Task 3
- Produces: `handleWeb({ interaction, env })`, `handleMyTask({ interaction, env })` — คืน `Response`

- [ ] **Step 1: เขียน `lib/web.js`**

```js
import { isTasksEnabled } from './db.js';
import { ephemeral } from './discord.js';

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
```

- [ ] **Step 2: เขียน `lib/mytask.js`**

```js
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
```

- [ ] **Step 3: ผูกเข้า `api/interactions.js`**

เพิ่ม import:

```js
import { MYTASK, PING, SEND, WEB } from '../lib/commands.js';
import { handleMyTask } from '../lib/mytask.js';
import { handleWeb } from '../lib/web.js';
```

เพิ่มใน `HANDLERS`:

```js
  [WEB]: handleWeb,
  [MYTASK]: handleMyTask,
```

- [ ] **Step 4: รันเทสต์**

Run: `node test/commands.test.mjs`
Expected: `/web` และ `/mytask` ผ่านแล้ว แต่ `/task` ยังล้ม (handler มาใน Task 5)

- [ ] **Step 5: อย่าเพิ่ง commit**

ทำ Task 5 ต่อทันทีเพื่อให้ commit ตอนเทสต์เขียวทั้งหมด

---

### Task 5: handler `/task list` และ `/task add`

**Files:**
- Create: `lib/task.js`
- Modify: `api/interactions.js`
- Modify: `test/commands.test.mjs` (รองรับคำสั่งที่มี subcommand)

**Interfaces:**
- Consumes: `formatTaskLine` จาก `lib/mytask.js`, `getTasksService` จาก Task 2, constant จาก Task 3
- Produces: `handleTask({ interaction, env })`

- [ ] **Step 1: เขียน `lib/task.js`**

```js
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
```

- [ ] **Step 2: ผูกเข้า `api/interactions.js`**

เพิ่ม `TASK` เข้า import จาก `lib/commands.js`, เพิ่ม `import { handleTask } from '../lib/task.js';` แล้วเพิ่ม `[TASK]: handleTask,` ใน `HANDLERS`

- [ ] **Step 3: แก้เทสต์ให้รองรับคำสั่งที่มี subcommand**

ใน `test/commands.test.mjs` ส่วน "ทุกคำสั่งที่ประกาศไว้ ต้องมี handler รับจริง" เปลี่ยน body ที่ส่งให้ใส่ subcommand แรกเมื่อ definition มี option ชนิด 1:

```js
    const firstSub = (command.options ?? []).find((o) => o.type === 1);
    const data = firstSub
      ? { name: command.name, options: [{ name: firstSub.name, type: 1, options: [] }] }
      : { name: command.name };
    const body = JSON.stringify({ type: 2, id: '1', channel_id: '999', guild_id: 'g1', data });
```

เพิ่มเคสใหม่ต่อท้ายไฟล์ ก่อนบรรทัดสรุป:

```js
console.log('\n=== คำสั่ง task ต้องปิดตัวเองเมื่อยังไม่ตั้ง MONGODB_URI ===');
{
  delete process.env.MONGODB_URI;
  const { handleWeb } = await import('../lib/web.js');
  const res = handleWeb({ interaction: { guild_id: 'g1' }, env: { PUBLIC_BASE_URL: 'https://x.test' } });
  const json = await res.json();
  check('/web แจ้งว่ายังไม่เปิดใช้งาน', json.data.content.includes('ยังไม่ได้เปิดใช้งาน'), json.data?.content);
}
```

- [ ] **Step 4: รันเทสต์ทั้งหมด**

Run: `npm test`
Expected: ทุกชุดผ่าน `FAIL: 0` — รวมถึงคำสั่งใหม่ทั้ง 3 ตัวมี handler

- [ ] **Step 5: Commit**

```bash
git add lib/commands.js lib/web.js lib/mytask.js lib/task.js api/interactions.js test/commands.test.mjs
git commit -m "Feat: /web, /task list, /task add and /mytask commands"
```

---

## ✅ จุดหยุดส่งมอบเฟส 1

ถึงตรงนี้ merge ได้แล้ว — ตั้ง `MONGODB_URI` กับ `PUBLIC_BASE_URL` บน Vercel, deploy, แล้ว `npm run register`
บอทจัดการ task ผ่าน Discord ได้ครบ `/web` จะให้ลิงก์ที่ยังเปิดไม่ได้จนกว่าจะจบเฟส 2

---

# เฟส 2 — หน้าเว็บ (Task 6-9)

---

### Task 6: session cookie

**Files:**
- Create: `lib/session.js`
- Test: `test/session.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `signSession({ uid, name, gid }, secret) → string`
  - `verifySession(value, secret) → { uid, name, gid, exp } | null`
  - `sessionCookie(value) → string` (Set-Cookie header, 7 วัน)
  - `clearCookie() → string`
  - `readCookie(request, name) → string | null`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `test/session.test.mjs`:

```js
import { clearCookie, readCookie, sessionCookie, signSession, verifySession } from '../lib/session.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

const SECRET = 'test-secret';

console.log('\n=== เซ็นแล้วตรวจกลับได้ ===');
{
  const token = signSession({ uid: '123', name: 'somchai', gid: 'g1' }, SECRET);
  const data = verifySession(token, SECRET);
  check('อ่าน uid กลับมาได้', data?.uid === '123');
  check('อ่าน guild กลับมาได้', data?.gid === 'g1');
  check('มีวันหมดอายุ', typeof data?.exp === 'number');
}

console.log('\n=== แก้ payload แล้วต้องไม่ผ่าน ===');
{
  const token = signSession({ uid: '123', name: 'somchai', gid: 'g1' }, SECRET);
  const [payload, sig] = token.split('.');
  const evil = Buffer.from(JSON.stringify({ uid: '999', name: 'hacker', gid: 'g1', exp: 9e12 }))
    .toString('base64url');
  check('payload ปลอมต้องไม่ผ่าน', verifySession(`${evil}.${sig}`, SECRET) === null);
  check('ลายเซ็นมั่วต้องไม่ผ่าน', verifySession(`${payload}.deadbeef`, SECRET) === null);
  check('secret คนละตัวต้องไม่ผ่าน', verifySession(token, 'other-secret') === null);
  check('ค่าเพี้ยนต้องไม่ crash', verifySession('ขยะ', SECRET) === null);
  check('ค่าว่างต้องไม่ผ่าน', verifySession('', SECRET) === null);
}

console.log('\n=== หมดอายุแล้วต้องไม่ผ่าน ===');
{
  const expired = signSession({ uid: '1', name: 'x', gid: 'g1' }, SECRET, -1000);
  check('token หมดอายุต้องไม่ผ่าน', verifySession(expired, SECRET) === null);
}

console.log('\n=== รูปแบบ cookie ===');
{
  const header = sessionCookie('abc');
  check('เป็น HttpOnly', header.includes('HttpOnly'));
  check('เป็น Secure', header.includes('Secure'));
  check('SameSite=Lax', header.includes('SameSite=Lax'));
  check('มีอายุ 7 วัน', header.includes('Max-Age=604800'), header);
  check('clearCookie ตั้งอายุเป็น 0', clearCookie().includes('Max-Age=0'));
}

console.log('\n=== อ่าน cookie จาก request ===');
{
  const req = new Request('https://x.test', { headers: { cookie: 'a=1; anomsg_session=xyz; b=2' } });
  check('อ่านค่าที่ต้องการได้', readCookie(req, 'anomsg_session') === 'xyz');
  check('ไม่มี cookie คืน null', readCookie(new Request('https://x.test'), 'anomsg_session') === null);
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `node test/session.test.mjs`
Expected: FAIL — `Cannot find module '../lib/session.js'`

- [ ] **Step 3: เขียน `lib/session.js`**

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'anomsg_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signSession({ uid, name, gid }, secret, ttlSeconds = MAX_AGE_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ uid, name, gid, exp })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(value, secret) {
  try {
    const [payload, signature] = String(value).split('.');
    if (!payload || !signature) return null;

    const expected = sign(payload, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    // เทียบแบบเวลาคงที่ กันการเดาลายเซ็นทีละไบต์
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function sessionCookie(value) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `node test/session.test.mjs`
Expected: PASS `FAIL: 0`

- [ ] **Step 5: ต่อเข้า npm test แล้ว commit**

เพิ่ม `node test/session.test.mjs &&` เข้า script `test` แล้ว:

```bash
npm test
git add lib/session.js test/session.test.mjs package.json
git commit -m "Feat: stateless signed session cookies"
```

---

### Task 7: OAuth2 login, callback, logout, /api/me

**Files:**
- Create: `lib/oauth.js`
- Create: `api/auth/login.js`
- Create: `api/auth/callback.js`
- Create: `api/auth/logout.js`
- Create: `api/me.js`
- Test: `test/auth.test.mjs`
- Modify: `package.json`, `.env.example`

**Interfaces:**
- Consumes: `signSession` `verifySession` `sessionCookie` `clearCookie` `readCookie` `SESSION_COOKIE` จาก Task 6
- Produces จาก `lib/oauth.js`:
  - `redirectUri(env) → string`
  - `authorizeUrl({ env, state }) → string`
  - `completeLogin({ code, guildId, env, fetchImpl }) → Promise<{ uid, name, gid }>` — โยน `ForbiddenError` ถ้าไม่ได้อยู่ใน guild
  - (`exchangeCode` และ `getJson` เป็นฟังก์ชันภายใน ไม่ export)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `test/auth.test.mjs`:

```js
import { completeLogin } from '../lib/oauth.js';
import { ForbiddenError } from '../lib/errors.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

const ENV = {
  DISCORD_CLIENT_ID: 'app-1',
  DISCORD_CLIENT_SECRET: 'secret-1',
  PUBLIC_BASE_URL: 'https://anomsg.test',
};

// จำลอง Discord: token -> identity -> guild list
function fakeDiscord({ guildIds = ['g1'] } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'tok-1' }), { status: 200 });
    }
    if (String(url).endsWith('/users/@me')) {
      return new Response(JSON.stringify({ id: 'u1', username: 'somchai' }), { status: 200 });
    }
    if (String(url).endsWith('/users/@me/guilds')) {
      return new Response(JSON.stringify(guildIds.map((id) => ({ id }))), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  impl.calls = calls;
  return impl;
}

console.log('\n=== ล็อกอินสำเร็จเมื่ออยู่ในเซิร์ฟเวอร์จริง ===');
{
  const impl = fakeDiscord({ guildIds: ['g1', 'g2'] });
  const session = await completeLogin({ code: 'c1', guildId: 'g1', env: ENV, fetchImpl: impl });
  check('ได้ uid', session.uid === 'u1');
  check('ได้ชื่อ', session.name === 'somchai');
  check('ผูกกับ guild ที่ขอ', session.gid === 'g1');
  check('ไม่ส่ง client secret ไปที่อื่นนอกจาก token endpoint',
    impl.calls.filter((c) => JSON.stringify(c.init ?? {}).includes('secret-1')).length === 1);
}

console.log('\n=== ไม่ได้อยู่ในเซิร์ฟเวอร์ -> ต้องปฏิเสธ ===');
{
  const impl = fakeDiscord({ guildIds: ['g-other'] });
  try {
    await completeLogin({ code: 'c1', guildId: 'g1', env: ENV, fetchImpl: impl });
    check('ต้องโยน ForbiddenError', false, 'ไม่ได้โยน');
  } catch (err) {
    check('ต้องโยน ForbiddenError', err instanceof ForbiddenError, err.constructor.name);
  }
}

console.log('\n=== Discord ปฏิเสธ code -> ต้องไม่สร้าง session ===');
{
  const impl = async (url) => (String(url).endsWith('/oauth2/token')
    ? new Response('{"error":"invalid_grant"}', { status: 400 })
    : new Response('{}', { status: 200 }));
  try {
    await completeLogin({ code: 'bad', guildId: 'g1', env: ENV, fetchImpl: impl });
    check('ต้องโยน error', false, 'ไม่ได้โยน');
  } catch (err) {
    check('ต้องโยน error', err instanceof Error);
  }
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `node test/auth.test.mjs`
Expected: FAIL — `Cannot find module '../lib/oauth.js'`

- [ ] **Step 3: เขียน `lib/oauth.js`**

```js
import { ForbiddenError } from './errors.js';

const DISCORD_API = 'https://discord.com/api/v10';

export function redirectUri(env) {
  return `${env.PUBLIC_BASE_URL}/api/auth/callback`;
}

export function authorizeUrl({ env, state }) {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchangeCode(code, env, fetchImpl) {
  const res = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(env),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function getJson(path, accessToken, fetchImpl) {
  const res = await fetchImpl(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

/**
 * แลก code เป็นตัวตน แล้วยืนยันว่าคนนี้อยู่ใน guild ที่ขอเข้าจริง
 * ด่านนี้คือความปลอดภัยหลัก guild id ไม่ใช่ความลับ ใครก็เดาได้
 */
export async function completeLogin({ code, guildId, env, fetchImpl = fetch }) {
  const accessToken = await exchangeCode(code, env, fetchImpl);
  const user = await getJson('/users/@me', accessToken, fetchImpl);
  const guilds = await getJson('/users/@me/guilds', accessToken, fetchImpl);

  if (!guilds.some((guild) => guild.id === guildId)) {
    throw new ForbiddenError('คุณไม่ได้อยู่ในเซิร์ฟเวอร์นี้');
  }
  return { uid: user.id, name: user.username, gid: guildId };
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `node test/auth.test.mjs`
Expected: PASS `FAIL: 0`

- [ ] **Step 5: เขียน `api/auth/login.js`**

```js
import { randomUUID } from 'node:crypto';
import { authorizeUrl } from '../../lib/oauth.js';

const STATE_COOKIE = 'anomsg_oauth';

export function GET(request) {
  const guildId = new URL(request.url).searchParams.get('guild') ?? '';
  if (!/^\d{17,20}$/.test(guildId)) {
    return new Response('guild ไม่ถูกต้อง', { status: 400 });
  }

  const state = `${randomUUID()}.${guildId}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl({ env: process.env, state }),
      // เก็บ state ไว้เทียบตอน callback เพื่อกัน CSRF ตอน login
      'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
```

- [ ] **Step 6: เขียน `api/auth/callback.js`**

```js
import { ForbiddenError } from '../../lib/errors.js';
import { completeLogin } from '../../lib/oauth.js';
import { readCookie, sessionCookie, signSession } from '../../lib/session.js';

const STATE_COOKIE = 'anomsg_oauth';

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = readCookie(request, STATE_COOKIE);

  if (!code || !state || state !== saved) {
    return new Response('การล็อกอินไม่ถูกต้อง กรุณาเริ่มใหม่จากคำสั่ง /web', { status: 400 });
  }

  const guildId = state.split('.')[1];

  try {
    const session = await completeLogin({ code, guildId, env: process.env });
    const token = signSession(session, process.env.SESSION_SECRET);
    return new Response(null, {
      status: 302,
      headers: [
        // redirect ไปได้เฉพาะ path ภายในเว็บเรา ไม่รับ URL จาก query string
        ['Location', `/?guild=${encodeURIComponent(guildId)}`],
        ['Set-Cookie', sessionCookie(token)],
        ['Set-Cookie', `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`],
      ],
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response(err.message, { status: 403 });
    console.error('oauth callback failed:', err);
    return new Response('ล็อกอินไม่สำเร็จ ลองใหม่อีกครั้ง', { status: 500 });
  }
}
```

- [ ] **Step 7: เขียน `api/auth/logout.js` และ `api/me.js`**

`api/auth/logout.js`:

```js
import { clearCookie } from '../../lib/session.js';

export function POST() {
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie() } });
}
```

`api/me.js`:

```js
import { SESSION_COOKIE, readCookie, verifySession } from '../lib/session.js';

export function GET(request) {
  const session = verifySession(readCookie(request, SESSION_COOKIE), process.env.SESSION_SECRET);
  if (!session) return Response.json({ error: 'ยังไม่ได้ล็อกอิน' }, { status: 401 });
  return Response.json({ uid: session.uid, name: session.name, gid: session.gid });
}
```

- [ ] **Step 8: เพิ่ม env ใน `.env.example` แล้ว commit**

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
SESSION_SECRET=
PUBLIC_BASE_URL=
```

เพิ่ม `node test/auth.test.mjs &&` เข้า script `test` แล้ว:

```bash
npm test
git add lib/oauth.js api/auth api/me.js test/auth.test.mjs package.json .env.example
git commit -m "Feat: Discord OAuth2 login with guild membership check"
```

---

### Task 8: REST endpoints ของ task

**Files:**
- Create: `lib/api-helpers.js`
- Create: `api/tasks.js`
- Create: `api/tasks/me.js`
- Test: `test/api-tasks.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `verifySession` `readCookie` `SESSION_COOKIE` จาก Task 6, `getTasksService` จาก Task 2, error types จาก Task 1
- Produces: `requireSession(request) → session | null`, `errorResponse(err) → Response`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `test/api-tasks.test.mjs`:

```js
import { errorResponse } from '../lib/api-helpers.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

console.log('\n=== แปลง error เป็น HTTP ===');
{
  check('ValidationError -> 400', errorResponse(new ValidationError('x')).status === 400);
  check('ForbiddenError -> 403', errorResponse(new ForbiddenError('x')).status === 403);
  check('NotFoundError -> 404', errorResponse(new NotFoundError('x')).status === 404);
  check('error อื่น -> 500', errorResponse(new Error('boom')).status === 500);
}

console.log('\n=== ไม่ส่งรายละเอียดภายในออกไป ===');
{
  const res = errorResponse(new Error('connect ECONNREFUSED 10.0.0.1:27017'));
  const body = await res.json();
  check('ไม่มีข้อความ error ดิบหลุดออกไป', !body.error.includes('ECONNREFUSED'), body.error);
  check('ยังมีข้อความให้ผู้ใช้อ่าน', typeof body.error === 'string' && body.error.length > 0);
}

console.log('\n=== ข้อความของ error ที่ตั้งใจแสดง ต้องส่งถึงผู้ใช้ ===');
{
  const body = await errorResponse(new ValidationError('ชื่องานต้องยาว 1-200 ตัวอักษร')).json();
  check('ส่งข้อความ validation ตรงๆ', body.error.includes('1-200'), body.error);
}

// route ปฏิเสธก่อนแตะฐานข้อมูล จึงทดสอบได้โดยไม่ต้องมี MongoDB
console.log('\n=== route ต้องปฏิเสธก่อนแตะ DB ===');
{
  process.env.MONGODB_URI = 'mongodb://fake';
  process.env.SESSION_SECRET = 'test-secret';
  const tasks = await import('../api/tasks.js');

  const noCookie = new Request('https://x.test/api/tasks');
  check('ไม่มี session -> 401', (await tasks.GET(noCookie)).status === 401);

  const badCookie = new Request('https://x.test/api/tasks', {
    headers: { cookie: 'anomsg_session=ปลอม.ปลอม' },
  });
  check('session ปลอม -> 401', (await tasks.GET(badCookie)).status === 401);
  check('POST ก็ต้องกัน', (await tasks.POST(noCookie)).status === 401);
  check('PATCH ก็ต้องกัน', (await tasks.PATCH(noCookie)).status === 401);
  check('DELETE ก็ต้องกัน', (await tasks.DELETE(noCookie)).status === 401);

  delete process.env.MONGODB_URI;
  check('ปิดระบบ task -> 503', (await tasks.GET(noCookie)).status === 503);
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `node test/api-tasks.test.mjs`
Expected: FAIL — `Cannot find module '../lib/api-helpers.js'`

- [ ] **Step 3: เขียน `lib/api-helpers.js`**

```js
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { SESSION_COOKIE, readCookie, verifySession } from './session.js';

export function requireSession(request) {
  return verifySession(readCookie(request, SESSION_COOKIE), process.env.SESSION_SECRET);
}

export function errorResponse(err) {
  if (err instanceof ValidationError) return Response.json({ error: err.message }, { status: 400 });
  if (err instanceof ForbiddenError) return Response.json({ error: err.message }, { status: 403 });
  if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });

  // error ที่ไม่ได้ตั้งใจ อาจมีรายละเอียดภายในอย่าง host หรือ port ปนอยู่ ไม่ส่งออกไป
  console.error('unhandled api error:', err);
  return Response.json({ error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' }, { status: 500 });
}

export function unauthorized() {
  return Response.json({ error: 'ยังไม่ได้ล็อกอิน' }, { status: 401 });
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `node test/api-tasks.test.mjs`
Expected: PASS `FAIL: 0`

- [ ] **Step 5: เขียน `api/tasks.js`**

```js
import { errorResponse, requireSession, unauthorized } from '../lib/api-helpers.js';
import { isTasksEnabled } from '../lib/db.js';
import { getTasksService } from '../lib/tasks-repo.js';

// guild มาจาก session เสมอ ไม่รับจาก query string
// ไม่งั้นคนที่ล็อกอิน guild A จะยิง ?guild=B เพื่อดูงานของเซิร์ฟเวอร์อื่นได้
function context(request) {
  if (!isTasksEnabled()) return { error: Response.json({ error: 'ระบบ task ยังไม่เปิดใช้งาน' }, { status: 503 }) };
  const session = requireSession(request);
  if (!session) return { error: unauthorized() };
  return { session };
}

export async function GET(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    return Response.json(await service.listTasks({ guildId: session.gid }));
  } catch (err) { return errorResponse(err); }
}

export async function POST(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    const data = await request.json();
    const task = await service.createTask({ guildId: session.gid, actorId: session.uid, data });
    return Response.json(task, { status: 201 });
  } catch (err) { return errorResponse(err); }
}

export async function PATCH(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    const taskId = new URL(request.url).searchParams.get('id');
    const patch = await request.json();
    const task = await service.updateTask({ taskId, guildId: session.gid, actorId: session.uid, patch });
    return Response.json(task);
  } catch (err) { return errorResponse(err); }
}

export async function DELETE(request) {
  const { session, error } = context(request);
  if (error) return error;
  try {
    const service = await getTasksService();
    const taskId = new URL(request.url).searchParams.get('id');
    await service.deleteTask({ taskId, guildId: session.gid, actorId: session.uid });
    return new Response(null, { status: 204 });
  } catch (err) { return errorResponse(err); }
}
```

- [ ] **Step 6: เขียน `api/tasks/me.js`**

```js
import { errorResponse, requireSession, unauthorized } from '../../lib/api-helpers.js';
import { isTasksEnabled } from '../../lib/db.js';
import { getTasksService } from '../../lib/tasks-repo.js';

export async function GET(request) {
  if (!isTasksEnabled()) return Response.json({ error: 'ระบบ task ยังไม่เปิดใช้งาน' }, { status: 503 });
  const session = requireSession(request);
  if (!session) return unauthorized();

  try {
    const service = await getTasksService();
    // actorId มาจาก session เท่านั้น ไม่รับจาก query string
    return Response.json(await service.listMyTasks({ guildId: session.gid, actorId: session.uid }));
  } catch (err) { return errorResponse(err); }
}
```

- [ ] **Step 7: ต่อเข้า npm test แล้ว commit**

```bash
npm test
git add lib/api-helpers.js api/tasks.js api/tasks/me.js test/api-tasks.test.mjs package.json
git commit -m "Feat: task REST endpoints scoped to the session's guild"
```

---

### Task 9: หน้าเว็บ และเอกสาร

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`
- Test: `test/web-escape.test.mjs`
- Modify: `README.md`, `package.json`

**Interfaces:**
- Consumes: `/api/me`, `/api/tasks`, `/api/tasks/me`, `/api/auth/login`, `/api/auth/logout`
- Produces: `buildTaskRow(task, { canEdit }) → { id, nameText, descriptionText, done, dueText, canEdit, usesTextContent, html }` export จาก `public/app.js` เพื่อให้เทสต์เรียกได้ใน Node โดยไม่ต้องมี DOM

- [ ] **Step 1: เขียนเทสต์ XSS ที่ยังไม่ผ่าน**

สร้าง `test/web-escape.test.mjs`:

```js
// ยืนยันว่าชื่อ task ถูกใส่เข้า DOM แบบข้อความล้วน ไม่ใช่ HTML
import { buildTaskRow } from '../public/app.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

const EVIL = '<img src=x onerror=alert(1)>';

console.log('\n=== ชื่อ task ที่มี HTML ต้องกลายเป็นข้อความล้วน ===');
{
  const row = buildTaskRow({ id: '1', name: EVIL, description: '', done: false, assignee: null, dueDate: null },
    { canEdit: false });
  check('เก็บชื่อไว้ครบเป็นข้อความ', row.nameText === EVIL, row.nameText);
  check('ไม่สร้าง HTML จากชื่อ', !String(row.html ?? '').includes('<img'), String(row.html));
  check('ใช้ textContent ไม่ใช่ innerHTML', row.usesTextContent === true);
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `node test/web-escape.test.mjs`
Expected: FAIL — `Cannot find module '../public/app.js'`

- [ ] **Step 3: เขียน `public/app.js`**

เขียนให้ `buildTaskRow` เป็นฟังก์ชันบริสุทธิ์ที่คืนคำอธิบายของแถว แล้วให้ตัว render จริงเอาไปสร้าง element
วิธีนี้ทำให้เทสต์ตรวจได้โดยไม่ต้องมี DOM

```js
// คืนข้อมูลของแถวแบบบริสุทธิ์ ไม่แตะ DOM เพื่อให้เทสต์เรียกได้ใน Node
export function buildTaskRow(task, { canEdit }) {
  return {
    id: task.id,
    nameText: task.name,               // ข้อความล้วน จะถูกใส่ผ่าน textContent
    descriptionText: task.description ?? '',
    done: Boolean(task.done),
    dueText: task.dueDate ? new Date(task.dueDate).toLocaleDateString('th-TH') : '',
    canEdit,
    usesTextContent: true,             // สัญญาว่าไม่มี HTML จากผู้ใช้
    html: null,                        // ห้ามมีค่า ห้ามประกอบ HTML จากข้อมูลผู้ใช้
  };
}

// ส่วนด้านล่างรันเฉพาะในเบราว์เซอร์
if (typeof document !== 'undefined') {
  const params = new URLSearchParams(location.search);
  const state = { guild: params.get('guild'), me: null, filter: 'all' };

  const $ = (sel) => document.querySelector(sel);

  async function api(path, options) {
    const res = await fetch(path, { credentials: 'same-origin', ...options });
    if (res.status === 401) { state.me = null; render(); return null; }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'ผิดพลาด');
    return res.status === 204 ? null : res.json();
  }

  function renderRow(row) {
    const li = document.createElement('li');
    li.className = row.done ? 'task done' : 'task';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = row.done;
    box.disabled = !row.canEdit;
    box.addEventListener('change', async () => {
      await api(`/api/tasks?id=${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: box.checked }),
      });
      load();
    });

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = row.nameText;   // ห้ามเปลี่ยนเป็น innerHTML เด็ดขาด

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = row.dueText ? `ครบ ${row.dueText}` : '';

    li.append(box, name, meta);

    if (row.canEdit) {
      const del = document.createElement('button');
      del.textContent = 'ลบ';
      del.addEventListener('click', async () => {
        await api(`/api/tasks?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        load();
      });
      li.append(del);
    }
    return li;
  }

  async function load() {
    const path = state.filter === 'mine' ? '/api/tasks/me' : '/api/tasks';
    const tasks = await api(path);
    if (!tasks) return;

    const list = $('#list');
    list.replaceChildren();
    for (const task of tasks) {
      if (state.filter === 'done' && !task.done) continue;
      if (state.filter === 'all' && task.done) continue;
      const canEdit = task.createdBy === state.me.uid || task.assignee === state.me.uid;
      list.append(renderRow(buildTaskRow(task, { canEdit })));
    }
  }

  function render() {
    $('#login').hidden = Boolean(state.me);
    $('#app').hidden = !state.me;
    if (state.me) {
      $('#who').textContent = state.me.name;
      load();
    }
  }

  $('#login-btn').addEventListener('click', () => {
    location.href = `/api/auth/login?guild=${encodeURIComponent(state.guild ?? '')}`;
  });

  $('#logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    state.me = null;
    render();
  });

  $('#add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#add-name');
    if (!input.value.trim()) return;
    await api('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.value }),
    });
    input.value = '';
    load();
  });

  for (const button of document.querySelectorAll('[data-filter]')) {
    button.addEventListener('click', () => { state.filter = button.dataset.filter; load(); });
  }

  api('/api/me').then((me) => { state.me = me; if (!state.guild && me) state.guild = me.gid; render(); });
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `node test/web-escape.test.mjs`
Expected: PASS `FAIL: 0`

- [ ] **Step 5: เขียน `public/index.html`**

```html
<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anomsg Tasks</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
  <section id="login">
    <h1>Anomsg Tasks</h1>
    <p>เข้าสู่ระบบด้วย Discord เพื่อจัดการงานของเซิร์ฟเวอร์</p>
    <button id="login-btn">Login with Discord</button>
  </section>

  <section id="app" hidden>
    <header>
      <h1>Anomsg Tasks</h1>
      <span id="who"></span>
      <button id="logout-btn">ออก</button>
    </header>

    <nav>
      <button data-filter="all">ทั้งหมด</button>
      <button data-filter="mine">ของฉัน</button>
      <button data-filter="done">เสร็จแล้ว</button>
    </nav>

    <form id="add-form">
      <input id="add-name" placeholder="ชื่องานใหม่" maxlength="200" required>
      <button type="submit">เพิ่ม</button>
    </form>

    <ul id="list"></ul>
  </section>
</main>
<script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 6: เขียน `public/style.css`**

mobile-first ปุ่มสูงอย่างน้อย 44px รองรับ dark mode

```css
:root { --bg: #ffffff; --fg: #1a1a1a; --muted: #666; --line: #e0e0e0; --accent: #5865f2; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1e1f22; --fg: #f2f3f5; --muted: #a0a4ab; --line: #35373c; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 1rem; }
header { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
header h1 { font-size: 1.25rem; margin: 0; flex: 1; }
button { min-height: 44px; padding: 0 1rem; border: 1px solid var(--line);
  border-radius: 8px; background: transparent; color: inherit; font-size: 1rem; cursor: pointer; }
button[type="submit"], #login-btn { background: var(--accent); color: #fff; border-color: var(--accent); }
nav { display: flex; gap: .5rem; margin: 1rem 0; }
#add-form { display: flex; gap: .5rem; }
#add-form input { flex: 1; min-height: 44px; padding: 0 .75rem;
  border: 1px solid var(--line); border-radius: 8px; background: transparent;
  color: inherit; font-size: 1rem; }
ul { list-style: none; padding: 0; margin: 1rem 0 0; }
.task { display: flex; align-items: center; gap: .75rem; padding: .75rem 0;
  border-bottom: 1px solid var(--line); }
.task .name { flex: 1; }
.task.done .name { text-decoration: line-through; color: var(--muted); }
.task .meta { color: var(--muted); font-size: .875rem; }
.task input[type="checkbox"] { width: 22px; height: 22px; }
```

- [ ] **Step 7: แก้ README**

แทนที่บรรทัดในหัวข้อ "ข้อจำกัดตามการออกแบบ" ที่เขียนว่าไม่เก็บ log ด้วยหัวข้อใหม่ที่แยกสองส่วนชัดเจน:

```markdown
## อะไรถูกเก็บ อะไรไม่ถูกเก็บ

| ส่วน | เก็บอะไร |
|---|---|
| `/send` `/ping` | **ไม่เก็บอะไรเลย** ไม่มี log ว่าใครส่งอะไร ตามหาย้อนหลังไม่ได้ ตัวนับ rate limit เก็บเฉพาะ id ที่ hash แล้วและหมดอายุใน 1 นาที |
| ระบบ task | **เก็บ Discord user id ถาวร** ในฟิลด์ `createdBy` และ `assignee` เพื่อให้รู้ว่าใครเป็นเจ้าของงาน |

สองส่วนนี้แยกฐานข้อมูลและแยกโค้ดจากกัน `/send` ไม่แตะฐานข้อมูล task เลย
```

เพิ่มคำสั่งใหม่เข้าตารางคำสั่ง เพิ่ม `lib/` ไฟล์ใหม่เข้าตารางโครงสร้าง และเพิ่มหัวข้อการตั้งค่า MongoDB กับ OAuth

- [ ] **Step 8: ต่อเทสต์เข้า npm test แล้ว commit**

```bash
npm test
git add public README.md test/web-escape.test.mjs package.json
git commit -m "Feat: task management web page with escaped user content"
```

---

## Self-review

**ครอบคลุม spec ครบ:**

| หัวข้อ spec | Task |
|---|---|
| 3 เส้นแบ่งความเป็นนิรนาม | Task 9 (README) + Global Constraints |
| 4 Data model + กฎสิทธิ์ + connection cache | Task 1, 2 |
| 5 OAuth2 + session | Task 6, 7 |
| 6 API + validation + PATCH whitelist | Task 1, 8 |
| 7 โครงสร้างไฟล์ | ทุก task |
| 8 คำสั่ง Discord + กรณีพิเศษ | Task 3, 4, 5 |
| 9 หน้าเว็บ + XSS | Task 9 |
| 10 error handling | Task 1, 8 |
| 11 เทสต์ | Task 1, 6, 7, 8, 9 |
| 12 env vars | Task 2, 7 |
| 13 การปล่อยขึ้นจริง | จุดหยุดส่งมอบเฟส 1 + ด้านล่าง |
| 14 เอกสาร | Task 9 |

**ลำดับปล่อยขึ้นจริงหลังจบ Task 9** (ห้ามสลับ):

1. ตั้ง env ทั้ง 5 ตัวบน Vercel: `MONGODB_URI` `DISCORD_CLIENT_ID` `DISCORD_CLIENT_SECRET` `SESSION_SECRET` `PUBLIC_BASE_URL`
2. เพิ่ม redirect URI `https://anomsg.vercel.app/api/auth/callback` ที่ Developer Portal → OAuth2 → Redirects
3. merge `feat/task-manager` เข้า `main` แล้วรอ deploy เสร็จ
4. `npm run register` เป็นขั้นสุดท้าย

ถ้า register ก่อน deploy คนจะเห็นคำสั่ง `/task` แล้วกดแล้วเจอ "application did not respond"
