// ทำความสะอาดรูปก่อนโพสต์ หัวใจคือห้ามให้ metadata ของคนส่งหลุดออกไป
// รูปจากมือถือฝังพิกัด GPS, รุ่นเครื่อง และเวลาถ่ายไว้ ถ้า forward ดิบๆ
// บอทที่ควรปกปิดตัวตนจะกลายเป็นตัวเปิดเผยตำแหน่งคนส่งแทน

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * ดูชนิดไฟล์จากไบต์จริง ไม่เชื่อ content_type ที่ Discord แจ้งมา
 * ถ้าชนิดที่แจ้งไม่ตรงกับของจริง ตัวลบ metadata จะเลือกวิธีผิดแล้วปล่อย EXIF หลุดไปเงียบๆ
 * คืน null เมื่อไม่ใช่ชนิดที่รองรับ ผู้เรียกต้องปฏิเสธไฟล์นั้น
 */
export function detectImageType(buf) {
  const head = (start, end) => buf.subarray(start, end).toString('latin1');

  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) {
    return 'image/png';
  }
  if (buf.length >= 12 && head(0, 4) === 'RIFF' && head(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 6 && (head(0, 6) === 'GIF87a' || head(0, 6) === 'GIF89a')) {
    return 'image/gif';
  }
  return null;
}

export function randomImageName(type) {
  return `image-${crypto.randomUUID().slice(0, 8)}.${EXTENSION[type]}`;
}

// JPEG เป็นลำดับ segment: FF <marker> <ความยาว 2 ไบต์> <ข้อมูล>
// ตัด APP1-APP15 (EXIF/XMP/IPTC/maker note) กับ COM ทิ้ง เก็บ APP0 (JFIF) ไว้เพราะมีแค่ค่า density
// พอเจอ SOS (FFDA) หลังจากนั้นเป็นข้อมูลภาพล้วน คัดลอกยาวรวดเดียวจนจบ
function stripJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2;

  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) break; // โครงสร้างเพี้ยน ปล่อยที่เหลือไปตามเดิม
    const marker = buf[i + 1];

    // marker ที่ไม่มีช่องความยาวตามหลัง
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }

    if (marker === 0xda) {
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }

    if (i + 3 >= buf.length) break;
    const length = (buf[i + 2] << 8) | buf[i + 3];
    if (length < 2 || i + 2 + length > buf.length) break;

    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) out.push(buf.subarray(i, i + 2 + length));
    i += 2 + length;
  }

  if (i < buf.length) out.push(buf.subarray(i));
  return Buffer.concat(out);
}

// PNG เป็นลำดับ chunk: <ความยาว 4><ชนิด 4><ข้อมูล><CRC 4>
// ตัดเฉพาะ chunk ที่เก็บข้อความและ EXIF ที่เหลือคงไว้ทั้งหมด
function stripPng(buf) {
  const DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  const out = [buf.subarray(0, 8)];
  let i = 8;

  while (i + 8 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + length;
    if (end > buf.length) break;

    if (!DROP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }

  return Buffer.concat(out);
}

// WebP เป็น RIFF container: <FourCC 4><ขนาด 4><ข้อมูล> โดยแต่ละ chunk ถูก pad ให้ยาวเป็นเลขคู่
// ตัด chunk EXIF กับ XMP ทิ้ง แล้วเคลียร์บิตใน VP8X ที่ยังประกาศว่ามีสองอย่างนั้นอยู่
function stripWebp(buf) {
  const out = [];
  let i = 12;

  while (i + 8 <= buf.length) {
    const type = buf.subarray(i, i + 4).toString('latin1');
    const size = buf.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (end > buf.length) break;

    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(i, end));
      if (type === 'VP8X' && chunk.length > 8) {
        chunk[8] &= ~0x08; // ธง EXIF
        chunk[8] &= ~0x04; // ธง XMP
      }
      out.push(chunk);
    }
    i = end;
  }

  const body = Buffer.concat(out);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

/**
 * ลบ metadata ตามชนิดไฟล์ ต้องส่ง type ที่ได้จาก detectImageType เท่านั้น
 *
 * GIF ผ่านไปตามเดิมโดยตั้งใจ เพราะกล้องมือถือไม่ผลิต GIF จึงไม่มี GPS ให้หลุด
 * และการไล่ block ของ GIF ผิดพลาดง่ายกว่าประโยชน์ที่ได้
 */
export function stripMetadata(buf, type) {
  if (type === 'image/jpeg') return stripJpeg(buf);
  if (type === 'image/png') return stripPng(buf);
  if (type === 'image/webp') return stripWebp(buf);
  return buf;
}
