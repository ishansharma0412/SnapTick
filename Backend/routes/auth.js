// Routes: auth
const express = require("express");
const jwt = require("jsonwebtoken");
const Teacher = require("../models/teacher");

const router = express.Router();

// JWT secret must be set via environment in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    // A random fallback would log every teacher out on each restart; fail loudly instead
    console.error("❌ JWT_SECRET is not set. Refusing to start in production.");
    process.exit(1);
  }
  console.error("⚠️  WARNING: JWT_SECRET not set in environment variables!");
  console.error("⚠️  Using insecure default - DO NOT use in production!");
}

// Optional: only allow registration with institutional emails, e.g. "abes.ac.in"
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
const SECURE_JWT_SECRET = JWT_SECRET || "dev-only-insecure-key-" + Math.random().toString(36);
const JWT_EXPIRES_IN = "7d";

// Generate JWT token
function generateToken(teacher) {
  return jwt.sign(
    {
      id: teacher._id,
      email: teacher.email,
      name: teacher.name,
      role: teacher.role
    },
    SECURE_JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// JWT verification middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, SECURE_JWT_SECRET);
    req.teacher = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// POST /auth/register - register teacher
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }

    if (ALLOWED_EMAIL_DOMAINS.length) {
      const domain = email.split("@").pop().toLowerCase();
      if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
        return res.status(403).json({ error: `Registration is limited to ${ALLOWED_EMAIL_DOMAINS.map((d) => "@" + d).join(", ")} email addresses` });
      }
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    // Check for existing email
    const existingTeacher = await Teacher.findOne({ email: email.toLowerCase() });
    if (existingTeacher) {
      return res.status(409).json({ error: "Email already registered" });
    }

    // Create teacher
    const teacher = new Teacher({
      name,
      email: email.toLowerCase(),
      password
    });

    await teacher.save();

    const token = generateToken(teacher);

    res.status(201).json({
      message: "Registration successful",
      token,
      teacher: teacher.toJSON()
    });

  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Failed to register" });
  }
});

// POST /auth/login - authenticate teacher
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Find teacher by email
    const teacher = await Teacher.findOne({ email: email.toLowerCase() });
    if (!teacher) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Ensure account is active
    if (!teacher.isActive) {
      return res.status(403).json({ error: "Account is deactivated" });
    }

    // Verify password
    const isMatch = await teacher.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Update last login timestamp
    teacher.lastLogin = new Date();
    await teacher.save();

    const token = generateToken(teacher);

    res.status(200).json({
      message: "Login successful",
      token,
      teacher: teacher.toJSON()
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

// GET /auth/verify - verify token and return teacher
router.get("/verify", authMiddleware, async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.teacher.id);
    if (!teacher) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    res.status(200).json({
      valid: true,
      teacher: teacher.toJSON()
    });

  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({ error: "Failed to verify token" });
  }
});

// GET /auth/teachers - list all teachers (admin only)
router.get("/teachers", authMiddleware, async (req, res) => {
  try {
    if (req.teacher.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    const teachers = await Teacher.find({}, "-password");
    res.status(200).json(teachers);
  } catch (error) {
    console.error("Fetch teachers error:", error);
    res.status(500).json({ error: "Failed to fetch teachers" });
  }
});

// PUT /auth/change-password - change password
router.put("/change-password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    const teacher = await Teacher.findById(req.teacher.id);
    if (!teacher) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    const isMatch = await teacher.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    teacher.password = newPassword;
    await teacher.save();

    res.status(200).json({ message: "Password changed successfully" });

  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// Exports
module.exports = router;
module.exports.authMiddleware = authMiddleware;
