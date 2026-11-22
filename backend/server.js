require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDatabase = require("./src/config/database");
const { connectRedis } = require("./src/config/redis");

const app = express();
const port = Number(process.env.PORT) || 5000;

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "interviewpro-api" }));
function handleError(error, _req, res, _next) {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ message: "Request body must be valid JSON." });
  }
  if (error.name === "MulterError") {
    return res.status(400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "Resume must be 5 MB or smaller." : error.message });
  }
  console.error(error);
  const status = error.status || error.statusCode || 500;
  const message = status < 500 || process.env.NODE_ENV !== "production"
    ? error.message
    : "The server could not complete the request.";
  return res.status(status).json({ message });
}

connectDatabase()
  .then(connectRedis)
  .then(() => {
    app.use("/api/auth", require("./src/routes/auth"));
    app.use("/api/interviews", require("./src/routes/interviews"));
    app.use(handleError);
    app.listen(port, () => console.log(`InterviewPro API listening on port ${port}`));
  })
  .catch((error) => {
    console.error("Could not start API because a required service failed to connect:", error.message);
    process.exitCode = 1;
  });
