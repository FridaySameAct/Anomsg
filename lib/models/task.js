import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  name: { type: String, required: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 2000 },
  done: { type: Boolean, default: false },
  assignee: { type: String, default: null },
  dueDate: { type: Date, default: null },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// query หลัก: task ของเซิร์ฟเวอร์นี้ แยกเสร็จ/ไม่เสร็จ เรียงตามกำหนดส่ง
taskSchema.index({ guildId: 1, done: 1, dueDate: 1 });

export const TaskModel = mongoose.models.Task ?? mongoose.model('Task', taskSchema);
