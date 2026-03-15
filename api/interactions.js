import { InteractionType, InteractionResponseType, verifyKey } from 'discord-interactions';

// 1. ปิดการทำงานของ Vercel Body Parser เพื่อให้ได้ข้อมูลดิบ (Raw Body)
export const config = {
  api: {
    bodyParser: false,
  },
};

// ฟังก์ชันช่วยอ่านข้อมูลดิบจาก Stream
async function getRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is online!');
  }

  // 2. อ่านข้อมูลดิบ
  const rawBody = await getRawBody(req);
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];

  // 3. ตรวจสอบ Signature ด้วยข้อมูลดิบจริงๆ
  const isValidRequest = verifyKey(
    rawBody,
    signature,
    timestamp,
    process.env.DISCORD_PUBLIC_KEY
  );

  if (!isValidRequest) {
    console.error("Signature Verification Failed!");
    return res.status(401).send('Bad request signature');
  }

  // แปลงข้อมูลดิบเป็น JSON เพื่อใช้งานต่อ
  const interaction = JSON.parse(rawBody.toString());

  // 4. ตอบกลับ PING
  if (interaction.type === InteractionType.PING) {
    console.log("PING received, sending PONG...");
    // ต้องตอบกลับด้วย .json() เพื่อให้ Header เป็น application/json
    return res.status(200).json({
      type: InteractionResponseType.PONG
    });
  }

  // 5. จัดการคำสั่ง /send
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    if (interaction.data.name === 'send') {
      const messageContent = interaction.data.options[0].value;
      const channelId = interaction.channel_id;

      try {
        await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: messageContent }),
        });

        return res.status(200).json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'ส่งข้อความแบบไม่ระบุตัวตนเรียบร้อยแล้ว!',
            flags: 64, 
          },
        });
      } catch (err) {
        console.error("Error sending message:", err);
        return res.status(500).send('Internal Error');
      }
    }
  }
}