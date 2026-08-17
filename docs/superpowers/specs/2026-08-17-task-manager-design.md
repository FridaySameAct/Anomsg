# Task Manager สำหรับ Anomsg — Design Spec

วันที่: 2026-08-17
Branch: `feat/task-manager`

## 1. เป้าหมาย

เพิ่มระบบจัดการ task เข้า Anomsg พร้อมหน้าเว็บสำหรับ add/edit ที่สะดวกกว่าการพิมพ์คำสั่งใน Discord
โดยมีคำสั่ง `/web` เป็นทางเข้า

task ผูกกับ Discord server (guild) ทุกคนในเซิร์ฟเวอร์เห็นได้ แต่แก้ได้เฉพาะคนสร้างหรือคนที่ถูก assign

## 2. สิ่งที่ไม่ทำ (YAGNI)

ตัดออกจาก schema เดิมของ taskdx โดยตั้งใจ:

- **`subtask`** — อ้างถึง task อื่นแบบ recursive ซับซ้อนทั้ง data model และ UI โดยยังไม่มีความต้องการจริง
- **`progress` 0-100** — `done` เป็น boolean พอสำหรับ MVP ถ้าวันหนึ่งต้องการสถานะกลาง ค่อยเปลี่ยนเป็น enum
  `todo` / `doing` / `done` ซึ่ง migrate จาก boolean ได้ตรงไปตรงมา
- **dropdown รายชื่อสมาชิกบนเว็บ** — ต้องเปิด privileged intent `Server Members` เพิ่ม
  MVP ให้เว็บ assign ได้เฉพาะ "ตัวเอง" หรือ "ไม่ระบุ" ส่วนการมอบหมายให้คนอื่นทำผ่าน `/task add` ใน Discord
  ซึ่งใช้ option แบบ user (type 6) ที่ Discord ส่งข้อมูลคนที่ถูกเลือกมาให้ในตัว
- **การยกเลิก session กลางคัน** — session เป็นแบบ stateless จึงเพิกถอนรายคนไม่ได้
  เปลี่ยน `SESSION_SECRET` เพื่อเตะทุกคนออกพร้อมกันได้

## 3. เส้นแบ่งเรื่องความเป็นนิรนาม

Anomsg เดิมออกแบบให้ไม่เก็บว่าใครส่งอะไร ระบบ task ขัดกับหลักการนั้นโดยธรรมชาติเพราะต้องรู้เจ้าของงาน

**ข้อบังคับ:**

- `/send` **ต้องไม่แตะฐานข้อมูล task เลย** ทั้งอ่านและเขียน
- โค้ดสองส่วนอยู่คนละไฟล์ ไม่ import ข้ามกัน
- rate limit ของ `/send` ยังใช้ id ที่ hash แล้วเหมือนเดิม ไม่เปลี่ยนเป็น id ดิบ
- README ต้องแยกสองหัวข้อชัดเจนว่าส่วนไหนไม่เก็บอะไร ส่วนไหนเก็บ user id ถาวร

โปรเจกต์จะกลายเป็น "บอทอเนกประสงค์ที่มีโหมดนิรนาม" ไม่ใช่ "บอทนิรนาม" อีกต่อไป เอกสารต้องสะท้อนความจริงข้อนี้

## 4. Data model

```js
// lib/models/task.js
{
  guildId:     String   required, index    // ผูกกับเซิร์ฟเวอร์
  name:        String   required, 1-200
  description: String   optional, max 2000
  done:        Boolean  default false
  assignee:    String   optional           // Discord user id
  dueDate:     Date     optional
  createdBy:   String   required           // Discord user id
  createdAt:   Date     default now
}
```

Index: `{ guildId: 1, done: 1, dueDate: 1 }` ครอบคลุม query หลักคือ
"task ของเซิร์ฟเวอร์นี้ เรียงตามกำหนดส่ง แยกเสร็จ/ไม่เสร็จ"

`assignee` เก็บเป็น user id ไม่ใช่ชื่อ เพราะชื่อเปลี่ยนได้ ถ้าเก็บชื่อ วันที่คนเปลี่ยน username
งานที่ assign ไว้จะหายจากรายการของเขาเงียบๆ

### กฎสิทธิ์

| การกระทำ | ใครทำได้ |
|---|---|
| อ่าน | ทุกคนที่เป็นสมาชิกของ guild นั้น |
| สร้าง | ทุกคนที่เป็นสมาชิกของ guild นั้น |
| แก้ / ลบ / ติ๊ก done | `createdBy === actor` **หรือ** `assignee === actor` |

