import { ephemeral, interactionLatencyMs } from './discord.js';

// ไม่ถูกจำกัดความถี่ เพราะไม่ได้โพสต์อะไรลงห้อง กวนคนอื่นไม่ได้
export function handlePing({ interaction }) {
  const latency = interactionLatencyMs(interaction.id);
  return ephemeral(latency === null ? 'Pong! 🏓' : `Pong! 🏓 (${latency} ms)`);
}
