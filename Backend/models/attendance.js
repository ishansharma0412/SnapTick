// Model: Attendance
const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
    studentName: String,
    rollNo: String,
    date: { type: Date, default: Date.now },
    // Lecture/period number within the day (labs and double lectures use 2, 3, ...)
    period: { type: Number, default: 1, min: 1, max: 12 },
    // present counts as attended; duty_leave counts as attended; medical_leave is excused
    status: { type: String, enum: ["present", "duty_leave", "medical_leave"], default: "present" },
    markedBy: { type: String, enum: ["scan", "manual", "request"], default: "manual" },
    classroomId: { type: mongoose.Schema.Types.ObjectId, ref: "Classroom", required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
});

// One record per student per classroom per day per period
attendanceSchema.index({ rollNo: 1, classroomId: 1, teacherId: 1, date: 1, period: 1 }, { unique: true, name: "uniq_student_day_period" });
attendanceSchema.index({ classroomId: 1, date: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