บังคับที่ service layer เท่านั้น การซ่อนปุ่มใน UI เป็นเรื่อง UX ไม่ใช่มาตรการความปลอดภัย

### การต่อ MongoDB ใน serverless

`lib/db.js` cache connection บน `globalThis` แล้วใช้ซ้ำตลอดอายุ instance

```js
let cached = globalThis._mongoose ??= { conn: null, promise: null };
export async function connectDb() {
  if (cached.conn) return cached.conn;
  cached.promise ??= mongoose.connect(uri, { bufferCommands: false });
  cached.conn = await cached.promise;
  return cached.conn;
}
```

ห้ามเรียก `connect()` ตอนโหลด module (ความผิดพลาดที่ taskdx ทำไว้) เพราะทุก cold start
จะเปิด connection ใหม่จนเต็ม pool ของ Atlas M0 ที่จำกัด 500 connections

## 5. การยืนยันตัวตน

Discord OAuth2 scope `identify guilds` เท่านั้น

### ลำดับการทำงาน

1. ผู้ใช้พิมพ์ `/web` → บอทตอบ ephemeral พร้อมลิงก์ `{PUBLIC_BASE_URL}/?guild=<guildId>`
2. เปิดลิงก์ → `public/index.html` โหลด → JS เรียก `GET /api/me`
3. ยังไม่ล็อกอิน → แสดงปุ่ม Login with Discord
4. `GET /api/auth/login?guild=<id>` → สุ่ม `state` เก็บใน cookie อายุสั้น แล้ว redirect ไป Discord
5. Discord เด้งกลับ `GET /api/auth/callback?code=...&state=...`
6. callback ออก session cookie แล้ว redirect กลับ `/?guild=<id>`

### callback ต้องตรวจครบ 4 ข้อ

1. **`state` ตรงกับ cookie** — กัน CSRF ตอน login ไม่ตรงให้ปฏิเสธทันที
2. แลก `code` เป็น access token ผ่าน `POST /oauth2/token`
3. `GET /users/@me` เอา user id และชื่อ
4. **`GET /users/@me/guilds` ยืนยันว่า guild ที่ขอเข้าอยู่ในรายการจริง**

ข้อ 4 คือด่านความปลอดภัยหลัก ถ้าข้ามไป ใครที่มี Discord account ก็เปิด `?guild=<id>` แล้วเห็น task ทั้งหมดได้
guild id ไม่ใช่ความลับ ความปลอดภัยไม่ได้อยู่ที่การเดา id ไม่ได้

### Session cookie

```
base64url({ uid, name, gid, exp }) + "." + HMAC-SHA256(payload, SESSION_SECRET)
```

- `HttpOnly` `Secure` `SameSite=Lax` `Path=/`
- อายุ **7 วัน**
- ตรวจลายเซ็นและวันหมดอายุทุก request

เลือกแบบ stateless เพราะ serverless ไม่มี memory ร่วมระหว่าง instance และการเก็บใน Redis
จะเพิ่ม round trip ทุก request โดยไม่ได้ประโยชน์คุ้มกัน

`SameSite=Lax` ทำให้ POST ข้ามเว็บไม่ส่ง cookie มาด้วย จึงกัน CSRF ของการแก้ข้อมูลได้ในตัว
ไม่ต้องมี CSRF token แยก

**ข้อจำกัดที่ยอมรับ:** คนที่ออกจากเซิร์ฟเวอร์ไปแล้วยังใช้ cookie เดิมได้จนหมดอายุ (สูงสุด 7 วัน)

### ห้ามทำ open redirect

หลังล็อกอินเสร็จ redirect ไปได้เฉพาะ path ภายในเว็บเราเท่านั้น ห้ามรับ URL เต็มจาก query string

client secret อยู่ใน function เท่านั้น ไม่มีวันไปฝั่ง browser

