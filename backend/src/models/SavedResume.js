const mongoose = require("mongoose");

const savedResumeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 255 },
  content: { type: String, required: true, maxlength: 30000, select: false },
}, { timestamps: true });

module.exports = mongoose.model("SavedResume", savedResumeSchema);
