import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { FiCalendar, FiSearch } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import API_URL from "../config/api";

const ManualAttendance = () => {
  const { classroomId } = useOutletContext();
  const { token, getAuthHeaders } = useAuth();
  const toast = useToast();
  const [studentListWithStatus, setStudentListWithStatus] = useState([]);
  // Local date (toISOString is UTC and shows yesterday before 5:30 AM IST)
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      if (!classroomId) return;
      setLoading(true);
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [studentsRes, attendanceRes] = await Promise.all([
          fetch(
            `${API_URL}/enroll?classroomId=${classroomId}&t=${Date.now()}`,
            { headers },
          ),
          fetch(
            `${API_URL}/attendance?classroomId=${classroomId}&date=${selectedDate}&t=${Date.now()}`,
            { headers },
          ),
        ]);

        if (!studentsRes.ok || !attendanceRes.ok) {
          throw new Error("Failed to fetch data");
        }

        const allStudents = await studentsRes.json();
        const attendanceRecords = await attendanceRes.json();
        const presentSet = new Set(attendanceRecords.map((r) => r.rollNo));
        setStudentListWithStatus(
          allStudents.map((s) => ({
            ...s,
            isPresent: presentSet.has(s.rollNumber),
          })),
        );
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };
    fetchData();
  }, [selectedDate, token, classroomId]);

  const toggleAttendance = async (student) => {
    const newStatus = !student.isPresent;
    setStudentListWithStatus((prev) =>
      prev.map((s) =>
        s.rollNumber === student.rollNumber
          ? { ...s, isPresent: newStatus }
          : s,
      ),
    );
    try {
      const url = newStatus
        ? `${API_URL}/attendance/mark`
        : `${API_URL}/attendance/unmark`;
      const method = newStatus ? "POST" : "DELETE";
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({
          rollNumber: student.rollNumber,
          name: student.name,
          date: selectedDate,
          classroomId,
        }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      // Roll back on error
      setStudentListWithStatus((prev) =>
        prev.map((s) =>
          s.rollNumber === student.rollNumber
            ? { ...s, isPresent: !newStatus }
            : s,
        ),
      );
      toast.error(`Failed to update attendance for ${student.name}`);
    }
  };

  const filteredList = studentListWithStatus.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.rollNumber.toLowerCase().includes(search.toLowerCase()),
  );
  const stats = {
    present: studentListWithStatus.filter((s) => s.isPresent).length,
    absent:
      studentListWithStatus.length -
      studentListWithStatus.filter((s) => s.isPresent).length,
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="flex gap-4">
          <div className="glass-card px-6 py-3 flex items-center gap-6">
            <div className="text-center">
              <p className="text-xs text-[var(--status-present-text)] uppercase font-extrabold tracking-wider">
                Present
              </p>
              <p className="text-2xl font-black text-[var(--text-main)]">
                {stats.present}
              </p>
            </div>
            <div className="h-8 w-px bg-[var(--border-subtle)]"></div>
            <div className="text-center">
              <p className="text-xs text-[var(--status-absent-text)] uppercase font-extrabold tracking-wider">
                Absent
              </p>
              <p className="text-2xl font-black text-[var(--text-muted)]">
                {stats.absent}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card p-4 sm:p-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
          <div className="relative w-full md:w-auto">
            <FiCalendar className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="input-premium pl-12 pr-6 py-3 font-semibold w-full"
            />
          </div>
          <div className="relative w-full md:w-80">
            <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search name or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-premium pl-12 pr-6 py-3 w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-2 sm:gap-4 px-3 sm:px-4 py-3 rounded-xl bg-[var(--bg-input)] text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 border border-[var(--border-subtle)]">
          <div className="col-span-8 md:col-span-4">Student</div>
          <div className="hidden md:block md:col-span-3">Roll No.</div>
          <div className="col-span-4 md:col-span-3 text-center">Status</div>
          <div className="hidden md:block md:col-span-2 text-right">Action</div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-12 text-[var(--text-muted)]">
              Loading data...
            </div>
          ) : filteredList.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">
              {studentListWithStatus.length === 0
                ? "No students enrolled in this classroom yet."
                : "No results found."}
            </div>
          ) : (
            <AnimatePresence>
              {filteredList.map((student) => (
                <Motion.div
                  key={student._id || student.rollNumber}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`grid grid-cols-12 gap-2 sm:gap-4 p-3 sm:p-4 rounded-xl items-center border transition-all duration-200 ${
                    student.isPresent
                      ? "bg-[var(--status-present-bg)] border-[var(--status-present-bg)] bg-opacity-10"
                      : "bg-[var(--bg-input)] border-transparent"
                  }`}
                >
                  <div className="col-span-8 md:col-span-4 font-semibold text-[var(--text-main)] flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${student.isPresent ? "bg-[var(--color-primary)] text-[var(--color-primary-text)]" : "bg-[var(--border-subtle)] text-[var(--text-secondary)]"}`}
                    >
                      {student.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate">{student.name}</p>
                      <p className="md:hidden font-mono text-[11px] text-[var(--text-muted)] truncate">{student.rollNumber}</p>
                    </div>
                  </div>
                  <div className="hidden md:block md:col-span-3 font-mono text-[var(--text-secondary)] text-sm">
                    {student.rollNumber}
                  </div>
                  <div className="col-span-4 md:col-span-3 flex justify-center">
                    <button
                      onClick={() => toggleAttendance(student)}
                      className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
                        student.isPresent
                          ? "bg-[var(--status-present-bg)] text-[var(--status-present-text)] border-[var(--status-present-bg)]"
                          : "bg-[var(--status-absent-bg)] text-[var(--status-absent-text)] border-[var(--status-absent-bg)]"
                      }`}
                    >
                      {student.isPresent ? "Present" : "Absent"}
                    </button>
                  </div>
                  <div className="hidden md:block md:col-span-2 text-right text-xs text-[var(--text-muted)]">
                    {student.isPresent ? "Auto-Saved" : "-"}
                  </div>
                </Motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManualAttendance;
