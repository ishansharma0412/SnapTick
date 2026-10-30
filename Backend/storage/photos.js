// Student reference photos stored in MongoDB GridFS.
// Keeping photos in the database means they survive restarts on hosts without a
// persistent disk and are included in every database backup.
//
// Student.image holds either "gridfs:<ObjectId>" (current) or a legacy file name
// inside Backend/uploads (older records, see scripts/migrate-photos-to-db.js).
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const UPLOADS_DIR = path.join(__dirname, "../uploads");
const PREFIX = "gridfs:";

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "photos" });
}

function isStored(image) {
  return typeof image === "string" && image.startsWith(PREFIX);
}

/** Save an image buffer; returns the value to store in Student.image. */
function savePhoto(buffer, { contentType = "image/jpeg", teacherId, classroomId } = {}) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream("student-photo", {
      metadata: { contentType, teacherId: String(teacherId || ""), classroomId: String(classroomId || "") },
    });
    upload.on("error", reject);
    upload.on("finish", () => resolve(PREFIX + upload.id.toString()));
    upload.end(buffer);
  });
}

/** Save an image file from disk and remove the file afterwards. */
async function savePhotoFromFile(filePath, meta) {
  const buffer = await fs.promises.readFile(filePath);
  const ref = await savePhoto(buffer, meta);
  await fs.promises.unlink(filePath).catch(() => {});
  return ref;
}

/** Read a student's photo as { buffer, contentType }, or null if it is missing. */
async function readPhoto(image) {
  if (!image) return null;
  if (isStored(image)) {
    const id = image.slice(PREFIX.length);
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const objectId = new mongoose.Types.ObjectId(id);
    const files = await bucket().find({ _id: objectId }).limit(1).toArray();
    if (!files.length) return null;
    const chunks = [];
    await new Promise((resolve, reject) => {
      bucket().openDownloadStream(objectId)
        .on("data", (c) => chunks.push(c))
        .on("error", reject)
        .on("end", resolve);
    });
    return { buffer: Buffer.concat(chunks), contentType: files[0].metadata?.contentType || "image/jpeg" };
  }
  // Legacy: plain file name inside the uploads folder (no path components allowed)
  const filePath = path.join(UPLOADS_DIR, path.basename(image));
  try {
    return { buffer: await fs.promises.readFile(filePath), contentType: "image/jpeg" };
  } catch {
    return null;
  }
}

/** Delete a stored photo; ignores missing files. */
async function deletePhoto(image) {
  if (!image) return;
  try {
    if (isStored(image)) {
      const id = image.slice(PREFIX.length);
      if (mongoose.Types.ObjectId.isValid(id)) await bucket().delete(new mongoose.Types.ObjectId(id));
    } else {
      await fs.promises.unlink(path.join(UPLOADS_DIR, path.basename(image)));
    }
  } catch {
    // already gone
  }
}

module.exports = { savePhoto, savePhotoFromFile, readPhoto, deletePhoto, isStored };
