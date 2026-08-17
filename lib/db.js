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
  cache.promise ??= mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false });
  cache.conn = await cache.promise;
  return cache.conn;
}
