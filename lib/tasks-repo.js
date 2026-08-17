import { connectDb } from './db.js';
import { TaskModel } from './models/task.js';
import { createTasksService } from './tasks-service.js';

function toTask(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    guildId: doc.guildId,
    name: doc.name,
    description: doc.description,
    done: doc.done,
    assignee: doc.assignee,
    dueDate: doc.dueDate,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
  };
}

const repo = {
  async findByGuild(guildId) {
    const docs = await TaskModel.find({ guildId }).sort({ done: 1, dueDate: 1 }).lean();
    return docs.map(toTask);
  },
  async findByAssignee(guildId, actorId) {
    const docs = await TaskModel.find({ guildId, assignee: actorId }).sort({ done: 1, dueDate: 1 }).lean();
    return docs.map(toTask);
  },
  async findById(taskId) {
    if (!/^[0-9a-f]{24}$/i.test(String(taskId))) return null; // กัน CastError จาก id มั่ว
    return toTask(await TaskModel.findById(taskId).lean());
  },
  async insert(doc) {
    return toTask((await TaskModel.create(doc)).toObject());
  },
  async updateById(taskId, patch) {
    return toTask(await TaskModel.findByIdAndUpdate(taskId, patch, { new: true }).lean());
  },
  async deleteById(taskId) {
    await TaskModel.findByIdAndDelete(taskId);
  },
};

export async function getTasksService() {
  await connectDb();
  return createTasksService(repo);
}
