import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiCamera, FiLogOut, FiMoon, FiSun, FiSend, FiArrowLeft } from "react-icons/fi";
import { api, toDay, STATUS_LABEL } from "../utils/api";
import ChangePassword from "./ChangePassword";
import ForgotPassword from "./ForgotPassword";

const TOKEN_KEY = "studentToken";

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};
const writeToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session only */
  }
};

const STATUS_STYLE = {
  good: "text-[var(--status-present-text)]",
  warning: "text-amber-600",
  critical: "text-[var(--status-absent-text)]",
  "no-data": "text-[var(--text-muted)]",
};
const REQUEST_STYLE = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "bg-[var(--status-present-bg)] text-[var(--status-present-text)]",
  rejected: "bg-[var(--status-absent-bg)] text-[var(--status-absent-text)]",
};

function AuthForms({ onSignedIn }) {
  const [mode, setMode] = useState("login"); // login | register | forgot
  const [form, setForm] = useState({ login: "", rollNumber: "", name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = mode === "login"
        ? { login: form.login.trim(), password: form.password }
        : { rollNumber: form.rollNumber.trim(), name: form.name.trim(), email: form.email.trim(), password: form.password };
      const r = await api(`/portal/${mode}`, { method: "POST", body });
      onSignedIn(r.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (mode === "forgot") {
    return <ForgotPassword endpoint="/portal" loginField="login" loginLabel="Roll number or email" initialLogin={form.login} onDone={() => setMode("login")} />;
  }

  return (
    <div>
      <p className="eyebrow mb-3">Student portal</p>
      <h2 className="font-display text-[40px] leading-none text-[var(--text-main)] mb-3">
        {mode === "login" ? "Your attendance." : "Create your account."}
      </h2>
      <p className="text-[var(--text-secondary)] text-sm mb-6">
        {mode === "login"
          ? "Sign in with your roll number or email to see your attendance in every subject."
          : "Use the roll number your teacher enrolled you with. If your teacher recorded your email, use that same email."}
      </p>
      {error && <p className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        {mode === "login" ? (
          <input value={form.login} onChange={set("login")} placeholder="Roll number or email" autoComplete="username" className="input-premium w-full px-4 py-3" required />
        ) : (
          <>
            <input value={form.rollNumber} onChange={set("rollNumber")} placeholder="Roll number" className="input-premium w-full px-4 py-3" required />
            <input value={form.name} onChange={set("name")} placeholder="Full name" className="input-premium w-full px-4 py-3" required />
            <input type="email" value={form.email} onChange={set("email")} placeholder="Email" autoComplete="email" className="input-premium w-full px-4 py-3" required />
          </>
        )}
        <input
          type="password"
          value={form.password}
          onChange={set("password")}
          placeholder={mode === "login" ? "Password" : "Password (8+ characters)"}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "login" ? 1 : 8}
          className="input-premium w-full px-4 py-3"
          required
        />
        <button disabled={busy} className="btn-primary w-full py-3.5 rounded-xl">
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="font-medium text-[var(--text-main)] hover:underline">
          {mode === "login" ? "First time? Create account" : "Have an account? Sign in"}
        </button>
        {mode === "login" && (
          <button onClick={() => setMode("forgot")} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">Forgot password?</button>
        )}
      </div>
    </div>
  );
}

function RequestForm({ token, subjects, onSent }) {
  const [form, setForm] = useState({ classroomId: subjects[0]?.classroomId || "", day: toDay(), period: 1, type: "present", reason: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const minDay = toDay(new Date(Date.now() - 14 * 24 * 3600 * 1000));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("/portal/requests", { token, method: "POST", body: { ...form, period: Number(form.period) } });
      setMsg({ ok: true, text: r.message });
      setForm((f) => ({ ...f, reason: "" }));
      onSent();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass-card p-5 space-y-3">
      <h3 className="font-semibold text-[var(--text-main)]">Request a correction</h3>
      <p className="text-xs text-[var(--text-muted)]">Marked absent by mistake, or on duty/medical leave? Your teacher reviews every request. Requests can be raised for the last 14 days.</p>
      <select value={form.classroomId} onChange={set("classroomId")} className="input-premium w-full px-3 py-2.5 text-sm" required>
        {subjects.map((s) => <option key={s.classroomId} value={s.classroomId}>{s.name}{s.subjectCode ? ` (${s.subjectCode})` : ""}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" min={minDay} max={toDay()} value={form.day} onChange={set("day")} className="input-premium px-3 py-2.5 text-sm" required />
        <select value={form.period} onChange={set("period")} className="input-premium px-3 py-2.5 text-sm">
          {Array.from({ length: 8 }, (_, i) => <option key={i + 1} value={i + 1}>Lecture {i + 1}</option>)}
        </select>
      </div>
      <select value={form.type} onChange={set("type")} className="input-premium w-full px-3 py-2.5 text-sm">
        <option value="present">I was present</option>
        <option value="duty_leave">Duty leave (college event, NCC, sports…)</option>
        <option value="medical_leave">Medical leave</option>
      </select>
      <textarea value={form.reason} onChange={set("reason")} rows={3} maxLength={500} placeholder="Reason, e.g. I sat in the last row and was not in the photo" className="input-premium w-full px-3 py-2.5 text-sm" required minLength={5} />
      {msg && <p className={`text-xs ${msg.ok ? "text-[var(--status-present-text)]" : "text-[var(--status-absent-text)]"}`}>{msg.text}</p>}
      <button disabled={busy || !form.classroomId} className="btn-primary w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2">
        <FiSend /> {busy ? "Sending…" : "Send to teacher"}
      </button>
    </form>
  );
}

function Dashboard({ token, onSignOut }) {
  const [data, setData] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [me, reqs] = await Promise.all([api("/portal/me", { token }), api("/portal/requests", { token })]);
      setData(me);
      setRequests(reqs);
    } catch (e) {
      if (e.status === 401 || e.status === 403) onSignOut();
      else setError(e.message);
    }
  }, [token, onSignOut]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="text-[var(--status-absent-text)]">{error}</p>;
  if (!data) return <p className="text-[var(--text-muted)]">Loading your attendance…</p>;
  const subjectName = new Map(data.subjects.map((s) => [s.classroomId, s.name]));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-8">
        <div>
          <p className="eyebrow mb-3">{data.student.rollNumber}</p>
          <h1 className="font-display text-[40px] sm:text-[48px] leading-none text-[var(--text-main)]">Hello, {data.student.name.split(" ")[0]}.</h1>
          <p className="text-[var(--text-secondary)] mt-3 text-sm">Attendance over the current semester (last 180 days).</p>
        </div>
        <ChangePassword token={token} endpoint="/portal/password" />
      </div>

      {data.subjects.length === 0 ? (
        <p className="glass-card p-6 text-sm text-[var(--text-muted)]">You are not enrolled in any class yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
          {data.subjects.map((s) => (
            <div key={s.classroomId} className="glass-card p-5">
              <p className="eyebrow truncate">{s.subjectCode || "Subject"} · {s.teacher}</p>
              <h3 className="font-semibold text-[var(--text-main)] mt-1 truncate">{s.name}</h3>
              <p className={`font-display text-[52px] leading-none mt-3 ${STATUS_STYLE[s.status] || ""}`}>
                {s.totalSessions ? `${s.percentage}%` : "—"}
              </p>
              <div className="h-1.5 rounded-full bg-[var(--bg-input)] mt-3 overflow-hidden relative">
                <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${Math.min(100, s.percentage)}%` }} />
                <div className="absolute top-0 h-full w-0.5 bg-[var(--text-main)]" style={{ left: `${s.threshold}%` }} title={`Minimum ${s.threshold}%`} />
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-3">
                {s.present} of {s.totalSessions} lectures
                {s.dutyLeave ? ` · ${s.dutyLeave} duty leave` : ""}
                {s.medicalLeave ? ` · ${s.medicalLeave} medical (excused)` : ""}
              </p>
              {s.lecturesToRecover > 0 ? (
                <p className="text-xs font-semibold mt-2 text-[var(--status-absent-text)]">
                  Below {s.threshold}%: attend the next {s.lecturesToRecover} lecture{s.lecturesToRecover > 1 ? "s" : ""} to recover.
                </p>
              ) : s.totalSessions > 0 ? (
                <p className="text-xs mt-2 text-[var(--status-present-text)]">Meets the {s.threshold}% minimum.</p>
              ) : null}
              {s.faceSamples === 0 && <p className="text-xs mt-2 text-amber-600">No face photo on record yet. Ask your teacher to add one.</p>}
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          {data.subjects.length > 0 && <RequestForm token={token} subjects={data.subjects} onSent={load} />}
          <div className="glass-card p-5">
            <h3 className="font-semibold text-[var(--text-main)] mb-3">My requests</h3>
            {requests.length === 0 && <p className="text-sm text-[var(--text-muted)]">No requests yet.</p>}
            {requests.map((r) => (
              <div key={r._id} className="py-2.5 border-b border-[var(--border-subtle)] last:border-0">
                <div className="flex justify-between gap-2">
                  <p className="text-sm text-[var(--text-main)] min-w-0 truncate">
                    {subjectName.get(r.classroomId) || "Subject"} · {r.day} · L{r.period}
                  </p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full capitalize ${REQUEST_STYLE[r.status]}`}>{r.status}</span>
                </div>
                <p className="text-xs text-[var(--text-muted)]">{STATUS_LABEL[r.type]} — {r.reason}</p>
                {r.teacherNote && <p className="text-xs text-[var(--text-secondary)] mt-0.5">Teacher: {r.teacherNote}</p>}
              </div>
            ))}
          </div>
        </div>
        <div className="glass-card p-5 h-fit">
          <h3 className="font-semibold text-[var(--text-main)] mb-3">Recent attendance</h3>
          {data.recent.length === 0 && <p className="text-sm text-[var(--text-muted)]">No attendance recorded yet.</p>}
          {data.recent.map((r, i) => (
            <div key={i} className="flex justify-between gap-2 py-2 border-b border-[var(--border-subtle)] last:border-0 text-sm">
              <span className="min-w-0 truncate text-[var(--text-main)]">{r.classroom}</span>
              <span className="font-mono text-xs text-[var(--text-muted)] whitespace-nowrap">{r.day} · L{r.period} · {STATUS_LABEL[r.status]}</span>
            </div>
          ))}
          <p className="text-[11px] text-[var(--text-muted)] mt-3">Lectures you missed are not listed here; they count as absent.</p>
        </div>
      </div>
    </div>
  );
}

export default function StudentPortal({ isDark, setIsDark }) {
  const [token, setToken] = useState(readToken);
  const signIn = (t) => {
    writeToken(t);
    setToken(t);
  };
  const signOut = useCallback(() => {
    writeToken("");
    setToken("");
  }, []);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-[var(--border-subtle)]">
        <Link to="/" className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-lg bg-[var(--color-primary)] flex items-center justify-center text-[var(--color-primary-text)]"><FiCamera /></span>
          <span className="font-semibold tracking-tight text-[var(--text-main)]">SnapTick</span>
          <span className="eyebrow ml-1 hidden sm:inline">Students</span>
        </Link>
        <div className="flex items-center gap-1">
          <button onClick={() => setIsDark(!isDark)} className="p-2.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Toggle theme">
            {isDark ? <FiSun /> : <FiMoon />}
          </button>
          {token && (
            <button onClick={signOut} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">
              <FiLogOut /> Sign out
            </button>
          )}
        </div>
      </header>
      <main className={token ? "max-w-6xl mx-auto px-4 sm:px-8 py-8" : "max-w-sm mx-auto px-4 py-12"}>
        {token ? (
          <Dashboard token={token} onSignOut={signOut} />
        ) : (
          <>
            <AuthForms onSignedIn={signIn} />
            <Link to="/login" className="mt-10 flex items-center justify-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">
              <FiArrowLeft /> Faculty sign in
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
