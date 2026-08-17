// register.js — ลงทะเบียน slash command กับ Discord (รัน `npm run register` บนเครื่องตัวเอง)
import 'dotenv/config';

const APP_ID = process.env.APP_ID;
const BOT_TOKEN = process.env.DISCORD_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
  console.error('ขาด APP_ID หรือ DISCORD_TOKEN ในไฟล์ .env');
  process.exit(1);
}

// PUT เป็นการแทนที่คำสั่งทั้งหมด — คำสั่งไหนไม่อยู่ใน array นี้จะถูกลบออกจาก Discord
const commands = [
  {
    name: 'send',
    description: 'ส่งข้อความแบบไม่ระบุตัวตน',
    options: [
      {
        name: 'message',
        type: 3, // String
        description: 'ข้อความที่คุณต้องการส่ง',
        required: true,
        min_length: 1,
        max_length: 2000, // เพดานความยาวข้อความของ Discord
      },
    ],
  },
  {
    name: 'ping',
    description: 'เช็คว่าบอทยังทำงานอยู่และตอบช้าแค่ไหน',
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

const body = await res.json();

if (!res.ok) {
  console.error(`ลงทะเบียนไม่สำเร็จ (${res.status}):`, body);
  process.exit(1);
}

console.log(
  'ลงทะเบียนคำสั่งเรียบร้อย:',
  body.map((c) => `/${c.name}`).join(' '),
);
