// Routes: attendance
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage } = require("canvas");
const Attendance = require("../models/attendance");
const Student = require("../models/student");
const Classroom = require("../models/classroom");
const { authMiddleware } = require("./auth");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { savePhoto } = require("../storage/photos");

// Use absolute path for uploads directory
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    // Random names: scan images are served publicly for a short time and must not be guessable
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + (path.extname(file.originalname) || ".jpg").toLowerCase()),
});
const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only image files are allowed"));
        }
        cb(null, true);
    },
});

// DeepFace service URL
const DEEPFACE_SERVICE_URL = process.env.DEEPFACE_URL || "http://localhost:5001";

// Base URL for serving uploaded images
const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

// Detect remote DeepFace service (requires base64 images)
const isRemoteDeepFace = !DEEPFACE_SERVICE_URL.includes("localhost") && !DEEPFACE_SERVICE_URL.includes("127.0.0.1");

// Max training samples per student
// Prevents database bloat and keeps matching efficient
const MAX_TRAINING_SAMPLES = 10;

console.log(`DeepFace attendance route initialized (service: ${DEEPFACE_SERVICE_URL}, remote: ${isRemoteDeepFace})`);

/**
 * Clean up old marked images to control storage growth.
 * Deletes marked-*.jpg files older than the specified age.
 */
function cleanupOldMarkedImages(maxAgeMinutes = 30) {
    try {
        const files = fs.readdirSync(UPLOADS_DIR);
        const now = Date.now();
        let deletedCount = 0;

        for (const file of files) {
            if (file.startsWith("marked-") || file.startsWith("facecrop-")) {
                const filePath = path.join(UPLOADS_DIR, file);
                const stats = fs.statSync(filePath);
                const ageMinutes = (now - stats.mtimeMs) / (1000 * 60);

                if (ageMinutes > maxAgeMinutes) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            }
        }

        if (deletedCount > 0) {
            console.log(`[Cleanup] Deleted ${deletedCount} old marked image(s)`);
        }
    } catch (err) {
        console.error("[Cleanup] Error cleaning old marked images:", err.message);
    }
}

// Run cleanup at startup and every 30 minutes
cleanupOldMarkedImages();
setInterval(() => cleanupOldMarkedImages(), 30 * 60 * 1000);

/**
 * Match faces in a group photo against enrolled descriptors via DeepFace.
 * Supports both local (file path) and remote (base64) modes.
 * @param {string} imagePath - Absolute path to the group photo
 * @param {Array} enrolledFaces - Array of {rollNumber, descriptors}
 * @returns {Promise<{matches: Array, face_count: number}>}
 */
async function matchFaces(imagePath, enrolledFaces) {
    // Ensure absolute path
    const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.join(UPLOADS_DIR, imagePath);

    console.log(`[DeepFace] Matching faces from: ${absolutePath} (remote: ${isRemoteDeepFace})`);

    let requestBody;

    if (isRemoteDeepFace) {
        // Remote service: send base64 image
        const imageBuffer = fs.readFileSync(absolutePath);
        const base64Image = imageBuffer.toString('base64');
        requestBody = JSON.stringify({
            image_base64: base64Image,
            enrolled_faces: enrolledFaces
        });
    } else {
        // Local service: send file path
        requestBody = JSON.stringify({
            image_path: absolutePath,
            enrolled_faces: enrolledFaces
        });
    }

    const response = await callFaceService("/match-faces", requestBody);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        console.error(`[DeepFace] Error response:`, data);
        throw new Error(data.error || "Failed to match faces");
    }

    return data;
}

/**
 * POST JSON to the face service with a timeout. The service may be asleep on
 * free hosting, so connection failures get a message the teacher can act on.
 */
