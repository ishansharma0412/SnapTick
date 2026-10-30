/**
 * Re-embed every enrolled student with the current face model.
 *
 * Needed after switching face models (embeddings from different models are
 * not comparable). Each student's stored enrollment photo is sent to the face
 * service and their descriptors are replaced with the new embedding.
 * Existing descriptors are backed up to Backend/backups/ first.
 *
 * Usage (face service must be running):
 *   cd Backend
 *   node scripts/reembed-all.js
 *
 * Options:
 *   --dry-run  Embed and report, but do not write to the database
 */

require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const Student = require("../models/student");
const { readPhoto } = require("../storage/photos");

const DRY_RUN = process.argv.includes("--dry-run");
const DEEPFACE_URL = process.env.DEEPFACE_URL || "http://localhost:5001";
const BACKUP_DIR = path.join(__dirname, "../backups");

async function main() {
  const health = await fetch(`${DEEPFACE_URL}/health`).then((r) => r.json());
  console.log(`Face service: ${health.model} (${DEEPFACE_URL})${DRY_RUN ? " [dry run]" : ""}`);

  await mongoose.connect(process.env.MONGO_URI);
  const students = await Student.find({}).lean();
  console.log(`Students: ${students.length}`);

  if (!DRY_RUN && students.length) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backupFile = path.join(BACKUP_DIR, `descriptors-${Date.now()}.json`);
    fs.writeFileSync(
      backupFile,
      JSON.stringify(students.map((s) => ({ _id: s._id, faceDescriptors: s.faceDescriptors, faceDescriptor: s.faceDescriptor })))
    );
    console.log(`Backup: ${backupFile}`);
  }

  let ok = 0;
  const failed = [];
  for (const s of students) {
    const photo = await readPhoto(s.image);
    if (!photo) {
      failed.push(`${s.rollNumber} ${s.name}: enrollment photo missing`);
      continue;
    }
    const res = await fetch(`${DEEPFACE_URL}/extract-embedding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: photo.buffer.toString("base64") }),
    });
    const data = await res.json();
    if (!res.ok || !data.embedding) {
      failed.push(`${s.rollNumber} ${s.name}: ${data.error || res.status}`);
      continue;
    }
    if (!DRY_RUN) {
      await Student.updateOne(
        { _id: s._id },
        { $set: { faceDescriptors: [data.embedding], faceDescriptor: data.embedding, descriptorCount: 1 } }
      );
    }
    ok++;
    console.log(`  ✓ ${s.rollNumber} ${s.name}`);
  }

  console.log(`Re-embedded ${ok}/${students.length}`);
  failed.forEach((f) => console.log(`  ✗ ${f}`));
  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Re-embed failed:", err.message);
  process.exit(1);
});
