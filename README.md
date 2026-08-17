# Anomsg

Discord bot สำหรับส่งข้อความแบบไม่ระบุตัวตน รันเป็น Vercel Function (โฮสต์ฟรีบน Hobby plan ได้)

| คำสั่ง | ทำอะไร |
|---|---|
| `/send message:<ข้อความ> image:<รูป>` | บอทโพสต์ข้อความและ/หรือรูปลงห้องในนามของบอทเอง |
| `/ping` | เช็คว่าบอทยังทำงานอยู่ พร้อมบอก latency เป็น ms |
| `/web` | ส่งลิงก์หน้าเว็บสำหรับจัดการ task ของเซิร์ฟเวอร์นี้ (ต้องล็อกอินด้วย Discord ที่หน้าเว็บ) |
| `/mytask` | ดู task ที่ยังไม่เสร็จและมอบหมายให้คุณในเซิร์ฟเวอร์นี้ |
| `/task list` | ดู task ที่ยังไม่เสร็จทั้งหมดของเซิร์ฟเวอร์นี้ |
| `/task add name:<ชื่องาน> assignee:<ผู้รับผิดชอบ>` | เพิ่ม task ใหม่ (`assignee` ไม่บังคับ) |

ทั้ง `message` และ `image` ของ `/send` เป็น option ที่ไม่บังคับ แต่ต้องใส่มาอย่างน้อยหนึ่งอย่าง
จะส่งเฉพาะรูปโดยไม่มีข้อความก็ได้

คำตอบของทุกคำสั่งเป็นแบบ ephemeral ที่มีแค่คนสั่งเห็น ตัวตนคนส่งจึงไม่ถูกเปิดเผยในห้อง

