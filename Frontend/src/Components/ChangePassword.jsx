import React, { useState } from "react";
import { FiLock } from "react-icons/fi";
import { api } from "../utils/api";

// Change password for a signed-in teacher (/auth/change-password) or student (/portal/password)
const ChangePassword = ({ token, endpoint = "/auth/change-password", method = "PUT" }) => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api(endpoint, { token, method, body: { currentPassword: current, newPassword: next } });
      setMsg({ ok: true, text: r.message || "Password changed" });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 text-sm font-medium text-[var(--text-main)] hover:underline">
        <FiLock /> Change password
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" className="input-premium w-full px-3 py-2 text-sm" required />
      <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+ characters)" minLength={8} className="input-premium w-full px-3 py-2 text-sm" required />
      {msg && <p className={`text-xs ${msg.ok ? "text-[var(--status-present-text)]" : "text-[var(--status-absent-text)]"}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 py-2 rounded-lg border border-[var(--border-subtle)] text-sm">Cancel</button>
        <button disabled={busy} className="flex-1 btn-primary py-2 rounded-lg text-sm">{busy ? "Saving…" : "Update"}</button>
      </div>
    </form>
  );
};

export default ChangePassword;
