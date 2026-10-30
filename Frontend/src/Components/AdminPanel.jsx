import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { FiMail, FiDownload, FiUnlock, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, toDay } from "../utils/api";

const TABS = ["Defaulters", "Classrooms", "Teachers", "Holidays", "Activity"];

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const Th = ({ children, right }) => (
  <th className={`px-3 py-2.5 text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>
);
const Td = ({ children, right, mono }) => (
  <td className={`px-3 py-2.5 text-sm text-[var(--text-main)] ${right ? "text-right" : ""} ${mono ? "font-mono text-xs" : ""}`}>{children}</td>
);

const AdminPanel = () => {
  const { teacher, token } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("Defaulters");
  const [holidays, setHolidays] = useState([]);
  const [newHoliday, setNewHoliday] = useState({ day: toDay(), label: "" });
  const [audit, setAudit] = useState([]);
  const [unlock, setUnlock] = useState({ classroomId: "", day: "" });
  const [report, setReport] = useState(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api(`/admin/overview?days=${days}`, { token }));
    } catch (e) {
      toast.error(e.message);
    }
  }, [days, token, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (tab === "Holidays") api("/admin/holidays", { token }).then(setHolidays).catch(() => {});
    if (tab === "Activity") api("/admin/audit?limit=200", { token }).then(setAudit).catch(() => {});
  }, [tab, token]);

  const defaulters = useMemo(() => {
    const q = search.toLowerCase();
    return (data?.defaulters || []).filter((d) => [d.name, d.rollNumber, d.classroom, d.teacher].some((x) => String(x).toLowerCase().includes(q)));
  }, [data, search]);

  if (teacher && teacher.role !== "admin") return <Navigate to="/dashboard" replace />;

  const exportDefaulters = () => {
    const header = ["Roll Number", "Name", "Classroom", "Subject Code", "Teacher", "Department", "Attended", "Total", "Attendance %", "Threshold %"];
    const rows = defaulters.map((d) => [d.rollNumber, d.name, d.classroom, d.subjectCode, d.teacher, d.department, d.present, d.totalSessions, d.percentage, d.threshold].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + [header.join(","), ...rows].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `defaulters_last_${days}_days_${toDay()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendSummary = async () => {
    try {
      toast.success((await api("/admin/summary/send", { token, method: "POST" })).message);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const updateTeacher = async (id, patch) => {
    try {
      await api(`/admin/teachers/${id}`, { token, method: "PUT", body: patch });
      toast.success("Teacher updated");
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const doUnlock = async () => {
    try {
      toast.success((await api(`/admin/classrooms/${unlock.classroomId}/unlock`, { token, method: "POST", body: { day: unlock.day } })).message);
      setUnlock({ classroomId: "", day: "" });
    } catch (e) {
      toast.error(e.message);
    }
  };

  const openReport = async (c) => {
    try {
      setReport({ name: c.name, data: await api(`/admin/classrooms/${c.classroomId}/report`, { token }) });
    } catch (e) {
      toast.error(e.message);
    }
  };

  const addHoliday = async (e) => {
    e.preventDefault();
    try {
      await api("/admin/holidays", { token, method: "POST", body: newHoliday });
      setHolidays(await api("/admin/holidays", { token }));
      setNewHoliday({ day: toDay(), label: "" });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeHoliday = async (day) => {
    await api(`/admin/holidays/${day}`, { token, method: "DELETE" }).catch((e) => toast.error(e.message));
    setHolidays((h) => h.filter((x) => x.day !== day));
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <p className="eyebrow mb-3">Department</p>
          <h1 className="font-display text-[44px] leading-none text-[var(--text-main)]">Attendance across classes</h1>
          <p className="text-[var(--text-secondary)] mt-3">Eligibility, teachers and calendar for the whole department.</p>
        </div>
        <div className="flex gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input-premium px-3 py-2.5 text-sm font-semibold">
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Semester (180 days)</option>
          </select>
          <button onClick={sendSummary} className="btn-primary px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 whitespace-nowrap">
            <FiMail /> Email summary
          </button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {[
            ["Teachers", data.totals.teachers],
            ["Classrooms", data.totals.classrooms],
            ["Students", data.totals.students],
            ["Below threshold", data.totals.defaulters],
          ].map(([label, value], i) => (
            <div key={label} className={i === 3 ? "surface-ink rounded-xl p-5 bg-[var(--bg-sidebar)]" : "glass-card p-5"}>
              <p className="eyebrow">{label}</p>
              <p className={`font-display text-[48px] leading-none mt-3 ${i === 3 ? "text-[var(--color-primary)]" : "text-[var(--text-main)]"}`}>{value}</p>
            </div>
          ))}
        </div>
      )}
      {data && !data.mailConfigured && (
        <p className="mb-6 p-3 rounded-xl text-sm bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">
          Email (SMTP) is not configured on the server, so summaries, alerts and password-reset codes are written to the server log. Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM to send real email.
        </p>
      )}

      <div className="flex gap-6 mb-6 border-b border-[var(--border-subtle)] overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-3 -mb-px text-sm font-medium border-b-2 whitespace-nowrap ${tab === t ? "border-[var(--color-primary)] text-[var(--text-main)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}
          >
            {t}
            {t === "Defaulters" && data ? ` (${data.defaulters.length})` : ""}
          </button>
        ))}
      </div>

      {!data ? (
        <p className="text-[var(--text-muted)]">Loading…</p>
      ) : tab === "Defaulters" ? (
        <div className="glass-card p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student, class or teacher" className="input-premium flex-1 px-3 py-2.5 text-sm" />
            <button onClick={exportDefaulters} className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-[var(--border-subtle)] flex items-center justify-center gap-2">
              <FiDownload /> CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-[var(--border-subtle)]">
                <tr><Th>Student</Th><Th>Class</Th><Th>Teacher</Th><Th right>Attended</Th><Th right>%</Th></tr>
              </thead>
              <tbody>
                {defaulters.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10 text-sm text-[var(--text-muted)]">No student is below their class threshold.</td></tr>
                )}
                {defaulters.map((d) => (
                  <tr key={`${d.rollNumber}-${d.classroomId}`} className="border-b border-[var(--border-subtle)] last:border-0">
                    <Td>{d.name}<span className="block font-mono text-[11px] text-[var(--text-muted)]">{d.rollNumber}</span></Td>
                    <Td>{d.classroom}<span className="block text-[11px] text-[var(--text-muted)]">{d.subjectCode}</span></Td>
                    <Td>{d.teacher}</Td>
                    <Td right mono>{d.present}/{d.totalSessions}</Td>
                    <Td right><span className={`font-bold ${d.status === "critical" ? "text-[var(--status-absent-text)]" : "text-amber-600"}`}>{d.percentage}%</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "Classrooms" ? (
        <div className="space-y-6">
          <div className="glass-card p-4 sm:p-6 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-[var(--border-subtle)]">
                <tr><Th>Class</Th><Th>Teacher</Th><Th right>Students</Th><Th right>Lectures</Th><Th right>Average</Th><Th right>Below</Th><Th right> </Th></tr>
              </thead>
              <tbody>
                {data.classrooms.map((c) => (
                  <tr key={c.classroomId} className="border-b border-[var(--border-subtle)] last:border-0">
                    <Td>{c.name}<span className="block text-[11px] text-[var(--text-muted)]">{c.subjectCode}</span></Td>
                    <Td>{c.teacher}<span className="block text-[11px] text-[var(--text-muted)]">{c.department}</span></Td>
                    <Td right mono>{c.students}</Td>
                    <Td right mono>{c.sessions}</Td>
                    <Td right>{c.average == null ? "—" : `${c.average}%`}</Td>
                    <Td right>{c.defaulters}</Td>
                    <Td right><button onClick={() => openReport(c)} className="text-xs font-semibold underline">Report</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="glass-card p-5">
            <h3 className="font-semibold text-[var(--text-main)] flex items-center gap-2 mb-1"><FiUnlock /> Re-open a locked day</h3>
            <p className="text-sm text-[var(--text-muted)] mb-3">Attendance older than 48 hours is locked. Re-opening lets the class teacher edit that day for 24 hours; it is recorded in the activity log.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={unlock.classroomId} onChange={(e) => setUnlock((u) => ({ ...u, classroomId: e.target.value }))} className="input-premium flex-1 px-3 py-2.5 text-sm">
                <option value="">Choose a class</option>
                {data.classrooms.map((c) => <option key={c.classroomId} value={c.classroomId}>{c.name} — {c.teacher}</option>)}
              </select>
              <input type="date" max={toDay()} value={unlock.day} onChange={(e) => setUnlock((u) => ({ ...u, day: e.target.value }))} className="input-premium px-3 py-2.5 text-sm" />
              <button disabled={!unlock.classroomId || !unlock.day} onClick={doUnlock} className="btn-primary px-4 py-2.5 rounded-lg text-sm">Re-open</button>
            </div>
          </div>
        </div>
      ) : tab === "Teachers" ? (
        <div className="glass-card p-4 sm:p-6 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-[var(--border-subtle)]">
              <tr><Th>Teacher</Th><Th>Department</Th><Th right>Classes</Th><Th>Role</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {data.teachers.map((t) => (
                <tr key={t._id} className="border-b border-[var(--border-subtle)] last:border-0">
                  <Td>{t.name}<span className="block text-[11px] text-[var(--text-muted)]">{t.email}</span></Td>
                  <Td>
                    <input
                      defaultValue={t.department || ""}
                      placeholder="e.g. CSE"
                      onBlur={(e) => e.target.value !== (t.department || "") && updateTeacher(t._id, { department: e.target.value })}
                      className="input-premium px-2 py-1.5 text-sm w-28"
                    />
                  </Td>
                  <Td right mono>{t.classrooms}</Td>
                  <Td>
                    <select value={t.role} disabled={t._id === teacher?._id} onChange={(e) => updateTeacher(t._id, { role: e.target.value })} className="input-premium px-2 py-1.5 text-sm">
                      <option value="teacher">Teacher</option>
                      <option value="admin">Admin</option>
                    </select>
                  </Td>
                  <Td>
                    <button
                      disabled={t._id === teacher?._id}
                      onClick={() => updateTeacher(t._id, { isActive: !t.isActive })}
                      className={`px-3 py-1 rounded-full text-xs font-bold ${t.isActive ? "bg-[var(--status-present-bg)] text-[var(--status-present-text)]" : "bg-[var(--status-absent-bg)] text-[var(--status-absent-text)]"} disabled:opacity-60`}
                    >
                      {t.isActive ? "Active" : "Deactivated"}
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "Holidays" ? (
        <div className="glass-card p-4 sm:p-6 max-w-2xl">
          <form onSubmit={addHoliday} className="flex flex-col sm:flex-row gap-2 mb-5">
            <input type="date" value={newHoliday.day} onChange={(e) => setNewHoliday((h) => ({ ...h, day: e.target.value }))} className="input-premium px-3 py-2.5 text-sm" required />
            <input value={newHoliday.label} onChange={(e) => setNewHoliday((h) => ({ ...h, label: e.target.value }))} placeholder="e.g. Diwali" className="input-premium flex-1 px-3 py-2.5 text-sm" required />
            <button className="btn-primary px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-1.5"><FiPlus /> Add</button>
          </form>
          {holidays.length === 0 && <p className="text-sm text-[var(--text-muted)]">No holidays added.</p>}
          {holidays.map((h) => (
            <div key={h.day} className="flex items-center justify-between py-2.5 border-b border-[var(--border-subtle)] last:border-0">
              <span className="text-sm"><span className="font-mono text-xs text-[var(--text-muted)] mr-3">{h.day}</span>{h.label}</span>
              <button onClick={() => removeHoliday(h.day)} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--status-absent-text)]" aria-label={`Remove ${h.label}`}><FiTrash2 /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-4 sm:p-6">
          {audit.map((e) => (
            <div key={e._id} className="flex justify-between gap-3 py-2 border-b border-[var(--border-subtle)] last:border-0">
              <p className="text-sm text-[var(--text-main)] min-w-0">
                <span className="font-semibold">{e.actorName || e.actorType}</span> · {e.action.replace(/[._]/g, " ")}
                {e.target && <span className="font-mono text-xs text-[var(--text-muted)] ml-1.5">{e.target}</span>}
              </p>
              <span className="text-[11px] font-mono text-[var(--text-muted)] whitespace-nowrap">
                {new Date(e.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}

      {report && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setReport(null)}>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)] w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="eyebrow">Last 30 days · min {report.data.threshold}%</p>
                <h3 className="font-display text-3xl">{report.name}</h3>
              </div>
              <button onClick={() => setReport(null)} className="p-1.5" aria-label="Close report"><FiX /></button>
            </div>
            <table className="w-full">
              <thead className="border-b border-[var(--border-subtle)]"><tr><Th>Student</Th><Th right>Attended</Th><Th right>%</Th></tr></thead>
              <tbody>
                {report.data.students.map((s) => (
                  <tr key={s.studentId} className="border-b border-[var(--border-subtle)] last:border-0">
                    <Td>{s.name}<span className="block font-mono text-[11px] text-[var(--text-muted)]">{s.rollNumber}</span></Td>
                    <Td right mono>{s.present}/{s.totalSessions}</Td>
                    <Td right>{s.percentage}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
