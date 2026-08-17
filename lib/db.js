import mongoose from 'mongoose';

// cache connection ไว้บน globalThis แล้วใช้ซ้ำตลอดอายุ instance
// ห้ามเรียก connect() ตอนโหลด module ไม่งั้นทุก cold start จะเปิด connection ใหม่
// จนเต็ม pool ของ Atlas M0 ที่จำกัด 500 connections
const cache = (globalThis._anomsgMongo ??= { conn: null, promise: null });

export function isTasksEnabled() {
  return Boolean(process.env.MONGODB_URI);
}

export async function connectDb() {
  if (cache.conn) return cache.conn;
  // ล้าง promise ทิ้งเมื่อต่อไม่สำเร็จ ไม่งั้นการต่อพลาดครั้งเดียวจะค้างเป็น promise ที่ reject
  // แล้วทุก request ที่เหลือของ instance นั้นจะพังตามไปด้วยจนกว่า instance จะถูกรีไซเคิล
  cache.promise ??= mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false })
    .catch((err) => {
      cache.promise = null;
      throw err;
    });
  cache.conn = await cache.promise;
  return cache.conn;
}
