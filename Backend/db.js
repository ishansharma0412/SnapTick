const mongoose = require("mongoose");
require("dotenv").config();

// Mongoose reconnects automatically after a connection drops, but not when the
// very first connection fails (e.g. the database is briefly unreachable at boot).
// Retry the initial connection with a capped backoff so the API heals by itself.
const connectDB = async (attempt = 1) => {
  const uri = process.env.MONGO_URI;
  if (attempt === 1) console.log("🔍 Mongo URI:", uri ? "Found" : "Missing");

  if (!uri) {
    console.error("❌ MONGO_URI is not defined. Set it in Backend/.env or the host's environment.");
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log("✅ MongoDB connected successfully");
    await migrateIndexes();
  } catch (error) {
    const delay = Math.min(30000, 2000 * attempt);
    console.error(`❌ MongoDB connection failed (attempt ${attempt}): ${error.message}. Retrying in ${delay / 1000}s`);
    setTimeout(() => connectDB(attempt + 1), delay);
  }
};

// Attendance moved from one record per day to one per (day, period): replace the old
// unique index so a second lecture on the same day is not rejected as a duplicate.
async function migrateIndexes() {
  try {
    const Attendance = require("./models/attendance");
    const existing = await Attendance.collection.indexes().catch(() => []);
    if (existing.some((i) => i.name === "rollNo_1_classroomId_1_teacherId_1_date_1")) {
      await Attendance.collection.dropIndex("rollNo_1_classroomId_1_teacherId_1_date_1");
      console.log("🔧 Dropped old one-per-day attendance index");
    }
    await Attendance.syncIndexes();
  } catch (err) {
    console.error("Index migration failed:", err.message);
  }
}

mongoose.connection.on("disconnected", () => console.warn("⚠️  MongoDB disconnected; waiting for reconnect"));
mongoose.connection.on("reconnected", () => console.log("✅ MongoDB reconnected"));

module.exports = connectDB;
