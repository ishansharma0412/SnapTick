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
const { buildReport, dayKey } = require("../services/reports");
const { audit } = require("../services/audit");
const { sendMail, mailConfigured } = require("../services/mailer");

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
    limits: { fileSize: 8 * 1024 * 1024, files: 3 },
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

// Up to three photos per scan, for large halls that do not fit in one frame
const MAX_PHOTOS = 3;

// Past attendance can be edited for this long; after that an admin must re-open the day
const EDIT_LOCK_HOURS = Number(process.env.EDIT_LOCK_HOURS || 48);

function parsePeriod(value) {
    const n = parseInt(value, 10);
    return n >= 1 && n <= 12 ? n : 1;
}

/** True if records for this day may still be edited in this classroom. */
function isEditable(classroom, day) {
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    if (Date.now() - dayEnd.getTime() <= EDIT_LOCK_HOURS * 3600 * 1000) return true;
    const key = dayKey(day);
    return (classroom.unlocked || []).some((u) => u.day === key && new Date(u.until) > new Date());
}
const LOCKED_MESSAGE = `Attendance older than ${EDIT_LOCK_HOURS} hours is locked. Ask an admin to re-open this day.`;

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

// POST /attendance/upload - detect and match faces in up to three class photos (auth required)
// Returns matches for review; nothing is written to the register here.
router.post("/upload", authMiddleware, upload.array("groupPhoto", MAX_PHOTOS), async (req, res) => {
    const files = req.files || [];
    const cleanup = () => files.forEach((f) => safeUnlink(f.path));
    try {
        const teacherId = req.teacher.id;
        const { classroomId } = req.body;
        const period = parsePeriod(req.body.period);

        if (!files.length) return res.status(400).json({ error: "No class photograph was uploaded." });

        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            cleanup();
            return res.status(400).json({ error: classroomCheck.error });
        }

        const students = await Student.find({ classroomId });
        const enrolledFaces = students
            .map((s) => {
                const descriptors = s.faceDescriptors?.length ? s.faceDescriptors : s.faceDescriptor?.length ? [s.faceDescriptor] : [];
                return descriptors.length ? { rollNumber: s.rollNumber, descriptors } : null;
            })
            .filter(Boolean);

        if (enrolledFaces.length === 0) {
            cleanup();
            return res.status(400).json({ error: "No student in this classroom has a face enrolled yet. Add photos on the Students tab." });
        }

        const studentMap = new Map(students.map((st) => [st.rollNumber, st]));
        const photos = [];
        let detections = [];

        for (const [photoIndex, file] of files.entries()) {
            let matchResult;
            try {
                matchResult = await matchFaces(file.path, enrolledFaces);
            } catch (error) {
                cleanup();
                return res.status(503).json({ error: error.message || "Failed to process faces" });
            }

            const img = await loadImage(file.path);
            const base = path.parse(file.filename).name;
            photos.push({ img, base, file });

            matchResult.matches.forEach((match, i) => {
                const fa = match.facial_area;
                const box = { x: fa.x || 0, y: fa.y || 0, width: fa.w || 100, height: fa.h || 100 };

                // Padded crop so the teacher can see each face on the review screen
                const pad = Math.round(Math.max(box.width, box.height) * 0.4);
                const sx = Math.max(0, box.x - pad);
                const sy = Math.max(0, box.y - pad);
                const sw = Math.min(img.width - sx, box.width + pad * 2);
                const sh = Math.min(img.height - sy, box.height + pad * 2);
                const scale = Math.min(1, 256 / Math.max(sw, sh));
                const crop = createCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
                crop.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
                const faceImage = `facecrop-${base}-${i}.jpg`;
                fs.writeFileSync(path.join(UPLOADS_DIR, faceImage), crop.toBuffer("image/jpeg", { quality: 0.9 }));

                const student = match.is_recognized ? studentMap.get(match.roll_number) : null;
                const confidence = typeof match.confidence === "number"
                    ? match.confidence
                    : Math.max(0, Math.min(100, Math.round((1 - match.distance / 0.8) * 100)));
                detections.push({
                    photoIndex,
                    facialArea: box,
                    match: {
                        studentId: student ? student._id.toString() : null,
                        name: student ? student.name : "Unknown",
                        rollNumber: student ? student.rollNumber : null,
                        distance: match.distance,
                        confidence,
                        status: student ? "matched" : "unknown",
                    },
                    faceImage,
                    faceImageUrl: `${BASE_URL}/uploads/${faceImage}`,
                    embedding: match.embedding,
                });
            });
        }

        // A student can only be present once: across photos keep their closest face
        const best = new Map();
        detections.forEach((d, i) => {
            const id = d.match.studentId;
            if (id && (!best.has(id) || d.match.distance < detections[best.get(id)].match.distance)) best.set(id, i);
        });
        detections = detections.filter((d, i) => !d.match.studentId || best.get(d.match.studentId) === i);
        detections.forEach((d, i) => (d.faceIndex = i));

        // Annotated copy of each photo (green = recognised, red = unknown)
        const markedImageUrls = photos.map(({ img, base, file }, photoIndex) => {
            const canvas = createCanvas(img.width, img.height);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            for (const d of detections.filter((x) => x.photoIndex === photoIndex)) {
                const { x, y, width, height } = d.facialArea;
                const color = d.match.status === "matched" ? "#16a34a" : "#dc2626";
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.strokeRect(x, y, width, height);
                const label = d.match.status === "matched" ? d.match.name : `#${d.faceIndex + 1}`;
                const fontSize = Math.max(16, Math.round(height / 6));
                ctx.font = `${fontSize}px sans-serif`;
                const tw = ctx.measureText(label).width;
                const lx = Math.max(0, Math.min(x, img.width - tw - 8));
                const ly = Math.max(0, y - fontSize - 6);
                ctx.fillStyle = color;
                ctx.fillRect(lx, ly, tw + 8, fontSize + 6);
                ctx.fillStyle = "#ffffff";
                ctx.fillText(label, lx + 4, ly + fontSize);
            }
            const name = `marked-${base}.jpg`;
            const out = path.join(UPLOADS_DIR, name);
            fs.writeFileSync(out, canvas.toBuffer("image/jpeg"));
            setTimeout(() => safeUnlink(out), 10 * 60 * 1000);
            safeUnlink(file.path);
            return `${BASE_URL}/uploads/${name}`;
        });

        // Students already marked for this lecture today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const todayRecords = await Attendance.find(
            { classroomId, teacherId, period, date: { $gte: todayStart, $lte: todayEnd } },
            "rollNo"
        ).lean();

        res.json({
            success: true,
            reviewMode: true,
            period,
            detections,
            alreadyPresent: todayRecords.map((r) => r.rollNo),
            markedImageUrl: markedImageUrls[0],
            markedImageUrls,
            faceCount: detections.length,
            recognizedCount: detections.filter((d) => d.match.status === "matched").length,
            classroomId,
            classroomName: classroomCheck.classroom.name,
            enrolledStudents: students.map((st) => ({
                _id: st._id.toString(),
                name: st.name,
                rollNumber: st.rollNumber,
                hasFace: Boolean(st.faceDescriptors?.length),
            })),
        });
    } catch (err) {
        console.error("Attendance error:", err);
        cleanup();
        res.status(500).json({ error: "Error processing attendance" });
    }
});


