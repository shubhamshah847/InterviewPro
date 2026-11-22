const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return res.status(401).json({ message: "Sign in to continue." });
  const secret = process.env.JWT_WEB_TOKEN || process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ message: "Authentication is not configured on this server." });

  try {
    const payload = jwt.verify(token, secret);
    const user = await User.findById(payload.sub).select("name email verified");
    if (!user || !user.verified) return res.status(401).json({ message: "Your session is no longer valid. Please sign in again." });
    req.user = user;
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Your session has expired. Please sign in again." });
    }
    return next(error);
  }
}

module.exports = requireAuth;
