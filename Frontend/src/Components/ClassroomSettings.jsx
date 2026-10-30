import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FiPlus, FiTrash2, FiSave, FiClock, FiShield, FiActivity, FiCamera } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useClassroom } from "../context/ClassroomContext";
import { api, DAYS } from "../utils/api";

const ACTION_LABEL = {
  "attendance.confirm": "Saved a scan",
  "attendance.mark": "Marked a student",
  "attendance.status": "Changed a record",
  "attendance.unmark": "Marked absent",
  "student.enroll": "Enrolled a student",
  "student.enroll_from_scan": "Enrolled from a scan",
  "student.update": "Edited a student",
  "student.delete": "Removed a student",
  "student.import_roster": "Imported a roster",
  "student.import_photos": "Imported photos",
  "request.approved": "Approved a request",
  "request.rejected": "Rejected a request",
  "request.create": "Student raised a request",
  "alerts.send": "Sent attendance alerts",
  "classroom.settings": "Changed settings",
  "classroom.purge_biometrics": "Deleted face data",
  "admin.unlock_day": "Admin re-opened a day",
};

const Section = ({ icon, title, children, hint }) => (
  <div className="glass-card p-5 sm:p-6">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-[var(--text-muted)]">{icon}</span>
      <h3 className="font-semibold text-[var(--text-main)]">{title}</h3>
    </div>
    {hint && <p className="text-sm text-[var(--text-muted)] mb-4">{hint}</p>}
    {children}
  </div>
);

