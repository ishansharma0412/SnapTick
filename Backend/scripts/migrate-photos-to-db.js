/**
 * Migration: move student reference photos from Backend/uploads into MongoDB (GridFS).
 *
 * Older records store a file name in Student.image. After this script every
 * student points at a photo inside the database, so photos survive restarts on
 * hosts without a persistent disk and travel with database backups.
 *
 * Usage:
 *   cd Backend
 *   node scripts/migrate-photos-to-db.js            # migrate
 *   node scripts/migrate-photos-to-db.js --dry-run  # report only
 */

require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const Student = require("../models/student");
const { savePhoto, isStored } = require("../storage/photos");

const DRY_RUN = process.argv.includes("--dry-run");
const UPLOADS_DIR = path.join(__dirname, "../uploads");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const students = await Student.find({}, "name rollNumber image teacherId classroomId");
  let moved = 0, already = 0;
  const missing = [];

  for (const s of students) {
    if (isStored(s.image)) {
      already++;
      continue;
    }
    const filePath = s.image ? path.join(UPLOADS_DIR, path.basename(s.image)) : null;
    if (!filePath || !fs.existsSync(filePath)) {
      missing.push(`${s.rollNumber} ${s.name}`);
      continue;
    }
    if (!DRY_RUN) {
      const ref = await savePhoto(fs.readFileSync(filePath), { teacherId: s.teacherId, classroomId: s.classroomId });
      await Student.updateOne({ _id: s._id }, { $set: { image: ref } });
      fs.unlinkSync(filePath);
    }
    moved++;
    console.log(`  ✓ ${s.rollNumber} ${s.name}`);
  }

  console.log(`${DRY_RUN ? "[dry run] would move" : "Moved"} ${moved}, already in database ${already}, missing ${missing.length}`);
  missing.forEach((m) => console.log(`  ✗ photo file missing: ${m}`));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
