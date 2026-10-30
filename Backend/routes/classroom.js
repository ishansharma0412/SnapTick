// Routes: classroom
const express = require("express");
const Classroom = require("../models/classroom");
const Student = require("../models/student");
const Attendance = require("../models/attendance");
const { authMiddleware } = require("./auth");
const mongoose = require("mongoose");
const { deletePhoto } = require("../storage/photos");

const router = express.Router();

// Reject malformed ids with 400 instead of a database cast error
router.param("id", (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid classroom id" });
  }
  next();
});

// POST /classroom - create classroom
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { name, description } = req.body;
    const teacherId = req.teacher.id;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Classroom name is required" });
    }

    // Check for duplicate name for this teacher
    const existing = await Classroom.findOne({
      teacherId,
      name: name.trim()
    });
    if (existing) {
      return res.status(409).json({ error: "You already have a classroom with this name" });
    }

    const classroom = new Classroom({
      name: name.trim(),
      description: description?.trim() || "",
      teacherId
    });

    await classroom.save();

    res.status(201).json({
      message: "Classroom created successfully",
      classroom
    });

  } catch (error) {
    console.error("Create classroom error:", error);
    if (error.code === 11000) {
      return res.status(409).json({ error: "You already have a classroom with this name" });
    }
    res.status(500).json({ error: "Failed to create classroom" });
  }
});

// GET /classroom - list classrooms for the logged-in teacher
router.get("/", authMiddleware, async (req, res) => {
  try {
    const teacherId = req.teacher.id;

    const classrooms = await Classroom.find({ teacherId, isActive: true })
      .sort({ createdAt: -1 });

    // Aggregate student count per classroom
    const classroomIds = classrooms.map(c => c._id);
    const studentCounts = await Student.aggregate([
      { $match: { classroomId: { $in: classroomIds } } },
      { $group: { _id: "$classroomId", count: { $sum: 1 } } }
    ]);

    const countMap = new Map(
      studentCounts.map(item => [item._id.toString(), item.count])
    );

    const classroomsWithCounts = classrooms.map(classroom => ({
      ...classroom.toObject(),
      studentCount: countMap.get(classroom._id.toString()) || 0
    }));

    res.status(200).json(classroomsWithCounts);

  } catch (error) {
    console.error("Fetch classrooms error:", error);
    res.status(500).json({ error: "Failed to fetch classrooms" });
  }
});

// GET /classroom/:id - fetch a single classroom
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.teacher.id;

    const classroom = await Classroom.findById(id);

    if (!classroom) {
      return res.status(404).json({ error: "Classroom not found" });
    }

    if (classroom.teacherId.toString() !== teacherId) {
      return res.status(403).json({ error: "You can only access your own classrooms" });
    }

    // Get student count
    const studentCount = await Student.countDocuments({ classroomId: id });

    res.status(200).json({
      ...classroom.toObject(),
      studentCount
    });

  } catch (error) {
    console.error("Fetch classroom error:", error);
    res.status(500).json({ error: "Failed to fetch classroom" });
  }
});

// PUT /classroom/:id - update classroom
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const teacherId = req.teacher.id;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Classroom name is required" });
    }

    const classroom = await Classroom.findById(id);

    if (!classroom) {
      return res.status(404).json({ error: "Classroom not found" });
    }

    if (classroom.teacherId.toString() !== teacherId) {
      return res.status(403).json({ error: "You can only update your own classrooms" });
    }

    // Check for duplicate name (excluding current classroom)
    const existing = await Classroom.findOne({
      teacherId,
      name: name.trim(),
      _id: { $ne: id }
    });
    if (existing) {
      return res.status(409).json({ error: "You already have a classroom with this name" });
    }

    classroom.name = name.trim();
    classroom.description = description?.trim() || "";
    classroom.updatedAt = new Date();

    await classroom.save();

    res.status(200).json({
      message: "Classroom updated successfully",
      classroom
    });

  } catch (error) {
    console.error("Update classroom error:", error);
    if (error.code === 11000) {
      return res.status(409).json({ error: "You already have a classroom with this name" });
    }
    res.status(500).json({ error: "Failed to update classroom" });
  }
});

// DELETE /classroom/:id - delete classroom (cascade: students and attendance)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.teacher.id;

    const classroom = await Classroom.findById(id);

    if (!classroom) {
      return res.status(404).json({ error: "Classroom not found" });
    }

    if (classroom.teacherId.toString() !== teacherId) {
      return res.status(403).json({ error: "You can only delete your own classrooms" });
    }

    // Delete every student's stored photo (biometric data must not outlive the record)
    const students = await Student.find({ classroomId: id }, "image");
    for (const student of students) {
      await deletePhoto(student.image);
    }

    // Cascade: remove all students in this classroom
    const deleteStudentsResult = await Student.deleteMany({ classroomId: id });

    // Cascade: remove all attendance records for this classroom
    const deleteAttendanceResult = await Attendance.deleteMany({ classroomId: id });

    // Delete classroom
    await Classroom.findByIdAndDelete(id);

    res.status(200).json({
      message: "Classroom deleted successfully",
      deleted: {
        students: deleteStudentsResult.deletedCount,
        attendanceRecords: deleteAttendanceResult.deletedCount
      }
    });

  } catch (error) {
    console.error("Delete classroom error:", error);
    res.status(500).json({ error: "Failed to delete classroom" });
  }
});

module.exports = router;
