import React, { useEffect, useState } from "react";
import { FiMail, FiMessageCircle, FiBell, FiX } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../utils/api";

/** wa.me link with the message pre-filled; Indian 10-digit numbers get +91 */
function whatsappLink(phone, text) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : "";
}

// Notify students below the eligibility threshold (and optionally their guardians)
const AlertsPanel = ({ classroomId, from, to, onClose }) => {
  const { token } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [includeGuardians, setIncludeGuardians] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api(`/attendance/alerts?classroomId=${classroomId}&from=${from}&to=${to}`, { token })
      .then(setData)
      .catch((e) => toast.error(e.message));
  }, [classroomId, from, to, token, toast]);

  const sendAll = async () => {
    setSending(true);
    try {
      const r = await api("/attendance/alerts/send", { token, method: "POST", body: { classroomId, from, to, includeGuardians } });
      toast.success(r.message);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="glass-card p-5 sm:p-6 print:hidden">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-[var(--text-main)] flex items-center gap-2">
            <FiBell className="text-[var(--text-muted)]" /> Attendance alerts
          </h3>
          <p className="text-sm text-[var(--text-muted)]">
            Students below {data?.threshold ?? "the minimum"}% between {from} and {to}.
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Close alerts">
          <FiX />
        </button>
      </div>

      {!data ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : data.students.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Every student meets the minimum in this period. No alerts needed.</p>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <button onClick={sendAll} disabled={sending} className="btn-primary px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2">
              <FiMail /> {sending ? "Sending…" : `Email ${data.students.length} student(s)`}
            </button>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" checked={includeGuardians} onChange={(e) => setIncludeGuardians(e.target.checked)} className="w-4 h-4 accent-[var(--color-primary)]" />
              Also email guardians
            </label>
          </div>
          {!data.mailConfigured && (
            <p className="mb-4 p-3 rounded-xl text-xs bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">
              Email is not set up on the server yet (SMTP settings). Messages will be written to the server log instead. WhatsApp links below work from your phone.
            </p>
          )}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {data.students.map((s) => {
              const wa = whatsappLink(s.phone, s.message);
              const waGuardian = whatsappLink(s.guardianPhone, s.guardianMessage);
              return (
                <div key={s.rollNumber} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-[var(--bg-input)]">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-main)] truncate">
                      {s.name} <span className="font-mono text-xs text-[var(--text-muted)]">{s.rollNumber}</span>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {s.percentage}% · {s.present}/{s.totalSessions} lectures · {s.email || "no email on record"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {wa && (
                      <a href={wa} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border-subtle)] hover:bg-[var(--bg-card)] flex items-center gap-1.5">
                        <FiMessageCircle /> Student
                      </a>
                    )}
                    {waGuardian && (
                      <a href={waGuardian} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border-subtle)] hover:bg-[var(--bg-card)] flex items-center gap-1.5">
                        <FiMessageCircle /> Guardian
                      </a>
                    )}
                    {!wa && !waGuardian && <span className="text-xs text-[var(--text-muted)]">No phone number</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default AlertsPanel;
