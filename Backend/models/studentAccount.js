// Model: StudentAccount — a student's login for the student portal.
// Linked to every Student record (one per classroom) with the same roll number.
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const studentAccountSchema = new mongoose.Schema({
  rollNumber: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  resetCodeHash: { type: String },
  resetExpires: { type: Date },
  resetAttempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
});

studentAccountSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, await bcrypt.genSalt(10));
  next();
});

studentAccountSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

studentAccountSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.resetCodeHash;
  delete obj.resetExpires;
  delete obj.resetAttempts;
  return obj;
};

module.exports = mongoose.model("StudentAccount", studentAccountSchema);
