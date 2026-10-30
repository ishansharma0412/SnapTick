// Attendance arithmetic shared by analytics, the admin panel, the student portal,
// alerts and Excel exports.
//
// A "session" is one (day, period) for which attendance was taken in a classroom.
// present and duty_leave count as attended; medical_leave is excused and removed
// from that student's total.
const Attendance = require("../models/attendance");
const Student = require("../models/student");

function dayKey(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const round1 = (n) => Math.round(n * 10) / 10;

function statusFor(percentage, totalSessions, threshold) {
  if (!totalSessions) return "no-data";
  if (percentage >= threshold) return "good";
  if (percentage >= threshold - 15) return "warning";
  return "critical";
}

/**
 * Build the report for one classroom between two Date objects (inclusive).
 * @param {object} classroom - Classroom document (needs _id, teacherId, threshold, name)
 * @param {object} [options] - { students } to reuse an already-loaded roster
 */
async function buildReport(classroom, startDate, endDate, options = {}) {
  const threshold = classroom.threshold || 75;
  const [students, records] = await Promise.all([
    options.students ||
      Student.find({ classroomId: classroom._id }, "name rollNumber email phone guardianEmail guardianPhone")
        .sort({ rollNumber: 1 })
        .lean(),
    Attendance.find(
      { classroomId: classroom._id, teacherId: classroom.teacherId, date: { $gte: startDate, $lte: endDate } },
      { rollNo: 1, date: 1, period: 1, status: 1 }
    ).lean(),
  ]);

  const enrolled = new Set(students.map((s) => s.rollNumber));
  const sessions = new Map(); // "day#period" -> { day, period, present }
  const perStudent = new Map(); // roll -> { attended:Set, duty:Set, medical:Set }

  for (const r of records) {
    const day = dayKey(r.date);
    const period = r.period || 1;
    const key = `${day}#${period}`;
    if (!sessions.has(key)) sessions.set(key, { day, period, present: 0 });
    if (!enrolled.has(r.rollNo)) continue; // student since removed
    if (!perStudent.has(r.rollNo)) perStudent.set(r.rollNo, { attended: new Set(), duty: new Set(), medical: new Set() });
    const entry = perStudent.get(r.rollNo);
    const status = r.status || "present";
    if (status === "medical_leave") entry.medical.add(key);
    else {
      entry.attended.add(key);
      if (status === "duty_leave") entry.duty.add(key);
      sessions.get(key).present++;
    }
  }

  const totalSessions = sessions.size;
  const rows = students.map((s) => {
    const e = perStudent.get(s.rollNumber);
    const attended = e?.attended.size || 0;
    const medicalLeave = e?.medical.size || 0;
    const dutyLeave = e?.duty.size || 0;
    const counted = totalSessions - medicalLeave;
    const percentage = counted > 0 ? round1((attended / counted) * 100) : totalSessions ? 100 : 0;
    return {
      studentId: s._id.toString(),
      name: s.name,
      rollNumber: s.rollNumber,
      email: s.email || "",
      phone: s.phone || "",
      guardianEmail: s.guardianEmail || "",
      guardianPhone: s.guardianPhone || "",
      present: attended,
      dutyLeave,
      medicalLeave,
      absent: Math.max(0, counted - attended),
      totalSessions: counted,
      percentage,
      status: statusFor(percentage, counted, threshold),
    };
  });

  const days = [...sessions.values()]
    .sort((a, b) => (a.day === b.day ? a.period - b.period : a.day.localeCompare(b.day)))
    .map((s) => ({
      date: s.day,
      period: s.period,
      present: s.present,
      total: students.length,
      percentage: students.length ? round1((s.present / students.length) * 100) : 0,
    }));

  const classAverage = rows.length && totalSessions ? round1(rows.reduce((a, r) => a + r.percentage, 0) / rows.length) : 0;

  return {
    classroom: { id: classroom._id.toString(), name: classroom.name, subjectCode: classroom.subjectCode || "" },
    from: dayKey(startDate),
    to: dayKey(endDate),
    threshold,
    totalStudents: students.length,
    totalSessions,
    classAverage,
    defaulterCount: rows.filter((r) => r.status === "warning" || r.status === "critical").length,
    students: rows,
    days,
  };
}

module.exports = { buildReport, dayKey, round1, statusFor };
