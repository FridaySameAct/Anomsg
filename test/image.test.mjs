// ทดสอบตัวลบ metadata โดยตรง แยกจาก handler
import { detectImageType, randomImageName, stripMetadata, MAX_IMAGE_BYTES } from '../lib/image.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name} ${extra}`);
    fail++;
  }
}

const SECRET = 'GPS-13.7563,100.5018';

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'latin1');
  data.copy(chunk, 8);
  return chunk; // ปล่อย CRC เป็นศูนย์ ตัว strip ไม่ได้ตรวจ CRC
}

function riffChunk(type, data) {
  const padded = data.length + (data.length % 2);
  const chunk = Buffer.alloc(8 + padded);
  chunk.write(type, 0, 'latin1');
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

console.log('\n=== detectImageType ดูจากไบต์จริง ===');
{
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.alloc(13)),
  ]);
  check('JPEG', detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])) === 'image/jpeg');
  check('PNG', detectImageType(png) === 'image/png');
  check('GIF', detectImageType(Buffer.from('GIF89a....', 'latin1')) === 'image/gif');
  check(
    'WebP',
    detectImageType(Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')])) ===
      'image/webp',
  );
  check('ไฟล์อื่นต้องได้ null', detectImageType(Buffer.from('MZ\x90\x00 exe', 'latin1')) === null);
  check('ไฟล์สั้นมากต้องไม่ crash', detectImageType(Buffer.from([0xff])) === null);
}

console.log('\n=== PNG: ตัด chunk ข้อความทิ้ง ===');
{
  const original = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.alloc(13, 7)),
    pngChunk('tEXt', Buffer.from(`Comment\0${SECRET}`, 'latin1')),
    pngChunk('eXIf', Buffer.from(SECRET, 'latin1')),
    pngChunk('IDAT', Buffer.from([0xaa, 0xbb, 0xcc])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const out = stripMetadata(original, 'image/png');
  const text = out.toString('latin1');

  check('ข้อมูลลับหายไป', !text.includes(SECRET));
  check('tEXt ถูกตัด', !text.includes('tEXt'));
  check('eXIf ถูกตัด', !text.includes('eXIf'));
  check('signature ยังอยู่', out.subarray(0, 8).equals(original.subarray(0, 8)));
  check('IHDR ยังอยู่', text.includes('IHDR'));
  check('IDAT ยังอยู่', out.indexOf(Buffer.from([0xaa, 0xbb, 0xcc])) !== -1);
  check('IEND ยังอยู่', text.includes('IEND'));
  check('ยังตรวจได้ว่าเป็น PNG', detectImageType(out) === 'image/png');
}

console.log('\n=== WebP: ตัด EXIF/XMP แล้วเคลียร์ธงใน VP8X ===');
{
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04 | 0x10; // ธง EXIF + XMP + Alpha
  const body = Buffer.concat([
    riffChunk('VP8X', vp8x),
    riffChunk('VP8 ', Buffer.from([0xde, 0xad, 0xbe, 0xef])),
    riffChunk('EXIF', Buffer.from(SECRET, 'latin1')),
    riffChunk('XMP ', Buffer.from(SECRET, 'latin1')),
  ]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  const out = stripMetadata(Buffer.concat([header, body]), 'image/webp');
  const text = out.toString('latin1');

  check('ข้อมูลลับหายไป', !text.includes(SECRET));
  check('chunk EXIF ถูกตัด', !text.includes('EXIF'));
  check('chunk XMP ถูกตัด', !text.includes('XMP '));
  check('ภาพจริงยังอยู่', out.indexOf(Buffer.from([0xde, 0xad, 0xbe, 0xef])) !== -1);
  check('ธง EXIF ใน VP8X ถูกเคลียร์', (out[20] & 0x08) === 0, `flags=${out[20]?.toString(2)}`);
  check('ธง XMP ใน VP8X ถูกเคลียร์', (out[20] & 0x04) === 0);
  check('ธง Alpha ไม่ถูกแตะ', (out[20] & 0x10) === 0x10);
  check('ขนาดใน RIFF header ถูกแก้ให้ตรง', out.readUInt32LE(4) === out.length - 8, `${out.readUInt32LE(4)} vs ${out.length - 8}`);
  check('ยังตรวจได้ว่าเป็น WebP', detectImageType(out) === 'image/webp');
}

console.log('\n=== GIF: ปล่อยผ่านตามที่ตั้งใจ ===');
{
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
  check('ไบต์ไม่เปลี่ยน', stripMetadata(gif, 'image/gif').equals(gif));
}

console.log('\n=== JPEG ที่ไม่มี metadata อยู่แล้ว ต้องไม่พัง ===');
{
  const clean = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x03, 0x00, 0x11, 0x22, 0xff, 0xd9]);
  const out = stripMetadata(clean, 'image/jpeg');
  check('ไบต์ไม่เปลี่ยน', out.equals(clean), out.toString('hex'));
}

console.log('\n=== JPEG ที่โครงสร้างพัง ต้องไม่ crash และไม่ทำข้อมูลหาย ===');
{
  const broken = Buffer.from([0xff, 0xd8, 0x00, 0x11, 0x22, 0x33]);
  const out = stripMetadata(broken, 'image/jpeg');
  check('ไม่ crash และคืนไบต์ครบ', out.equals(broken), out.toString('hex'));
}

console.log('\n=== randomImageName ===');
{
  const a = randomImageName('image/jpeg');
  const b = randomImageName('image/jpeg');
  check('รูปแบบชื่อถูกต้อง', /^image-[0-9a-f]{8}\.jpg$/.test(a), a);
  check('สุ่มไม่ซ้ำกัน', a !== b);
  check('นามสกุลตาม PNG', randomImageName('image/png').endsWith('.png'));
  check('นามสกุลตาม WebP', randomImageName('image/webp').endsWith('.webp'));
  check('นามสกุลตาม GIF', randomImageName('image/gif').endsWith('.gif'));
  check('ไม่มีร่องรอยชื่อไฟล์เดิม', !a.includes('photo'));
}

console.log('\n=== เพดานขนาดไฟล์ ===');
check('MAX_IMAGE_BYTES = 8MB', MAX_IMAGE_BYTES === 8 * 1024 * 1024);

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
