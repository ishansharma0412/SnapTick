import React, { useState } from "react";
import { FiArrowLeft } from "react-icons/fi";
import { api } from "../utils/api";

// Two-step reset: request a 6-digit code by email, then set a new password.
// endpoint is "/auth" (faculty, field "email") or "/portal" (students, field "login").
const ForgotPassword = ({ endpoint, loginField, loginLabel, initialLogin = "", onDone }) => {
  const [login, setLogin] = useState(initialLogin);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const requestCode = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api(`${endpoint}/forgot-password`, { method: "POST", body: { [loginField]: login.trim() } });
      setSent(true);
      setMsg({ ok: true, text: r.message });
    });
  };

  const reset = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api(`${endpoint}/reset-password`, { method: "POST", body: { [loginField]: login.trim(), code: code.trim(), password } });
      setMsg({ ok: true, text: r.message });
      setTimeout(onDone, 1200);
    });
  };

  return (
    <div>
      <button onClick={onDone} className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] mb-6">
        <FiArrowLeft /> Back to sign in
      </button>
      <p className="eyebrow mb-3">Password reset</p>
      <h2 className="font-display text-[40px] leading-none text-[var(--text-main)] mb-3">Reset your password.</h2>
      <p className="text-[var(--text-secondary)] text-sm mb-6">
        {sent ? "Enter the 6-digit code from your email and choose a new password. The code is valid for 15 minutes." : "We will email you a 6-digit code."}
      </p>
      {msg && (
        <p className={`mb-4 p-3 rounded-lg text-sm ${msg.ok ? "bg-[var(--status-present-bg)] text-[var(--status-present-text)]" : "bg-red-500/10 border border-red-500/20 text-red-500"}`}>{msg.text}</p>
      )}
      <form onSubmit={sent ? reset : requestCode} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">{loginLabel}</label>
          <input value={login} onChange={(e) => setLogin(e.target.value)} disabled={sent} className="input-premium w-full px-4 py-3" required />
        </div>
        {sent && (
          <>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="6-digit code" className="input-premium w-full px-4 py-3 font-mono tracking-[0.3em]" required />
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} placeholder="New password (8+ characters)" className="input-premium w-full px-4 py-3" required />
          </>
        )}
        <button disabled={busy} className="btn-primary w-full py-3.5 rounded-xl">
          {busy ? "Please wait…" : sent ? "Set new password" : "Send code"}
        </button>
        {sent && (
          <button type="button" onClick={() => { setSent(false); setMsg(null); }} className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">
            Didn't get it? Send again
          </button>
        )}
      </form>
    </div>
  );
};

export default ForgotPassword;
