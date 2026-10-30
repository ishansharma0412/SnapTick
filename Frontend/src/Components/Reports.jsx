import React, { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import {
  FiAlertTriangle,
  FiBarChart2,
  FiCalendar,
  FiDownload,
  FiPrinter,
  FiSearch,
  FiTrendingUp,
  FiUsers,
  FiGrid,
  FiBell,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import API_URL from "../config/api";
import { downloadFile } from "../utils/api";
import AlertsPanel from "./AlertsPanel";

// Local YYYY-MM-DD (toISOString would shift the date in IST)
const toDateInput = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const PRESETS = [
  { id: "7d", label: "Last 7 days", from: () => daysAgo(6) },
  { id: "30d", label: "Last 30 days", from: () => daysAgo(29) },
  {
    id: "month",
    label: "This month",
    from: () => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), 1);
    },
  },
  { id: "90d", label: "Semester (90 days)", from: () => daysAgo(89) },
];

const STATUS_STYLES = {
  good: {
    label: "Eligible",
    badge: "bg-[var(--status-present-bg)] text-[var(--status-present-text)]",
    bar: "bg-green-500",
  },
  warning: {
    label: "At risk",
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  critical: {
    label: "Defaulter",
    badge: "bg-[var(--status-absent-bg)] text-[var(--status-absent-text)]",
    bar: "bg-red-500",
  },
  "no-data": {
    label: "No data",
    badge: "bg-[var(--bg-input)] text-[var(--text-muted)]",
    bar: "bg-[var(--border-subtle)]",
  },
};

const formatDay = (key, opts = { day: "numeric", month: "short" }) =>
  new Date(`${key}T00:00:00`).toLocaleDateString("en-IN", opts);

const csvCell = (value) => {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const Reports = () => {
  const { classroomId } = useOutletContext();
  const { token } = useAuth();
  const toast = useToast();

  const [preset, setPreset] = useState("30d");
  const [from, setFrom] = useState(() => toDateInput(daysAgo(29)));
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [onlyDefaulters, setOnlyDefaulters] = useState(false);
  const [sortBy, setSortBy] = useState("rollNumber");
  const [showAlerts, setShowAlerts] = useState(false);

  useEffect(() => {
    if (!classroomId) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `${API_URL}/attendance/report?classroomId=${classroomId}&from=${from}&to=${to}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load report");
        setReport(data);
      } catch (err) {
        if (err.name !== "AbortError") setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, [classroomId, from, to, token]);

  const applyPreset = (p) => {
    setPreset(p.id);
    setFrom(toDateInput(p.from()));
    setTo(toDateInput(new Date()));
  };

  const rows = useMemo(() => {
    if (!report) return [];
    const q = search.toLowerCase();
    const list = report.students.filter(
      (s) =>
        (!onlyDefaulters || s.status === "warning" || s.status === "critical") &&
        (s.name.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q)),
    );
    const sorters = {
      rollNumber: (a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }),
      name: (a, b) => a.name.localeCompare(b.name),
      low: (a, b) => a.percentage - b.percentage,
      high: (a, b) => b.percentage - a.percentage,
    };
    return [...list].sort(sorters[sortBy]);
  }, [report, search, onlyDefaulters, sortBy]);

  const exportCsv = () => {
    if (!report) return;
    const header = ["Roll Number", "Name", "Lectures Attended", "Of which Duty Leave", "Medical Leave (excused)", "Absent", "Counted Lectures", "Attendance %", "Status"];
    const lines = report.students.map((s) =>
      [s.rollNumber, s.name, s.present, s.dutyLeave || 0, s.medicalLeave || 0, s.absent, s.totalSessions, s.percentage, STATUS_STYLES[s.status].label]
        .map(csvCell)
        .join(","),
    );
    const meta = [
      `Classroom,${csvCell(report.classroom.name)}`,
      `Period,${report.from} to ${report.to}`,
      `Minimum required,${report.threshold}%`,
      "",
    ];
    const blob = new Blob(["﻿" + [...meta, header.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.classroom.name.replace(/[^\w-]+/g, "_")}_attendance_${report.from}_to_${report.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Attendance report downloaded");
  };

  const exportExcel = async () => {
    try {
      await downloadFile(
        `/attendance/register.xlsx?classroomId=${classroomId}&from=${from}&to=${to}`,
        token,
        `${(report?.classroom.name || "class").replace(/[^\w-]+/g, "_")}_register_${from}_to_${to}.xlsx`,
      );
      toast.success("Excel register downloaded");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const maxDay = Math.max(1, ...(report?.days || []).map((d) => d.total));
  const multiPeriod = new Set((report?.days || []).map((d) => d.date)).size < (report?.days || []).length;

  const stats = report
    ? [
        { label: "Class average", value: `${report.classAverage}%`, icon: <FiTrendingUp />, tone: report.classAverage >= report.threshold ? "text-green-500" : "text-amber-500" },
        { label: "Classes held", value: report.totalSessions, icon: <FiCalendar />, tone: "text-[var(--color-primary)]" },
        { label: "Students", value: report.totalStudents, icon: <FiUsers />, tone: "text-[var(--color-primary)]" },
        { label: `Below ${report.threshold}%`, value: report.defaulterCount, icon: <FiAlertTriangle />, tone: report.defaulterCount ? "text-red-500" : "text-green-500" },
      ]
    : [];

  return (
    <div className="space-y-8 print-report">
      {/* Print-only header */}
      {report && (
        <div className="hidden print:block mb-4">
          <h1 className="text-2xl font-bold">SnapTick — Attendance Report</h1>
          <p className="text-sm">
            {report.classroom.name} · {formatDay(report.from, { dateStyle: "medium" })} to{" "}
            {formatDay(report.to, { dateStyle: "medium" })} · Minimum required {report.threshold}%
          </p>
        </div>
      )}

      {/* Range controls */}
      <div className="glass-card p-4 sm:p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-4 print:hidden min-w-0">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              className={`px-4 py-2 rounded-full text-sm font-semibold border whitespace-nowrap flex-shrink-0 transition-colors ${
                preset === p.id
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-text)] border-[var(--color-primary)]"
                  : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-main)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3">
          <input
            type="date"
            value={from}
            max={to}
            aria-label="From date"
            onChange={(e) => {
              setPreset("custom");
              setFrom(e.target.value);
            }}
            className="input-premium px-3 py-2 text-sm font-semibold w-full sm:w-auto min-w-0"
          />
          <input
            type="date"
            value={to}
            min={from}
            aria-label="To date"
            onChange={(e) => {
              setPreset("custom");
              setTo(e.target.value);
            }}
            className="input-premium px-3 py-2 text-sm font-semibold w-full sm:w-auto min-w-0"
          />
          <button
            onClick={exportCsv}
            disabled={!report}
            className="btn-primary px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"
          >
            <FiDownload /> Export CSV
          </button>
          <button
            onClick={exportExcel}
            disabled={!report}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-input)] flex items-center justify-center gap-2"
          >
            <FiGrid /> Excel register
          </button>
          <button
            onClick={() => setShowAlerts((v) => !v)}
            disabled={!report}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-input)] flex items-center justify-center gap-2"
          >
            <FiBell /> Alerts
          </button>
          <button
            onClick={() => window.print()}
            disabled={!report}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-input)] flex items-center justify-center gap-2"
          >
            <FiPrinter /> Print / PDF
          </button>
        </div>
      </div>

      {showAlerts && <AlertsPanel classroomId={classroomId} from={from} to={to} onClose={() => setShowAlerts(false)} />}

      {error && (
        <div className="glass-card p-4 text-[var(--status-absent-text)] bg-[var(--status-absent-bg)]">{error}</div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <Motion.div
            key={s.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="eyebrow">{s.label}</p>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center bg-[var(--bg-input)] ${s.tone}`}>{s.icon}</div>
            </div>
            <p className="font-display text-[48px] leading-none text-[var(--text-main)] tabular-nums">{s.value}</p>
          </Motion.div>
        ))}
      </div>

      {/* Daily trend */}
      {report && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-6">
            <FiBarChart2 className="text-[var(--color-primary)]" />
            <h3 className="font-semibold text-[var(--text-main)]">Daily attendance</h3>
          </div>
          {report.days.length === 0 ? (
            <p className="text-center py-8 text-[var(--text-muted)]">
              No attendance taken in this period yet. Use Smart Scan or Records to mark attendance.
            </p>
          ) : (
            <div className="flex items-end gap-2 h-48 overflow-x-auto pb-2">
              {report.days.map((d) => (
                <div key={`${d.date}-${d.period}`} className="flex flex-col items-center gap-1 min-w-[36px] flex-1 h-full justify-end group">
                  <span className="text-[10px] font-bold text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity">
                    {d.present}/{d.total}
                  </span>
                  <div
                    className={`w-full max-w-[40px] rounded-t-lg ${d.percentage >= report.threshold ? "bg-[var(--color-primary)]" : "bg-amber-500"}`}
                    style={{ height: `${Math.max(4, (d.present / maxDay) * 100)}%` }}
                    title={`${formatDay(d.date)}${multiPeriod ? ` · Lecture ${d.period}` : ""}: ${d.present} of ${d.total} present (${d.percentage}%)`}
                  />
                  <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                    {formatDay(d.date)}
                    {multiPeriod ? ` L${d.period}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Student table */}
      <div className="glass-card p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col md:flex-row justify-between gap-4 mb-6 print:hidden">
          <div className="relative w-full md:w-80">
            <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search name or roll number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-premium pl-12 pr-6 py-3 w-full"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={onlyDefaulters}
                onChange={(e) => setOnlyDefaulters(e.target.checked)}
                className="accent-[var(--color-primary)] w-4 h-4"
              />
              Below {report?.threshold ?? 75}% only
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="input-premium px-4 py-2 text-sm font-semibold"
            >
              <option value="rollNumber">Sort: Roll number</option>
              <option value="name">Sort: Name</option>
              <option value="low">Sort: Lowest attendance</option>
              <option value="high">Sort: Highest attendance</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-2 sm:gap-4 px-3 sm:px-4 py-3 rounded-xl bg-[var(--bg-input)] text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 border border-[var(--border-subtle)]">
          <div className="col-span-7 md:col-span-4">Student</div>
          <div className="hidden md:block md:col-span-2">Roll No.</div>
          <div className="hidden md:block md:col-span-2 text-center">Attended</div>
          <div className="col-span-5 md:col-span-2">Attendance</div>
          <div className="hidden md:block md:col-span-2 text-right">Status</div>
        </div>

        <div className="space-y-2">
          {loading && !report ? (
            <div className="text-center py-12 text-[var(--text-muted)]">Building report...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">
              {report?.students.length === 0
                ? "No students enrolled in this classroom yet."
                : onlyDefaulters
                  ? `Great — no student is below ${report?.threshold}% in this period.`
                  : "No results found."}
            </div>
          ) : (
            rows.map((s) => {
              const style = STATUS_STYLES[s.status];
              return (
                <div
                  key={s.studentId}
                  className="grid grid-cols-12 gap-2 sm:gap-4 p-3 sm:p-4 rounded-xl items-center bg-[var(--bg-input)] break-inside-avoid"
                >
                  <div className="col-span-7 md:col-span-4 font-semibold text-[var(--text-main)] flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold bg-[var(--color-primary)] text-[var(--color-primary-text)]">
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate">{s.name}</p>
                      <p className="md:hidden flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] min-w-0">
                        <span className="font-mono truncate">{s.rollNumber}</span>
                        <span className={`px-1.5 py-px rounded font-semibold whitespace-nowrap ${style.badge}`}>{style.label}</span>
                      </p>
                    </div>
                  </div>
                  <div className="hidden md:block md:col-span-2 text-sm font-semibold text-[var(--text-secondary)]">
                    {s.rollNumber}
                  </div>
                  <div className="hidden md:block md:col-span-2 text-center font-mono text-sm text-[var(--text-secondary)]">
                    {s.present}/{s.totalSessions}
                    {(s.dutyLeave > 0 || s.medicalLeave > 0) && (
                      <span className="block text-[10px] text-[var(--text-muted)]">
                        {[s.dutyLeave ? `DL ${s.dutyLeave}` : "", s.medicalLeave ? `ML ${s.medicalLeave}` : ""].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  <div className="col-span-5 md:col-span-2">
                    <p className="text-sm font-bold text-[var(--text-main)]">
                      {s.percentage}%
                      <span className="md:hidden font-mono font-normal text-[11px] text-[var(--text-muted)] ml-1.5">
                        {s.present}/{s.totalSessions}
                      </span>
                    </p>
                    <div className="h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden mt-1">
                      <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${s.percentage}%` }} />
                    </div>
                  </div>
                  <div className="hidden md:flex md:col-span-2 justify-end">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${style.badge}`}>{style.label}</span>
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

export default Reports;
