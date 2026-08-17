// คืนข้อมูลของแถวแบบบริสุทธิ์ ไม่แตะ DOM เพื่อให้เทสต์เรียกได้ใน Node โดยไม่ต้องมี DOM
// ชื่อและรายละเอียดของ task มาจากผู้ใช้ ห้าม escape/ตัด/ประกอบเป็น HTML ที่นี่เด็ดขาด —
// เก็บไว้เป็นข้อความล้วน แล้วให้ฝั่ง DOM ใส่ผ่าน textContent เท่านั้น (ดู renderRow ด้านล่าง)
// แปลงวันที่เป็นรูปแบบที่ <input type="date"> รับได้ (yyyy-mm-dd)
// ใช้ส่วนประกอบเวลาท้องถิ่น ไม่ใช่ toISOString() เพราะตัวหลังแปลงเป็น UTC ก่อน
// ซึ่งทำให้วันเลื่อนไป 1 วันสำหรับคนที่อยู่ฝั่งตะวันออกของ UTC เช่นไทย
export function toDateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function buildTaskRow(task, { canEdit, meId = null }) {
  const assignee = task.assignee ?? null;
  return {
    id: task.id,
    nameText: task.name, // ข้อความล้วน จะถูกใส่ผ่าน textContent
    descriptionText: task.description ?? '',
    done: Boolean(task.done),
    dueText: task.dueDate ? new Date(task.dueDate).toLocaleDateString('th-TH') : '',
    dueValue: toDateInputValue(task.dueDate), // ค่าเริ่มต้นของช่องวันที่ตอนกดแก้
    assignee,
    // เว็บไม่รู้จักชื่อสมาชิกในเซิร์ฟเวอร์ (ต้องเปิด privileged intent เพิ่ม) จึงบอกได้แค่
    // ความสัมพันธ์กับคนที่กำลังดูอยู่ ซึ่งเป็นข้อมูลที่มีประโยชน์กว่าการโชว์ id ดิบอยู่แล้ว
    assigneeState: assignee === null ? 'none' : assignee === meId ? 'me' : 'other',
    canEdit,
    usesTextContent: true, // สัญญาว่าไม่มี HTML จากผู้ใช้
    html: null, // ห้ามมีค่า ห้ามประกอบ HTML จากข้อมูลผู้ใช้
  };
}

// ฟังก์ชันบริสุทธิ์เหมือน buildTaskRow ด้านบน ตัดสินว่าควรโชว์ section ไหนจากแค่ guild (จาก ?guild=
// ใน URL) กับ me (ผลจาก GET /api/me — null ถ้ายังไม่ได้ล็อกอินหรือ session พัง/หมดอายุ) จึงเทสต์ได้
// ตรงๆ ใน Node โดยไม่ต้องมี DOM เหมือนกัน
// - มี session ที่ใช้ได้ (me) -> 'app' เสมอ แม้ URL จะไม่มี ?guild= (ใช้ gid จาก session แทน ตามสเปคข้อ 9
//   "ถ้ามี session อยู่แล้วให้ใช้ gid จาก cookie เป็นค่าตั้งต้นแทน จะได้ไม่ต้องกลับไป Discord ทุกครั้ง")
// - ไม่มี session แต่มี ?guild= (เช่น เพิ่งมาจากลิงก์ /web) -> 'login'
// - ไม่มีทั้งคู่ (บุ๊กมาร์กหน้าแรกไว้ หรือ cookie ที่มีอยู่พังจน /api/me ตอบ 401) -> 'explain'
export function decideView({ guild, me }) {
  if (me) return 'app';
  if (guild) return 'login';
  return 'explain';
}

