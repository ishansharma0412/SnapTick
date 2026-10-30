// Routes: student portal (students sign in with their roll number or email)
const express = require("express");
const mongoose = require("mongoose");
const StudentAccount = require("../models/studentAccount");
const Student = require("../models/student");
const Classroom = require("../models/classroom");
const Teacher = require("../models/teacher");
const Attendance = require("../models/attendance");
const CorrectionRequest = require("../models/correctionRequest");
const { signToken, verifyToken, ALLOWED_EMAIL_DOMAINS } = require("./auth");
const { buildReport, dayKey } = require("../services/reports");
const { issueCode, checkCode, OTP_MESSAGES } = require("../services/otp");
const { sendMail } = require("../services/mailer");
const { audit } = require("../services/audit");

const router = express.Router();
const REQUEST_WINDOW_DAYS = 14;

function tokenFor(account) {
  return signToken({ type: "student", id: account._id, rollNumber: account.rollNumber, name: account.name }, "30d");
}

async function studentAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Please sign in" });
  try {
    const decoded = verifyToken(header.slice(7));
    if (decoded.type !== "student") return res.status(403).json({ error: "This page is for students." });
    const account = await StudentAccount.findById(decoded.id);
    if (!account || !account.isActive) return res.status(401).json({ error: "Account not found" });
    req.student = { ...decoded, account };
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

// POST /portal/register - { rollNumber, name, email, password }
router.post("/register", async (req, res) => {
  try {
    const rollNumber = String(req.body.rollNumber || "").trim();
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!rollNumber || !name || !email || !password) return res.status(400).json({ error: "All fields are required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email address" });
    if (ALLOWED_EMAIL_DOMAINS.length && !ALLOWED_EMAIL_DOMAINS.includes(email.split("@").pop())) {
      return res.status(403).json({ error: `Use your ${ALLOWED_EMAIL_DOMAINS.map((d) => "@" + d).join(", ")} email address` });
    }
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const enrolled = await Student.find({ rollNumber }, "email").lean();
    if (!enrolled.length) return res.status(404).json({ error: "This roll number is not enrolled in any class yet. Ask your teacher to add you." });
    // If a teacher recorded the student's email, only that email may claim the roll number
    const rosterEmails = enrolled.map((s) => s.email).filter(Boolean);
    if (rosterEmails.length && !rosterEmails.includes(email)) {
      return res.status(403).json({ error: "This email does not match the one your teacher has on record for this roll number." });
    }
    if (await StudentAccount.exists({ rollNumber })) return res.status(409).json({ error: "An account already exists for this roll number. Sign in or reset your password." });
    if (await StudentAccount.exists({ email })) return res.status(409).json({ error: "This email is already registered." });

    const account = await StudentAccount.create({ rollNumber, name, email, password });
    res.status(201).json({ token: tokenFor(account), student: account.toJSON() });
  } catch (error) {
    console.error("Portal register error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /portal/login - { login (roll number or email), password }
router.post("/login", async (req, res) => {
  try {
    const login = String(req.body.login || "").trim();
    const password = String(req.body.password || "");
    if (!login || !password) return res.status(400).json({ error: "Enter your roll number or email and password" });
    const account = await StudentAccount.findOne(login.includes("@") ? { email: login.toLowerCase() } : { rollNumber: login });
    if (!account || !(await account.comparePassword(password))) return res.status(401).json({ error: "Invalid roll number/email or password" });
    if (!account.isActive) return res.status(403).json({ error: "Account is deactivated" });
    account.lastLogin = new Date();
    await account.save();
    res.json({ token: tokenFor(account), student: account.toJSON() });
  } catch (error) {
    console.error("Portal login error:", error);
    res.status(500).json({ error: "Sign-in failed" });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const login = String(req.body.login || "").trim();
    const account = login ? await StudentAccount.findOne(login.includes("@") ? { email: login.toLowerCase() } : { rollNumber: login }) : null;
    if (account?.isActive) {
      const code = await issueCode(account);
      await sendMail({ to: account.email, subject: "SnapTick password reset code", text: `Hello ${account.name},\n\nYour SnapTick password reset code is ${code}. It expires in 15 minutes.` });
    }
    res.json({ message: "If an account exists, a reset code has been sent to its email." });
  } catch (error) {
    console.error("Portal forgot error:", error);
    res.status(500).json({ error: "Could not send the reset code." });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const login = String(req.body.login || "").trim();
    const { code, password } = req.body;
    if (!password || String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    const account = login ? await StudentAccount.findOne(login.includes("@") ? { email: login.toLowerCase() } : { rollNumber: login }) : null;
    if (!account) return res.status(400).json({ error: OTP_MESSAGES.invalid });
    const result = await checkCode(account, code);
    if (result !== "ok") return res.status(400).json({ error: OTP_MESSAGES[result] });
    account.password = password;
    await account.save();
    res.json({ message: "Password updated. You can sign in now." });
  } catch (error) {
    console.error("Portal reset error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// GET /portal/me - attendance in every class the student is enrolled in
router.get("/me", studentAuth, async (req, res) => {
  try {
    const roll = req.student.account.rollNumber;
    const enrolments = await Student.find({ rollNumber: roll }, "classroomId name descriptorCount consentAt").lean();
    const classrooms = await Classroom.find({ _id: { $in: enrolments.map((e) => e.classroomId) } }).lean();
    const teachers = await Teacher.find({ _id: { $in: classrooms.map((c) => c.teacherId) } }, "name").lean();
    const teacherName = new Map(teachers.map((t) => [String(t._id), t.name]));

    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end.getTime() - 180 * 24 * 3600 * 1000); // current semester window
    start.setHours(0, 0, 0, 0);

    const subjects = [];
    for (const c of classrooms) {
      const report = await buildReport(c, start, end);
      const me = report.students.find((s) => s.rollNumber === roll);
      const enrolment = enrolments.find((e) => String(e.classroomId) === String(c._id));
      subjects.push({
        classroomId: String(c._id),
        name: c.name,
        subjectCode: c.subjectCode || "",
        teacher: teacherName.get(String(c.teacherId)) || "",
        threshold: report.threshold,
        totalSessions: me?.totalSessions || 0,
        present: me?.present || 0,
        dutyLeave: me?.dutyLeave || 0,
        medicalLeave: me?.medicalLeave || 0,
        percentage: me?.percentage || 0,
        status: me?.status || "no-data",
        // How many more lectures in a row reach the threshold (if below)
        lecturesToRecover: me && me.percentage < report.threshold && report.threshold < 100
          ? Math.max(0, Math.ceil((report.threshold * me.totalSessions - 100 * me.present) / (100 - report.threshold)))
          : 0,
        faceSamples: enrolment?.descriptorCount || 0,
        schedule: c.schedule || [],
      });
    }

    const recent = await Attendance.find({ rollNo: roll, classroomId: { $in: classrooms.map((c) => c._id) } })
      .sort({ date: -1 }).limit(30).lean();
    const className = new Map(classrooms.map((c) => [String(c._id), c.name]));
    res.json({
      student: req.student.account.toJSON(),
      subjects,
      recent: recent.map((r) => ({ day: dayKey(r.date), period: r.period || 1, status: r.status || "present", classroom: className.get(String(r.classroomId)) })),
    });
  } catch (error) {
    console.error("Portal me error:", error);
    res.status(500).json({ error: "Failed to load your attendance" });
  }
});

// GET /portal/requests - the student's correction requests
router.get("/requests", studentAuth, async (req, res) => {
  const requests = await CorrectionRequest.find({ accountId: req.student.account._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(requests);
});

// POST /portal/requests - { classroomId, day, period, type, reason }
router.post("/requests", studentAuth, async (req, res) => {
  try {
    const { classroomId, day, reason } = req.body;
    const period = Math.min(12, Math.max(1, parseInt(req.body.period, 10) || 1));
    const type = ["present", "duty_leave", "medical_leave"].includes(req.body.type) ? req.body.type : "present";
    const roll = req.student.account.rollNumber;
    if (!mongoose.Types.ObjectId.isValid(classroomId)) return res.status(400).json({ error: "Choose a subject" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return res.status(400).json({ error: "Choose the date" });
    if (!reason || String(reason).trim().length < 5) return res.status(400).json({ error: "Explain the reason (at least a few words)" });

    const enrolment = await Student.findOne({ rollNumber: roll, classroomId }, "name").lean();
    if (!enrolment) return res.status(403).json({ error: "You are not enrolled in this class" });
    const classroom = await Classroom.findById(classroomId, "teacherId").lean();

    const [y, m, d] = day.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (date > today) return res.status(400).json({ error: "The date cannot be in the future" });
    if (today - date > REQUEST_WINDOW_DAYS * 24 * 3600 * 1000) return res.status(400).json({ error: `Requests can only be raised within ${REQUEST_WINDOW_DAYS} days` });

    const existing = await Attendance.findOne({
      rollNo: roll, classroomId, period, date: { $gte: date, $lte: new Date(y, m - 1, d, 23, 59, 59, 999) },
    }).lean();
    if (existing && (existing.status || "present") === type) return res.status(409).json({ error: "Your attendance for this lecture is already recorded that way." });
    if (await CorrectionRequest.exists({ accountId: req.student.account._id, classroomId, day, period, status: "pending" })) {
      return res.status(409).json({ error: "You already have a pending request for this lecture." });
    }

    const request = await CorrectionRequest.create({
      accountId: req.student.account._id, rollNumber: roll, studentName: enrolment.name,
      classroomId, teacherId: classroom.teacherId, day, period, type, reason: String(reason).trim().slice(0, 500),
    });
    audit({ type: "student", id: req.student.account._id, name: req.student.account.name }, "request.create", { classroomId, target: roll, details: { day, period, type } });
    res.status(201).json({ message: "Request sent to your teacher.", request });
  } catch (error) {
    console.error("Portal request error:", error);
    res.status(500).json({ error: "Failed to send the request" });
  }
});

// PUT /portal/password - { currentPassword, newPassword }
router.put("/password", studentAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  if (!(await req.student.account.comparePassword(String(currentPassword || "")))) return res.status(401).json({ error: "Current password is incorrect" });
  req.student.account.password = newPassword;
  await req.student.account.save();
  res.json({ message: "Password changed" });
});

module.exports = router;
