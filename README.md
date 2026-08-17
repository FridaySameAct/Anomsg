# Anomsg

Discord bot สำหรับส่งข้อความแบบไม่ระบุตัวตน รันเป็น Vercel Function (โฮสต์ฟรีบน Hobby plan ได้)

| คำสั่ง | ทำอะไร |
|---|---|
| `/send message:<ข้อความ> image:<รูป>` | บอทโพสต์ข้อความและ/หรือรูปลงห้องในนามของบอทเอง |
| `/ping` | เช็คว่าบอทยังทำงานอยู่ พร้อมบอก latency เป็น ms |

ทั้ง `message` และ `image` เป็น option ที่ไม่บังคับ แต่ต้องใส่มาอย่างน้อยหนึ่งอย่าง
จะส่งเฉพาะรูปโดยไม่มีข้อความก็ได้

คำตอบของทั้งสองคำสั่งเป็นแบบ ephemeral ที่มีแค่คนสั่งเห็น ตัวตนคนส่งจึงไม่ถูกเปิดเผย

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
| `api/interactions.js` | Vercel Function รับ webhook จาก Discord (deploy อัตโนมัติที่ `/api/interactions`) |
| `register.js` | สคริปต์รันบนเครื่องตัวเอง ลงทะเบียน slash command กับ Discord (รันครั้งเดียว) |
| `lib/image.js` | ตรวจชนิดไฟล์ภาพและลบ metadata ก่อนอัปโหลด (ไม่ได้อยู่ใน `/api` จึงไม่ถูก deploy เป็น function) |
| `lib/rate-limit.js` | จำกัดความถี่ของ `/send` ผ่าน Upstash Redis |

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

รัน 126 เคส ไม่ต้องใช้ token จริงหรือต่อเน็ต แบ่งเป็น 4 ชุด:

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

## ข้อจำกัดตามการออกแบบ

- รับได้เฉพาะสิ่งที่ Discord ยิงเข้ามา (slash command / ปุ่ม / เมนู) ทำงานที่ต้องฟัง event
  ต่อเนื่องอย่างดักข้อความธรรมดาหรือเล่นเพลงไม่ได้ เพราะไม่ได้ต่อ Gateway ค้างไว้
- ต้องตอบ Discord ภายใน 3 วินาที ถ้าจะเพิ่มงานที่ช้ากว่านั้นต้องใช้
  `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` แล้วตามไปแก้ข้อความทีหลัง
- ไม่เก็บ log ว่าใครส่งอะไร ตามหาคนก่อกวนย้อนหลังไม่ได้ (ดูหัวข้อ rate limit สำหรับการกันสแปม)
- ปิด mention ทุกชนิดไว้แล้ว (`allowed_mentions: { parse: [] }`) เพื่อกันคนใช้ `/send @everyone` ก่อกวน