async function callFaceService(endpoint, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
        return await fetch(`${DEEPFACE_SERVICE_URL}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
        });
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error("Face recognition took too long. Please try again with a smaller photo.");
        }
        throw new Error("The face recognition service is starting up. Please try again in a minute.");
    } finally {
        clearTimeout(timeout);
    }
}

/** Parse "YYYY-MM-DD" as a local calendar day (independent of the server's UTC parsing). */
function parseDay(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split("-").map(Number);
        return new Date(y, m - 1, d);
    }
    const d = new Date(value);
    return isNaN(d) ? null : d;
}

/** Delete a file, ignoring errors (it may already have been removed). */
function safeUnlink(filePath) {
    fs.promises.unlink(filePath).catch(() => {});
}

/**
 * Validate classroom ownership.
 */
async function verifyClassroom(classroomId, teacherId) {
    if (!classroomId) {
        return { valid: false, error: "classroomId is required" };
    }
    if (!mongoose.Types.ObjectId.isValid(classroomId)) {
        return { valid: false, error: "Invalid classroom id" };
    }

    const classroom = await Classroom.findById(classroomId);
    if (!classroom) {
        return { valid: false, error: "Classroom not found" };
    }

    if (classroom.teacherId.toString() !== teacherId) {
        return { valid: false, error: "You can only manage attendance for your own classrooms" };
    }

    return { valid: true, classroom };
}

// POST /attendance/upload - upload group photo for detection (auth required)
// Returns detections for review instead of marking immediately
router.post("/upload", authMiddleware, upload.single("groupPhoto"), async (req, res) => {
    let absoluteImagePath = "";
    try {
        const teacherId = req.teacher.id;
        const { classroomId } = req.body;

        if (!req.file) return res.status(400).json({ error: "No group photo file uploaded." });

        // Validate classroom
        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ error: classroomCheck.error });
        }

        const groupImagePath = req.file.path;

        // Load students for this classroom
        const students = await Student.find({ classroomId });

        // Prepare enrolled descriptors for DeepFace
        const enrolledFaces = students
            .map((s) => {
                const descriptors =
                    s.faceDescriptors && s.faceDescriptors.length > 0
                        ? s.faceDescriptors
                        : s.faceDescriptor
                            ? [s.faceDescriptor]
                            : [];

                if (descriptors.length === 0) return null;
                return { rollNumber: s.rollNumber, descriptors };
            })
            .filter(Boolean);

        if (enrolledFaces.length === 0) {
            if (fs.existsSync(groupImagePath)) fs.unlinkSync(groupImagePath);
            return res.status(400).json({ error: "No students are enrolled with face data in this classroom." });
        }

        // groupImagePath is already absolute (UPLOADS_DIR)
        absoluteImagePath = groupImagePath;

        // Call DeepFace to match faces
        let matchResult;
        try {
            matchResult = await matchFaces(absoluteImagePath, enrolledFaces);
        } catch (error) {
            if (fs.existsSync(absoluteImagePath)) fs.unlinkSync(absoluteImagePath);
            return res.status(503).json({ error: error.message || "Failed to process faces" });
        }

        // Load image for bounding boxes
        const groupImg = await loadImage(absoluteImagePath);
        const outCanvas = createCanvas(groupImg.width, groupImg.height);
        const ctx = outCanvas.getContext('2d');
        ctx.drawImage(groupImg, 0, 0);

        const studentMap = new Map(
            students.map((student) => [student.rollNumber, student])
        );

        // Save a padded crop of every face so the teacher can see who was (not) recognized
        const cropBase = path.parse(req.file.filename).name;
        const saveFaceCrop = (box, index) => {
            const pad = Math.round(Math.max(box.width, box.height) * 0.4);
            const sx = Math.max(0, box.x - pad);
            const sy = Math.max(0, box.y - pad);
            const sw = Math.min(groupImg.width - sx, box.width + pad * 2);
            const sh = Math.min(groupImg.height - sy, box.height + pad * 2);
            const scale = Math.min(1, 256 / Math.max(sw, sh));
            const cropCanvas = createCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
            cropCanvas.getContext("2d").drawImage(groupImg, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);
            const fileName = `facecrop-${cropBase}-${index}.jpg`;
            fs.writeFileSync(path.join(UPLOADS_DIR, fileName), cropCanvas.toBuffer("image/jpeg", { quality: 0.9 }));
            return fileName;
        };

        // Build detection results
        const detections = [];

        // Process DeepFace matches
        for (let i = 0; i < matchResult.matches.length; i++) {
            const match = matchResult.matches[i];
            const facial_area = match.facial_area;
            const box = {
                x: facial_area.x || 0,
                y: facial_area.y || 0,
                width: facial_area.w || 100,
                height: facial_area.h || 100
            };

            const faceImage = saveFaceCrop(box, i);
            const isRecognized = match.is_recognized;
            const rollNumber = match.roll_number;
            const student = isRecognized ? studentMap.get(rollNumber) : null;
            const label = isRecognized && student ? student.name : "Unknown";
            const strokeColor = isRecognized ? "#16a34a" : "#dc2626";

            // Draw bounding box
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 3;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            // Draw label
            const fontSize = Math.max(18, Math.round(box.height / 12));
            const padding = Math.max(4, Math.round(fontSize * 0.25));
            ctx.font = `${fontSize}px Arial`;
            const textWidth = ctx.measureText(label).width;
            const textHeight = fontSize + padding * 2;
            const labelX = Math.max(0, Math.min(box.x - (ctx.lineWidth / 2), outCanvas.width - textWidth - padding * 2));
            const labelY = Math.max(0, box.y - textHeight);

            ctx.fillStyle = strokeColor;
            ctx.fillRect(labelX, labelY, textWidth + padding * 2, textHeight);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(label, labelX + padding, labelY + fontSize + (padding / 2));

            // Confidence comes from the face service (calibrated to its model);
            // fall back to a distance-based estimate for older services.
            const confidence = typeof match.confidence === "number"
                ? match.confidence
                : Math.max(0, Math.min(100, Math.round((1 - match.distance / 0.8) * 100)));

            // Add detection result
            detections.push({
                faceIndex: i,
                facialArea: box,
                match: {
                    studentId: student ? student._id.toString() : null,
                    name: label,
                    rollNumber: rollNumber !== "unknown" ? rollNumber : null,
                    distance: match.distance,
                    confidence: confidence,
                    status: isRecognized ? "matched" : "unknown"
                },
                faceImage,
                faceImageUrl: `${BASE_URL}/uploads/${faceImage}`,
                embedding: match.embedding // Include embedding for corrections
            });
        }

        // Save annotated image
        const newImageName = `marked-${req.file.filename}`;
        const newImageSavePath = path.join(UPLOADS_DIR, newImageName);
        const buffer = outCanvas.toBuffer('image/jpeg');
        fs.writeFileSync(newImageSavePath, buffer);

        // Remove original image
        if (fs.existsSync(absoluteImagePath)) {
            fs.unlinkSync(absoluteImagePath);
        }

        // Schedule cleanup of marked image after 10 minutes
        setTimeout(() => safeUnlink(newImageSavePath), 10 * 60 * 1000);

        // Prepare enrolled students for correction dropdown
        const enrolledStudents = students.map(s => ({
            _id: s._id.toString(),
            name: s.name,
            rollNumber: s.rollNumber
        }));

        // Students already marked present today (manual or earlier scan)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const todayRecords = await Attendance.find(
            { classroomId, teacherId, date: { $gte: todayStart, $lte: todayEnd } },
            "rollNo"
        ).lean();

        res.json({
            success: true,
            reviewMode: true,
            detections,
            alreadyPresent: todayRecords.map((r) => r.rollNo),
            markedImageUrl: `${BASE_URL}/uploads/${newImageName}`,
            faceCount: matchResult.face_count,
            recognizedCount: matchResult.recognized_count,
            classroomId,
            classroomName: classroomCheck.classroom.name,
            enrolledStudents
        });

    } catch (err) {
        console.error("Attendance error:", err);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        if (absoluteImagePath && fs.existsSync(absoluteImagePath)) {
            fs.unlinkSync(absoluteImagePath);
        }
        if (err.message === "Only image files are allowed") {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: "Error processing attendance" });
    }
});


// POST /attendance/confirm - confirm detections and mark attendance (auth required)
// Called after review of /upload detections
router.post("/confirm", authMiddleware, async (req, res) => {
    try {
        const teacherId = req.teacher.id;
        const { classroomId, confirmations, manualStudentIds = [] } = req.body;

        if (!classroomId) {
            return res.status(400).json({ error: "classroomId is required" });
        }

        if (!confirmations || !Array.isArray(confirmations) || !Array.isArray(manualStudentIds)) {
            return res.status(400).json({ error: "confirmations array is required" });
        }

        // Validate classroom
        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            return res.status(400).json({ error: classroomCheck.error });
        }

        // Compute attendance date window
        const now = new Date();
        const startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
        const attendanceDate = new Date(startDate);

        // Load existing attendance records
        const existingRecords = await Attendance.find({
            date: { $gte: startDate, $lte: endDate },
            teacherId,
            classroomId
        }, "rollNo");
        const existingRollNumbers = new Set(existingRecords.map(r => r.rollNo));

        // Process confirmations
        const markedStudents = [];
        const alreadyPresentStudents = [];
        let trainedCount = 0;
        const uniqueRollNumbers = new Set();

        // Students the teacher marked present by hand (not visible in the photo)
        const allConfirmations = [
            ...confirmations,
            ...manualStudentIds.map((studentId) => ({ studentId, action: "manual", addToTraining: false })),
        ];

        for (const confirmation of allConfirmations) {
            const { faceIndex, studentId, action, addToTraining, embedding } = confirmation;

            // Skip faces marked as not enrolled
            if (action === "skip") {
                continue;
            }

            // Confirm/correct actions require studentId
            if (!studentId) {
                continue;
            }

            // Load student
            const student = await Student.findOne({ _id: studentId, classroomId });
            if (!student) {
                console.log(`[Confirm] Student not found: ${studentId}`);
                continue;
            }

            // Mark attendance (dedupe)
            if (existingRollNumbers.has(student.rollNumber) && !uniqueRollNumbers.has(student.rollNumber)) {
                alreadyPresentStudents.push({ studentName: student.name, rollNo: student.rollNumber });
                uniqueRollNumbers.add(student.rollNumber);
            } else if (!uniqueRollNumbers.has(student.rollNumber)) {
                try {
                    await Attendance.create({
                        studentName: student.name,
                        rollNo: student.rollNumber,
                        date: attendanceDate,
                        classroomId,
                        teacherId
                    });
                    markedStudents.push({
                        studentName: student.name,
                        rollNo: student.rollNumber
                    });
                    uniqueRollNumbers.add(student.rollNumber);
                    existingRollNumbers.add(student.rollNumber);
                } catch (error) {
                    if (error && error.code === 11000) {
                        // Duplicate: already marked
                        existingRollNumbers.add(student.rollNumber);
                    } else {
                        throw error;
                    }
                }
            }

            // Add embedding to training data when requested
            if (addToTraining && embedding && Array.isArray(embedding)) {
                try {
                    // Initialize faceDescriptors if missing
                    if (!student.faceDescriptors) {
                        student.faceDescriptors = [];
                    }

                    // Enforce training sample limit
                    if (student.faceDescriptors.length >= MAX_TRAINING_SAMPLES) {
                        console.log(`[Confirm] ${student.name} (${student.rollNumber}) has reached max training samples (${MAX_TRAINING_SAMPLES}), skipping`);
                    } else {
                        // Append new embedding
                        student.faceDescriptors.push(embedding);
                        student.descriptorCount = student.faceDescriptors.length;
                        await student.save();

                        trainedCount++;
                        console.log(`[Confirm] Added training data for ${student.name} (${student.rollNumber}), now has ${student.descriptorCount}/${MAX_TRAINING_SAMPLES} photos`);
                    }
                } catch (error) {
                    console.error(`[Confirm] Failed to add training data for ${student.rollNumber}:`, error.message);
                }
            }
        }

        res.json({
            success: true,
            markedCount: markedStudents.length,
            trainedCount,
            markedStudents,
            alreadyPresentStudents,
            message: `Marked ${markedStudents.length} student(s) present` +
                (alreadyPresentStudents.length ? `, ${alreadyPresentStudents.length} already present today` : "") +
                (trainedCount > 0 ? ` · learned ${trainedCount} new face sample(s)` : "")
        });

    } catch (err) {
        console.error("Confirm attendance error:", err);
        res.status(500).json({ error: "Error confirming attendance" });
    }
});


// Manual attendance routes

// GET /attendance - list attendance records
router.get("/", authMiddleware, async (req, res) => {
    try {
        const { date, classroomId } = req.query;
        const teacherId = req.teacher.id;

        if (!date) return res.status(400).json({ error: "Date query parameter is required." });
        if (!classroomId) return res.status(400).json({ error: "classroomId query parameter is required." });

        // Validate classroom ownership
        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            return res.status(400).json({ error: classroomCheck.error });
        }

        const day = parseDay(date);
        if (!day) return res.status(400).json({ error: "Invalid date." });
        const startDate = new Date(day);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(day);
        endDate.setHours(23, 59, 59, 999);

        const records = await Attendance.find({
            date: { $gte: startDate, $lte: endDate },
            teacherId,
            classroomId
        });
        res.status(200).json(records);
    } catch (error) {
        console.error("Fetching attendance error:", error);
        res.status(500).json({ error: "Failed to fetch attendance records." });
    }
});

// POST /attendance/enroll-face - enroll a new student from an unrecognized face in a scan (auth required)
// Uses the face crop and embedding produced by /upload, so no new photo is needed.
router.post("/enroll-face", authMiddleware, async (req, res) => {
    try {
        const teacherId = req.teacher.id;
        const { classroomId, name, rollNumber, faceImage, embedding } = req.body;

        if (!name?.trim() || !rollNumber?.trim()) {
            return res.status(400).json({ error: "Name and roll number are required" });
        }
        if (!Array.isArray(embedding) || embedding.length === 0) {
            return res.status(400).json({ error: "Face embedding is missing; scan the photo again" });
        }
        // Only accept crops written by /upload (no path traversal)
        if (typeof faceImage !== "string" || !/^facecrop-[\w.-]+\.jpg$/.test(faceImage)) {
            return res.status(400).json({ error: "Invalid face image" });
        }
        const cropPath = path.join(UPLOADS_DIR, faceImage);
        if (!fs.existsSync(cropPath)) {
            return res.status(410).json({ error: "This scan has expired; scan the photo again" });
        }

        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            return res.status(400).json({ error: classroomCheck.error });
        }

        if (await Student.findOne({ rollNumber: rollNumber.trim(), classroomId })) {
            return res.status(409).json({ error: "Roll number already exists in this classroom" });
        }

        const imageName = await savePhoto(await fs.promises.readFile(cropPath), { contentType: "image/jpeg", teacherId, classroomId });

        const student = await Student.create({
            name: name.trim(),
            rollNumber: rollNumber.trim(),
            image: imageName,
            faceDescriptors: [embedding],
            faceDescriptor: embedding,
            descriptorCount: 1,
            teacherId,
            classroomId,
        });

        res.status(201).json({
            message: "Student added",
            student: { _id: student._id.toString(), name: student.name, rollNumber: student.rollNumber },
        });
    } catch (error) {
        console.error("Enroll from face error:", error);
        res.status(500).json({ error: "Failed to add student" });
    }
});

// Minimum attendance percentage most colleges require (used for defaulter list)
const ATTENDANCE_THRESHOLD = 75;

// Local-date key (YYYY-MM-DD); attendance dates are stored at local midnight
function dayKey(value) {
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// GET /attendance/overview - today's attendance and 30-day average for every classroom of the teacher
router.get("/overview", authMiddleware, async (req, res) => {
    try {
        const teacherId = req.teacher.id;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const monthStart = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);

        const classrooms = await Classroom.find({ teacherId }, { name: 1 }).lean();
        const ids = classrooms.map((c) => c._id);
        const [studentCounts, records] = await Promise.all([
            Student.aggregate([{ $match: { classroomId: { $in: ids } } }, { $group: { _id: "$classroomId", n: { $sum: 1 } } }]),
            Attendance.find({ classroomId: { $in: ids }, teacherId, date: { $gte: monthStart } }, { classroomId: 1, date: 1 }).lean(),
        ]);
        const countBy = new Map(studentCounts.map((c) => [c._id.toString(), c.n]));

        const perClass = new Map(ids.map((id) => [id.toString(), { today: 0, byDay: new Map(), last: null }]));
        for (const r of records) {
            const entry = perClass.get(r.classroomId.toString());
            const key = dayKey(r.date);
            entry.byDay.set(key, (entry.byDay.get(key) || 0) + 1);
            if (r.date >= todayStart) entry.today++;
            if (!entry.last || r.date > entry.last) entry.last = r.date;
        }

        const round1 = (n) => Math.round(n * 10) / 10;
        const rows = classrooms.map((c) => {
            const id = c._id.toString();
            const students = countBy.get(id) || 0;
            const entry = perClass.get(id);
            const sessions = entry.byDay.size;
            const totalPresent = [...entry.byDay.values()].reduce((a, b) => a + b, 0);
            return {
                classroomId: id,
                name: c.name,
                students,
                presentToday: entry.today,
                takenToday: entry.today > 0,
                sessions30d: sessions,
                average30d: students && sessions ? round1(Math.min(100, (totalPresent / (students * sessions)) * 100)) : null,
                lastTaken: entry.last ? dayKey(entry.last) : null,
            };
        });

        const totalStudents = rows.reduce((a, r) => a + r.students, 0);
        const presentToday = rows.reduce((a, r) => a + r.presentToday, 0);
        const studentsInTakenClasses = rows.filter((r) => r.takenToday).reduce((a, r) => a + r.students, 0);
        const averaged = rows.filter((r) => r.average30d !== null);

        res.json({
            totalClassrooms: rows.length,
            totalStudents,
            presentToday,
            todayRate: studentsInTakenClasses ? round1((presentToday / studentsInTakenClasses) * 100) : null,
            classesTakenToday: rows.filter((r) => r.takenToday).length,
            average30d: averaged.length ? round1(averaged.reduce((a, r) => a + r.average30d, 0) / averaged.length) : null,
            classrooms: rows,
        });
    } catch (error) {
        console.error("Attendance overview error:", error);
        res.status(500).json({ error: "Failed to load overview." });
    }
});

// GET /attendance/report - per-student attendance summary for a date range (auth required)
// A "session" is any day in the range on which attendance was taken for this classroom.
router.get("/report", authMiddleware, async (req, res) => {
    try {
        const { classroomId, from, to } = req.query;
        const teacherId = req.teacher.id;

        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            return res.status(400).json({ error: classroomCheck.error });
        }

        const endDate = to ? parseDay(to) : new Date();
        const startDate = from ? parseDay(from) : endDate && new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);
        if (!startDate || !endDate) {
            return res.status(400).json({ error: "Invalid from/to date." });
        }
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        if (startDate > endDate) {
            return res.status(400).json({ error: "'from' must be before 'to'." });
        }

        const [students, records] = await Promise.all([
            Student.find({ classroomId }, { name: 1, rollNumber: 1 }).sort({ rollNumber: 1 }).lean(),
            Attendance.find(
                { classroomId, teacherId, date: { $gte: startDate, $lte: endDate } },
                { rollNo: 1, date: 1 }
            ).lean(),
        ]);

        const enrolledRolls = new Set(students.map((s) => s.rollNumber));
        const daysByRoll = new Map();
        const presentByDay = new Map();
        for (const record of records) {
            const key = dayKey(record.date);
            if (!presentByDay.has(key)) presentByDay.set(key, 0);
            if (!enrolledRolls.has(record.rollNo)) continue; // student since removed
            presentByDay.set(key, presentByDay.get(key) + 1);
            if (!daysByRoll.has(record.rollNo)) daysByRoll.set(record.rollNo, new Set());
            daysByRoll.get(record.rollNo).add(key);
        }

        const totalSessions = presentByDay.size;
        const round1 = (n) => Math.round(n * 10) / 10;

        const rows = students.map((s) => {
            const present = daysByRoll.get(s.rollNumber)?.size || 0;
            const percentage = totalSessions ? round1((present / totalSessions) * 100) : 0;
            let status = "no-data";
            if (totalSessions) {
                if (percentage >= ATTENDANCE_THRESHOLD) status = "good";
                else if (percentage >= ATTENDANCE_THRESHOLD - 15) status = "warning";
                else status = "critical";
            }
            return {
                studentId: s._id.toString(),
                name: s.name,
                rollNumber: s.rollNumber,
                present,
                absent: totalSessions - present,
                percentage,
                status,
            };
        });

        const days = [...presentByDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, present]) => ({
                date,
                present,
                total: students.length,
                percentage: students.length ? round1((present / students.length) * 100) : 0,
            }));

        const classAverage = rows.length && totalSessions
            ? round1(rows.reduce((sum, r) => sum + r.percentage, 0) / rows.length)
            : 0;

        res.json({
            classroom: { id: classroomId, name: classroomCheck.classroom.name },
            from: dayKey(startDate),
            to: dayKey(endDate),
            threshold: ATTENDANCE_THRESHOLD,
            totalStudents: students.length,
            totalSessions,
            classAverage,
            defaulterCount: rows.filter((r) => r.status === "warning" || r.status === "critical").length,
            students: rows,
            days,
        });
    } catch (error) {
        console.error("Attendance report error:", error);
        res.status(500).json({ error: "Failed to build attendance report." });
    }
});

// POST /attendance/mark - mark attendance manually
router.post("/mark", authMiddleware, async (req, res) => {
    try {
        const { rollNumber, name, date, classroomId } = req.body;
        const teacherId = req.teacher.id;

        if (!rollNumber || !name || !date || !classroomId) {
            return res.status(400).json({ error: "rollNumber, name, date, and classroomId are required." });
        }

        // Validate classroom ownership
        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            return res.status(400).json({ error: classroomCheck.error });
        }

        const specificDate = parseDay(date);
        if (!specificDate) return res.status(400).json({ error: "Invalid date." });
        const startDate = new Date(new Date(specificDate).setHours(0, 0, 0, 0));
        const endDate = new Date(new Date(specificDate).setHours(23, 59, 59, 999));
        const attendanceDate = new Date(startDate);

        const existingRecord = await Attendance.findOne({
            rollNo: rollNumber,
            date: { $gte: startDate, $lte: endDate },
            teacherId,
            classroomId
        });

        if (existingRecord) {
            return res.status(200).json({ message: "Student already marked present.", record: existingRecord });
        }

        const newRecord = new Attendance({
            studentName: name,
            rollNo: rollNumber,
            date: attendanceDate,
            classroomId,
            teacherId
        });
        try {
            await newRecord.save();
        } catch (error) {
            if (error && error.code === 11000) {
                const existing = await Attendance.findOne({
                    rollNo: rollNumber,
                    date: { $gte: startDate, $lte: endDate },
                    teacherId,
                    classroomId
                });
                return res.status(200).json({ message: "Student already marked present.", record: existing });
            }
            throw error;
        }
        res.status(201).json({ message: "Student marked present successfully.", record: newRecord });
    } catch (error) {
        console.error("Manual mark error:", error);
        res.status(500).json({ error: "Failed to mark student." });
    }
});

// DELETE /attendance/unmark - remove attendance record
router.delete("/unmark", authMiddleware, async (req, res) => {
    try {
        const { rollNumber, date, classroomId } = req.body;
        const teacherId = req.teacher.id;

        if (!rollNumber || !date || !classroomId) {
            return res.status(400).json({ error: "rollNumber, date, and classroomId are required." });
        }

        // Validate classroom ownership
        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            return res.status(400).json({ error: classroomCheck.error });
        }

        const specificDate = parseDay(date);
        if (!specificDate) return res.status(400).json({ error: "Invalid date." });
        const startDate = new Date(new Date(specificDate).setHours(0, 0, 0, 0));
        const endDate = new Date(new Date(specificDate).setHours(23, 59, 59, 999));

        const result = await Attendance.findOneAndDelete({
            rollNo: rollNumber,
            date: { $gte: startDate, $lte: endDate },
            teacherId,
            classroomId
        });

        if (!result) {
            return res.status(404).json({ error: "No attendance record found for this student on this date." });
        }

        res.status(200).json({ message: "Student unmarked successfully." });
    } catch (error) {
        console.error("Manual unmark error:", error);
        res.status(500).json({ error: "Failed to unmark student." });
    }
});

// POST /attendance/diagnose - diagnose matching issues (auth required)
router.post("/diagnose", authMiddleware, upload.single("groupPhoto"), async (req, res) => {
    let absoluteImagePath = "";
    try {
        const teacherId = req.teacher.id;
        const { classroomId } = req.body;

        if (!req.file) return res.status(400).json({ error: "No group photo file uploaded." });

        // Validate classroom
        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ error: classroomCheck.error });
        }

        const groupImagePath = req.file.path;
        absoluteImagePath = groupImagePath;

        // Load students for this classroom
        const students = await Student.find({ classroomId });

        // Prepare enrolled descriptors for DeepFace
        const enrolledFaces = students
            .map((s) => {
                const descriptors =
                    s.faceDescriptors && s.faceDescriptors.length > 0
                        ? s.faceDescriptors
                        : s.faceDescriptor
                            ? [s.faceDescriptor]
                            : [];

                if (descriptors.length === 0) return null;
                return {
                    rollNumber: s.rollNumber,
                    name: s.name,
                    descriptors
                };
            })
            .filter(Boolean);

        if (enrolledFaces.length === 0) {
            if (fs.existsSync(groupImagePath)) fs.unlinkSync(groupImagePath);
            return res.status(400).json({ error: "No students are enrolled with face data in this classroom." });
        }

        // Call DeepFace diagnose endpoint
        let requestBody;

        if (isRemoteDeepFace) {
            // Remote service: send base64 image
            const imageBuffer = fs.readFileSync(absoluteImagePath);
            const base64Image = imageBuffer.toString('base64');
            requestBody = JSON.stringify({
                image_base64: base64Image,
                enrolled_faces: enrolledFaces
            });
        } else {
            // Local service: send file path
            requestBody = JSON.stringify({
                image_path: absoluteImagePath,
                enrolled_faces: enrolledFaces
            });
        }

        let response;
        try {
            response = await callFaceService("/diagnose", requestBody);
        } catch (error) {
            safeUnlink(absoluteImagePath);
            return res.status(503).json({ error: error.message });
        }

        const diagnosisResult = await response.json().catch(() => ({}));

        // Clean up uploaded image
        if (fs.existsSync(absoluteImagePath)) {
            fs.unlinkSync(absoluteImagePath);
        }

        if (!response.ok) {
            return res.status(500).json({ error: diagnosisResult.error || "Failed to diagnose" });
        }

        res.json({
            success: true,
            classroomId,
            classroomName: classroomCheck.classroom.name,
            enrolledStudents: enrolledFaces.map(f => ({
                rollNumber: f.rollNumber,
                name: f.name,
                numPhotos: f.descriptors.length
            })),
            ...diagnosisResult
        });

    } catch (err) {
        console.error("Diagnose error:", err);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        if (absoluteImagePath && fs.existsSync(absoluteImagePath)) {
            fs.unlinkSync(absoluteImagePath);
        }
        res.status(500).json({ error: "Error diagnosing face matching" });
    }
});

module.exports = router;
