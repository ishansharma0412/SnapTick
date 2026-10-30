// Routes: enroll
const express = require("express");
const multer = require("multer");
const Student = require("../models/student");
const Classroom = require("../models/classroom");
const { authMiddleware } = require("./auth");
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { savePhotoFromFile, readPhoto, deletePhoto } = require("../storage/photos");

const router = express.Router();

// Use absolute path for uploads directory
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  // Random names: uploads are temporary and must not be guessable
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + (path.extname(file.originalname) || ".jpg").toLowerCase()),
});

// Max upload size
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Max training samples per student
// Prevents database bloat and keeps matching efficient
const MAX_TRAINING_SAMPLES = 10;

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

// Validate MongoDB ObjectId
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// DeepFace service URL
const DEEPFACE_SERVICE_URL = process.env.DEEPFACE_URL || "http://localhost:5001";

// Detect remote DeepFace service (requires base64 images)
const isRemoteDeepFace = !DEEPFACE_SERVICE_URL.includes("localhost") && !DEEPFACE_SERVICE_URL.includes("127.0.0.1");

// Face service may be asleep on free hosting; allow time for it to wake up.
const FACE_SERVICE_TIMEOUT_MS = 90000;

/** POST an image to the face service's /extract-embedding endpoint. */
async function callExtract(body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FACE_SERVICE_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(`${DEEPFACE_SERVICE_URL}/extract-embedding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("The face recognition service took too long to respond. Please try again.");
      }
      throw new Error("The face recognition service is starting up. Please try again in a minute.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`[FaceService] Error response:`, data.error || response.status);
      throw new Error(data.error || "Failed to extract face embedding");
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract a face embedding from an image file.
 * Local services read the file by path; remote services receive base64.
 */
async function extractFaceEmbedding(imagePath) {
  const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.join(UPLOADS_DIR, imagePath);
  if (isRemoteDeepFace) {
    const base64Image = (await fs.promises.readFile(absolutePath)).toString("base64");
    return callExtract({ image_base64: base64Image });
  }
  return callExtract({ image_path: absolutePath });
}

/** Extract a face embedding from an in-memory image (e.g. a stored photo). */
async function extractFaceEmbeddingFromBuffer(buffer) {
  return callExtract({ image_base64: buffer.toString("base64") });
}

/** Remove a temporary upload, ignoring errors. */
function removeUpload(file) {
  if (file?.path) fs.promises.unlink(file.path).catch(() => {});
}

console.log("DeepFace enrollment route initialized (using service at " + DEEPFACE_SERVICE_URL + ")");

/**
 * Validate classroom ownership.
 */
async function verifyClassroom(classroomId, teacherId) {
  if (!classroomId) {
    return { valid: false, error: "classroomId is required" };
  }

  const classroom = await Classroom.findById(classroomId);
  if (!classroom) {
    return { valid: false, error: "Classroom not found" };
  }

  if (classroom.teacherId.toString() !== teacherId) {
    return { valid: false, error: "You can only enroll students in your own classrooms" };
  }

  return { valid: true, classroom };
}


// POST /enroll - create student (auth required)
router.post("/", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    console.log("[Enroll] Request received");
    const { name, rollNumber, classroomId } = req.body;
    const teacherId = req.teacher.id;
    console.log(`[Enroll] name=${name}, rollNumber=${rollNumber}, classroomId=${classroomId}`);

    if (!name || !rollNumber) {
      return res.status(400).json({ error: "name and rollNumber are required" });
    }

    // Validate classroom
    console.log("[Enroll] Verifying classroom...");
    const classroomCheck = await verifyClassroom(classroomId, teacherId);
    if (!classroomCheck.valid) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: classroomCheck.error });
    }
    console.log("[Enroll] Classroom verified");

    const imagePath = req.file ? req.file.path : "";
    console.log(`[Enroll] Image path: ${imagePath}`);
    if (!imagePath) return res.status(400).json({ error: "Image file is required" });

    // req.file.path is already absolute (UPLOADS_DIR)
    const absoluteImagePath = imagePath;

    // Check for duplicate roll number in this classroom
    const existingStudent = await Student.findOne({ rollNumber, classroomId });
    if (existingStudent) {
      if (fs.existsSync(absoluteImagePath)) fs.unlinkSync(absoluteImagePath);
      return res.status(409).json({ error: "Roll number already exists in this classroom" });
    }

    // Use DeepFace to extract face embedding
    console.log("[Enroll] Calling DeepFace service...");
    let faceData;
    try {
      faceData = await extractFaceEmbedding(absoluteImagePath);
      console.log("[Enroll] DeepFace returned successfully");
    } catch (error) {
      console.error("[Enroll] DeepFace error:", error.message);
      if (fs.existsSync(absoluteImagePath)) fs.unlinkSync(absoluteImagePath);
      return res.status(400).json({ error: error.message || "No face detected in the image." });
    }

    const descriptor = faceData.embedding;
    const image = await savePhotoFromFile(absoluteImagePath, { contentType: req.file.mimetype, teacherId, classroomId });

    const student = new Student({
      name,
      rollNumber,
      image,
      faceDescriptors: [descriptor],
      faceDescriptor: descriptor,
      descriptorCount: 1,
      teacherId,
      classroomId
    });

    await student.save();
    res.status(201).json({ message: "Student enrolled successfully!", student });
  } catch (error) {
    console.error("Enroll error:", error.message);
    removeUpload(req.file);
    if (error.message === "Only image files are allowed") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Failed to enroll student" });
  }
});


// PUT /enroll/:id - update student (auth required)
router.put("/:id", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, rollNumber } = req.body;
    const teacherId = req.teacher.id;

    if (!name || !rollNumber) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: "name and rollNumber are required" });
    }

    if (!isValidObjectId(id)) {
      removeUpload(req.file);
      return res.status(400).json({ error: "Invalid student id" });
    }
    const student = await Student.findById(id);
    if (!student) {
      removeUpload(req.file);
      return res.status(404).json({ error: "Student not found" });
    }

    // Validate teacher ownership
    if (student.teacherId.toString() !== teacherId) {
      removeUpload(req.file);
      return res.status(403).json({ error: "You can only update your own students" });
    }

    // Check for duplicate roll number in classroom
    const existingStudent = await Student.findOne({
      rollNumber,
      classroomId: student.classroomId,
      _id: { $ne: id },
    });
    if (existingStudent) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(409).json({ error: "Roll number already exists in this classroom" });
    }
    student.name = name;
    student.rollNumber = rollNumber;

    if (req.file) {
      const absoluteImagePath = req.file.path;

      // Use DeepFace to extract face embedding
      let faceData;
      try {
        faceData = await extractFaceEmbedding(absoluteImagePath);
      } catch (error) {
        if (fs.existsSync(absoluteImagePath)) fs.unlinkSync(absoluteImagePath);
        return res.status(400).json({ error: error.message || "No face detected in the new image." });
      }

      const newDescriptor = faceData.embedding;
      const previousImage = student.image;
      student.image = await savePhotoFromFile(absoluteImagePath, { contentType: req.file.mimetype, teacherId, classroomId: student.classroomId });
      await deletePhoto(previousImage);

      if (!student.faceDescriptors || student.faceDescriptors.length === 0) {
        student.faceDescriptors = [newDescriptor];
      } else if (student.faceDescriptors.length >= MAX_TRAINING_SAMPLES) {
        // At limit: replace oldest descriptor (FIFO)
        student.faceDescriptors = [...student.faceDescriptors.slice(1), newDescriptor];
        console.log(`[Update] ${student.rollNumber} at max samples (${MAX_TRAINING_SAMPLES}), replaced oldest`);
      } else {
        student.faceDescriptors = [...student.faceDescriptors, newDescriptor];
      }

      student.faceDescriptor = newDescriptor;
      student.descriptorCount = student.faceDescriptors.length;
    }

    const updatedStudent = await student.save();
    res.status(200).json({ message: "Student updated successfully (new photo added)", student: updatedStudent });

  } catch (error) {
    console.error("Update error:", error);
    removeUpload(req.file);
    if (error.message === "Only image files are allowed") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Failed to update student" });
  }
});


// GET /enroll - list students (optional classroomId)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const teacherId = req.teacher.id;
    const { classroomId } = req.query;

    const query = { teacherId };
    if (classroomId) {
      if (!isValidObjectId(classroomId)) {
        return res.status(400).json({ error: "Invalid classroom id" });
      }
      query.classroomId = classroomId;
    }

    // Embeddings are large and not needed by the client list
    const students = await Student.find(query, "-faceDescriptors -faceDescriptor").lean();
    res.status(200).json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// GET /enroll/descriptors - list face descriptors (optional classroomId)
router.get("/descriptors", authMiddleware, async (req, res) => {
  try {
    const teacherId = req.teacher.id;
    const { classroomId } = req.query;

    const query = { teacherId };
    if (classroomId) {
      query.classroomId = classroomId;
    }

    const students = await Student.find(query, "name rollNumber faceDescriptors faceDescriptor classroomId");
    const payload = students.map((student) => ({
      name: student.name,
      rollNumber: student.rollNumber,
      classroomId: student.classroomId,
      descriptors:
        student.faceDescriptors && student.faceDescriptors.length > 0
          ? student.faceDescriptors
          : student.faceDescriptor
            ? [student.faceDescriptor]
            : [],
    }));
    res.status(200).json(payload);
  } catch (error) {
    console.error("Descriptor fetch error:", error);
    res.status(500).json({ error: "Failed to fetch face descriptors" });
  }
});

// POST /enroll/:id/add-photo - add training photo
router.post("/:id/add-photo", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.teacher.id;

    if (!req.file) {
      return res.status(400).json({ error: "Image file is required" });
    }

    if (!isValidObjectId(id)) {
      removeUpload(req.file);
      return res.status(400).json({ error: "Invalid student id" });
    }
    const student = await Student.findById(id);
    if (!student) {
      removeUpload(req.file);
      return res.status(404).json({ error: "Student not found" });
    }

    // Validate teacher ownership
    if (student.teacherId.toString() !== teacherId) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: "You can only add photos to your own students" });
    }

    const imagePath = req.file.path;
    // req.file.path is already absolute (UPLOADS_DIR)
    const absoluteImagePath = imagePath;

    // Use DeepFace to extract face embedding
    let faceData;
    try {
      faceData = await extractFaceEmbedding(absoluteImagePath);
    } catch (error) {
      if (fs.existsSync(absoluteImagePath)) fs.unlinkSync(absoluteImagePath);
      return res.status(400).json({ error: error.message || "No face detected in the image." });
    }

    const newDescriptor = faceData.embedding;

    // Enforce training sample limit
    const currentCount = student.faceDescriptors?.length || 0;
    if (currentCount >= MAX_TRAINING_SAMPLES) {
      if (fs.existsSync(absoluteImagePath)) fs.unlinkSync(absoluteImagePath);
      return res.status(400).json({
        error: `Maximum of ${MAX_TRAINING_SAMPLES} photos reached. Use "Reset Photos" to start fresh.`,
        photoCount: currentCount,
        maxPhotos: MAX_TRAINING_SAMPLES
      });
    }

    // Append new descriptor
    if (!student.faceDescriptors || student.faceDescriptors.length === 0) {
      student.faceDescriptors = [newDescriptor];
    } else {
      student.faceDescriptors = [...student.faceDescriptors, newDescriptor];
    }

    student.faceDescriptor = newDescriptor;
    student.descriptorCount = student.faceDescriptors.length;
    // The latest photo becomes the displayed / re-embedding reference
    const previousImage = student.image;
    student.image = await savePhotoFromFile(absoluteImagePath, { contentType: req.file.mimetype, teacherId, classroomId: student.classroomId });
    await deletePhoto(previousImage);

    const updatedStudent = await student.save();

    res.status(200).json({
      message: `Photo added successfully! Student now has ${student.descriptorCount}/${MAX_TRAINING_SAMPLES} photos.`,
      student: updatedStudent,
      photoCount: student.descriptorCount,
      maxPhotos: MAX_TRAINING_SAMPLES
    });

  } catch (error) {
    console.error("Add photo error:", error);
    removeUpload(req.file);
    res.status(500).json({ error: "Failed to add photo" });
  }
});


// DELETE /enroll/:id - delete student
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.teacher.id;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid student id" });
    }
    const student = await Student.findById(id);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Validate teacher ownership
    if (student.teacherId.toString() !== teacherId) {
      return res.status(403).json({ error: "You can only delete your own students" });
    }

    await deletePhoto(student.image);

    await Student.findByIdAndDelete(id);
    res.status(200).json({ message: "Student deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Failed to delete student" });
  }
});


// DELETE /enroll/:id/reset-photos - keep only latest photo
router.delete("/:id/reset-photos", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.teacher.id;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid student id" });
    }
    const student = await Student.findById(id);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Validate teacher ownership
    if (student.teacherId.toString() !== teacherId) {
      return res.status(403).json({ error: "You can only reset photos for your own students" });
    }

    if (!student.faceDescriptors || student.faceDescriptors.length === 0) {
      return res.status(400).json({ error: "Student has no photos to reset" });
    }

    // Keep only the latest descriptor
    const lastDescriptor = student.faceDescriptors[student.faceDescriptors.length - 1];
    student.faceDescriptors = [lastDescriptor];
    student.faceDescriptor = lastDescriptor;
    student.descriptorCount = 1;

    const updatedStudent = await student.save();

    res.status(200).json({
      message: "Photos reset successfully. Only the latest photo is kept.",
      student: updatedStudent,
      photoCount: 1
    });

  } catch (error) {
    console.error("Reset photos error:", error);
    res.status(500).json({ error: "Failed to reset photos" });
  }
});


// POST /enroll/re-embed - reprocess all student photos with current model (ArcFace)
// Use after switching models to refresh embeddings
router.post("/re-embed", authMiddleware, async (req, res) => {
  try {
    const teacherId = req.teacher.id;
    const { classroomId } = req.body;

    // Build query
    const query = { teacherId };
    if (classroomId) {
      query.classroomId = classroomId;
    }

    const students = await Student.find(query);

    if (students.length === 0) {
      return res.status(404).json({ error: "No students found" });
    }

    const results = {
      total: students.length,
      success: 0,
      failed: 0,
      skipped: 0,
      details: []
    };

    console.log(`[Re-embed] Processing ${students.length} students with new model...`);

    for (const student of students) {
      // Skip if student lacks an image
      if (!student.image) {
        results.skipped++;
        results.details.push({
          rollNumber: student.rollNumber,
          name: student.name,
          status: "skipped",
          reason: "No image file"
        });
        continue;
      }

      const photo = await readPhoto(student.image);

      // Skip if the photo is missing
      if (!photo) {
        results.skipped++;
        results.details.push({
          rollNumber: student.rollNumber,
          name: student.name,
          status: "skipped",
          reason: "Image file not found"
        });
        continue;
      }

      try {
        // Extract new embedding with current model (ArcFace)
        console.log(`[Re-embed] Processing ${student.rollNumber}: ${student.name}...`);
        const faceData = await extractFaceEmbeddingFromBuffer(photo.buffer);
        const newDescriptor = faceData.embedding;

        // Update student with new embedding
        student.faceDescriptors = [newDescriptor];
        student.faceDescriptor = newDescriptor;
        student.descriptorCount = 1;
        await student.save();

        results.success++;
        results.details.push({
          rollNumber: student.rollNumber,
          name: student.name,
          status: "success",
          embeddingSize: newDescriptor.length
        });
        console.log(`[Re-embed] ✅ ${student.rollNumber} updated successfully`);

      } catch (error) {
        results.failed++;
        results.details.push({
          rollNumber: student.rollNumber,
          name: student.name,
          status: "failed",
          reason: error.message
        });
        console.error(`[Re-embed] ❌ ${student.rollNumber} failed: ${error.message}`);
      }
    }

    console.log(`[Re-embed] Complete: ${results.success} success, ${results.failed} failed, ${results.skipped} skipped`);

    res.status(200).json({
      message: `Re-embedding complete: ${results.success}/${results.total} students updated`,
      results
    });

  } catch (error) {
    console.error("Re-embed error:", error);
    res.status(500).json({ error: "Failed to re-embed students" });
  }
});


// GET /enroll/:id/photo - a student's reference photo (owner only)
router.get("/:id/photo", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid student id" });
    }
    const student = await Student.findById(id, "teacherId image");
    if (!student || student.teacherId.toString() !== req.teacher.id) {
      return res.status(404).json({ error: "Photo not found" });
    }
    const photo = await readPhoto(student.image);
    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }
    res.set("Content-Type", photo.contentType);
    res.set("Cache-Control", "private, max-age=300");
    res.send(photo.buffer);
  } catch (error) {
    console.error("Photo fetch error:", error);
    res.status(500).json({ error: "Failed to load photo" });
  }
});

module.exports = router;