คำสั่งกลุ่ม task (`/web` `/mytask` `/task`) ใช้ได้เฉพาะในเซิร์ฟเวอร์ (ไม่ใช่ DM) และต้องตั้งค่า
`MONGODB_URI` ไว้ก่อน ไม่งั้นจะตอบว่า "ระบบ task ยังไม่ได้เปิดใช้งาน" — ดูหัวข้อ
[ตั้งค่าระบบ task: MongoDB และ Discord OAuth2](#ตั้งค่าระบบ-task-mongodb-และ-discord-oauth2)

## การจัดการรูป

รูปที่แนบมาจะถูก **ลบ metadata และตั้งชื่อไฟล์ใหม่** ก่อนโพสต์เสมอ เพราะรูปจากมือถือ
ฝังพิกัด GPS, รุ่นเครื่อง และเวลาถ่ายไว้ ถ้า forward ดิบๆ บอทที่ควรปกปิดตัวตน
จะกลายเป็นตัวเปิดเผยตำแหน่งคนส่งแทน ชื่อไฟล์เดิมก็บอกอะไรได้เยอะเหมือนกัน

| ชนิด | สิ่งที่ถูกลบ |
|---|---|
| JPEG | segment APP1–APP15 (EXIF/XMP/IPTC/maker note) และ COM |
| PNG | chunk `tEXt` `zTXt` `iTXt` `eXIf` `tIME` |
| WebP | chunk `EXIF` `XMP ` พร้อมเคลียร์ธงใน `VP8X` |
| GIF | **ไม่ลบ** (ดูหมายเหตุ) |

หมายเหตุอื่น:

- ชนิดไฟล์ตรวจจาก **ไบต์จริง** ไม่ใช่ `content_type` ที่ Discord แจ้งมา ถ้าไม่ตรงกับ
  4 ชนิดข้างบนจะถูกปฏิเสธ เพื่อไม่ให้ไฟล์หลุดออกไปโดยไม่ผ่านการลบ metadata
- GIF ปล่อยผ่านโดยตั้งใจ เพราะกล้องมือถือไม่ผลิต GIF จึงไม่มีพิกัดให้หลุด
  และการไล่ block ของ GIF ผิดพลาดง่ายกว่าประโยชน์ที่ได้
- จำกัดขนาดที่ **8 MB** และบอทจะดาวน์โหลดมาอัปโหลดใหม่เสมอ ไม่ได้ส่ง URL ต่อ
  เพราะลิงก์ CDN ของ Discord ถูกเซ็นด้วย `ex`/`is`/`hm` แล้วหมดอายุ

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `api/interactions.js` | Vercel Function รับ webhook จาก Discord (deploy อัตโนมัติที่ `/api/interactions`) ทำแค่ตรวจลายเซ็นแล้วส่งต่อให้ handler |
| `api/me.js` | คืนข้อมูล session ปัจจุบัน (`uid`/`name`/`gid`) ให้หน้าเว็บ (`GET /api/me`) |
| `api/tasks.js` | CRUD ของ task ในเซิร์ฟเวอร์ที่ล็อกอินอยู่ (`GET`/`POST /api/tasks`, `PATCH`/`DELETE /api/tasks?id=`) |
| `api/tasks/me.js` | task ที่มอบหมายให้ผู้ใช้ที่ล็อกอินอยู่ (`GET /api/tasks/me`) |
| `api/auth/login.js` | เริ่ม OAuth2 flow กับ Discord (`GET /api/auth/login?guild=`) |
| `api/auth/callback.js` | รับ callback จาก Discord แลก code เป็น session cookie |
| `api/auth/logout.js` | ล้าง session cookie (`POST /api/auth/logout`) |
| `register.js` | สคริปต์รันบนเครื่องตัวเอง ลงทะเบียน slash command กับ Discord (รันครั้งเดียว) |
| `lib/commands.js` | **แหล่งความจริงเดียว**ของชื่อคำสั่งและ option ทั้ง `register.js` และ handler import จากที่นี่ |
| `lib/send.js` | ตรรกะของ `/send` ทั้งหมด |
| `lib/ping.js` | ตรรกะของ `/ping` |
| `lib/web.js` | ตรรกะของ `/web` — ส่งลิงก์หน้าเว็บกลับไป |
| `lib/task.js` | ตรรกะของ `/task list` และ `/task add` |
| `lib/mytask.js` | ตรรกะของ `/mytask` และตัวช่วย `formatTaskLine()` ที่ `/task list` ใช้ร่วมกัน |
| `lib/discord.js` | ตัวช่วยที่ใช้ร่วมกัน — `ephemeral()`, วัด latency, งบเวลา |
| `lib/image.js` | ตรวจชนิดไฟล์ภาพและลบ metadata ก่อนอัปโหลด |
| `lib/rate-limit.js` | จำกัดความถี่ของ `/send` ผ่าน Upstash Redis |
| `lib/db.js` | เปิด/cache การเชื่อมต่อ MongoDB และ `isTasksEnabled()` (เช็คว่าตั้งค่า `MONGODB_URI` ไว้หรือยัง) |
| `lib/models/task.js` | Mongoose schema ของ task |
| `lib/tasks-repo.js` | ประกอบ service จริงที่ต่อ MongoDB (`getTasksService()`) — เทสต์ inject ตัวปลอมแทนได้ |
| `lib/tasks-service.js` | กฎธุรกิจของ task — validation, สิทธิ์แก้/ลบ, PATCH whitelist |
| `lib/oauth.js` | แลก OAuth2 code เป็น access token แล้วยืนยันว่าผู้ใช้อยู่ใน guild ที่ขอเข้าจริง |
| `lib/session.js` | เซ็น/ตรวจ session cookie แบบ stateless (HMAC-SHA256) |
| `lib/errors.js` | ชนิด error ของชั้น service (`ValidationError`/`ForbiddenError`/`NotFoundError`) ที่ชั้น API แปลงเป็น HTTP status |
| `lib/api-helpers.js` | ตัวช่วยร่วมของทุก route ใต้ `/api/tasks*` — การ์ด `context()`, `jsonNoStore()`, `parseJsonBody()`, `errorResponse()` |
| `public/index.html` `public/style.css` `public/app.js` | หน้าเว็บจัดการ task แบบ mobile-first — ไฟล์ static ใน `public/` ถูก deploy ที่ root ของเว็บ (`public/app.js` คือ `/app.js`) |

ทุกอย่างใน `lib/` อยู่นอก `/api` โดยตั้งใจ เพราะ Vercel จะ deploy **ทุกไฟล์ใน `/api`** เป็น endpoint
รวมถึงไฟล์ในโฟลเดอร์ย่อย เช่น `api/tasks/me.js` กลายเป็น `/api/tasks/me` และ `api/auth/login.js`
กลายเป็น `/api/auth/login` โดยอัตโนมัติเหมือนกัน

### เพิ่มคำสั่งใหม่

1. เพิ่ม definition ใน `lib/commands.js` (ประกาศชื่อเป็น constant แล้วใช้ constant นั้นใน definition)
2. เขียน handler ใน `lib/<ชื่อ>.js`
3. ผูกเข้า `HANDLERS` ใน `api/interactions.js`
4. รัน `npm run register`

ถ้าลืมข้อ 3 เทสต์จะฟ้องทันทีว่าคำสั่งนั้นไม่มี handler รับ

ไม่ต้องมี `vercel.json` — Vercel deploy ทุกไฟล์ใน `/api` เป็น function ให้เองอัตโนมัติ

## ขั้นตอน deploy

### 1. เตรียมค่าจาก Discord Developer Portal

เข้า https://discord.com/developers/applications แล้วเลือก (หรือสร้าง) แอป จากนั้นเก็บค่า 3 ตัว:

| ค่า | หาได้ที่ |
|---|---|
| `APP_ID` | General Information → Application ID |
| `DISCORD_PUBLIC_KEY` | General Information → Public Key |
| `DISCORD_TOKEN` | Bot → Token (ถ้าหาไม่เจอให้กด Reset Token) |

### 2. ลงทะเบียนคำสั่ง (ทำบนเครื่องตัวเอง ครั้งเดียว)

```bash
cp .env.example .env
```

ใส่ค่าทั้ง 3 ตัวลงใน `.env` แล้วรัน:

```bash
npm install && npm run register
```

### 3. ชวนบอทเข้าเซิร์ฟเวอร์

ที่ OAuth2 → URL Generator เลือก scope **`bot`** และ **`applications.commands`**
แล้วเลือก permission **Send Messages** จากนั้นเปิดลิงก์ที่ได้เพื่อเชิญบอทเข้าเซิร์ฟเวอร์

### 4. Deploy ขึ้น Vercel

push โค้ดขึ้น GitHub แล้ว import repo ที่ https://vercel.com/new

- **Framework Preset**: `Other`
- **Build Command / Output Directory**: เว้นว่างไว้

เพิ่ม Environment Variables (Settings → Environment Variables) ให้ครบทั้ง Production:

```
DISCORD_TOKEN
DISCORD_PUBLIC_KEY
```

> `APP_ID` ใช้แค่ตอนรัน `register.js` บนเครื่อง ไม่ต้องใส่บน Vercel

ถ้าจะเปิดระบบ task (`/web` `/mytask` `/task` และหน้าเว็บ) ด้วย ต้องใส่เพิ่มอีก 5 ตัว — ดูหัวข้อ
[ตั้งค่าระบบ task: MongoDB และ Discord OAuth2](#ตั้งค่าระบบ-task-mongodb-และ-discord-oauth2)
ด้านล่าง ไม่ใส่ก็ deploy ได้ปกติ บอทเดิมทำงานครบ แค่คำสั่งกลุ่ม task จะปิดอยู่

กด Deploy แล้วรอจนเสร็จ

### 5. ผูก Interactions Endpoint URL

กลับไปที่ Discord Developer Portal → General Information → **Interactions Endpoint URL** ใส่:

```
https://<ชื่อโปรเจกต์>.vercel.app/api/interactions
```

กด Save — Discord จะยิงคำขอทดสอบมาทันที ถ้าบันทึกผ่านแปลว่าใช้งานได้แล้ว

> **ต้องใช้ production domain เท่านั้น** (`<ชื่อโปรเจกต์>.vercel.app`)
> อย่าใช้ URL ของ preview deployment ที่มีตัวเลขต่อท้าย เพราะ Hobby plan ล็อก preview URL
> ไว้ด้วย Vercel Authentication ทำให้ Discord ยิงเข้าไม่ถึงและบันทึกไม่ผ่าน

## ตั้งค่าระบบ task: MongoDB และ Discord OAuth2

เป็นฟีเจอร์แบบ opt-in เหมือนกับ rate limit (ดูหัวข้อถัดไป) — ถ้าไม่ตั้งค่า `MONGODB_URI` ระบบ task ทั้งชุด
(คำสั่ง `/web` `/mytask` `/task` และหน้าเว็บที่ `/`) จะถูกปิด ส่วน `/send` กับ `/ping` ทำงานปกติเหมือนเดิม
ไม่ถูกกระทบเลยเพราะเป็นโค้ดคนละชุดกัน (ดูหัวข้อ [อะไรถูกเก็บ อะไรไม่ถูกเก็บ](#อะไรถูกเก็บ-อะไรไม่ถูกเก็บ))

### 1. สร้างฐานข้อมูล MongoDB

สร้างคลัสเตอร์ฟรีที่ https://www.mongodb.com/cloud/atlas (M0 พอสำหรับใช้งานจริง) แล้วคัดลอก
connection string จากปุ่ม **Connect → Drivers**

### 2. เปิด Discord OAuth2

ที่ https://discord.com/developers/applications เลือกแอปเดิม (แอปเดียวกับที่ใช้ตอน register คำสั่ง)
ไปที่ **OAuth2 → General** เก็บค่า **Client ID** กับ **Client Secret** (กด Reset Secret ถ้าหาไม่เจอ)
แล้วไปที่ **OAuth2 → Redirects** เพิ่ม:

```
https://<โดเมนจริงของเว็บ>/api/auth/callback
```

> ต้องเป็น production domain เดียวกับที่ตั้ง `PUBLIC_BASE_URL` เป๊ะๆ (รวม `https://`) ไม่งั้น
> Discord จะปฏิเสธตอนแลก code เป็น token

### 3. ตั้งค่า Environment Variables

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `MONGODB_URI` | connection string ของ MongoDB — ถ้าว่างไว้ ระบบ task ทั้งชุดจะปิด (ดู `lib/db.js`) |
| `DISCORD_CLIENT_ID` | OAuth2 → General → Client ID |
| `DISCORD_CLIENT_SECRET` | OAuth2 → General → Client Secret |
| `SESSION_SECRET` | กุญแจเซ็น session cookie **ต้องยาวอย่างน้อย 32 ตัวอักษร** สุ่มด้วย `openssl rand -base64 32` — ถ้าว่างหรือสั้นเกินไป โค้ดจะปฏิเสธทั้งการออก session ใหม่และการตรวจ session เดิมทันที (ดู `lib/session.js`) เพื่อไม่ให้มีทางออก session ที่ปลอมแปลงได้ |
| `PUBLIC_BASE_URL` | โดเมนจริงของเว็บ ไม่มี `/` ปิดท้าย เช่น `https://anomsg.vercel.app` ใช้คำนวณ redirect URI กลับมาที่ `/api/auth/callback` และประกอบลิงก์ที่คำสั่ง `/web` ส่งกลับ |

ใส่ทั้ง 5 ตัวที่ Vercel → Settings → Environment Variables (Production) แล้ว **Redeploy** ค่าใหม่ถึงจะมีผล

### 4. ล็อกอินใช้งานจริง

ผู้ใช้พิมพ์ `/web` ในเซิร์ฟเวอร์ บอทจะตอบลิงก์ `<PUBLIC_BASE_URL>/?guild=<guild id>` แบบ ephemeral กลับมา
กดลิงก์ → กด "Login with Discord" ที่หน้าเว็บ → Discord ถามสิทธิ์ scope `identify guilds` → หลังยืนยัน
`api/auth/callback.js` จะเช็คว่าผู้ใช้อยู่ใน guild นั้นจริงก่อนออก session cookie ให้เสมอ (401/403 ถ้าไม่ผ่าน)
guild id ไม่ใช่ความลับ (ใครก็เดาได้) ด่านตรวจสิทธิ์จริงคือขั้นตอนนี้ ไม่ใช่การซ่อน guild id

## ทดสอบ

```bash
npm test
```

รัน 326 เคส ไม่ต้องใช้ token จริง ไม่ต่อเน็ต และไม่ต้องมี MongoDB จริง แบ่งเป็น 11 ชุด:

- `test/commands.test.mjs` — กัน definition กับ handler หลุดจากกัน (34 เคส) ยืนยันว่า
  option ที่โค้ดอ่านมีอยู่จริง, definition ผ่านกฎของ Discord และทุกคำสั่งที่ประกาศไว้
  (รวม `/web` `/mytask` `/task`) มี handler รับจริง
- `test/task-command.test.mjs` — เรียก `handleTask` ตรงๆ (26 เคส) ครอบคลุม `/task list`
  และ `/task add` โดย inject service ปลอมแทน MongoDB จริง
- `test/tasks-service.test.mjs` — กฎธุรกิจของ task (27 เคส) validation ของชื่อ/description,
  PATCH whitelist ฟิลด์ที่แก้ได้, สิทธิ์แก้/ลบเฉพาะเจ้าของงานหรือผู้ถูกมอบหมาย
- `test/image.test.mjs` — ยิงตัวลบ metadata ตรงๆ (33 เคส) สร้าง JPEG/PNG/WebP
  ที่ฝังพิกัดปลอมไว้แล้วยืนยันว่าพิกัดหายจริง ส่วนภาพยังอยู่ครบ และไฟล์ยังเปิดได้
- `test/rate-limit.test.mjs` — ปลอม Upstash REST API (29 เคส) ยืนยันว่า id ไม่ถูกเก็บดิบ,
  คนที่โดนบล็อกไม่ไปกินโควตาห้อง และ Redis ล่มแล้วยังปล่อยผ่าน
- `test/interactions.test.mjs` — เรียก handler ตรงๆ (55 เคส) ครอบคลุม PING/PONG,
  ลายเซ็นผิดต้องได้ 401, `/send` ทั้งแบบข้อความและแนบรูป, ไฟล์ที่ไม่ใช่ภาพ,
  ไฟล์เกิน 8MB, โดน rate limit, Discord ตอบ 401/403/404, `/ping`, คำสั่งไม่รู้จัก,
  body พัง และ env var หาย
- `test/http-e2e.test.mjs` — เปิด HTTP server จริงแล้วจำลอง adapter ของ Vercel (9 เคส)
  ยิงผ่าน TCP จริงตามลำดับที่ Discord ใช้ตรวจตอนกด Save Endpoint URL
  รวมถึงเช็คว่าข้อความภาษาไทย/emoji เซ็นผ่านและส่งถึงปลายทางไม่เพี้ยน
- `test/session.test.mjs` — เซ็น/ตรวจ session cookie ตรงๆ (32 เคส) payload ปลอม,
  ลายเซ็นมั่ว, secret คนละตัว, token หมดอายุ, `SESSION_SECRET` สั้นกว่า 32 ตัวอักษร
  ต้องถูกปฏิเสธทั้งตอนเซ็นและตอนตรวจ
- `test/auth.test.mjs` — OAuth2 login/callback/logout (42 เคส) state ปลอมต้องกัน CSRF ได้,
  ปฏิเสธ guild id ที่ไม่ตรงรูปแบบ, ผู้ใช้ที่ไม่ได้อยู่ใน guild ต้องเข้าไม่ได้ (403)
- `test/api-tasks.test.mjs` — route ของ `/api/tasks*` (24 เคส) ทุก method ต้องปฏิเสธก่อนแตะ
  ฐานข้อมูลเมื่อไม่มี session หรือปิดฟีเจอร์ไว้, error ภายในต้องไม่หลุดออกไปให้ผู้ใช้เห็น
- `test/web-escape.test.mjs` — `buildTaskRow()` จาก `public/app.js` ตรงๆ (15 เคส) ยืนยันว่า
  ชื่อและ description ที่มี HTML/script ถูกเก็บเป็นข้อความล้วน ไม่มีการประกอบ HTML จากข้อมูลผู้ใช้เลย

## จำกัดความถี่ (rate limit)

`/send` ถูกจำกัดที่ **5 ครั้ง/นาที ต่อคน** และ **15 ครั้ง/นาที ต่อห้อง** ส่วน `/ping` ไม่ถูกจำกัด

เป็นฟีเจอร์แบบ opt-in — ถ้าไม่ตั้งค่า Upstash บอทจะทำงานปกติทุกอย่างแต่ไม่จำกัดความถี่

### เปิดใช้งาน

1. สร้าง Redis database ฟรีที่ https://upstash.com (หรือผ่าน Vercel Marketplace ซึ่งจะใส่ env var ให้อัตโนมัติ)
2. กด **Connect** แล้วคัดลอกค่า REST URL กับ REST Token
3. เพิ่มที่ Vercel → Settings → Environment Variables (Production):

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

4. **Redeploy** ค่าใหม่ถึงจะมีผล

ปรับตัวเลขลิมิตได้ที่ `RATE_LIMIT` ใน [lib/rate-limit.js](lib/rate-limit.js)

### ยังไม่ระบุตัวตนอยู่ไหม — ยังครับ

สิ่งที่เก็บลง Redis คือ **ตัวนับที่หมดอายุใน 1 นาที** ไม่ใช่ log และ id ถูก HMAC-SHA256 ด้วย salt ลับก่อนเสมอ
key ที่เก็บจริงหน้าตาเป็น `rl:u:9f2a...` ต่อให้ข้อมูลหลุดก็ย้อนกลับเป็น user id ไม่ได้
และไม่มีการเก็บเนื้อหาข้อความหรือรูปไว้ที่ไหนทั้งสิ้น

### พฤติกรรมที่ตั้งใจออกแบบไว้

- **นับของคนก่อน แล้วค่อยนับของห้อง** ถ้าคนนั้นโดนบล็อกแล้วจะไม่ไปแตะตัวนับห้องเลย
  ไม่งั้นคนสแปมคนเดียวจะกินโควตาห้องจนคนอื่นส่งไม่ได้ตามไปด้วย
- **Redis ล่ม = ปล่อยผ่าน** (fail-open) ตัวจำกัดความถี่พังไม่ควรทำให้บอททั้งตัวใช้ไม่ได้ แต่จะ log ไว้
- **เช็คก่อนโหลดรูป** คำขอที่ยังไงก็ไม่ผ่านจะไม่เปลือง bandwidth และเวลา

## แก้ปัญหาที่เจอบ่อย

**Discord ขึ้น "interactions endpoint url could not be verified"**
- `DISCORD_PUBLIC_KEY` บน Vercel ผิดหรือยังไม่ได้ใส่ (ต้องเป็น Public Key ไม่ใช่ token)
- ใส่ env var แล้วแต่ยังไม่ได้ redeploy — Vercel ต้อง deploy ใหม่ env ถึงจะมีผล
- เอา preview URL ไปใส่แทน production domain

**บอทตอบ "ส่งไม่สำเร็จ: bot token ไม่ถูกต้อง"**
ค่า `DISCORD_TOKEN` บน Vercel ไม่ตรงกับ token จริง เช็ค 3 อย่าง:
- อย่าใส่คำว่า `Bot ` นำหน้า ใส่แค่ตัว token เปล่าๆ (โค้ดเติม `Bot ` ให้เอง)
- ต้องเป็น **Bot → Token** ไม่ใช่ Client Secret หรือ Public Key
- แก้ env var แล้วต้อง **Redeploy** ด้วย ค่าใหม่ถึงจะมีผลกับ deployment ที่รันอยู่

**บอทตอบ "ส่งไม่สำเร็จ: บอทไม่มีสิทธิ์โพสต์ในห้องนี้"**
บอทยังไม่ได้อยู่ในเซิร์ฟเวอร์ หรือไม่มี permission Send Messages ในห้องนั้น

**พิมพ์ `/send` แล้วไม่ขึ้นคำสั่ง**
ยังไม่ได้รัน `npm run register` หรือเชิญบอทโดยไม่ได้ติ๊ก scope `applications.commands`
(คำสั่งแบบ global ใช้เวลา sync ได้ถึง 1 ชั่วโมง)

**ดู log**: Vercel Dashboard → โปรเจกต์ → Logs

## อะไรถูกเก็บ อะไรไม่ถูกเก็บ

| ส่วน | เก็บอะไร |
|---|---|
| `/send` `/ping` | **ไม่เก็บอะไรเลย** ไม่มี log ว่าใครส่งอะไร ตามหาย้อนหลังไม่ได้ ตัวนับ rate limit เก็บเฉพาะ id ที่ hash แล้วและหมดอายุใน 1 นาที |
| ระบบ task | **เก็บ Discord user id ถาวร** ในฟิลด์ `createdBy` และ `assignee` เพื่อให้รู้ว่าใครเป็นเจ้าของงาน |

สองส่วนนี้แยกฐานข้อมูลและแยกโค้ดจากกัน `/send` ไม่แตะฐานข้อมูล task เลย และระบบ task ไม่แตะ
Upstash Redis ของ rate limit เลยเช่นกัน ปิด/เปิดฟีเจอร์หนึ่งจึงไม่กระทบอีกฟีเจอร์หนึ่ง

ระบบ task ยังเก็บ **ชื่องานและ description ตามที่ผู้ใช้พิมพ์เข้ามาแบบคำต่อคำ** (ไม่ hash ไม่ redact)
เพราะต้องแสดงให้สมาชิกคนอื่นในเซิร์ฟเวอร์เห็น จึงไม่ใช่ระบบไม่ระบุตัวตนเหมือน `/send` — คนที่ล็อกอิน
เข้าเซิร์ฟเวอร์เดียวกันจะเห็นได้ว่าใครสร้าง/ถูกมอบหมายงานไหน

## หน้าเว็บทำอะไรได้

เปิดผ่านลิงก์ที่ `/web` ตอบกลับมา ล็อกอินด้วย Discord แล้วจะเห็น task ทั้งหมดของเซิร์ฟเวอร์นั้น

| ทำได้ | ยังไง |
|---|---|
| เพิ่มงานเร็วๆ | พิมพ์ชื่อในช่องบนสุดแล้วกด "เพิ่ม" |
| ติ๊กว่าเสร็จ | กด checkbox หน้าแถว |
| **แก้ทุกฟิลด์** | กด "แก้" ในแถว → ชื่อ, รายละเอียด, กำหนดส่ง, ผู้รับผิดชอบ |
| ลบ | กด "ลบ" |
| กรอง | ทั้งหมด / ของฉัน / เสร็จแล้ว |

ฟอร์มเพิ่มมีช่องเดียวโดยตั้งใจ — งานที่ทำบ่อยที่สุดคือจดชื่องานไว้ก่อน ส่วนรายละเอียดกับกำหนดส่ง
ค่อยเติมทีหลังผ่านปุ่มแก้ ซึ่งเป็น**ทางเดียว**ที่ตั้ง `description` กับ `dueDate` ได้ เพราะ
`/task add` ใน Discord รับแค่ชื่องานกับผู้รับผิดชอบ

**ผู้รับผิดชอบบนเว็บเลือกได้แค่ "ฉัน" หรือ "ไม่ระบุ"** เพราะหน้าเว็บไม่รู้จักรายชื่อสมาชิกในเซิร์ฟเวอร์
(ต้องเปิด privileged intent `Server Members` เพิ่ม) ถ้าจะมอบหมายให้คนอื่นใช้ `/task add assignee:@คน`
ใน Discord ซึ่ง Discord ส่งข้อมูลคนที่ถูกเลือกมาให้ในตัว

งานที่คนอื่นถืออยู่จะมีตัวเลือก **"คงผู้รับผิดชอบเดิม"** เพิ่มมาและถูกเลือกไว้ให้ เพื่อไม่ให้การ
แก้ชื่องานเผลอปลดคนอื่นออกจากงานไปด้วย และแถวจะขึ้นป้าย "ของฉัน" หรือ "มอบหมายแล้ว"
แทนการโชว์ Discord id ดิบซึ่งอ่านไม่รู้เรื่อง

## คำสั่งที่ต้องรอฐานข้อมูล

Discord บังคับให้ response **แรก** มาถึงภายใน 3 วินาที เกินกว่านั้น token ถูกยกเลิกทันทีและ
ผู้ใช้เห็นแค่ "แอปพลิเคชันไม่ตอบสนอง" ยืดเวลาไม่ได้เลย

`/task list` `/task add` `/mytask` ต้องรอ MongoDB ซึ่งตอน cold start อาจเกิน 3 วินาทีได้
สามคำสั่งนี้จึงตอบ **`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`** กลับไปทันที (Discord ขึ้น "กำลังคิด…")
แล้วค่อยแก้ข้อความนั้นเป็นผลลัพธ์จริงเมื่อทำงานเสร็จ — interaction token ใช้ได้อีก 15 นาที

```
/task list  →  ตอบ type 5 ทันที (< 100ms)     Discord ขึ้น "กำลังคิด…"
            →  ต่อ Mongo, query, จัดรูปแบบ      ใช้เวลาเท่าไหร่ก็ได้
            →  PATCH ข้อความเดิมด้วยผลจริง        ผู้ใช้เห็นคำตอบ
```

บน Vercel การ return response ทำให้ function ถูกแช่แข็งทันที งานที่เหลือจึงต้องฝากไว้กับ
`waitUntil()` ของ `@vercel/functions` ซึ่งห่อไว้ใน `lib/defer.js` แล้ว

จุดที่ตั้งใจออกแบบไว้:

- **ด่านที่ตอบได้ทันทีจะไม่ defer** — DM, ระบบ task ปิดอยู่, subcommand ที่ไม่รู้จัก ตอบตรงๆ เลย
  ไม่ต้องให้ผู้ใช้เห็น "กำลังคิด…" แวบหนึ่งเพื่อรอคำตอบที่รู้อยู่แล้ว
- **ทุก error ถูกแปลงเป็นข้อความเสมอ** ถ้าปล่อยให้ error หลุดออกไปโดยไม่มีใครแก้ข้อความ
  ผู้ใช้จะค้างอยู่ที่ "กำลังคิด…" ตลอดไปโดยไม่รู้ว่าเกิดอะไร มีเทสต์คุมข้อนี้ไว้
- **ephemeral ต้องตั้งตั้งแต่ response แรก** Discord ยึดตามครั้งแรก ถ้าลืมข้อความ "กำลังคิด…"
  จะโผล่ให้ทั้งห้องเห็น
- `/send` `/ping` `/web` ไม่แตะฐานข้อมูล จึงตอบตรงๆ เหมือนเดิม ไม่ต้อง defer

## ข้อจำกัดตามการออกแบบ

- รับได้เฉพาะสิ่งที่ Discord ยิงเข้ามา (slash command / ปุ่ม / เมนู) ทำงานที่ต้องฟัง event
  ต่อเนื่องอย่างดักข้อความธรรมดาหรือเล่นเพลงไม่ได้ เพราะไม่ได้ต่อ Gateway ค้างไว้
- ต้องตอบ Discord ภายใน 3 วินาที ยืดไม่ได้ — ดูหัวข้อ
  [คำสั่งที่ต้องรอฐานข้อมูล](#คำสั่งที่ต้องรอฐานข้อมูล) ว่าจัดการยังไง
- ดูหัวข้อ [อะไรถูกเก็บ อะไรไม่ถูกเก็บ](#อะไรถูกเก็บ-อะไรไม่ถูกเก็บ) ด้านบนสำหรับสิ่งที่แต่ละฟีเจอร์บันทึกไว้
- ปิด mention ทุกชนิดไว้แล้ว (`allowed_mentions: { parse: [] }`) เพื่อกันคนใช้ `/send @everyone` ก่อกวน