const ClassroomSettings = () => {
  const { classroom } = useOutletContext();
  const { token } = useAuth();
  const toast = useToast();
  const { fetchClassrooms } = useClassroom();
  const [subjectCode, setSubjectCode] = useState(classroom.subjectCode || "");
  const [threshold, setThreshold] = useState(classroom.threshold || 75);
  const [liveCaptureOnly, setLiveCaptureOnly] = useState(Boolean(classroom.liveCaptureOnly));
  const [schedule, setSchedule] = useState(classroom.schedule || []);
  const [saving, setSaving] = useState(false);
  const [audit, setAudit] = useState([]);
  const [purgeName, setPurgeName] = useState("");

  useEffect(() => {
    api(`/attendance/audit?classroomId=${classroom._id}&limit=60`, { token }).then(setAudit).catch(() => {});
  }, [classroom._id, token]);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/classroom/${classroom._id}/settings`, {
        token,
        method: "PUT",
        body: { subjectCode, threshold: Number(threshold), liveCaptureOnly, schedule },
      });
      toast.success("Settings saved");
      fetchClassrooms?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const purge = async () => {
    try {
      const r = await api(`/classroom/${classroom._id}/purge-biometrics`, { token, method: "POST", body: { confirm: purgeName } });
      toast.success(r.message);
      setPurgeName("");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const updateSlot = (i, patch) => setSchedule((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="grid xl:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Section icon={<FiShield />} title="Class details & eligibility">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-[var(--text-secondary)]">Subject code</span>
              <input value={subjectCode} onChange={(e) => setSubjectCode(e.target.value)} placeholder="e.g. KCS-501" className="input-premium w-full px-3 py-2.5 mt-1.5" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[var(--text-secondary)]">Minimum attendance (%)</span>
              <input type="number" min="1" max="100" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="input-premium w-full px-3 py-2.5 mt-1.5" />
            </label>
          </div>
          <label className="flex items-start gap-3 mt-5 cursor-pointer">
            <input type="checkbox" checked={liveCaptureOnly} onChange={(e) => setLiveCaptureOnly(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[var(--color-primary)]" />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-main)]"><FiCamera /> Live camera only</span>
              <span className="block text-sm text-[var(--text-muted)]">
                Attendance can only be taken with the in-app camera, not from gallery photos, so an old photo cannot be reused.
              </span>
            </span>
          </label>
        </Section>

        <Section icon={<FiClock />} title="Timetable" hint="Used to pre-select the lecture number when you take attendance and to show this class on your overview.">
          <div className="space-y-2">
            {schedule.length === 0 && <p className="text-sm text-[var(--text-muted)]">No lectures added yet.</p>}
            {schedule.map((slot, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 items-center">
                <select value={slot.day} onChange={(e) => updateSlot(i, { day: Number(e.target.value) })} className="input-premium px-2 py-2 text-sm">
                  {DAYS.map((d, n) => (
                    <option key={d} value={n}>{d}</option>
                  ))}
                </select>
                <input type="time" value={slot.start} onChange={(e) => updateSlot(i, { start: e.target.value })} className="input-premium px-2 py-2 text-sm min-w-0" />
                <input type="time" value={slot.end} onChange={(e) => updateSlot(i, { end: e.target.value })} className="input-premium px-2 py-2 text-sm min-w-0" />
                <select value={slot.period} onChange={(e) => updateSlot(i, { period: Number(e.target.value) })} className="input-premium px-2 py-2 text-sm" title="Lecture number in the day">
                  {[1, 2, 3, 4, 5, 6].map((p) => (
                    <option key={p} value={p}>L{p}</option>
                  ))}
                </select>
                <button onClick={() => setSchedule((s) => s.filter((_, j) => j !== i))} className="p-2 text-[var(--text-muted)] hover:text-[var(--status-absent-text)]" aria-label="Remove lecture">
                  <FiTrash2 />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSchedule((s) => [...s, { day: new Date().getDay(), start: "09:30", end: "10:20", period: 1 }])}
            className="mt-3 text-sm font-semibold text-[var(--text-main)] flex items-center gap-1.5 hover:underline"
          >
            <FiPlus /> Add lecture
          </button>
        </Section>

        <button onClick={save} disabled={saving} className="btn-primary w-full py-3 rounded-xl flex items-center justify-center gap-2">
          <FiSave /> {saving ? "Saving…" : "Save settings"}
        </button>

        <Section icon={<FiTrash2 />} title="Delete face data" hint="At the end of a semester, delete every student's photos and face data in this class. Attendance records are kept. This cannot be undone.">
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={purgeName} onChange={(e) => setPurgeName(e.target.value)} placeholder={`Type "${classroom.name}" to confirm`} className="input-premium flex-1 px-3 py-2.5 text-sm" />
            <button
              onClick={purge}
              disabled={purgeName !== classroom.name}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-[var(--status-absent-text)] text-white disabled:opacity-40"
            >
              Delete face data
            </button>
          </div>
        </Section>
      </div>

      <Section icon={<FiActivity />} title="Activity log" hint="Every change to this class, newest first.">
        <div className="space-y-1 max-h-[640px] overflow-y-auto">
          {audit.length === 0 && <p className="text-sm text-[var(--text-muted)]">No activity yet.</p>}
          {audit.map((e) => (
            <div key={e._id} className="flex items-start justify-between gap-3 py-2 border-b border-[var(--border-subtle)] last:border-0">
              <div className="min-w-0">
                <p className="text-sm text-[var(--text-main)]">
                  {ACTION_LABEL[e.action] || e.action}
                  {e.target && <span className="font-mono text-xs text-[var(--text-muted)] ml-1.5">{e.target}</span>}
                </p>
                <p className="text-xs text-[var(--text-muted)] truncate">
                  {e.actorName}
                  {e.details?.day ? ` · ${e.details.day}` : ""}
                  {e.details?.period ? ` · L${e.details.period}` : ""}
                  {e.details?.to ? ` · → ${e.details.to.replace("_", " ")}` : ""}
                  {Array.isArray(e.details?.marked) ? ` · ${e.details.marked.length} marked` : ""}
                </p>
              </div>
              <span className="text-[11px] font-mono text-[var(--text-muted)] whitespace-nowrap">
                {new Date(e.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
};

export default ClassroomSettings;
