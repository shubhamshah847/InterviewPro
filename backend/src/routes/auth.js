const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const User = require("../models/User");
const requireAuth = require("../middleware/auth");
const sendOtpEmail = require("../utils/email");
const { client: redisClient } = require("../config/redis");

const router = express.Router();
let authLimiter;

function getAuthLimiter() {
  if (!authLimiter) {
    authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => res.status(429).json({ message: "Too many account requests. Please wait a few minutes and try again." }),
      ...(redisClient ? {
        store: new RedisStore({
          sendCommand: (...args) => redisClient.sendCommand(args),
        }),
      } : {}),
    });
  }
  return authLimiter;
}

router.use((req, res, next) => getAuthLimiter()(req, res, next));

function otpHash(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function createOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function createToken(userId) {
  const secret = process.env.JWT_WEB_TOKEN || process.env.JWT_SECRET;
  if (!secret) {
    const error = new Error("Authentication is not configured on this server.");
    error.status = 500;
    throw error;
  }
  return jwt.sign({ sub: userId }, secret, { expiresIn: "7d" });
}

async function issueOtp(user, purpose) {
  const otp = createOtp();
  user.otpHash = otpHash(otp);
  user.otpPurpose = purpose;
  user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();
  return sendOtpEmail(user.email, otp, purpose);
}

function isValidOtp(user, otp, purpose) {
  if (!/^\d{6}$/.test(otp || "") || user.otpPurpose !== purpose || !user.otpExpiresAt || user.otpExpiresAt < new Date() || !user.otpHash) return false;
  const supplied = Buffer.from(otpHash(otp), "hex");
  const expected = Buffer.from(user.otpHash, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

router.post("/register", async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (name.length < 2 || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) {
      return res.status(400).json({ message: "Enter a valid name, email, and password (8–128 characters)." });
    }
    let user = await User.findOne({ email }).select("+passwordHash");
    if (user?.verified) return res.status(409).json({ message: "An account with this email already exists. Sign in instead." });
    const passwordHash = await bcrypt.hash(password, 12);
    if (user) {
      user.name = name;
      user.passwordHash = passwordHash;
    } else {
      user = new User({ name, email, passwordHash });
    }
    const delivery = await issueOtp(user, "verify");
    return res.status(201).json({ message: "Check your inbox for your verification code.", ...delivery });
  } catch (error) {
    return next(error);
  }
});

router.post("/verify-otp", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const user = await User.findOne({ email }).select("+otpHash");
    if (!user || !isValidOtp(user, req.body.otp, "verify")) return res.status(400).json({ message: "That code is invalid or expired. Request a new one and try again." });
    user.verified = true;
    user.otpHash = undefined;
    user.otpPurpose = undefined;
    user.otpExpiresAt = undefined;
    await user.save();
    return res.json({ token: createToken(user.id), user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    return next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: "Email or password is incorrect." });
    if (!user.verified) return res.status(403).json({ message: "Verify your email before signing in.", needsVerification: true });
    return res.json({ token: createToken(user.id), user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    return next(error);
  }
});

router.patch("/profile", requireAuth, async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ message: "Name must be between 2 and 80 characters." });
    }
    req.user.name = name;
    await req.user.save();
    return res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email } });
  } catch (error) {
    return next(error);
  }
});

router.post("/resend-otp", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const purpose = req.body.purpose === "reset" ? "reset" : "verify";
    const user = await User.findOne({ email });
    if (!user || (purpose === "verify" && user.verified) || (purpose === "reset" && !user.verified)) {
      return res.status(400).json({ message: purpose === "reset" ? "Unable to reset the password for this account." : "Unable to send a verification code for this account." });
    }
    const delivery = await issueOtp(user, purpose);
    return res.json({ message: "A new code has been sent.", ...delivery });
  } catch (error) {
    return next(error);
  }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const user = await User.findOne({ email, verified: true });
    if (!user) return res.status(404).json({ message: "No verified account was found with that email." });
    const delivery = await issueOtp(user, "reset");
    return res.json({ message: "Check your inbox for a password reset code.", ...delivery });
  } catch (error) {
    return next(error);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const user = await User.findOne({ email, verified: true }).select("+otpHash");
    if (!user || !isValidOtp(user, req.body.otp, "reset")) return res.status(400).json({ message: "That code is invalid or expired. Request a new one and try again." });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ message: "Password must be between 8 and 128 characters." });
    user.passwordHash = await bcrypt.hash(password, 12);
    user.otpHash = undefined;
    user.otpPurpose = undefined;
    user.otpExpiresAt = undefined;
    await user.save();
    return res.json({ message: "Your password has been updated." });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
