// Routes: correction requests (teacher side)
const express = require("express");
const mongoose = require("mongoose");
const CorrectionRequest = require("../models/correctionRequest");
const Attendance = require("../models/attendance");
const Classroom = require("../models/classroom");
const { authMiddleware } = require("./auth");
const { audit } = require("../services/audit");

const router = express.Router();

// GET /requests?classroomId=&status=pending - requests for the teacher's classrooms
router.get("/", authMiddleware, async (req, res) => {
  try {
    const query = { teacherId: req.teacher.id };
    if (req.query.classroomId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.classroomId)) return res.status(400).json({ error: "Invalid classroom id" });
      query.classroomId = req.query.classroomId;
    }
    if (["pending", "approved", "rejected"].includes(req.query.status)) query.status = req.query.status;
    const requests = await CorrectionRequest.find(query).sort({ createdAt: -1 }).limit(200).lean();
    res.json(requests);
  } catch (error) {
    console.error("Requests fetch error:", error);
    res.status(500).json({ error: "Failed to load requests" });
  }
});

// GET /requests/pending-count - number of pending requests per classroom
router.get("/pending-count", authMiddleware, async (req, res) => {
  try {
    const rows = await CorrectionRequest.aggregate([
      { $match: { teacherId: new mongoose.Types.ObjectId(req.teacher.id), status: "pending" } },
      { $group: { _id: "$classroomId", n: { $sum: 1 } } },
    ]);
    res.json(Object.fromEntries(rows.map((r) => [String(r._id), r.n])));
  } catch (error) {
    console.error("Pending count error:", error);
    res.status(500).json({ error: "Failed to load requests" });
  }
});

// POST /requests/:id/decide - { decision: "approve" | "reject", note }
router.post("/:id/decide", authMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid request id" });
    const request = await CorrectionRequest.findById(req.params.id);
    if (!request || String(request.teacherId) !== req.teacher.id) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "pending") return res.status(409).json({ error: "This request has already been decided." });
    const { decision, note = "" } = req.body;
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "decision must be approve or reject" });

    if (decision === "approve") {
      const classroom = await Classroom.findById(request.classroomId);
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });
      const [y, m, d] = request.day.split("-").map(Number);
      const start = new Date(y, m - 1, d);
      const end = new Date(y, m - 1, d, 23, 59, 59, 999);
      await Attendance.findOneAndUpdate(
        { rollNo: request.rollNumber, classroomId: request.classroomId, teacherId: classroom.teacherId, period: request.period, date: { $gte: start, $lte: end } },
        { $set: { status: request.type, markedBy: "request" }, $setOnInsert: { studentName: request.studentName, date: start } },
        { upsert: true, new: true }
      );
    }
    request.status = decision === "approve" ? "approved" : "rejected";
    request.teacherNote = String(note).slice(0, 300);
    request.decidedAt = new Date();
    await request.save();
    audit(req.teacher, `request.${request.status}`, {
      classroomId: request.classroomId,
      target: request.rollNumber,
      details: { day: request.day, period: request.period, type: request.type },
    });
    res.json({ message: `Request ${request.status}.`, request });
  } catch (error) {
    console.error("Request decision error:", error);
    res.status(500).json({ error: "Failed to update the request" });
  }
});

module.exports = router;
