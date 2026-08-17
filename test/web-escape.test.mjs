// ยืนยันว่าชื่อและรายละเอียดของ task ถูกใส่เข้า DOM แบบข้อความล้วน ไม่ใช่ HTML
// buildTaskRow เป็นฟังก์ชันบริสุทธิ์ (ไม่แตะ DOM) จึงเรียกตรงๆ ใน Node ได้โดยไม่ต้องมี browser/jsdom
import { buildTaskRow, decideView } from '../public/app.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name} ${extra}`); fail++; }
}

const EVIL = '<img src=x onerror=alert(1)>';
const EVIL2 = '"><script>alert(document.cookie)</script>';

console.log('\n=== ชื่อ task ที่มี HTML ต้องกลายเป็นข้อความล้วน ===');
{
  const row = buildTaskRow(
    { id: '1', name: EVIL, description: '', done: false, assignee: null, dueDate: null },
    { canEdit: false },
  );
  check('เก็บชื่อไว้ครบเป็นข้อความ ไม่ถูก escape/ตัดทิ้ง', row.nameText === EVIL, row.nameText);
  check('ไม่มีการประกอบ HTML จากข้อมูลผู้ใช้เลย (html ต้องเป็น null เสมอ)', row.html === null, String(row.html));
  check('ไม่พบ payload ใน html แม้จะเป็นค่า null', !String(row.html ?? '').includes('<img'), String(row.html));
  check('สัญญาว่าจะใส่ผ่าน textContent', row.usesTextContent === true);
}

console.log('\n=== รายละเอียด (description) ที่มี HTML ต้องกลายเป็นข้อความล้วนเหมือนกัน ===');
{
  const row = buildTaskRow(
    { id: '2', name: 'ชื่อปกติ', description: EVIL2, done: false, assignee: null, dueDate: null },
    { canEdit: true },
  );
  check('เก็บ description ไว้ครบเป็นข้อความ ไม่ถูก escape/ตัดทิ้ง', row.descriptionText === EVIL2, row.descriptionText);
  check('ไม่มีการประกอบ HTML จาก description', row.html === null, String(row.html));
}

console.log('\n=== description ที่ไม่ได้ใส่มา (undefined/null) ต้องไม่พัง ===');
{
  const undef = buildTaskRow(
    { id: '3', name: 'x', description: undefined, done: false, assignee: null, dueDate: null },
    { canEdit: false },
  );
  check('description undefined -> string ว่าง', undef.descriptionText === '');

  const nul = buildTaskRow(
    { id: '4', name: 'x', description: null, done: false, assignee: null, dueDate: null },
    { canEdit: false },
  );
  check('description null -> string ว่าง', nul.descriptionText === '');
}

console.log('\n=== id / done / canEdit ต้องส่งผ่านตรงๆ ===');
{
  const rowA = buildTaskRow(
    { id: 'abc', name: 'x', description: '', done: true, assignee: null, dueDate: null },
    { canEdit: true },
  );
  check('id ตรงกับ task.id', rowA.id === 'abc');
  check('done: true -> row.done true', rowA.done === true);
  check('canEdit: true -> row.canEdit true', rowA.canEdit === true);

  const rowB = buildTaskRow(
    { id: 'abc', name: 'x', description: '', done: 0, assignee: null, dueDate: null },
    { canEdit: false },
  );
  check('done ที่เป็น falsy ค่าอื่น (0) -> แปลงเป็น boolean false', rowB.done === false);
  check('canEdit: false -> row.canEdit false', rowB.canEdit === false);
}

console.log('\n=== dueText: แปลงวันที่เฉพาะเมื่อมี dueDate ===');
{
  const withDue = buildTaskRow(
    { id: '1', name: 'x', description: '', done: false, assignee: null, dueDate: '2026-01-15T00:00:00.000Z' },
    { canEdit: false },
  );
  check('มี dueDate -> dueText ไม่ว่าง', withDue.dueText.length > 0, withDue.dueText);

  const noDue = buildTaskRow(
    { id: '1', name: 'x', description: '', done: false, assignee: null, dueDate: null },
    { canEdit: false },
  );
  check('ไม่มี dueDate -> dueText ว่าง', noDue.dueText === '');
}

// สเปคข้อ 9: เปิดเว็บโดยไม่มี ?guild= และไม่มี session ต้องโชว์หน้าอธิบาย ไม่ใช่ตกไปที่ปุ่ม login เฉยๆ
// (ซึ่งเดิมกดแล้วไปเจอ 400 ดิบของ api/auth/login.js เพราะไม่มี guild ให้ส่ง)
console.log('\n=== decideView: ตัดสิน section ที่ควรโชว์จาก guild/session ===');
{
  check('มี session ที่ใช้ได้ -> app แม้ไม่มี guild ใน URL (ใช้ gid จาก session แทน)',
    decideView({ guild: null, me: { uid: '1', name: 'x', gid: 'g1' } }) === 'app');
  check('มี session ที่ใช้ได้ -> app แม้มี guild ใน URL ด้วย',
    decideView({ guild: 'g2', me: { uid: '1', name: 'x', gid: 'g1' } }) === 'app');
  check('ไม่มี session แต่มี guild ใน URL -> login',
    decideView({ guild: 'g1', me: null }) === 'login');
  check('ไม่มี session และไม่มี guild เลย -> explain (บุ๊กมาร์กหน้าแรก หรือ cookie พัง/หมดอายุ)',
    decideView({ guild: null, me: null }) === 'explain');
  check('guild เป็น string ว่าง (เช่น ?guild= เปล่าๆ) นับเป็นไม่มี guild -> explain',
    decideView({ guild: '', me: null }) === 'explain');
}

console.log(`\n----------------------------\nPASS: ${pass}   FAIL: ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
