// Model: Student
const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rollNumber: { type: String, required: true },
  image: { type: String },

  // Face embeddings (legacy + current formats)
  faceDescriptors: { type: [[Number]], default: [] },
  faceDescriptor: { type: [Number] },
  descriptorCount: { type: Number, default: 0 },

  // Ownership and classroom linkage
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: "Classroom", required: true },

  // Contact details (optional, from roster import) used for portal sign-up and alerts
  email: { type: String, default: "", lowercase: true, trim: true },
  phone: { type: String, default: "", trim: true },
  guardianEmail: { type: String, default: "", lowercase: true, trim: true },
  guardianPhone: { type: String, default: "", trim: true },
  // When the teacher confirmed the student consented to face enrolment
  consentAt: { type: Date },
  dateAdded: { type: Date, default: Date.now },
});

// Ensure roll numbers are unique within a classroom
studentSchema.index({ rollNumber: 1, classroomId: 1 }, { unique: true });
studentSchema.index({ rollNumber: 1 });

module.exports = mongoose.model("Student", studentSchema);
