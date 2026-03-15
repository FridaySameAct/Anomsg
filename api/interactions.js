import { InteractionType, InteractionResponseType, verifyKey } from 'discord-interactions';

export default async function handler(req, res) {
  // 1. ตรวจสอบการยืนยันตัวตน (Security check)
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const isValidRequest = verifyKey(
    JSON.stringify(req.body),
    signature,
    timestamp,
    process.env.DISCORD_PUBLIC_KEY // ตั้งค่าใน Vercel Dashboard
  );

  if (!isValidRequest) {
    return res.status(401).send('Bad request signature');
  }

  const interaction = req.body;

  // 2. ตอบกลับการ PING (Discord ใช้เช็คว่า URL เราใช้งานได้ไหม)
  if (interaction.type === InteractionType.PING) {
    return res.status(200).json({ type: InteractionResponseType.PONG });
  }

  // 3. จัดการคำสั่ง Slash Command (เช่น /send)
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = interaction.data;

    if (name === 'send') {
      const messageContent = options.find(opt => opt.name === 'message').value;
      const channelId = interaction.channel_id; // ส่งกลับไปที่ห้องเดิมที่พิมพ์

      // ส่งข้อความในนามบอท (ผ่าน Discord API)
      await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: messageContent,
        }),
      });

      // ตอบกลับผู้ใช้งานแบบ Ephemeral (เห็นคนเดียว) เพื่อยืนยันว่าส่งแล้ว
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'ส่งข้อความแบบไม่ระบุตัวตนเรียบร้อยแล้ว!',
          flags: 64, // 64 = Ephemeral message (คนอื่นไม่เห็น)
        },
      });
    }
  }
}