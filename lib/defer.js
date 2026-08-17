import { waitUntil } from '@vercel/functions';
import { deferredEphemeral, editOriginal } from './discord.js';

/**
 * ยืดอายุ function ให้ทำงานต่อได้หลังส่ง response กลับไปแล้ว
 *
 * บน Vercel พอ return response ปุ๊บ function จะถูกแช่แข็งทันที โค้ดที่เหลือไม่ได้รัน
 * การตอบ Discord ว่า "กำลังคิด..." แล้วค่อยทำงานต่อจึงต้องผ่าน waitUntil เท่านั้น
 *
 * ห่อ try/catch ไว้เพราะเรียกนอก runtime ของ Vercel (เช่นตอนรันเทสต์ หรือรันในเครื่อง)
 * waitUntil จะโยน error ทิ้ง ซึ่งไม่ควรทำให้ตัวงานพังตามไปด้วย — promise ยังเดินของมันเองได้อยู่แล้ว
 */
export function defer(promise) {
  try {
    waitUntil(promise);
  } catch {
    // นอก Vercel ปล่อยให้ promise ทำงานต่อตามปกติ ไม่ต้องทำอะไรเพิ่ม
  }
}

/**
 * ตอบ "กำลังคิด..." ทันที แล้วเอาผลของ work() ไปแทนที่ข้อความนั้นทีหลัง
 *
 * ใช้กับคำสั่งที่ต้องรอ MongoDB ซึ่งตอน cold start อาจนานเกิน 3 วินาทีที่ Discord ให้
 * แล้วผู้ใช้จะเห็นแค่ "แอปพลิเคชันไม่ตอบสนอง" โดยไม่รู้สาเหตุและต้องพิมพ์คำสั่งซ้ำ
 *
 * ทุก error ถูกจับไว้ตรงนี้และแปลงเป็นข้อความเสมอ ถ้าปล่อยให้หลุดออกไป
 * จะไม่มีใครแก้ข้อความ "กำลังคิด..." ผู้ใช้ก็ค้างอยู่แบบนั้นตลอดไป
 */
export function respondLater({ interaction, work, defer: deferImpl = defer, fetchImpl }) {
  const finish = async () => {
    let content;
    try {
      content = await work();
    } catch (err) {
      console.error('deferred work failed:', err);
      content = 'ระบบ task ใช้ไม่ได้ชั่วคราว ลองใหม่อีกครั้ง';
    }
    await editOriginal(
      { applicationId: interaction.application_id, token: interaction.token, content },
      fetchImpl,
    );
  };

  deferImpl(finish());
  return deferredEphemeral();
}
