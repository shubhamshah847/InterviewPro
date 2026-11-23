const express = require("express");
const cors = require("cors");
const connectDatabase = require("./src/config/database");
const { connectRedis } = require("./src/config/redis");

const app = express();
app.set("trust proxy", 1);
let servicesPromise;

function initializeServices() {
  if (!servicesPromise) {
    servicesPromise = Promise.all([connectDatabase(), connectRedis()]).catch((error) => {
      servicesPromise = null;
      throw error;
    });
  }
  return servicesPromise;
}

app.use(cors({
  origin: process.env.CLIENT_URL || (process.env.NODE_ENV === "production"
    ? "https://useinterviewpro.vercel.app"
    : "http://localhost:5173"),
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "1mb" }));

app.use("/api", (_req, _res, next) => {
  initializeServices().then(() => next(), next);
});

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "interviewpro-api" }));
app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/interviews", require("./src/routes/interviews"));

function handleError(error, _req, res, _next) {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ message: "Request body must be valid JSON." });
  }
  if (error.name === "MulterError") {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "The uploaded file is too large. Resumes must be 5 MB or smaller; recordings must be 12 MB or smaller."
      : error.message;
    return res.status(400).json({ message });
  }
  console.error(error);
  const status = error.status || error.statusCode || 500;
  const message = status < 500 || process.env.NODE_ENV !== "production"
    ? error.message
    : "The server could not complete the request.";
  return res.status(status).json({ message });
}

app.use(handleError);

module.exports = { app, initializeServices };
