import React, { useState } from "react";
import { FiUpload, FiDownload, FiFileText, FiArchive } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../utils/api";

const TEMPLATE = "Roll Number,Name,Email,Phone,Guardian Email,Guardian Phone\n2300320100001,Student Name,student@college.edu,9876543210,parent@example.com,9876500000\n";

// Bulk onboarding: a CSV roster, then a ZIP of photos named by roll number
const RosterImport = ({ classroomId, onDone }) => {
  const { token } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState(null);

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "snaptick-roster-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importRoster = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy("roster");
    try {
      const r = await api("/enroll/import-roster", { token, method: "POST", body: { classroomId, csv: await file.text() } });
      setResult({ kind: "Roster", message: r.message, issues: r.skipped.map((s) => `Line ${s.line}${s.rollNumber ? ` (${s.rollNumber})` : ""}: ${s.reason}`) });
      toast.success(r.message);
      onDone?.(r.created);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  };

  const importPhotos = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy("photos");
    try {
      const form = new FormData();
      form.append("classroomId", classroomId);
      form.append("consent", String(consent));
      form.append("zip", file);
      const r = await api("/enroll/import-photos", { token, method: "POST", form });
      setResult({
        kind: "Photos",
        message: r.message,
        issues: [...r.failed.map((f) => `${f.rollNumber}: ${f.reason}`), ...r.unmatched.map((n) => `${n}: no student with this roll number`)],
      });
      toast.success(r.message);
      onDone?.(0);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="glass-card p-5 sm:p-6 mt-6">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-semibold text-[var(--text-main)] flex items-center gap-2">
          <FiUpload className="text-[var(--text-muted)]" /> Bulk import
        </h3>
        <button onClick={downloadTemplate} className="text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-main)] flex items-center gap-1">
          <FiDownload /> CSV template
        </button>
      </div>
      <p className="text-sm text-[var(--text-muted)] mb-4">
        1. Upload the class list as CSV (Roll Number, Name, optional Email/Phone). 2. Upload a ZIP of photos named by roll number, e.g. <span className="font-mono">2300320100001.jpg</span>.
        Students without a photo can also be identified during their first scan.
      </p>

      <div className="grid sm:grid-cols-2 gap-2">
        <label className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-[var(--border-dashed)] text-sm font-semibold cursor-pointer hover:bg-[var(--bg-input)] ${busy ? "opacity-60 pointer-events-none" : ""}`}>
          <FiFileText /> {busy === "roster" ? "Importing…" : "Roster CSV"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={importRoster} />
        </label>
        <label
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-[var(--border-dashed)] text-sm font-semibold ${
            consent && !busy ? "cursor-pointer hover:bg-[var(--bg-input)]" : "opacity-50 cursor-not-allowed"
          }`}
          title={consent ? "" : "Confirm consent first"}
        >
          <FiArchive /> {busy === "photos" ? "Processing photos…" : "Photos ZIP"}
          <input type="file" accept=".zip,application/zip" className="hidden" disabled={!consent || Boolean(busy)} onChange={importPhotos} />
        </label>
      </div>
      <label className="flex items-start gap-2 mt-3 text-xs text-[var(--text-secondary)] cursor-pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[var(--color-primary)]" />
        These students have agreed to their photos and face data being stored for attendance.
      </label>

      {result && (
        <div className="mt-4 p-3 rounded-xl bg-[var(--bg-input)] text-sm">
          <p className="font-semibold text-[var(--text-main)]">{result.kind}: {result.message}</p>
          {result.issues.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-[var(--text-muted)] max-h-32 overflow-y-auto">
              {result.issues.map((i) => (
                <li key={i}>• {i}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default RosterImport;
