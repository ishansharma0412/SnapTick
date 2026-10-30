// Model: CorrectionRequest — a student asks for a record to be corrected
// ("I was present", duty leave or medical leave). The teacher approves or rejects it.
const mongoose = require("mongoose");

const correctionRequestSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "StudentAccount", required: true },
  rollNumber: { type: String, required: true },
  studentName: { type: String, required: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: "Classroom", required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  period: { type: Number, default: 1, min: 1, max: 12 },
  type: { type: String, enum: ["present", "duty_leave", "medical_leave"], default: "present" },
  reason: { type: String, required: true, maxlength: 500, trim: true },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  teacherNote: { type: String, default: "", maxlength: 300 },
  decidedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

correctionRequestSchema.index({ classroomId: 1, status: 1 });
correctionRequestSchema.index({ accountId: 1, createdAt: -1 });

module.exports = mongoose.model("CorrectionRequest", correctionRequestSchema);
