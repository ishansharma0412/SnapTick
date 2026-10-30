// Routes: admin (HOD / principal) — department-wide view and controls
const express = require("express");
const mongoose = require("mongoose");
const Teacher = require("../models/teacher");
const Classroom = require("../models/classroom");
const Student = require("../models/student");
const Holiday = require("../models/holiday");
const AuditLog = require("../models/auditLog");
const { authMiddleware, adminOnly, forgetTeacherStatus } = require("./auth");
const { buildReport, dayKey } = require("../services/reports");
const { sendMail, mailConfigured } = require("../services/mailer");
const { audit } = require("../services/audit");

const router = express.Router();

function lastDays(days) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - (days - 1) * 24 * 3600 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

/** Reports for every active classroom over the last `days` days. */
async function allReports(days) {
  const { start, end } = lastDays(days);
  const [classrooms, teachers] = await Promise.all([Classroom.find({ isActive: true }).lean(), Teacher.find({}, "name department").lean()]);
  const teacher = new Map(teachers.map((t) => [String(t._id), t]));
  const reports = [];
  for (const c of classrooms) {
    const report = await buildReport(c, start, end);
    const t = teacher.get(String(c.teacherId));
    reports.push({ classroom: c, teacherName: t?.name || "", department: t?.department || "", report });
  }
  return reports;
}

function defaultersFrom(reports) {
  const rows = [];
  for (const { classroom, teacherName, department, report } of reports) {
    for (const s of report.students) {
      if (s.status === "warning" || s.status === "critical") {
        rows.push({
          rollNumber: s.rollNumber, name: s.name, percentage: s.percentage, present: s.present, totalSessions: s.totalSessions, status: s.status,
          classroomId: String(classroom._id), classroom: classroom.name, subjectCode: classroom.subjectCode || "", teacher: teacherName, department,
          threshold: report.threshold,
        });
      }
    }
  }
  return rows.sort((a, b) => a.percentage - b.percentage);
}

// GET /admin/overview?days=30
router.get("/overview", authMiddleware, adminOnly, async (req, res) => {
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));
    const [teachers, counts, reports] = await Promise.all([
      Teacher.find({}, "-password -resetCodeHash -resetExpires -resetAttempts").sort({ name: 1 }).lean(),
      Classroom.aggregate([{ $group: { _id: "$teacherId", n: { $sum: 1 } } }]),
      allReports(days),
    ]);
    const classCount = new Map(counts.map((c) => [String(c._id), c.n]));
    const classrooms = reports.map(({ classroom, teacherName, department, report }) => ({
      classroomId: String(classroom._id), name: classroom.name, subjectCode: classroom.subjectCode || "", teacher: teacherName, department,
      students: report.totalStudents, sessions: report.totalSessions, average: report.totalSessions ? report.classAverage : null,
      defaulters: report.defaulterCount, threshold: report.threshold,
    }));
    const defaulters = defaultersFrom(reports);
    res.json({
      days,
      mailConfigured,
      totals: {
        teachers: teachers.length,
        classrooms: classrooms.length,
        students: await Student.countDocuments(),
        defaulters: new Set(defaulters.map((d) => d.rollNumber)).size,
      },
      teachers: teachers.map((t) => ({ ...t, classrooms: classCount.get(String(t._id)) || 0 })),
      classrooms,
      defaulters,
    });
  } catch (error) {
    console.error("Admin overview error:", error);
    res.status(500).json({ error: "Failed to load the admin overview" });
  }
});

// PUT /admin/teachers/:id - { isActive, role, department }
router.put("/teachers/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid teacher id" });
    if (req.params.id === req.teacher.id && (req.body.isActive === false || req.body.role === "teacher")) {
      return res.status(400).json({ error: "You cannot deactivate or demote your own account." });
    }
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ error: "Teacher not found" });
    if (typeof req.body.isActive === "boolean") teacher.isActive = req.body.isActive;
    if (["teacher", "admin"].includes(req.body.role)) teacher.role = req.body.role;
    if (typeof req.body.department === "string") teacher.department = req.body.department.trim().slice(0, 80);
    await teacher.save();
    forgetTeacherStatus(teacher._id);
    audit(req.teacher, "admin.teacher_update", { target: teacher.email, details: { isActive: teacher.isActive, role: teacher.role } });
    res.json({ message: "Teacher updated", teacher: teacher.toJSON() });
  } catch (error) {
    console.error("Admin teacher update error:", error);
    res.status(500).json({ error: "Failed to update teacher" });
  }
});

