// แหล่งความจริงเดียวของชื่อคำสั่งและ option
//
// ทั้ง register.js (ที่บอก Discord ว่ามีคำสั่งอะไร) และ handler (ที่อ่านค่าออกมาใช้)
// ต้อง import จากไฟล์นี้เท่านั้น ห้าม hardcode ชื่อซ้ำที่อื่น
// ไม่งั้นเปลี่ยนชื่อ option ที่เดียวแล้วอีกที่จะพังเงียบๆ โดยเทสต์ยังเขียวหมด

export const SEND = 'send';
export const PING = 'ping';

export const OPT_MESSAGE = 'message';
export const OPT_IMAGE = 'image';

const OPTION_TYPE = {
  STRING: 3,
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
];
