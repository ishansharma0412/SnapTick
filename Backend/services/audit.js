// Append-only audit trail. Failures to write an entry never block the request.
const AuditLog = require("../models/auditLog");

function actorFrom(user) {
  if (!user) return { actorType: "system", actorId: "", actorName: "" };
  if (user.type === "student") return { actorType: "student", actorId: String(user.id), actorName: user.name || user.rollNumber };
  return { actorType: user.role === "admin" ? "admin" : "teacher", actorId: String(user.id), actorName: user.name || user.email || "" };
}

function audit(user, action, { classroomId, target = "", details } = {}) {
  AuditLog.create({ ...actorFrom(user), action, classroomId, target: String(target || ""), details }).catch((err) =>
    console.error("[audit] write failed:", err.message)
  );
}

module.exports = { audit };