// GET /admin/classrooms/:id/report?from&to - read-only report for any classroom
router.get("/classrooms/:id/report", authMiddleware, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid classroom id" });
    const classroom = await Classroom.findById(req.params.id).lean();
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    const parse = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? new Date(...v.split("-").map((n, i) => (i === 1 ? n - 1 : +n))) : null);
    const { start, end } = lastDays(30);
    const from = parse(req.query.from) || start;
    const to = parse(req.query.to) || end;
    to.setHours(23, 59, 59, 999);
    res.json(await buildReport(classroom, from, to));
  } catch (error) {
    console.error("Admin report error:", error);
    res.status(500).json({ error: "Failed to build the report" });
  }
});

// POST /admin/classrooms/:id/unlock - { day } re-open a locked day for 24 hours
router.post("/classrooms/:id/unlock", authMiddleware, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid classroom id" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.day || "")) return res.status(400).json({ error: "Choose a date" });
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    const until = new Date(Date.now() + 24 * 3600 * 1000);
    classroom.unlocked = [...(classroom.unlocked || []).filter((u) => u.day !== req.body.day && new Date(u.until) > new Date()), { day: req.body.day, until }];
    await classroom.save();
    audit(req.teacher, "admin.unlock_day", { classroomId: classroom._id, details: { day: req.body.day, until } });
    res.json({ message: `${req.body.day} can be edited in ${classroom.name} for the next 24 hours.` });
  } catch (error) {
    console.error("Unlock error:", error);
    res.status(500).json({ error: "Failed to unlock" });
  }
});

// GET /admin/audit?limit&classroomId - recent activity across the college
router.get("/audit", authMiddleware, adminOnly, async (req, res) => {
  const query = {};
  if (req.query.classroomId && mongoose.Types.ObjectId.isValid(req.query.classroomId)) query.classroomId = req.query.classroomId;
  const entries = await AuditLog.find(query).sort({ createdAt: -1 }).limit(Math.min(500, Number(req.query.limit) || 200)).lean();
  res.json(entries);
});

// Holidays: everyone signed in can read; admins manage
router.get("/holidays", authMiddleware, async (req, res) => {
  res.json(await Holiday.find({}).sort({ day: 1 }).lean());
});
router.post("/holidays", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { day, label } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || !String(label || "").trim()) return res.status(400).json({ error: "Enter a date and a name" });
    const holiday = await Holiday.findOneAndUpdate({ day }, { day, label: String(label).trim().slice(0, 100), createdBy: req.teacher.id }, { upsert: true, new: true });
    audit(req.teacher, "admin.holiday_add", { details: { day, label } });
    res.status(201).json(holiday);
  } catch (error) {
    console.error("Holiday add error:", error);
    res.status(500).json({ error: "Failed to add holiday" });
  }
});
router.delete("/holidays/:day", authMiddleware, adminOnly, async (req, res) => {
  await Holiday.deleteOne({ day: req.params.day });
  audit(req.teacher, "admin.holiday_remove", { details: { day: req.params.day } });
  res.json({ message: "Holiday removed" });
});

/** Email the weekly defaulter summary to every admin. */
async function sendSummary() {
  const reports = await allReports(30);
  const defaulters = defaultersFrom(reports);
  const admins = await Teacher.find({ role: "admin", isActive: true }, "email").lean();
  const lines = defaulters.slice(0, 200).map((d) => `${d.rollNumber}  ${d.name}  —  ${d.classroom}: ${d.percentage}% (${d.present}/${d.totalSessions})`);
  const text =
    `SnapTick weekly attendance summary (last 30 days, as of ${dayKey(new Date())})\n\n` +
    `Classrooms: ${reports.length}\nStudents below their class threshold: ${new Set(defaulters.map((d) => d.rollNumber)).size}\n\n` +
    (lines.length ? lines.join("\n") : "No student is below the threshold.") +
    `\n\n— SnapTick`;
  let sent = 0;
  for (const a of admins) {
    const r = await sendMail({ to: a.email, subject: "SnapTick weekly attendance summary", text });
    if (r.sent) sent++;
  }
  return { admins: admins.length, sent, defaulters: defaulters.length };
}

// POST /admin/summary/send - email the summary now
router.post("/summary/send", authMiddleware, adminOnly, async (req, res) => {
  try {
    const r = await sendSummary();
    audit(req.teacher, "admin.summary_send", { details: r });
    res.json({ message: mailConfigured ? `Summary emailed to ${r.sent} admin(s).` : "Email is not configured on the server; the summary was written to the server log.", ...r });
  } catch (error) {
    console.error("Summary error:", error);
    res.status(500).json({ error: "Failed to send the summary" });
  }
});

// GET /admin/summary/cron?key=CRON_SECRET - for an external weekly scheduler (cron-job.org etc.)
router.get("/summary/cron", async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.key !== process.env.CRON_SECRET) return res.status(403).json({ error: "Forbidden" });
  try {
    res.json(await sendSummary());
  } catch (error) {
    console.error("Cron summary error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

module.exports = router;
