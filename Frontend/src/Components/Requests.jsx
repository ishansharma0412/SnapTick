import React, { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FiCheck, FiX, FiInbox } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, STATUS_LABEL } from "../utils/api";

const TYPE_LABEL = { present: "I was present", duty_leave: "Duty leave", medical_leave: "Medical leave" };

const Requests = () => {
  const { classroomId, refreshPending } = useOutletContext();
  const { token } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("pending");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api(`/requests?classroomId=${classroomId}&status=${tab}`, { token }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [classroomId, tab, token, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id, decision) => {
    setBusy(id);
    try {
      const r = await api(`/requests/${id}/decide`, { token, method: "POST", body: { decision, note: notes[id] || "" } });
      toast.success(r.message);
      setItems((list) => list.filter((x) => x._id !== id));
      refreshPending?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {["pending", "approved", "rejected"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-full text-sm font-semibold border capitalize transition-colors ${
              tab === t
                ? "bg-[var(--color-primary)] text-[var(--color-primary-text)] border-[var(--color-primary)]"
                : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-main)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="glass-card p-4 sm:p-6">
        {loading ? (
          <p className="text-center py-10 text-[var(--text-muted)]">Loading requests…</p>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <FiInbox className="mx-auto text-3xl mb-3" />
            {tab === "pending" ? "No pending requests. Students raise them from the student portal." : `No ${tab} requests.`}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((r) => (
              <div key={r._id} className="p-4 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)]">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-main)]">
                      {r.studentName} <span className="font-mono text-xs text-[var(--text-muted)] ml-1">{r.rollNumber}</span>
                    </p>
                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                      <span className="font-semibold">{TYPE_LABEL[r.type]}</span> · {r.day} · Lecture {r.period}
                    </p>
                    <p className="text-sm text-[var(--text-main)] mt-2 whitespace-pre-wrap break-words">“{r.reason}”</p>
                    {r.teacherNote && <p className="text-xs text-[var(--text-muted)] mt-2">Your note: {r.teacherNote}</p>}
                  </div>
                  <span className="eyebrow whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString("en-IN")}</span>
                </div>
                {r.status === "pending" && (
                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <input
                      value={notes[r._id] || ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [r._id]: e.target.value }))}
                      placeholder="Optional note to the student"
                      className="input-premium flex-1 px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={busy === r._id}
                        onClick={() => decide(r._id, "approve")}
                        className="btn-primary flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-1.5"
                      >
                        <FiCheck /> Approve ({STATUS_LABEL[r.type]})
                      </button>
                      <button
                        disabled={busy === r._id}
                        onClick={() => decide(r._id, "reject")}
                        className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--border-subtle)] text-[var(--status-absent-text)] hover:bg-[var(--status-absent-bg)] flex items-center justify-center gap-1.5"
                      >
                        <FiX /> Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Requests;