// POST /attendance/confirm - confirm detections and mark attendance (auth required)
// Called after review of /upload detections
router.post("/confirm", authMiddleware, async (req, res) => {
    try {
        const teacherId = req.teacher.id;
        const { classroomId, confirmations, manualStudentIds = [] } = req.body;
        const period = parsePeriod(req.body.period);

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

        // Load existing attendance records for this lecture
        const existingRecords = await Attendance.find({
            date: { $gte: startDate, $lte: endDate },
            teacherId,
            classroomId,
            period
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
            const { studentId, action, addToTraining, embedding, faceImage } = confirmation;

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
                        period,
                        markedBy: action === "manual" ? "manual" : "scan",
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

            // Students imported from a roster have no reference photo yet: use this face
            if (!student.image && typeof faceImage === "string" && /^facecrop-[\w.-]+\.jpg$/.test(faceImage)) {
                const cropPath = path.join(UPLOADS_DIR, faceImage);
                if (fs.existsSync(cropPath)) {
                    student.image = await savePhoto(await fs.promises.readFile(cropPath), { teacherId, classroomId });
                    if (!student.consentAt) student.consentAt = new Date();
                    await student.save();
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

        audit(req.teacher, "attendance.confirm", {
            classroomId,
            details: { period, marked: markedStudents.map((m) => m.rollNo), alreadyPresent: alreadyPresentStudents.length },
        });

        res.json({
            success: true,
            period,
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

        const query = { date: { $gte: startDate, $lte: endDate }, teacherId, classroomId };
        if (req.query.period) query.period = parsePeriod(req.query.period);
        const records = await Attendance.find(query).lean();
        res.status(200).json(records.map((r) => ({ ...r, period: r.period || 1, status: r.status || "present" })));
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
        if (req.body.consent !== true) {
            return res.status(400).json({ error: "Confirm that the student has consented to face enrolment." });
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
            consentAt: new Date(),
            teacherId,
            classroomId,
        });
        audit(req.teacher, "student.enroll_from_scan", { classroomId, target: student.rollNumber, details: { name: student.name } });

        res.status(201).json({
            message: "Student added",
            student: { _id: student._id.toString(), name: student.name, rollNumber: student.rollNumber },
        });
    } catch (error) {
        console.error("Enroll from face error:", error);
        res.status(500).json({ error: "Failed to add student" });
    }
});



// GET /attendance/overview - today's attendance and 30-day average for every classroom of the teacher
router.get("/overview", authMiddleware, async (req, res) => {
    try {
        const teacherId = req.teacher.id;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const monthStart = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);

        const classrooms = await Classroom.find({ teacherId }).lean();
        const todays = await Attendance.find(
            { teacherId, date: { $gte: todayStart, $lte: todayEnd }, status: { $ne: "medical_leave" } },
            { classroomId: 1, rollNo: 1 }
        ).lean();

        const rows = [];
        for (const c of classrooms) {
            const report = await buildReport(c, monthStart, todayEnd);
            const presentToday = new Set(todays.filter((r) => String(r.classroomId) === String(c._id)).map((r) => r.rollNo)).size;
            const lastDay = report.days.length ? report.days[report.days.length - 1].date : null;
            rows.push({
                classroomId: String(c._id),
                name: c.name,
                students: report.totalStudents,
                presentToday,
                takenToday: report.days.some((d) => d.date === dayKey(todayStart)),
                sessions30d: report.totalSessions,
                average30d: report.totalStudents && report.totalSessions ? report.classAverage : null,
                defaulters30d: report.defaulterCount,
                lastTaken: lastDay,
                schedule: c.schedule || [],
            });
        }

        const totalStudents = rows.reduce((a, r) => a + r.students, 0);
        const presentToday = rows.reduce((a, r) => a + r.presentToday, 0);
        const studentsInTakenClasses = rows.filter((r) => r.takenToday).reduce((a, r) => a + r.students, 0);
        const averaged = rows.filter((r) => r.average30d !== null);
        const round1 = (n) => Math.round(n * 10) / 10;

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
// A "session" is one (day, period) on which attendance was taken in the classroom.
router.get("/report", authMiddleware, async (req, res) => {
    try {
        const range = await reportRange(req, res);
        if (!range) return;
        res.json(await buildReport(range.classroom, range.startDate, range.endDate));
    } catch (error) {
        console.error("Attendance report error:", error);
        res.status(500).json({ error: "Failed to build attendance report." });
    }
});

/** Validate classroom + from/to query params; responds with an error and returns null if invalid. */
async function reportRange(req, res) {
    const { classroomId, from, to } = req.query;
    const classroomCheck = await verifyClassroom(classroomId, req.teacher.id);
    if (!classroomCheck.valid) {
        res.status(400).json({ error: classroomCheck.error });
        return null;
    }
    const endDate = to ? parseDay(to) : new Date();
    const startDate = from ? parseDay(from) : endDate && new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);
    if (!startDate || !endDate) {
        res.status(400).json({ error: "Invalid from/to date." });
        return null;
    }
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    if (startDate > endDate) {
        res.status(400).json({ error: "'from' must be before 'to'." });
        return null;
    }
    return { classroom: classroomCheck.classroom, startDate, endDate };
}

// POST /attendance/mark - mark or update one student's record for a day and period
// body: { rollNumber, name, date, classroomId, period?, status? }
router.post("/mark", authMiddleware, async (req, res) => {
    try {
        const { rollNumber, name, date, classroomId } = req.body;
        const period = parsePeriod(req.body.period);
        const status = ["present", "duty_leave", "medical_leave"].includes(req.body.status) ? req.body.status : "present";
        const teacherId = req.teacher.id;

        if (!rollNumber || !name || !date || !classroomId) {
            return res.status(400).json({ error: "rollNumber, name, date, and classroomId are required." });
        }

        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            return res.status(400).json({ error: classroomCheck.error });
        }

        const specificDate = parseDay(date);
        if (!specificDate) return res.status(400).json({ error: "Invalid date." });
        if (specificDate > new Date()) return res.status(400).json({ error: "Attendance cannot be marked for a future date." });
        if (!isEditable(classroomCheck.classroom, specificDate)) return res.status(423).json({ error: LOCKED_MESSAGE });

        const startDate = new Date(new Date(specificDate).setHours(0, 0, 0, 0));
        const endDate = new Date(new Date(specificDate).setHours(23, 59, 59, 999));
        const filter = { rollNo: rollNumber, classroomId, teacherId, period, date: { $gte: startDate, $lte: endDate } };

        const existing = await Attendance.findOne(filter);
        if (existing) {
            if (existing.status === status) {
                return res.status(200).json({ message: "Already recorded.", record: existing });
            }
            const previous = existing.status;
            existing.status = status;
            await existing.save();
            audit(req.teacher, "attendance.status", { classroomId, target: rollNumber, details: { day: dayKey(startDate), period, from: previous, to: status } });
            return res.status(200).json({ message: "Record updated.", record: existing });
        }

        try {
            const record = await Attendance.create({
                studentName: name, rollNo: rollNumber, date: startDate, period, status, markedBy: "manual", classroomId, teacherId,
            });
            audit(req.teacher, "attendance.mark", { classroomId, target: rollNumber, details: { day: dayKey(startDate), period, status } });
            return res.status(201).json({ message: "Student marked.", record });
        } catch (error) {
            if (error?.code === 11000) {
                return res.status(200).json({ message: "Already recorded.", record: await Attendance.findOne(filter) });
            }
            throw error;
        }
    } catch (error) {
        console.error("Manual mark error:", error);
        res.status(500).json({ error: "Failed to mark student." });
    }
});

// DELETE /attendance/unmark - remove a student's record for a day and period (mark absent)
router.delete("/unmark", authMiddleware, async (req, res) => {
    try {
        const { rollNumber, date, classroomId } = req.body;
        const period = parsePeriod(req.body.period);
        const teacherId = req.teacher.id;

        if (!rollNumber || !date || !classroomId) {
            return res.status(400).json({ error: "rollNumber, date, and classroomId are required." });
        }

        const classroomCheck = await verifyClassroom(classroomId, teacherId);
        if (!classroomCheck.valid) {
            return res.status(400).json({ error: classroomCheck.error });
        }

        const specificDate = parseDay(date);
        if (!specificDate) return res.status(400).json({ error: "Invalid date." });
        if (!isEditable(classroomCheck.classroom, specificDate)) return res.status(423).json({ error: LOCKED_MESSAGE });

        const startDate = new Date(new Date(specificDate).setHours(0, 0, 0, 0));
        const endDate = new Date(new Date(specificDate).setHours(23, 59, 59, 999));
        const result = await Attendance.findOneAndDelete({
            rollNo: rollNumber, classroomId, teacherId, period, date: { $gte: startDate, $lte: endDate },
        });

        if (!result) {
            return res.status(404).json({ error: "No attendance record found for this student on this date." });
        }
        audit(req.teacher, "attendance.unmark", { classroomId, target: rollNumber, details: { day: dayKey(startDate), period, was: result.status } });
        res.status(200).json({ message: "Student marked absent." });
    } catch (error) {
        console.error("Manual unmark error:", error);
        res.status(500).json({ error: "Failed to unmark student." });
    }
});

// GET /attendance/audit - recent changes in a classroom (owner)
router.get("/audit", authMiddleware, async (req, res) => {
    try {
        const { classroomId } = req.query;
        const classroomCheck = await verifyClassroom(classroomId, req.teacher.id);
        if (!classroomCheck.valid) return res.status(400).json({ error: classroomCheck.error });
        const AuditLog = require("../models/auditLog");
        const entries = await AuditLog.find({ classroomId }).sort({ createdAt: -1 }).limit(Math.min(500, Number(req.query.limit) || 100)).lean();
        res.json(entries);
    } catch (error) {
        console.error("Audit fetch error:", error);
        res.status(500).json({ error: "Failed to load activity." });
    }
});

// GET /attendance/register.xlsx - attendance register (students × lectures) as an Excel file
router.get("/register.xlsx", authMiddleware, async (req, res) => {
    try {
        const range = await reportRange(req, res);
        if (!range) return;
        const { classroom, startDate, endDate } = range;
        const report = await buildReport(classroom, startDate, endDate);
        const records = await Attendance.find(
            { classroomId: classroom._id, teacherId: classroom.teacherId, date: { $gte: startDate, $lte: endDate } },
            { rollNo: 1, date: 1, period: 1, status: 1 }
        ).lean();
        const cell = new Map(records.map((r) => [`${r.rollNo}|${dayKey(r.date)}#${r.period || 1}`, r.status || "present"]));
        const CODE = { present: "P", duty_leave: "DL", medical_leave: "ML" };

        const ExcelJS = require("exceljs");
        const wb = new ExcelJS.Workbook();
        wb.creator = "SnapTick";
        const ws = wb.addWorksheet("Register", { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
        ws.addRow([`${classroom.name}${classroom.subjectCode ? " (" + classroom.subjectCode + ")" : ""} — Attendance Register`]).font = { bold: true, size: 14 };
        ws.addRow([`Period: ${report.from} to ${report.to}   ·   Minimum required: ${report.threshold}%   ·   P = present, DL = duty leave, ML = medical leave, A = absent`]);
        ws.addRow([]);
        const sessions = report.days.map((d) => `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}${report.days.filter((x) => x.date === d.date).length > 1 ? " L" + d.period : ""}`);
        const header = ws.addRow(["Roll No.", "Name", ...sessions, "Attended", "Total", "%", "Status"]);
        header.font = { bold: true };
        header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        const STATUS = { good: "Eligible", warning: "At risk", critical: "Defaulter", "no-data": "—" };
        for (const st of report.students) {
            const marks = report.days.map((d) => CODE[cell.get(`${st.rollNumber}|${d.date}#${d.period}`)] || "A");
            const row = ws.addRow([st.rollNumber, st.name, ...marks, st.present, st.totalSessions, st.percentage, STATUS[st.status]]);
            marks.forEach((m, i) => {
                const c = row.getCell(3 + i);
                c.alignment = { horizontal: "center" };
                if (m === "A") c.font = { color: { argb: "FFB3261E" }, bold: true };
            });
            if (st.status === "critical" || st.status === "warning") {
                row.getCell(3 + marks.length + 3).font = { bold: true, color: { argb: st.status === "critical" ? "FFB3261E" : "FFB26A00" } };
            }
        }
        ws.getColumn(1).width = 16;
        ws.getColumn(2).width = 26;
        for (let i = 3; i < 3 + sessions.length; i++) ws.getColumn(i).width = 6.5;
        ws.eachRow((row, n) => {
            if (n >= 4) row.eachCell((c) => (c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } }));
        });

        const safe = classroom.name.replace(/[^\w-]+/g, "_");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${safe}_register_${report.from}_to_${report.to}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("Register export error:", error);
        if (!res.headersSent) res.status(500).json({ error: "Failed to build the register." });
    }
});

/** Plain-text attendance warning for a student (used for email and WhatsApp). */
function alertText(report, st, forGuardian = false) {
    const who = forGuardian ? `your ward ${st.name} (${st.rollNumber})` : `you`;
    return `Attendance notice — ${report.classroom.name}\n\n` +
        `Between ${report.from} and ${report.to}, ${who} attended ${st.present} of ${st.totalSessions} lectures (${st.percentage}%). ` +
        `The minimum required is ${report.threshold}%.` +
        (st.percentage < report.threshold ? ` Please attend regularly to remain eligible for examinations.` : "") +
        `\n\n— Sent via SnapTick`;
}

// GET /attendance/alerts - students below the threshold, with contact details and message text
router.get("/alerts", authMiddleware, async (req, res) => {
    try {
        const range = await reportRange(req, res);
        if (!range) return;
        const report = await buildReport(range.classroom, range.startDate, range.endDate);
        const StudentAccount = require("../models/studentAccount");
        const accounts = await StudentAccount.find({ rollNumber: { $in: report.students.map((s) => s.rollNumber) } }, "rollNumber email").lean();
        const accountEmail = new Map(accounts.map((a) => [a.rollNumber, a.email]));
        const students = report.students
            .filter((s) => s.status === "warning" || s.status === "critical")
            .map((s) => ({
                ...s,
                email: s.email || accountEmail.get(s.rollNumber) || "",
                message: alertText(report, s),
                guardianMessage: alertText(report, s, true),
            }));
        res.json({ threshold: report.threshold, from: report.from, to: report.to, mailConfigured, students });
    } catch (error) {
        console.error("Alerts error:", error);
        res.status(500).json({ error: "Failed to prepare alerts." });
    }
});

// POST /attendance/alerts/send - email the warning to students (and optionally guardians)
// body: { classroomId, from, to, includeGuardians, rollNumbers? }
router.post("/alerts/send", authMiddleware, async (req, res) => {
    try {
        req.query = { ...req.query, classroomId: req.body.classroomId, from: req.body.from, to: req.body.to };
        const range = await reportRange(req, res);
        if (!range) return;
        const report = await buildReport(range.classroom, range.startDate, range.endDate);
        const StudentAccount = require("../models/studentAccount");
        const accounts = await StudentAccount.find({ rollNumber: { $in: report.students.map((s) => s.rollNumber) } }, "rollNumber email").lean();
        const accountEmail = new Map(accounts.map((a) => [a.rollNumber, a.email]));
        const only = Array.isArray(req.body.rollNumbers) ? new Set(req.body.rollNumbers) : null;

        let sent = 0, logged = 0, skipped = 0;
        for (const st of report.students) {
            if (!(st.status === "warning" || st.status === "critical")) continue;
            if (only && !only.has(st.rollNumber)) continue;
            const targets = [[st.email || accountEmail.get(st.rollNumber), false]];
            if (req.body.includeGuardians) targets.push([st.guardianEmail, true]);
            for (const [to, guardian] of targets) {
                if (!to) { skipped++; continue; }
                const r = await sendMail({ to, subject: `Attendance notice: ${report.classroom.name}`, text: alertText(report, st, guardian) });
                if (r.sent) sent++; else if (r.logged) logged++;
            }
        }
        audit(req.teacher, "alerts.send", { classroomId: range.classroom._id, details: { sent, logged, skipped } });
        res.json({ message: mailConfigured ? `Sent ${sent} email(s); ${skipped} without an email address.` : `Email is not configured on the server; ${logged} message(s) were written to the server log.`, sent, logged, skipped });
    } catch (error) {
        console.error("Alerts send error:", error);
        res.status(500).json({ error: "Failed to send alerts." });
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