## 6. API

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/api/me` | ใครล็อกอินอยู่ + guild ไหน (หรือ 401) |
| `GET` | `/api/auth/login?guild=<id>` | เด้งไป Discord |
| `GET` | `/api/auth/callback` | ออก session แล้วเด้งกลับ |
| `POST` | `/api/auth/logout` | ล้าง cookie |
| `GET` | `/api/tasks?guild=<id>` | รายการ task ของ guild |
| `GET` | `/api/tasks/me?guild=<id>` | task ที่ `assignee` เป็นเรา |
| `POST` | `/api/tasks` | สร้าง |
| `PATCH` | `/api/tasks?id=<taskId>` | แก้ (รวมติ๊ก done) |
| `DELETE` | `/api/tasks?id=<taskId>` | ลบ |

ใช้ `?id=` แทน path segment เพราะเอกสาร Vercel ยืนยันเฉพาะ routing ของไฟล์ระดับบนกับไฟล์ในโฟลเดอร์
ไม่ได้ระบุวิธีดึง dynamic param เมื่อใช้ Web Handler signature ที่โปรเจกต์นี้ใช้อยู่

`actorId` มาจาก session cookie เสมอ **ห้ามรับจาก query string หรือ body** ไม่งั้นใครก็ใส่ user id
คนอื่นแล้วดูหรือแก้งานของเขาได้

### การตรวจข้อมูลขาเข้า

| ฟิลด์ | กฎ |
|---|---|
| `name` | บังคับ 1-200 ตัวอักษร |
| `description` | ไม่เกิน 2000 |
| `dueDate` | ISO date ที่ parse ได้ หรือ null |
| `assignee` | snowflake (ตัวเลข 17-20 หลัก) หรือ null |

ตรวจที่ service layer ไม่ใช่ที่ route — route ทำหน้าที่แปลง request เป็น argument เท่านั้น

### PATCH ต้องรับเฉพาะฟิลด์ที่อนุญาต

`updateTask` รับได้เฉพาะ **`name` `description` `done` `assignee` `dueDate`** เท่านั้น
ฟิลด์อื่นที่ส่งมาให้ทิ้งทิ้งไปเงียบๆ ห้ามส่ง object จาก body เข้า query โดยตรง

ถ้าไม่ทำ whitelist ผู้ใช้จะ PATCH `createdBy` เป็นตัวเองเพื่อยึดสิทธิ์แก้ task ของคนอื่น
หรือ PATCH `guildId` เพื่อย้าย task ไปเซิร์ฟเวอร์อื่นได้ — เป็นช่องโหว่ mass assignment แบบคลาสสิก
ต้องมีเทสต์ยืนยันว่าทั้งสองฟิลด์นี้แก้ผ่าน API ไม่ได้

## 7. โครงสร้างไฟล์

```
api/
  interactions.js       ← มีอยู่แล้ว ไม่แตะ
  me.js
  tasks.js              GET POST PATCH DELETE
  tasks/me.js
  auth/login.js
  auth/callback.js
  auth/logout.js
lib/
  db.js                 cache connection
  models/task.js        mongoose schema
  tasks-repo.js         implementation จริงด้วย mongoose
  tasks-service.js      ตรรกะ + กฎสิทธิ์ (รับ repo เข้ามา)
  session.js            เซ็น/ตรวจ cookie
  errors.js             ValidationError / ForbiddenError / NotFoundError
  web.js                handler /web
  task.js               handler /task list, /task add
  mytask.js             handler /mytask
public/
  index.html  app.js  style.css
