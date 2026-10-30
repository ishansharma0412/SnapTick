// Model: Classroom
const mongoose = require("mongoose");

const slotSchema = new mongoose.Schema({
  day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
  start: { type: String, match: /^\d{2}:\d{2}$/, required: true }, // "09:40"
  end: { type: String, match: /^\d{2}:\d{2}$/, required: true },
  period: { type: Number, min: 1, max: 12, default: 1 },
}, { _id: false });

const classroomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: "" },
  subjectCode: { type: String, default: "" },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
  // Weekly timetable used to pre-select the lecture/period when taking attendance
  schedule: { type: [slotSchema], default: [] },
  // Minimum attendance percentage for eligibility
  threshold: { type: Number, default: 75, min: 1, max: 100 },
  // Only allow photos captured with the in-app camera (no gallery uploads)
  liveCaptureOnly: { type: Boolean, default: false },
  // Past days an admin has re-opened for editing: [{ day: "YYYY-MM-DD", until: Date }]
  unlocked: { type: [{ day: String, until: Date, _id: false }], default: [] },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index to speed up teacher lookups
classroomSchema.index({ teacherId: 1 });
// Prevent duplicate classroom names per teacher
classroomSchema.index({ teacherId: 1, name: 1 }, { unique: true });

// Keep updatedAt current on save
classroomSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Classroom", classroomSchema);
