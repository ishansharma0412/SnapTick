// Model: Teacher
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const teacherSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["teacher", "admin"], default: "teacher" },
  department: { type: String, default: "", trim: true },
  // Password reset one-time code (hashed) and its expiry
  resetCodeHash: { type: String },
  resetExpires: { type: Date },
  resetAttempts: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date }
});

// Hash the password before saving
teacherSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Password verification helper
teacherSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove sensitive fields from JSON output
teacherSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.resetCodeHash;
  delete obj.resetExpires;
  delete obj.resetAttempts;
  return obj;
};

module.exports = mongoose.model("Teacher", teacherSchema);