```

ทุกอย่างใน `lib/` อยู่นอก `/api` เพราะ Vercel deploy ทุกไฟล์ใน `/api` เป็น endpoint

### service รับ repository เข้ามา

```js
export function createTasksService(repo) {
  return { listTasks, listMyTasks, createTask, updateTask, deleteTask };
}
```

ทำให้ทดสอบกฎสิทธิ์ได้ครบทุกกรณีโดยไม่ต้องมี MongoDB จริง
`tasks-repo.js` จะบางมาก (แค่ query) และพิสูจน์ตอนทดสอบจริงบน deployment

**`lib/tasks-service.js` เป็นที่เดียวที่มีกฎสิทธิ์** ทั้ง API ฝั่งเว็บและคำสั่ง Discord เรียกตัวเดียวกัน
ถ้าปล่อยให้แต่ละฝั่งเช็คเอง วันหนึ่งจะแก้ที่เดียวลืมอีกที่แล้วเกิดช่องโหว่

## 8. คำสั่ง Discord

| คำสั่ง | ทำอะไร |
|---|---|
| `/web` | ตอบลิงก์ ephemeral **ไม่แตะ DB เลย** |
| `/task list` | 10 อันแรกที่ยังไม่เสร็จ เรียงตาม dueDate พร้อมบอกว่ามีอีกกี่อัน |
| `/task add name:<...> [assignee:<user>]` | สร้าง task ใช้ service ตัวเดียวกับเว็บ |
| `/mytask` | task ที่ assign ให้คนที่พิมพ์ ตอบ ephemeral |

**กรณีที่ต้องกำหนดให้ชัด:**

- คำสั่ง task ทุกตัวรวมถึง `/web` เมื่อยังไม่ได้ตั้ง `MONGODB_URI` → ตอบ ephemeral ว่า
  "ระบบ task ยังไม่ได้เปิดใช้งาน" ไม่ใช่ error หรือลิงก์ที่กดไปแล้วพัง
- ใช้คำสั่ง task ใน DM (ไม่มี `guild_id`) → ตอบว่าใช้ได้เฉพาะในเซิร์ฟเวอร์
- `/task list` และ `/mytask` เมื่อไม่มี task เลย → ตอบข้อความว่างที่เป็นมิตร ไม่ใช่รายการเปล่า

คำสั่งเดิม `/send` และ `/ping` ไม่เปลี่ยนแปลง

คำสั่งที่แตะ DB ใช้งบเวลาจาก `lib/discord.js` ที่มีอยู่แล้ว ถ้าใกล้หมดเวลาให้ตอบ error ที่อ่านรู้เรื่อง
แทนปล่อยให้ Discord timeout

ชื่อคำสั่งและ option ทั้งหมดต้องประกาศใน `lib/commands.js` ตามรูปแบบเดิม ห้าม hardcode ซ้ำที่อื่น

## 9. หน้าเว็บ

single page ไม่มี client-side routing ไม่มี build step — HTML + CSS + vanilla JS ใน `public/`

**สองสถานะ:** ยังไม่ล็อกอิน (ปุ่ม Login) กับ ล็อกอินแล้ว (header + filter + ฟอร์มเพิ่ม + รายการ)

**เปิดเว็บโดยไม่มี `?guild=`** — เกิดได้ถ้าคนบุ๊กมาร์กหน้าแรกไว้ ให้แสดงหน้าอธิบายสั้นๆ ว่า
ต้องเข้าผ่านคำสั่ง `/web` ในเซิร์ฟเวอร์ที่ต้องการ พร้อมปุ่มออกจากระบบ
ถ้ามี session อยู่แล้วให้ใช้ `gid` จาก cookie เป็นค่าตั้งต้นแทน จะได้ไม่ต้องกลับไป Discord ทุกครั้ง

**filter:** ทั้งหมด / ของฉัน / เสร็จแล้ว

ฟอร์มเพิ่มมีช่องเดียว (ชื่องาน) กดเพิ่มแล้วค่อยกดแก้เพื่อใส่รายละเอียด กำหนดส่ง ผู้รับผิดชอบ
ลดแรงเสียดทานของงานที่ทำบ่อยที่สุด

ปุ่มแก้/ลบไม่แสดงถ้าไม่ใช่เจ้าของหรือ assignee แต่ API ปฏิเสธซ้ำอยู่ดี

**mobile-first** เพราะคนส่วนใหญ่กดลิงก์จาก Discord บนมือถือ — single column ปุ่มใหญ่พอกดด้วยนิ้ว
ไม่มีตารางที่ต้องเลื่อนแนวนอน รองรับ dark mode ผ่าน `prefers-color-scheme`

### ⚠️ XSS — ข้อบังคับ

ชื่อ task และ description มาจากผู้ใช้ **ต้องใส่เข้า DOM ผ่าน `textContent` เท่านั้น**
ห้ามใช้ `innerHTML` กับ string ที่มีข้อมูลจากผู้ใช้เด็ดขาด

cookie เป็น `HttpOnly` จึงขโมยด้วย JS ตรงๆ ไม่ได้ แต่ XSS ยังยิง request แทนผู้ใช้ได้
จึงต้องกันที่ต้นทาง

## 10. การจัดการ error

```
ValidationError → 400    ForbiddenError → 403
NotFoundError   → 404    อื่นๆ          → 500
```

แปลงเป็น HTTP ที่ชั้น route ชั้นเดียว service ไม่รู้จัก HTTP เลย
ทุก error ตอบ `{ error: "ข้อความ" }` ไม่ส่ง stack trace ออกไป

**DB ล่ม** → เว็บตอบ 503 พร้อมข้อความที่อ่านรู้เรื่อง คำสั่ง Discord ตอบ ephemeral ว่าใช้ไม่ได้ชั่วคราว
**แต่ `/send` และ `/ping` ต้องทำงานปกติ**

## 11. เทสต์

รักษาคุณสมบัติเดิมไว้: `npm test` ต้องรันได้โดย **ไม่ต้องใช้เน็ต ไม่ต้องใช้ token จริง ไม่ต้องมี DB**

| ไฟล์ | ทดสอบอะไร |
|---|---|
| `test/session.test.mjs` | เซ็น/ตรวจ cookie, แก้ payload แล้วต้องไม่ผ่าน, หมดอายุแล้วต้องไม่ผ่าน |
| `test/tasks-service.test.mjs` | กฎสิทธิ์ทุกกรณี + การตรวจข้อมูล (ใช้ repo ปลอมในหน่วยความจำ) |
| `test/api-tasks.test.mjs` | ไม่มี session → 401, ไม่ใช่เจ้าของ → 403, ข้อมูลพัง → 400 |
| `test/auth.test.mjs` | `state` ไม่ตรง → ปฏิเสธ, ไม่ได้อยู่ใน guild → ปฏิเสธ |
| `test/commands.test.mjs` | ขยายของเดิม — คำสั่งใหม่ทุกตัวมี handler จริง |

เคสที่สำคัญที่สุดสองอัน:

- **ข้ามเซิร์ฟเวอร์ไม่ได้** — ล็อกอิน guild A แล้วยิง `?guild=B` ต้องถูกปฏิเสธ
- **XSS** — ยัด `<script>alert(1)</script>` เป็นชื่อ task แล้วต้องออกมาเป็นตัวอักษรธรรมดา

## 12. Environment variables

| ตัวแปร | ได้จากไหน | จำเป็นไหม |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas → Connect | ถ้าไม่ตั้ง = ปิดฟีเจอร์ task |
| `DISCORD_CLIENT_ID` | = `APP_ID` เดิม | ต้องมีถ้าเปิด task |
| `DISCORD_CLIENT_SECRET` | Developer Portal → OAuth2 | ต้องมีถ้าเปิด task |
| `SESSION_SECRET` | สุ่มเอง `openssl rand -hex 32` | ต้องมีถ้าเปิด task |
| `PUBLIC_BASE_URL` | `https://anomsg.vercel.app` | ต้องมีถ้าเปิด task |

