// Server entrypoint
const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const connectDB = require("./db");
const enrollRoute = require("./routes/enroll");
const attendanceRoute = require("./routes/attendance");
const authRoute = require("./routes/auth");
const classroomRoute = require("./routes/classroom");
const requestsRoute = require("./routes/requests");
const portalRoute = require("./routes/portal");
const adminRoute = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

// Behind a hosting proxy (Render, Nginx) the client IP is in X-Forwarded-For.
// Without this every user would share the proxy's IP for rate limiting.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

// Log instead of crashing on stray async errors; a crash would stop attendance for everyone
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// Security headers via Helmet (API-focused configuration)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin image serving
  contentSecurityPolicy: false // Disable CSP for API server
}));

// Rate limiting to prevent abuse. Limits are per client IP; a whole campus can sit
// behind one public IP, so they are sized for many teachers at once.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.RATE_LIMIT_MAX || (isProduction ? 3000 : 10000)),
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false
});
// Short-lived scan images (annotated photo, face crops) are served before the
// limiter so that viewing a review screen does not consume the request budget.
app.use("/uploads", express.static(path.join(__dirname, "uploads"), { maxAge: "10m" }));
app.use(limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 200), // login/register attempts per IP
  message: { error: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false
});

// CORS configuration (strict in production)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests without origin (mobile apps, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from: ${origin}`);
      if (isProduction) {
        callback(new Error('Not allowed by CORS'));
      } else {
        callback(null, true); // Allow in development
      }
    }
  },
  credentials: true
}));

// JSON body parser with size limits for large payloads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use("/models", express.static(path.join(__dirname, "face-models")));

// Connect database
connectDB();

// Routes
app.use("/auth", authLimiter, authRoute); // Stricter rate limit for auth
app.use("/classroom", classroomRoute);
app.use("/enroll", enrollRoute);
app.use("/attendance", attendanceRoute);
app.use("/requests", requestsRoute);
app.use("/portal", (req, res, next) => (/^\/(login|register|forgot-password|reset-password)/.test(req.path) ? authLimiter(req, res, next) : next()), portalRoute);
app.use("/admin", adminRoute);

app.get("/", (req, res) => {
  res.send("SnapTick API Server - Ready!");
});

// GET /health - database and face-service status. The client calls this on load,
// which also wakes sleeping free-tier services before the teacher needs them.
const FACE_URL = process.env.DEEPFACE_URL || "http://localhost:5001";
app.get("/health", async (req, res) => {
  const mongoose = require("mongoose");
  const database = mongoose.connection.readyState === 1 ? "ok" : "down";
  let faceService = "down";
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(`${FACE_URL}/health`, { signal: controller.signal });
    clearTimeout(t);
    faceService = r.ok ? "ok" : "starting";
  } catch {
    faceService = "starting";
  }
  res.status(database === "ok" ? 200 : 503).json({ api: "ok", database, faceService });
});

// 404 for unknown API routes
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler: upload errors and anything thrown outside a route's try/catch.
// Always JSON, never an HTML stack trace.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (req.file?.path) require("fs").promises.unlink(req.file.path).catch(() => {});
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "The image is too large. Please use a photo under 8 MB." });
  }
  if (err?.message === "Only image files are allowed") {
    return res.status(400).json({ error: "Only image files (JPG, PNG) are allowed." });
  }
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid request body." });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request is too large." });
  }
  if (err?.name === "CastError") {
    return res.status(400).json({ error: "Invalid id" });
  }
  console.error("[Unhandled route error]", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}${isProduction ? ' (production)' : ' (development)'}`);
});
