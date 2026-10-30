// Model: Holiday — college-wide days without lectures (managed by admins).
const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema({
  day: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  label: { type: String, required: true, trim: true, maxlength: 100 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher" },
});

module.exports = mongoose.model("Holiday", holidaySchema);
