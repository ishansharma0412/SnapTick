import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FiCalendar, FiSearch, FiLock, FiSun, FiCheckSquare } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, toDay, currentSlot } from "../utils/api";

const OPTIONS = [
  { id: "present", label: "Present", short: "P", cls: "bg-[var(--status-present-bg)] text-[var(--status-present-text)] border-[var(--status-present-text)]/30" },
  { id: "duty_leave", label: "Duty leave", short: "DL", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  { id: "medical_leave", label: "Medical", short: "ML", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  { id: "absent", label: "Absent", short: "A", cls: "bg-[var(--status-absent-bg)] text-[var(--status-absent-text)] border-[var(--status-absent-text)]/30" },
];

const ManualAttendance = () => {
  const { classroomId, classroom } = useOutletContext();
  const { token } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(() => toDay());
  const [period, setPeriod] = useState(() => currentSlot(classroom?.schedule)?.period || 1);
  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState({}); // roll -> status
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [locked, setLocked] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [bulk, setBulk] = useState(false);

  useEffect(() => {
    api("/admin/holidays", { token }).then(setHolidays).catch(() => {});
  }, [token]);

  const load = useCallback(async () => {
    if (!classroomId) return;
    setLoading(true);
    try {
      const [list, recs] = await Promise.all([
        api(`/enroll?classroomId=${classroomId}`, { token }),
        api(`/attendance?classroomId=${classroomId}&date=${date}&period=${period}`, { token }),
      ]);
      list.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));
      setStudents(list);
      setRecords(Object.fromEntries(recs.map((r) => [r.rollNo, r.status || "present"])));
      const ageHours = (Date.now() - new Date(`${date}T23:59:59`).getTime()) / 3600000;
      const reopened = (classroom?.unlocked || []).some((u) => u.day === date && new Date(u.until) > new Date());
      setLocked(ageHours > 48 && !reopened);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [classroomId, date, period, token, toast, classroom?.unlocked]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (student, status) => {
    const previous = records[student.rollNumber] || "absent";
    if (previous === status) return true;
    setRecords((r) => {
      const next = { ...r };
      if (status === "absent") delete next[student.rollNumber];
      else next[student.rollNumber] = status;
      return next;
    });
    try {
      if (status === "absent") {
        await api("/attendance/unmark", { token, method: "DELETE", body: { rollNumber: student.rollNumber, date, classroomId, period } });
      } else {
        await api("/attendance/mark", { token, method: "POST", body: { rollNumber: student.rollNumber, name: student.name, date, classroomId, period, status } });
      }
      return true;
    } catch (e) {
      setRecords((r) => {
        const next = { ...r };
        if (previous === "absent") delete next[student.rollNumber];
        else next[student.rollNumber] = previous;
        return next;
      });
      if (e.status === 423) setLocked(true);
      toast.error(e.message);
      return false;
    }
  };

  const markAllPresent = async () => {
    setBulk(true);
    const absentees = students.filter((s) => !records[s.rollNumber]);
    let done = 0;
    for (const s of absentees) {
      // Sequential on purpose: keeps the server load and error handling simple
      if (await setStatus(s, "present")) done += 1;
      else break;
    }
    setBulk(false);
    if (done) toast.success(`Marked ${done} student(s) present`);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return students.filter((s) => s.name.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q));
  }, [students, search]);

  const counts = useMemo(() => {
    const c = { present: 0, duty_leave: 0, medical_leave: 0, absent: 0 };
    students.forEach((s) => (c[records[s.rollNumber] || "absent"] += 1));
    return c;
  }, [students, records]);

  const holiday = holidays.find((h) => h.day === date);
  const maxPeriod = Math.max(6, ...(classroom?.schedule || []).map((s) => s.period || 1));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {OPTIONS.map((o) => (
          <div key={o.id} className="glass-card px-4 py-3">
            <p className="eyebrow">{o.label}</p>
            <p className="font-display text-3xl leading-none mt-2 text-[var(--text-main)]">{counts[o.id]}</p>
          </div>
        ))}
      </div>

      {holiday && (
        <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm flex items-center gap-2">
          <FiSun /> {date} is a holiday: {holiday.label}
        </div>
      )}
      {locked && (
        <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)] text-sm flex items-center gap-2">
          <FiLock className="flex-shrink-0" /> Records older than 48 hours are locked to keep the register tamper-proof. An admin can re-open this day.
        </div>
      )}

      <div className="glass-card p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row gap-3 mb-6">
          <div className="flex gap-2 flex-1">
            <div className="relative flex-1 min-w-0">
              <FiCalendar className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input type="date" value={date} max={toDay()} onChange={(e) => setDate(e.target.value)} className="input-premium pl-10 pr-3 py-2.5 font-semibold w-full" />
            </div>
            <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} className="input-premium px-3 py-2.5 font-semibold" aria-label="Lecture">
              {Array.from({ length: maxPeriod }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>Lecture {p}</option>
              ))}
            </select>
          </div>
          <div className="relative lg:w-72">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input type="text" placeholder="Search name or roll number" value={search} onChange={(e) => setSearch(e.target.value)} className="input-premium pl-10 pr-3 py-2.5 w-full" />
          </div>
          <button
            onClick={markAllPresent}
            disabled={locked || bulk || counts.absent === 0}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-input)] disabled:opacity-40 flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <FiCheckSquare /> {bulk ? "Marking…" : "Mark rest present"}
          </button>
        </div>

        <div className="space-y-2">
          {loading ? (
            <p className="text-center py-12 text-[var(--text-muted)]">Loading register…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center py-12 text-[var(--text-muted)]">
              {students.length === 0 ? "No students enrolled in this classroom yet." : "No results found."}
            </p>
          ) : (
            filtered.map((student) => {
              const status = records[student.rollNumber] || "absent";
              return (
                <div key={student._id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 p-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold bg-[var(--color-primary-soft)] text-[var(--text-main)]">
                      {student.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text-main)] truncate">{student.name}</p>
                      <p className="font-mono text-[11px] text-[var(--text-muted)] truncate">{student.rollNumber}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-1 sm:flex sm:gap-1.5" role="radiogroup" aria-label={`Attendance for ${student.name}`}>
                    {OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        role="radio"
                        aria-checked={status === o.id}
                        disabled={locked}
                        onClick={() => setStatus(student, o.id)}
                        title={o.label}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:cursor-not-allowed ${
                          status === o.id ? o.cls : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-card)]"
                        }`}
                      >
                        <span className="sm:hidden">{o.short}</span>
                        <span className="hidden sm:inline">{o.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default ManualAttendance;