redirect URI ที่ต้องเพิ่มใน Developer Portal → OAuth2 → Redirects:

```
https://anomsg.vercel.app/api/auth/callback
```

ต้องตรงเป๊ะทุกตัวอักษร Discord ไม่ยอมให้คลาดเคลื่อนแม้แต่ slash ท้าย

## 13. การปล่อยขึ้นจริง

ใช้รูปแบบ opt-in แบบเดียวกับ rate limit — **ไม่ตั้ง `MONGODB_URI` = ปิดฟีเจอร์ task ทั้งชุด**
บอทเดิมทำงานครบทุกอย่าง คำสั่ง task ตอบว่ายังไม่ได้เปิดใช้งาน

แปลว่า merge แล้ว deploy ได้ทันทีโดยยังไม่ต้องตั้ง Atlas เสร็จ ไม่มีช่วงที่บอทพัง

**ลำดับที่ห้ามสลับ:**

1. ตั้ง env var ทั้ง 5 ตัวบน Vercel
2. เพิ่ม redirect URI ที่ Developer Portal
3. merge + deploy
4. `npm run register` **เป็นขั้นสุดท้าย**

ถ้า register ก่อน deploy คนจะเห็นคำสั่ง `/task` ใน Discord แล้วกดแล้วเจอ
"application did not respond" เพราะ handler ยังไม่ขึ้น

## 14. เอกสารที่ต้องแก้

README ปัจจุบันเขียนว่า "ไม่เก็บ log ว่าใครส่งอะไร" ซึ่งจะทำให้เข้าใจผิดทันทีที่มีระบบ task

ต้องแยกสองหัวข้อชัดเจน:

- **`/send`** — ไม่เก็บอะไรเลย ไม่มี log ตามหาคนย้อนหลังไม่ได้
- **task** — เก็บ Discord user id ถาวรในฐานข้อมูล (`createdBy`, `assignee`)

เพื่อให้คนที่เอาไปใช้ตัดสินใจได้ถูกว่าอะไรนิรนามจริง อะไรไม่
