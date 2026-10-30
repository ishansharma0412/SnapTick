// One-time codes for password reset (6 digits, hashed, 15-minute expiry, 5 attempts).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

async function issueCode(doc) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  doc.resetCodeHash = await bcrypt.hash(code, 8);
  doc.resetExpires = new Date(Date.now() + TTL_MS);
  doc.resetAttempts = 0;
  await doc.save();
  return code;
}

/** Returns "ok", "expired", "invalid" or "locked". Clears the code on success. */
async function checkCode(doc, code) {
  if (!doc.resetCodeHash || !doc.resetExpires || doc.resetExpires < new Date()) return "expired";
  if ((doc.resetAttempts || 0) >= MAX_ATTEMPTS) return "locked";
  const ok = await bcrypt.compare(String(code || ""), doc.resetCodeHash);
  if (!ok) {
    doc.resetAttempts = (doc.resetAttempts || 0) + 1;
    await doc.save();
    return "invalid";
  }
  doc.resetCodeHash = undefined;
  doc.resetExpires = undefined;
  doc.resetAttempts = 0;
  return "ok";
}

const OTP_MESSAGES = {
  expired: "This code has expired. Request a new one.",
  invalid: "Incorrect code.",
  locked: "Too many attempts. Request a new code.",
};

module.exports = { issueCode, checkCode, OTP_MESSAGES };
