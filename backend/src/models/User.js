const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  verified: { type: Boolean, default: false },
  otpHash: { type: String, select: false },
  otpPurpose: { type: String, enum: ["verify", "reset"] },
  otpExpiresAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
