// register.js (รัน node register.js)
require('dotenv').config()

const APP_ID = process.env.APP_ID;
const BOT_TOKEN = process.env.DISCORD_TOKEN;

const command = {
  name: 'send',
  description: 'ส่งข้อความแบบไม่ระบุตัวตน',
  options: [
    {
      name: 'message',
      type: 3, // String
      description: 'ข้อความที่คุณต้องการส่ง',
      required: true,
    },
  ],
};

fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify([command]),
}).then(res => res.json()).then(console.log);