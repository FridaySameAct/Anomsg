# Anomsg

Discord bot สำหรับส่งข้อความแบบไม่ระบุตัวตน รันเป็น Vercel Function (โฮสต์ฟรีบน Hobby plan ได้)

ผู้ใช้พิมพ์ `/send message:<ข้อความ>` แล้วบอทจะโพสต์ข้อความนั้นลงห้องในนามของบอทเอง
ส่วนคำยืนยันจะเป็นแบบ ephemeral ที่มีแค่คนสั่งเห็น ตัวตนคนส่งจึงไม่ถูกเปิดเผย

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `api/interactions.js` | Vercel Function รับ webhook จาก Discord (deploy อัตโนมัติที่ `/api/interactions`) |
| `register.js` | สคริปต์รันบนเครื่องตัวเอง ลงทะเบียน slash command กับ Discord (รันครั้งเดียว) |

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

## ทดสอบ

```bash
npm test
```

ชุดทดสอบสร้าง Ed25519 keypair ขึ้นมาเซ็นจริงแล้วเรียก handler ตรงๆ ไม่ต้องใช้ token
หรือต่อเน็ต ครอบคลุมทั้ง PING/PONG, ลายเซ็นผิดต้องได้ 401, `/send` สำเร็จ,
กรณี Discord ตอบ error และกรณี env var หาย

## แก้ปัญหาที่เจอบ่อย

**Discord ขึ้น "interactions endpoint url could not be verified"**
- `DISCORD_PUBLIC_KEY` บน Vercel ผิดหรือยังไม่ได้ใส่ (ต้องเป็น Public Key ไม่ใช่ token)
- ใส่ env var แล้วแต่ยังไม่ได้ redeploy — Vercel ต้อง deploy ใหม่ env ถึงจะมีผล
- เอา preview URL ไปใส่แทน production domain

**บอทตอบ "ส่งไม่สำเร็จ: บอทไม่มีสิทธิ์โพสต์ในห้องนี้"**
บอทยังไม่ได้อยู่ในเซิร์ฟเวอร์ หรือไม่มี permission Send Messages ในห้องนั้น

**พิมพ์ `/send` แล้วไม่ขึ้นคำสั่ง**
ยังไม่ได้รัน `npm run register` หรือเชิญบอทโดยไม่ได้ติ๊ก scope `applications.commands`
(คำสั่งแบบ global ใช้เวลา sync ได้ถึง 1 ชั่วโมง)

**ดู log**: Vercel Dashboard → โปรเจกต์ → Logs

## ข้อจำกัดตามการออกแบบ

- รับได้เฉพาะสิ่งที่ Discord ยิงเข้ามา (slash command / ปุ่ม / เมนู) ทำงานที่ต้องฟัง event
  ต่อเนื่องอย่างดักข้อความธรรมดาหรือเล่นเพลงไม่ได้ เพราะไม่ได้ต่อ Gateway ค้างไว้
- ต้องตอบ Discord ภายใน 3 วินาที ถ้าจะเพิ่มงานที่ช้ากว่านั้นต้องใช้
  `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` แล้วตามไปแก้ข้อความทีหลัง
- ไม่เก็บ log ว่าใครส่งอะไร และไม่มี rate limit — ถ้าเปิดใช้ในเซิร์ฟเวอร์สาธารณะควรเพิ่มเอง
- ปิด mention ทุกชนิดไว้แล้ว (`allowed_mentions: { parse: [] }`) เพื่อกันคนใช้ `/send @everyone` ก่อกวน
