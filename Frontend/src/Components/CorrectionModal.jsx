import React, { useEffect, useMemo, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { FiX, FiUserCheck, FiUserX, FiUserPlus, FiSearch } from "react-icons/fi";

const OPTION_STYLE = (active) =>
  `flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
    active
      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
      : "border-[var(--border-subtle)] hover:border-[var(--text-muted)]"
  }`;

const Radio = ({ active }) => (
  <div
    className={`w-5 h-5 flex-shrink-0 rounded-full border-2 flex items-center justify-center mt-0.5 ${
      active ? "border-[var(--color-primary)]" : "border-[var(--text-muted)]"
    }`}
  >
    {active && <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]" />}
  </div>
);

const CorrectionModal = ({
  isOpen,
  onClose,
  onSave,
  onEnrollNew,
  faceIndex,
  currentMatch,
  faceImageUrl,
  enrolledStudents,
  takenStudentIds = [],
}) => {
  // "different_student" | "new_student" | "not_enrolled"
  const [correctionType, setCorrectionType] = useState("different_student");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [search, setSearch] = useState("");
  const [addToTraining, setAddToTraining] = useState(true);
  const [newName, setNewName] = useState("");
  const [newRoll, setNewRoll] = useState("");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Reset each time the modal opens for a face
  useEffect(() => {
    if (!isOpen) return;
    setCorrectionType("different_student");
    setSelectedStudentId("");
    setSearch("");
    setAddToTraining(true);
    setNewName("");
    setNewRoll("");
    setConsent(false);
    setError("");
  }, [isOpen, faceIndex]);

  const filteredStudents = useMemo(() => {
    const q = search.toLowerCase();
    return (enrolledStudents || []).filter(
      (s) => s.name.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q),
    );
  }, [enrolledStudents, search]);

  const canSave =
    (correctionType === "different_student" && selectedStudentId) ||
    (correctionType === "new_student" && newName.trim() && newRoll.trim() && consent) ||
    correctionType === "not_enrolled";

  const handleSave = async () => {
    setError("");
    if (correctionType === "not_enrolled") {
      onSave({ faceIndex, action: "skip", studentId: null, addToTraining: false });
      onClose();
    } else if (correctionType === "different_student" && selectedStudentId) {
      onSave({ faceIndex, action: "correct", studentId: selectedStudentId, addToTraining });
      onClose();
    } else if (correctionType === "new_student") {
      setSaving(true);
      const result = await onEnrollNew({ faceIndex, name: newName.trim(), rollNumber: newRoll.trim(), consent });
      setSaving(false);
      if (result?.error) {
        setError(result.error);
        return;
      }
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Modal backdrop */}
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal container */}
        <Motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative z-10 w-full max-w-lg mx-4 max-h-[92vh] flex flex-col bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] overflow-hidden"
        >
          {/* Modal header */}
          <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
            <h2 className="text-lg font-bold text-[var(--text-main)]">
              Who is face #{faceIndex + 1}?
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <FiX size={20} />
            </button>
          </div>

          {/* Modal body */}
          <div className="p-5 space-y-4 overflow-y-auto">
            {/* Face preview + current match */}
            <div className="flex items-center gap-4 p-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)]">
              {faceImageUrl ? (
                <img
                  src={faceImageUrl}
                  alt={`Face ${faceIndex + 1}`}
                  className="w-24 h-24 rounded-xl object-cover border border-[var(--border-subtle)]"
                />
              ) : (
                <div className="w-24 h-24 rounded-xl bg-[var(--bg-app)]" />
              )}
              <div>
                <p className="text-sm text-[var(--text-muted)]">Recognized as</p>
                <p className="text-lg font-bold text-[var(--text-main)]">
                  {currentMatch?.status === "matched" ? currentMatch.name : "Not recognized"}
                </p>
                {currentMatch?.status !== "matched" && (
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Pick the student, or add them to this class.
                  </p>
                )}
              </div>
            </div>

            {/* Existing student */}
            <label className={OPTION_STYLE(correctionType === "different_student")}>
              <input
                type="radio"
                name="correctionType"
                checked={correctionType === "different_student"}
                onChange={() => setCorrectionType("different_student")}
                className="sr-only"
              />
              <Radio active={correctionType === "different_student"} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <FiUserCheck className="text-[var(--text-muted)]" />
                  <span className="font-medium text-[var(--text-main)]">An enrolled student</span>
                </div>
                {correctionType === "different_student" && (
                  <>
                    <div className="relative mb-2">
                      <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name or roll number"
                        className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-main)] focus:border-[var(--color-primary)] focus:outline-none"
                      />
                    </div>
                    <div className="max-h-44 overflow-y-auto space-y-1">
                      {filteredStudents.length === 0 && (
                        <p className="text-xs text-[var(--text-muted)] p-2">No matching students.</p>
                      )}
                      {filteredStudents.map((student) => {
                        const taken = takenStudentIds.includes(student._id);
                        return (
                          <button
                            type="button"
                            key={student._id}
                            onClick={() => setSelectedStudentId(student._id)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                              selectedStudentId === student._id
                                ? "bg-[var(--color-primary)] text-[var(--color-primary-text)]"
                                : "hover:bg-[var(--bg-app)] text-[var(--text-main)]"
                            }`}
                          >
                            <span className="truncate font-medium">{student.name}</span>
                            <span className="text-xs opacity-75 ml-2 whitespace-nowrap">
                              {student.rollNumber}
                              {taken ? " · in photo" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedStudentId && (
                      <label className="flex items-center gap-2 mt-3 text-sm text-[var(--text-secondary)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={addToTraining}
                          onChange={(e) => setAddToTraining(e.target.checked)}
                          className="w-4 h-4 accent-[var(--color-primary)]"
                        />
                        Learn this face (better recognition next time)
                      </label>
                    )}
                  </>
                )}
              </div>
            </label>

            {/* New student */}
            <label className={OPTION_STYLE(correctionType === "new_student")}>
              <input
                type="radio"
                name="correctionType"
                checked={correctionType === "new_student"}
                onChange={() => setCorrectionType("new_student")}
                className="sr-only"
              />
              <Radio active={correctionType === "new_student"} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FiUserPlus className="text-[var(--text-muted)]" />
                  <span className="font-medium text-[var(--text-main)]">New student — add to this class</span>
                </div>
                {correctionType === "new_student" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Full name"
                      autoFocus
                      className="px-3 py-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-main)] focus:border-[var(--color-primary)] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newRoll}
                      onChange={(e) => setNewRoll(e.target.value)}
                      placeholder="Roll number"
                      className="px-3 py-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-main)] focus:border-[var(--color-primary)] focus:outline-none"
                    />
                    <p className="sm:col-span-2 text-xs text-[var(--text-muted)]">
                      This face is saved as their enrolment photo and they are marked present.
                    </p>
                    <label className="sm:col-span-2 flex items-start gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[var(--color-primary)]" />
                      The student has agreed to their photo and face data being stored for attendance.
                    </label>
                  </div>
                )}
              </div>
            </label>

            {/* Skip */}
            <label className={OPTION_STYLE(correctionType === "not_enrolled")}>
              <input
                type="radio"
                name="correctionType"
                checked={correctionType === "not_enrolled"}
                onChange={() => setCorrectionType("not_enrolled")}
                className="sr-only"
              />
              <Radio active={correctionType === "not_enrolled"} />
              <div className="flex items-center gap-2">
                <FiUserX className="text-[var(--text-muted)]" />
                <span className="font-medium text-[var(--text-main)]">Not a student (skip this face)</span>
              </div>
            </label>

            {error && (
              <p className="p-3 rounded-xl bg-[var(--status-absent-bg)] text-[var(--status-absent-text)] text-sm font-medium">
                {error}
              </p>
            )}
          </div>

          {/* Modal footer */}
          <div className="flex gap-3 p-5 border-t border-[var(--border-subtle)] bg-[var(--bg-input)]">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] font-bold hover:bg-[var(--bg-app)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="flex-1 px-4 py-3 rounded-xl bg-[var(--color-primary)] text-[var(--color-primary-text)] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving
                ? "Adding..."
                : correctionType === "new_student"
                  ? "Add & mark present"
                  : correctionType === "not_enrolled"
                    ? "Skip face"
                    : "Save"}
            </button>
          </div>
        </Motion.div>
      </div>
    </AnimatePresence>
  );
};

export default CorrectionModal;
