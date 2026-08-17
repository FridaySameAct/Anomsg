// แหล่งความจริงเดียวของชื่อคำสั่งและ option
//
// ทั้ง register.js (ที่บอก Discord ว่ามีคำสั่งอะไร) และ handler (ที่อ่านค่าออกมาใช้)
// ต้อง import จากไฟล์นี้เท่านั้น ห้าม hardcode ชื่อซ้ำที่อื่น
// ไม่งั้นเปลี่ยนชื่อ option ที่เดียวแล้วอีกที่จะพังเงียบๆ โดยเทสต์ยังเขียวหมด

export const SEND = 'send';
export const PING = 'ping';
export const WEB = 'web';
export const TASK = 'task';
export const MYTASK = 'mytask';

export const OPT_MESSAGE = 'message';
export const OPT_IMAGE = 'image';
export const OPT_NAME = 'name';
export const OPT_ASSIGNEE = 'assignee';

export const SUB_LIST = 'list';
export const SUB_ADD = 'add';

const OPTION_TYPE = {
  SUB_COMMAND: 1,
  STRING: 3,
  USER: 6,
  ATTACHMENT: 11,
};

export const COMMAND_DEFINITIONS = [
  {
    name: SEND,
    description: 'ส่งข้อความแบบไม่ระบุตัวตน',
    // ทั้งสอง option ไม่บังคับ แต่ handler จะปฏิเสธถ้าไม่ใส่มาสักอย่าง
    // เพื่อให้ส่งเฉพาะรูปโดยไม่มีข้อความก็ได้
    options: [
      {
        name: OPT_MESSAGE,
        type: OPTION_TYPE.STRING,
        description: 'ข้อความที่คุณต้องการส่ง',
        required: false,
        min_length: 1,
        max_length: 2000, // เพดานความยาวข้อความของ Discord
      },
      {
        name: OPT_IMAGE,
        type: OPTION_TYPE.ATTACHMENT,
        description: 'รูปที่ต้องการแนบ (ระบบจะลบ EXIF และชื่อไฟล์เดิมทิ้งให้)',
        required: false,
      },
    ],
  },
  {
    name: PING,
    description: 'เช็คว่าบอทยังทำงานอยู่และตอบช้าแค่ไหน',
  },
  {
    name: WEB,
    description: 'เปิดลิงก์หน้าเว็บสำหรับจัดการ task',
  },
  {
    name: MYTASK,
    description: 'ดู task ที่มอบหมายให้คุณในเซิร์ฟเวอร์นี้',
  },
  {
    name: TASK,
    description: 'จัดการ task ของเซิร์ฟเวอร์นี้',
    options: [
      {
        name: SUB_LIST,
        type: OPTION_TYPE.SUB_COMMAND,
        description: 'ดู task ที่ยังไม่เสร็จ',
      },
      {
        name: SUB_ADD,
        type: OPTION_TYPE.SUB_COMMAND,
        description: 'เพิ่ม task ใหม่',
        options: [
          {
            name: OPT_NAME,
            type: OPTION_TYPE.STRING,
            description: 'ชื่องาน',
            required: true,
            min_length: 1,
            max_length: 200,
          },
          {
            name: OPT_ASSIGNEE,
            type: OPTION_TYPE.USER,
            description: 'ผู้รับผิดชอบ (ไม่บังคับ)',
            required: false,
          },
        ],
      },
    ],
  },
];
