const express = require("express");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const mongoose = require("mongoose");
const Interview = require("../models/Interview");
const SavedResume = require("../models/SavedResume");
const requireAuth = require("../middleware/auth");
const { generateJson, generateSpeechStream } = require("../utils/gemini");

const router = express.Router();
const dimensionLabels = {
  technicalAccuracy: "Technical accuracy",
  communicationClarity: "Communication clarity",
  answerStructure: "Answer structure",
  problemSolving: "Problem solving",
  roleRelevance: "Role relevance",
  languageFluency: "Language fluency",
};
const dimensionKeys = Object.keys(dimensionLabels);
const LIVEAVATAR_API_URL = "https://api.liveavatar.com";
const LIVEAVATAR_SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";
const speechLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: "Too many voice replies. Wait a minute and try again." }),
});
const questionSchema = {
  type: "object",
  properties: { question: { type: "string" } },
  required: ["question"],
};
const answerSchema = {
  type: "object",
  properties: {
    feedback: { type: "string" },
    score: { type: "integer" },
    nextQuestion: { type: "string" },
    transcript: { type: "string" },
    dimensionScores: {
      type: "object",
      properties: Object.fromEntries(dimensionKeys.map((key) => [key, { type: "integer" }])),
      required: dimensionKeys,
    },
  },
  required: ["feedback", "score", "nextQuestion", "transcript", "dimensionScores"],
};
const guidedAnswerSchema = {
  ...answerSchema,
  properties: {
    ...answerSchema.properties,
    answerFramework: { type: "array", items: { type: "string" } },
    sampleAnswer: { type: "string" },
  },
  required: [...answerSchema.required, "answerFramework", "sampleAnswer"],
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"]);
    if (!allowed.has(file.mimetype)) {
      const error = new Error("Resume must be a PDF, DOCX, or TXT file.");
      error.status = 400;
      return callback(error);
    }
    return callback(null, true);
  },
});
const acceptedAudioTypes = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav", "audio/aac", "audio/flac"]);
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const mimeType = file.mimetype.split(";")[0].toLowerCase();
    if (!acceptedAudioTypes.has(mimeType)) {
      const error = new Error("Audio must be a supported WebM, MP4, OGG, MP3, WAV, AAC, or FLAC recording.");
      error.status = 400;
      return callback(error);
    }
    return callback(null, true);
  },
});

function averageDimensionScores(answers) {
  return Object.fromEntries(dimensionKeys.flatMap((key) => {
    const scores = answers.map((answer) => answer.dimensionScores?.[key]).filter(Number.isFinite);
    return scores.length ? [[key, Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)]] : [];
  }));
}

