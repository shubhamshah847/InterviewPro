const mongoose = require("mongoose");

const interviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  resumeId: { type: mongoose.Schema.Types.ObjectId, ref: "SavedResume", default: null },
  role: { type: String, required: true, trim: true, maxlength: 100 },
  difficulty: { type: String, enum: ["Beginner", "Intermediate", "Advanced"], required: true },
  duration: { type: Number, enum: [10, 20, 30, 45], required: true },
  mode: { type: String, enum: ["mock", "guided"], default: "mock" },
  voiceStyle: { type: String, enum: ["feminine", "masculine"], default: "feminine" },
  language: { type: String, enum: ["English", "Hindi"], default: "English" },
  avatarSessionId: { type: String, default: null, select: false },
  resumeText: { type: String, maxlength: 30000, select: false },
  status: { type: String, enum: ["in-progress", "completed"], default: "in-progress" },
  questions: [{
    question: { type: String, required: true, maxlength: 2000 },
    answer: { type: String, maxlength: 10000 },
    feedback: { type: String, maxlength: 2000 },
    score: { type: Number, min: 0, max: 100 },
    answerFramework: [{ type: String, maxlength: 300 }],
    sampleAnswer: { type: String, maxlength: 2500 },
    dimensionScores: {
      technicalAccuracy: { type: Number, min: 0, max: 100 },
      communicationClarity: { type: Number, min: 0, max: 100 },
      answerStructure: { type: Number, min: 0, max: 100 },
      problemSolving: { type: Number, min: 0, max: 100 },
      roleRelevance: { type: Number, min: 0, max: 100 },
      languageFluency: { type: Number, min: 0, max: 100 },
    },
  }],
  summary: {
    score: { type: Number, min: 0, max: 100 },
    dimensionScores: {
      technicalAccuracy: { type: Number, min: 0, max: 100 },
      communicationClarity: { type: Number, min: 0, max: 100 },
      answerStructure: { type: Number, min: 0, max: 100 },
      problemSolving: { type: Number, min: 0, max: 100 },
      roleRelevance: { type: Number, min: 0, max: 100 },
      languageFluency: { type: Number, min: 0, max: 100 },
    },
    strengths: [{ type: String, maxlength: 300 }],
    improvements: [{ type: String, maxlength: 300 }],
    overview: { type: String, maxlength: 2000 },
  },
}, { timestamps: true });

module.exports = mongoose.model("Interview", interviewSchema);