// ส่วนด้านล่างรันเฉพาะในเบราว์เซอร์ — กันไว้ด้วย guard นี้เพื่อให้ import ด้านบนปลอดภัยใน Node (ไม่มี DOM)
if (typeof document !== 'undefined') {
  const params = new URLSearchParams(location.search);
  const state = { guild: params.get('guild'), me: null, filter: 'all' };

  const $ = (sel) => document.querySelector(sel);

  function showError(message) {
    const el = $('#error');
    el.textContent = message; // ข้อความ error มาจากเซิร์ฟเวอร์/เครือข่าย ก็ยังใส่ผ่าน textContent เสมอ
    el.hidden = false;
  }

  function clearError() {
    $('#error').hidden = true;
  }

  async function api(path, options) {
    let res;
    try {
      res = await fetch(path, { credentials: 'same-origin', ...options });
    } catch {
      throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง');
    }
    if (res.status === 401) { state.me = null; render(); return null; }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'เกิดข้อผิดพลาด');
    return res.status === 204 ? null : res.json();
  }

  function renderRow(row) {
    const li = document.createElement('li');
    li.className = row.done ? 'task done' : 'task';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = row.done;
    box.disabled = !row.canEdit;
    box.addEventListener('change', async () => {
      try {
        await api(`/api/tasks?id=${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ done: box.checked }),
        });
        clearError();
      } catch (err) {
        box.checked = !box.checked; // สลับ UI กลับเพราะบันทึกไม่สำเร็จ
        showError(err.message);
      }
      load();
    });

    const body = document.createElement('div');
    body.className = 'body';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = row.nameText; // ห้ามเปลี่ยนเป็น innerHTML เด็ดขาด
    body.append(name);

    if (row.descriptionText) {
      const desc = document.createElement('span');
      desc.className = 'description';
      desc.textContent = row.descriptionText; // ห้ามเปลี่ยนเป็น innerHTML เด็ดขาด
      body.append(desc);
    }

    const tags = document.createElement('span');
    tags.className = 'tags';

    if (row.dueText) {
      const due = document.createElement('span');
      due.className = 'meta';
      due.textContent = `ครบ ${row.dueText}`;
      tags.append(due);
    }
    if (row.assigneeState !== 'none') {
      const who = document.createElement('span');
      who.className = row.assigneeState === 'me' ? 'meta mine' : 'meta';
      who.textContent = row.assigneeState === 'me' ? 'ของฉัน' : 'มอบหมายแล้ว';
      tags.append(who);
    }
    if (tags.childElementCount > 0) body.append(tags);

    li.append(box, body);

    if (row.canEdit) {
      const actions = document.createElement('span');
      actions.className = 'actions';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit-btn';
      edit.textContent = 'แก้';
      edit.addEventListener('click', () => li.replaceChildren(buildEditForm(row, li)));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'delete';
      del.textContent = 'ลบ';
      del.addEventListener('click', async () => {
        try {
          await api(`/api/tasks?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
          clearError();
        } catch (err) {
          showError(err.message);
        }
        load();
      });

      actions.append(edit, del);
      li.append(actions);
    }
    return li;
  }

  // ฟอร์มแก้ไขในแถวเดิม เปิดจากปุ่ม "แก้" — เป็นทางเดียวที่ตั้ง description กับ dueDate ได้
  // เพราะ /task add ใน Discord รับแค่ชื่องานกับผู้รับผิดชอบ
  function buildEditForm(row, li) {
    const form = document.createElement('form');
    form.className = 'edit';

    const name = document.createElement('input');
    name.type = 'text';
    name.required = true;
    name.maxLength = 200;
    name.value = row.nameText; // .value ไม่ตีความ HTML จึงปลอดภัยเหมือน textContent
    name.placeholder = 'ชื่องาน';

    const description = document.createElement('textarea');
    description.rows = 2;
    description.maxLength = 2000;
    description.value = row.descriptionText;
    description.placeholder = 'รายละเอียด (ไม่บังคับ)';

    const due = document.createElement('input');
    due.type = 'date';
    due.value = row.dueValue;

    // เว็บมอบหมายได้แค่ "ตัวเอง" หรือ "ไม่ระบุ" เพราะไม่รู้จักรายชื่อสมาชิก
    // ตัวเลือก "คงเดิม" จำเป็นเพื่อไม่ให้การแก้ชื่องานเผลอปลดคนอื่นออกจากงานไปด้วย
    const who = document.createElement('select');
    for (const [value, label] of [['', 'ไม่ระบุผู้รับผิดชอบ'], ['me', 'มอบหมายให้ฉัน']]) {
      who.append(new Option(label, value));
    }
    if (row.assigneeState === 'other') who.append(new Option('คงผู้รับผิดชอบเดิม', 'keep'));
    who.value = row.assigneeState === 'me' ? 'me' : row.assigneeState === 'other' ? 'keep' : '';

    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'บันทึก';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ghost';
    cancel.textContent = 'ยกเลิก';
    cancel.addEventListener('click', () => li.replaceChildren(...renderRow(row).childNodes));

    const buttons = document.createElement('div');
    buttons.className = 'edit-actions';
    buttons.append(save, cancel);

    form.append(name, description, due, who, buttons);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const assignee =
        who.value === 'me' ? state.me.uid : who.value === 'keep' ? row.assignee : null;
      try {
        await api(`/api/tasks?id=${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.value,
            description: description.value,
            dueDate: due.value || null,
            assignee,
          }),
        });
        clearError();
      } catch (err) {
        showError(err.message);
      }
      load();
    });

    return form;
  }

  async function load() {
    const path = state.filter === 'mine' ? '/api/tasks/me' : '/api/tasks';
    let tasks;
    try {
      tasks = await api(path);
    } catch (err) {
      showError(err.message);
      return;
    }
    if (!tasks) return;

    const list = $('#list');
    list.replaceChildren();
    for (const task of tasks) {
      if (state.filter === 'done' && !task.done) continue;
      if (state.filter === 'all' && task.done) continue;
      const canEdit = task.createdBy === state.me.uid || task.assignee === state.me.uid;
      list.append(renderRow(buildTaskRow(task, { canEdit, meId: state.me.uid })));
    }
  }

  // ดูคำอธิบายเต็มของ 3 สถานะที่ decideView() คืนได้ (login/explain/app) ที่ตัวฟังก์ชันเอง
  // ด้านบน (นอก guard นี้) เพราะมันเป็นฟังก์ชันบริสุทธิ์ที่เทสต์เรียกตรงๆ ได้โดยไม่ต้องมี DOM
  function render() {
    const view = decideView({ guild: state.guild, me: state.me });
    $('#loading').hidden = true; // รู้คำตอบแล้วว่าเป็น view ไหน เลิกแสดงสถานะกำลังตรวจสอบ
    $('#login').hidden = view !== 'login';
    $('#explain').hidden = view !== 'explain';
    $('#app').hidden = view !== 'app';
    if (view === 'app') {
      $('#who').textContent = state.me.name; // ชื่อ Discord ก็เป็นข้อมูลผู้ใช้ ใส่ผ่าน textContent เหมือนกัน
      load();
    }
  }

  $('#login-btn').addEventListener('click', () => {
    // ?guild= จาก URL ของหน้านี้เอง ใช้ตรงนี้ที่เดียวเท่านั้น (ผูก session ใหม่เข้ากับ guild)
    location.href = `/api/auth/login?guild=${encodeURIComponent(state.guild ?? '')}`;
  });

  // ใช้ร่วมกันทั้งปุ่มออกจากระบบในหน้าแอปปกติ (#logout-btn) และปุ่มในหน้าอธิบาย (#explain-logout-btn)
  // ปุ่มหลังมีไว้ล้าง cookie ที่ค้าง/พัง (เช่นหมดอายุ หรือถูกยัดของปลอมทับ) ทั้งที่ฝั่ง client ยังไม่นับว่า
  // ล็อกอินอยู่แล้ว (/api/me ตอบ 401 ไปแล้ว) ผู้ใช้จึงยังต้องมีทางล้าง cookie นั้นทิ้งได้เอง
  async function doLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    state.me = null;
    render();
  }

  $('#logout-btn').addEventListener('click', doLogout);
  $('#explain-logout-btn').addEventListener('click', doLogout);

  $('#add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#add-name');
    if (!input.value.trim()) return;
    try {
      await api('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: input.value }),
      });
      input.value = '';
      clearError();
    } catch (err) {
      showError(err.message);
    }
    load();
  });

  for (const button of document.querySelectorAll('[data-filter]')) {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      for (const other of document.querySelectorAll('[data-filter]')) other.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      load();
    });
  }

  // ไม่ส่ง guild เข้า /api/me — endpoint นี้อ่าน guild จาก session cookie เท่านั้น
  // gid ที่ได้กลับมาใช้แค่เติม state.guild เผื่อผู้ใช้เปิดหน้านี้โดยไม่มี ?guild= ใน URL เลย (เช่น bookmark ไว้)
  api('/api/me').then((me) => { state.me = me; if (!state.guild && me) state.guild = me.gid; render(); })
    // ต้อง render() ต่อแม้ถามไม่สำเร็จ ไม่งั้นหน้าจะค้างที่ "กำลังตรวจสอบ" ตลอดไป
    // me ยังเป็น null อยู่ decideView จึงพาไปหน้า login หรือหน้าอธิบายตามที่ควรเป็น
    .catch((err) => { showError(err.message); render(); });
}