function completedJsonStringField(jsonText, field) {
  const keyIndex = jsonText.indexOf(`"${field}"`);
  if (keyIndex < 0) return null;
  let valueStart = keyIndex + field.length + 2;
  while (/\s/.test(jsonText[valueStart] || "")) valueStart += 1;
  if (jsonText[valueStart] !== ":") return null;
  valueStart += 1;
  while (/\s/.test(jsonText[valueStart] || "")) valueStart += 1;
  if (jsonText[valueStart] !== '"') return null;

  let escaped = false;
  for (let index = valueStart + 1; index < jsonText.length; index += 1) {
    if (escaped) {
      escaped = false;
    } else if (jsonText[index] === "\\") {
      escaped = true;
    } else if (jsonText[index] === '"') {
      try {
        return JSON.parse(jsonText.slice(valueStart, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function getPreviousPerformance(userId) {
  const sessions = await Interview.find({ user: userId, status: "completed" })
    .select("role questions.question questions.feedback questions.dimensionScores")
    .sort({ updatedAt: -1 })
    .limit(5)
    .lean();
  const entries = sessions.flatMap((session) => session.questions.slice().reverse()
    .filter((question) => question.feedback)
    .map((question) => ({
      role: session.role,
      question: question.question,
      feedback: question.feedback || "",
      dimensionScores: question.dimensionScores || {},
    })));
  const averages = averageDimensionScores(entries);
  const focusAreas = Object.entries(averages)
    .sort((left, right) => left[1] - right[1])
    .slice(0, 3)
    .map(([key, score]) => ({ skill: dimensionLabels[key], score }));
  return {
    completedSessions: sessions.length,
    dimensionAverages: averages,
    focusAreas,
    recentCoachNotes: entries.filter((entry) => entry.feedback).slice(0, 5).map(({ role, feedback, dimensionScores }) => ({
      role,
      feedback: feedback.slice(0, 350),
      dimensionScores,
    })),
    recentQuestions: entries.slice(0, 8).map(({ question }) => question.slice(0, 400)),
  };
}

router.use(requireAuth);

router.post("/speech", speechLimiter, async (req, res, next) => {
  try {
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    const voiceStyle = req.body.voiceStyle || "feminine";
    const language = req.body.language || "English";
    if (!text || text.length > 3000) return res.status(400).json({ message: "Speech text must be between 1 and 3,000 characters." });
    if (!["feminine", "masculine"].includes(voiceStyle)) return res.status(400).json({ message: "Choose a valid interviewer voice." });
    if (!["English", "Hindi"].includes(language)) return res.status(400).json({ message: "Choose English or Hindi for speech." });
    const audioChunks = await generateSpeechStream(text, voiceStyle, language);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    for await (const chunk of audioChunks) {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ audio: chunk })}\n\n`);
    }
    res.write("data: {\"done\":true}\n\n");
    return res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message || "Speech generation failed." })}\n\n`);
      return res.end();
    }
    return next(error);
  }
});

async function extractResume(file) {
  if (!file) return "";
  if (file.mimetype === "application/pdf") {
    const parsed = await pdfParse(file.buffer);
    return parsed.text.slice(0, 30000);
  }
  if (file.mimetype === "text/plain") return file.buffer.toString("utf8").slice(0, 30000);
  const parsed = await mammoth.extractRawText({ buffer: file.buffer });
  return parsed.value.slice(0, 30000);
}

async function liveAvatarRequest(path, { apiKey, sessionToken, body }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-KEY"] = apiKey;
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  let response;
  try {
    response = await fetch(`${LIVEAVATAR_API_URL}${path}`, {
      method: "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    const error = new Error(`Could not reach LiveAvatar: ${cause.message}`);
    error.status = 502;
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = [
      result?.message,
      result?.detail,
      result?.error?.message,
      result?.data?.message,
      result?.data?.error?.message,
    ].find((value) => typeof value === "string" && value.trim());
    const error = new Error(`LiveAvatar request failed (${response.status})${detail ? `: ${detail}` : "."}`);
    error.status = 502;
    throw error;
  }
  return result.data;
}

async function stopLiveAvatarSession(sessionId) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    const error = new Error("LiveAvatar cannot stop the session because HEYGEN_API_KEY is not configured on the backend.");
    error.status = 503;
    throw error;
  }
  await liveAvatarRequest("/v1/sessions/stop", {
    apiKey,
    body: { session_id: sessionId, reason: "USER_CLOSED" },
  });
}

function safeInterview(interview) {
  const value = interview.toObject ? interview.toObject() : interview;
  delete value.resumeText;
  delete value.avatarSessionId;
  return value;
}

function publicResume(resume) {
  return { _id: resume._id, name: resume.name, createdAt: resume.createdAt };
}

router.get("/resumes", async (req, res, next) => {
  try {
    const resumes = await SavedResume.find({ user: req.user.id })
      .select("name createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ resumes });
  } catch (error) {
    return next(error);
  }
});

router.post("/resumes", upload.single("resume"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Choose a resume to upload." });
    const content = await extractResume(req.file);
    if (!content.trim()) return res.status(400).json({ message: "No readable text was found in that resume." });
    const name = req.file.originalname.split(/[\\/]/).pop().slice(0, 255) || "Resume";
    const resume = await SavedResume.create({ user: req.user.id, name, content });
    return res.status(201).json({ resume: publicResume(resume) });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/avatar/session", async (req, res, next) => {
  try {
    const interview = await Interview.findOne({ _id: req.params.id, user: req.user.id }).select("+avatarSessionId");
    if (!interview) return res.status(404).json({ message: "Interview not found." });
    if (interview.status === "completed") return res.status(409).json({ message: "This interview is already complete." });
    if (interview.avatarSessionId) return res.status(409).json({ message: "This interview already has a live avatar session." });

    const apiKey = process.env.HEYGEN_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ message: "Live avatar video is not configured. Add HEYGEN_API_KEY to the backend environment." });
    }
    const sandbox = String(process.env.LIVEAVATAR_SANDBOX || "true").toLowerCase() !== "false";
    const configuredAvatarId = interview.voiceStyle === "feminine"
      ? process.env.LIVEAVATAR_AVATAR_ID_GIRL || process.env.LIVEAVATAR_FEMININE_AVATAR_ID
      : process.env.LIVEAVATAR_AVATAR_ID_BOY || process.env.LIVEAVATAR_MASCULINE_AVATAR_ID;
    const avatarId = sandbox
      ? LIVEAVATAR_SANDBOX_AVATAR_ID
      : (configuredAvatarId || process.env.LIVEAVATAR_AVATAR_ID);
    if (!avatarId) {
      const requiredVariable = interview.voiceStyle === "feminine" ? "LIVEAVATAR_AVATAR_ID_GIRL" : "LIVEAVATAR_AVATAR_ID_BOY";
      return res.status(503).json({ message: `Set ${requiredVariable} to an avatar from your LiveAvatar account before disabling sandbox mode.` });
    }

    const tokenData = await liveAvatarRequest("/v1/sessions/token", {
      apiKey,
      body: {
        mode: "LITE",
        avatar_id: avatarId,
        is_sandbox: sandbox,
      },
    });
    if (!tokenData?.session_token || !tokenData?.session_id) {
      const error = new Error("LiveAvatar returned an incomplete session token.");
      error.status = 502;
      throw error;
    }

    let sessionData;
    try {
      sessionData = await liveAvatarRequest("/v1/sessions/start", {
        sessionToken: tokenData.session_token,
      });
    } catch (error) {
      try {
        await stopLiveAvatarSession(tokenData.session_id);
      } catch (cleanupError) {
        console.error("Could not clean up an incomplete LiveAvatar session:", cleanupError.message);
      }
      throw error;
    }
    if (!sessionData?.livekit_url || !sessionData?.livekit_client_token || !sessionData?.ws_url) {
      await stopLiveAvatarSession(tokenData.session_id);
      const error = new Error("LiveAvatar started without returning the video and audio connection details.");
      error.status = 502;
      throw error;
    }

    interview.avatarSessionId = tokenData.session_id;
    try {
      await interview.save();
    } catch (error) {
      try {
        await stopLiveAvatarSession(tokenData.session_id);
      } catch (cleanupError) {
        console.error("Could not clean up an unsaved LiveAvatar session:", cleanupError.message);
      }
      throw error;
    }
    return res.status(201).json({
      session: {
        sessionId: tokenData.session_id,
        livekitUrl: sessionData.livekit_url,
        clientToken: sessionData.livekit_client_token,
        websocketUrl: sessionData.ws_url,
        sandbox,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/avatar/stop", async (req, res, next) => {
  try {
    const interview = await Interview.findOne({ _id: req.params.id, user: req.user.id }).select("+avatarSessionId");
    if (!interview) return res.status(404).json({ message: "Interview not found." });
    if (!interview.avatarSessionId) return res.json({ stopped: false });
    await stopLiveAvatarSession(interview.avatarSessionId);
    interview.avatarSessionId = null;
    await interview.save();
    return res.json({ stopped: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const interviews = await Interview.find({ user: req.user.id })
      .select("role difficulty duration mode voiceStyle status summary createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    return res.json({ interviews });
  } catch (error) {
    return next(error);
  }
});

router.post("/", upload.single("resume"), async (req, res, next) => {
  try {
    const role = typeof req.body.role === "string" ? req.body.role.trim() : "";
    const difficulty = req.body.difficulty;
    const duration = Number(req.body.duration);
    const mode = req.body.mode || "mock";
    const voiceStyle = req.body.voiceStyle || "feminine";
    const language = req.body.language || "English";
    if (!role || role.length > 100) return res.status(400).json({ message: "Enter a job title or interview type (up to 100 characters)." });
    if (!["Beginner", "Intermediate", "Advanced"].includes(difficulty)) return res.status(400).json({ message: "Choose a valid difficulty." });
    if (![10, 20, 30, 45].includes(duration)) return res.status(400).json({ message: "Choose a valid interview duration." });
    if (!["mock", "guided"].includes(mode)) return res.status(400).json({ message: "Choose a valid practice mode." });
    if (!["feminine", "masculine"].includes(voiceStyle)) return res.status(400).json({ message: "Choose a valid interviewer voice." });
    if (!["English", "Hindi"].includes(language)) return res.status(400).json({ message: "Choose English or Hindi for the interview." });

    const requestedResumeId = typeof req.body.resumeId === "string" ? req.body.resumeId.trim() : "";
    if (req.file && requestedResumeId) return res.status(400).json({ message: "Choose a saved resume or upload a new one, not both." });
    let savedResume = null;
    let resumeText = "";
    if (requestedResumeId) {
      if (!mongoose.Types.ObjectId.isValid(requestedResumeId)) return res.status(400).json({ message: "Choose a valid saved resume." });
      savedResume = await SavedResume.findOne({ _id: requestedResumeId, user: req.user.id }).select("+content");
      if (!savedResume) return res.status(404).json({ message: "Saved resume not found. Choose another or upload it again." });
      resumeText = savedResume.content;
    } else {
      resumeText = await extractResume(req.file);
    }
    const previousPerformance = await getPreviousPerformance(req.user.id);
    const coachName = voiceStyle === "masculine" ? "Dev" : "Maya";
    const generated = await generateJson(
      `You are ${coachName}, a warm, friendly, and supportive professional interviewer. Be conversational rather than strict. Conduct the entire interview in ${language === "Hindi" ? "natural Hindi (हिन्दी), which may include common English/Hinglish job terms" : "English"}. Create exactly one original opening question tailored to the role, selected difficulty, and resume. The selected difficulty is a firm requirement: Beginner means fundamentals and straightforward examples; Intermediate means practical application and moderate trade-offs; Advanced means complex scenarios, edge cases, scale, and competing trade-offs. Make the question's actual reasoning demand match "${difficulty}", regardless of how senior the role or resume sounds. Vary question types and include behavioral, technical, situational, and practical possibilities without exceeding the selected level. Do not use a fixed question bank or repeat recent questions. Use prior practice data only to gently target a skill that needs work, never to change difficulty. Never assume or use the candidate's gender. Keep the question clear and ask only one question. Return a JSON object with one string field named "question".\nRole: ${role}\nSelected difficulty (must remain fixed throughout this interview): ${difficulty}\nResume:\n${resumeText || "No resume supplied."}\nPrior practice profile from this account: ${JSON.stringify(previousPerformance)}`,
      questionSchema,
    );
    if (typeof generated.question !== "string" || !generated.question.trim()) {
      return res.status(502).json({ message: "The AI interview service returned an invalid question. Please try again." });
    }
    const interview = await Interview.create({
      user: req.user.id,
      resumeId: savedResume?._id || null,
      role,
      difficulty,
      duration,
      mode,
      voiceStyle,
      language,
      resumeText,
      questions: [{ question: generated.question.trim() }],
    });
    return res.status(201).json({ interview: safeInterview(interview) });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/answer", audioUpload.single("audio"), async (req, res, next) => {
  let sendStreamEvent = null;
  try {
    const answer = typeof req.body?.answer === "string" ? req.body.answer.trim() : "";
    if ((!answer && !req.file) || answer.length > 10000) return res.status(400).json({ message: "Enter an answer (up to 10,000 characters) or record one." });
    const interview = await Interview.findOne({ _id: req.params.id, user: req.user.id }).select("+resumeText");
    if (!interview) return res.status(404).json({ message: "Interview not found." });
    if (interview.status === "completed") return res.status(409).json({ message: "This interview is already complete." });
    const current = interview.questions[interview.questions.length - 1];
    if (!current || current.answer) return res.status(409).json({ message: "This question has already been answered." });

    const coachName = interview.voiceStyle === "masculine" ? "Dev" : "Maya";
    const previousPerformance = await getPreviousPerformance(req.user.id);
    const currentSessionAnswers = interview.questions
      .filter((question) => question.answer)
      .slice(-4)
      .map(({ question, feedback, dimensionScores }) => ({
        question: question.slice(0, 400),
        feedback: (feedback || "").slice(0, 350),
        dimensionScores,
      }));
    const currentSessionAverages = averageDimensionScores(interview.questions.filter((question) => question.answer));
    const answerInput = req.file
      ? "Transcribe the candidate's spoken answer exactly in the interview language, then evaluate the transcript."
      : `Candidate answer: ${answer}`;
    const streamResponse = req.headers.accept?.includes("text/event-stream");
    let outputText = "";
    let streamedFeedback = "";
    if (streamResponse) {
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      sendStreamEvent = (event, data) => {
        if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      sendStreamEvent("status", { message: "Reviewing your answer..." });
    }
    const guidedInstructions = interview.mode === "guided"
      ? 'This is guided coaching. In addition to the normal evaluation, return answerFramework as 3-4 short ordered steps tailored to this question, and sampleAnswer as a concise, natural 80-150 word example that improves on the candidate answer. Use only facts the candidate actually provided in their answer or resume; do not invent achievements, employers, metrics, or skills. If personal details are missing, use clearly marked placeholders in square brackets instead of fabricating them. Make the example a learning aid, not a script to memorize.'
      : "";
    const generated = await generateJson(
      `You are ${coachName}, a warm, friendly, and supportive professional interviewer. Be conversational rather than strict. Conduct the entire interview in ${interview.language === "Hindi" ? "natural Hindi (हिन्दी), which may include common English/Hinglish job terms" : "English"}. Evaluate the candidate's answer using only job-relevant evidence and calibrate scoring expectations to the selected difficulty. Give concise, encouraging, actionable feedback of 2-3 sentences. Include an integer score from 0 to 100 and six integer dimension scores: technicalAccuracy, communicationClarity, answerStructure, problemSolving, roleRelevance, and languageFluency. Do not penalize accent or dialect. For factual or situational answers, explain the key reason or trade-off and briefly describe possible alternatives when relevant. If the answer seems uncertain or ambiguous, ask a gentle clarifying question or give the candidate another chance instead of acting strict. Return one original next question at exactly the selected difficulty. Beginner means fundamentals and straightforward examples; Intermediate means practical application and moderate trade-offs; Advanced means complex scenarios, edge cases, scale, and competing trade-offs. Do not raise or lower the level based on answer quality, role seniority, or prior practice data; adapt only the topic or angle while staying at the selected level. Vary question types and include behavioral, technical, situational, and practical possibilities without exceeding that level. Adapt it to weaker areas in the prior profile and this session, while avoiding every listed prior question. Never infer or consider gender. ${guidedInstructions} Return JSON with string fields "transcript", "feedback", and "nextQuestion", integer field "score", and an object "dimensionScores" containing all six dimension scores.${interview.mode === "guided" ? ' Also return "answerFramework" as an array of strings and "sampleAnswer" as a string.' : ""} For typed answers, copy the candidate's answer exactly into "transcript".\nRole: ${interview.role}\nSelected difficulty (must remain fixed throughout this interview): ${interview.difficulty}\nResume context: ${(interview.resumeText || "Not supplied").slice(0, 10000)}\nPrevious practice profile from this account: ${JSON.stringify(previousPerformance)}\nCurrent session score averages: ${JSON.stringify(currentSessionAverages)}\nRecent answers and coach notes from this session: ${JSON.stringify(currentSessionAnswers)}\nQuestion: ${current.question}\n${answerInput}`,
      interview.mode === "guided" ? guidedAnswerSchema : answerSchema,
      req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype.split(";")[0].toLowerCase() } : undefined,
      streamResponse ? (textDelta) => {
        outputText += textDelta;
        const feedback = completedJsonStringField(outputText, "feedback");
        if (feedback !== null && feedback !== streamedFeedback) {
          streamedFeedback = feedback;
          sendStreamEvent("feedback", { text: feedback });
        }
      } : undefined,
    );
    const dimensionScores = generated.dimensionScores && Object.fromEntries(dimensionKeys.map((key) => [key, Number(generated.dimensionScores[key])]));
    const answerFramework = generated.answerFramework;
    const hasValidGuidance = interview.mode !== "guided" || (
      Array.isArray(answerFramework)
      && answerFramework.length >= 3
      && answerFramework.length <= 4
      && answerFramework.every((step) => typeof step === "string" && step.trim())
      && typeof generated.sampleAnswer === "string"
      && generated.sampleAnswer.trim()
    );
    if (typeof generated.transcript !== "string" || (req.file && !generated.transcript.trim()) || typeof generated.feedback !== "string" || !Number.isFinite(Number(generated.score)) || typeof generated.nextQuestion !== "string" || !generated.nextQuestion.trim() || !dimensionScores || dimensionKeys.some((key) => !Number.isInteger(dimensionScores[key]) || dimensionScores[key] < 0 || dimensionScores[key] > 100) || !hasValidGuidance) {
      if (sendStreamEvent) {
        sendStreamEvent("error", { message: "The AI interview service returned incomplete feedback. Please try again." });
        return res.end();
      }
      return res.status(502).json({ message: "The AI interview service returned incomplete feedback. Please try again." });
    }
    current.answer = req.file ? generated.transcript.trim().slice(0, 10000) : answer;
    current.feedback = generated.feedback.slice(0, 2000);
    current.score = Math.max(0, Math.min(100, Math.round(Number(generated.score))));
    current.dimensionScores = dimensionScores;
    if (interview.mode === "guided") {
      current.answerFramework = answerFramework.map((step) => step.trim().slice(0, 300));
      current.sampleAnswer = generated.sampleAnswer.trim().slice(0, 2500);
    }
    interview.questions.push({ question: generated.nextQuestion.trim().slice(0, 2000) });
    await interview.save();
    const result = { interview: safeInterview(interview), feedback: current.feedback, transcript: current.answer };
    if (sendStreamEvent) {
      sendStreamEvent("result", result);
      return res.end();
    }
    return res.json(result);
  } catch (error) {
    if (sendStreamEvent) {
      const message = error.status === 502 || error.status === 503
        ? error.message
        : "Could not submit your answer. Please try again.";
      sendStreamEvent("error", { message });
      return res.end();
    }
    return next(error);
  }
});

router.post("/:id/finish", async (req, res, next) => {
  try {
    const interview = await Interview.findOne({ _id: req.params.id, user: req.user.id }).select("+avatarSessionId");
    if (!interview) return res.status(404).json({ message: "Interview not found." });
    if (interview.status === "completed") return res.json({ interview: safeInterview(interview) });
    const answered = interview.questions.filter((item) => item.answer);
    if (!answered.length) return res.status(400).json({ message: "Answer at least one question before finishing." });
    if (interview.avatarSessionId) {
      await stopLiveAvatarSession(interview.avatarSessionId);
      interview.avatarSessionId = null;
    }
    const scores = answered.map((item) => item.score || 0);
    const score = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
    const dimensionScores = averageDimensionScores(answered);
    const rankedDimensions = Object.entries(dimensionScores).sort((left, right) => right[1] - left[1]);
    const strengths = rankedDimensions.length
      ? rankedDimensions.slice(0, 2).map(([key, value]) => `${dimensionLabels[key]} (${value}%)`)
      : ["Completed a focused practice session"];
    const improvements = rankedDimensions.length
      ? rankedDimensions.slice(-2).reverse().map(([key, value]) => `${dimensionLabels[key]} (${value}%)`)
      : ["Review the coach's notes and practice concise, specific examples"];
    interview.status = "completed";
    interview.summary = {
      score,
      dimensionScores,
      strengths,
      improvements,
      overview: `You completed ${answered.length} ${answered.length === 1 ? "answer" : "answers"} and earned an average score of ${score}%.`,
    };
    await interview.save();
    return res.json({ interview: safeInterview(interview) });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const interview = await Interview.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!interview) return res.status(404).json({ message: "Interview not found." });
    return res.json({ message: "Interview deleted.", interviewId: interview._id });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const interview = await Interview.findOne({ _id: req.params.id, user: req.user.id });
    if (!interview) return res.status(404).json({ message: "Interview not found." });
    return res.json({ interview: safeInterview(interview) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
