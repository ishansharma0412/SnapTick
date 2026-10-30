// Model: AuditLog — who changed which attendance or student record, and when.
const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  actorType: { type: String, enum: ["teacher", "admin", "student", "system"], required: true },
  actorId: { type: String, default: "" },
  actorName: { type: String, default: "" },
  action: { type: String, required: true }, // e.g. attendance.mark, student.delete
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: "Classroom" },
  target: { type: String, default: "" }, // usually a roll number
  details: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

auditLogSchema.index({ classroomId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
