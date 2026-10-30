import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion as Motion } from "framer-motion";
import {
  FiPlus,
  FiUsers,
  FiEdit2,
  FiTrash2,
  FiX,
  FiFolder,
  FiChevronRight,
  FiCalendar,
  FiCheckCircle,
  FiTrendingUp,
  FiCamera,
  FiBarChart2,
  FiClock,
} from "react-icons/fi";
import { useClassroom } from "../context/ClassroomContext";
import { useAuth } from "../context/AuthContext";
import API_URL from "../config/api";
import { api, toDay } from "../utils/api";

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

const formatLastTaken = (key) => {
  if (!key) return "Not started";
  const d = new Date(`${key}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "Taken today";
  if (diff === 1) return "Last taken yesterday";
  return `Last taken ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
};

export default function ClassroomDashboard() {
  const navigate = useNavigate();
  const {
    classrooms,
    loading,
    createClassroom,
    updateClassroom,
    deleteClassroom,
    selectClassroom,
  } = useClassroom();

  const [showModal, setShowModal] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState(null);
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [overview, setOverview] = useState(null);
  const { teacher, token } = useAuth();

  // Live numbers for the stat cards and classroom cards
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/attendance/overview`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setOverview)
      .catch(() => setOverview(null));
  }, [token, classrooms.length]);

  const statsFor = (id) => overview?.classrooms.find((c) => c.classroomId === id);

  const [pendingByClass, setPendingByClass] = useState({});
  const [holidays, setHolidays] = useState([]);
  useEffect(() => {
    if (!token) return;
    api("/requests/pending-count", { token }).then(setPendingByClass).catch(() => {});
    api("/admin/holidays", { token }).then(setHolidays).catch(() => {});
  }, [token]);
  const todayHoliday = holidays.find((h) => h.day === toDay());

  // Lecture running now, or the next one today, from every classroom's timetable
  const lectureNow = (() => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const today = (overview?.classrooms || [])
      .flatMap((c) => (c.schedule || []).filter((s) => s.day === now.getDay()).map((s) => ({ ...s, classroomId: c.classroomId, name: c.name })))
      .sort((a, b) => a.start.localeCompare(b.start));
    const current = today.find((s) => s.start <= hhmm && hhmm < s.end);
    if (current) return { ...current, when: "now" };
    const next = today.find((s) => s.start > hhmm);
    return next ? { ...next, when: "next" } : today.length ? { when: "done" } : null;
  })();

  const openCreateModal = () => {
    setEditingClassroom(null);
    setFormData({ name: "", description: "" });
    setFormError("");
    setShowModal(true);
  };

  const openEditModal = (classroom, e) => {
    e.stopPropagation();
    setEditingClassroom(classroom);
    setFormData({
      name: classroom.name,
      description: classroom.description || "",
    });
    setFormError("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingClassroom(null);
    setFormData({ name: "", description: "" });
    setFormError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    setFormLoading(true);

    try {
      if (editingClassroom) {
        await updateClassroom(
          editingClassroom._id,
          formData.name,
          formData.description,
        );
      } else {
        await createClassroom(formData.name, formData.description);
      }
      closeModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteClassroom(id);
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const handleClassroomClick = (classroom) => {
    selectClassroom(classroom);
    navigate(`/classroom/${classroom._id}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <p className="eyebrow mb-3">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
          <h1 className="font-display text-[44px] leading-none text-[var(--text-main)]">
            {greeting()}, {teacher?.name?.split(" ")[0] || "Teacher"}.
          </h1>
          <p className="text-[var(--text-secondary)] mt-3">
            Attendance overview for today across your classrooms.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="btn-primary px-5 py-3 rounded-xl flex items-center gap-2 self-start sm:self-auto"
        >
          <FiPlus /> New Classroom
        </button>
      </div>

      {todayHoliday && (
        <div className="mb-6 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm">
          Today is a holiday: <b>{todayHoliday.label}</b>
        </div>
      )}

      {lectureNow && lectureNow.when !== "done" && (
        <div className="surface-ink rounded-xl bg-[var(--bg-sidebar)] p-5 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="eyebrow flex items-center gap-2">
              {lectureNow.when === "now" ? <span className="accent-dot" /> : null}
              {lectureNow.when === "now" ? "In progress" : "Next lecture today"}
            </p>
            <p className="font-display text-3xl leading-tight mt-1">{lectureNow.name}</p>
            <p className="text-sm text-[var(--text-secondary)] font-mono mt-1">
              Lecture {lectureNow.period} · {lectureNow.start}–{lectureNow.end}
            </p>
          </div>
          <button
            onClick={() => navigate(`/classroom/${lectureNow.classroomId}/attendance`)}
            className="btn-primary px-5 py-3 rounded-lg flex items-center justify-center gap-2 self-start sm:self-auto whitespace-nowrap"
          >
            <FiCamera /> Take attendance
          </button>
        </div>
      )}

      {/* Overview stats */}
      {classrooms.length > 0 && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-10">
          {[
            {
              label: "Classrooms",
              value: overview?.totalClassrooms ?? classrooms.length,
              hint: overview ? `${overview.classesTakenToday} taken today` : "",
              icon: <FiFolder />,
              tone: "neutral",
            },
            {
              label: "Students enrolled",
              value: overview?.totalStudents ?? "—",
              hint: "across all classes",
              icon: <FiUsers />,
              tone: "neutral",
            },
            {
              label: "Present today",
              highlight: true,
              value: overview ? overview.presentToday : "—",
              hint: overview?.todayRate != null ? `${overview.todayRate}% of classes taken` : "No attendance yet today",
              icon: <FiCheckCircle />,
              tone: "neutral",
            },
            {
              label: "30-day average",
              value: overview?.average30d != null ? `${overview.average30d}%` : "—",
              hint: overview?.average30d != null && overview.average30d < 75 ? "Below 75% requirement" : "Attendance rate",
              icon: <FiTrendingUp />,
              tone: overview?.average30d != null && overview.average30d < 75 ? "warning" : "neutral",
            },
          ].map((s, i) => (
            <Motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={s.highlight ? "surface-ink rounded-xl p-5 bg-[var(--bg-sidebar)] border border-black/30" : "glass-card p-5"}
            >
              <div className="flex items-center justify-between mb-4">
                <p className="eyebrow">{s.label}</p>
                <div
                  className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                    s.tone === "warning"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                  }`}
                >
                  {s.icon}
                </div>
              </div>
              <p className={`font-display text-[52px] leading-none tabular-nums ${s.highlight ? "text-[var(--color-primary)]" : "text-[var(--text-main)]"}`}>
                {s.value}
              </p>
              {s.hint && <p className="text-xs text-[var(--text-muted)] mt-3">{s.hint}</p>}
            </Motion.div>
          ))}
        </div>
      )}

      {classrooms.length > 0 && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-[28px] leading-none text-[var(--text-main)]">Classrooms</h2>
          <p className="eyebrow">{classrooms.length} active</p>
        </div>
      )}

      {/* Empty state */}
      {classrooms.length === 0 ? (
        <Motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-12 text-center"
        >
          <div className="h-16 w-16 rounded-2xl bg-[var(--color-primary)]/10 flex items-center justify-center mx-auto mb-4">
            <FiFolder className="text-3xl text-[var(--color-primary)]" />
          </div>
          <h3 className="text-xl font-semibold text-[var(--text-main)] mb-2">
            No classrooms yet
          </h3>
          <p className="text-[var(--text-muted)] mb-6 max-w-md mx-auto">
            Create your first classroom to start enrolling students and tracking
            attendance.
          </p>
          <button
            onClick={openCreateModal}
            className="btn-primary px-6 py-3 rounded-xl inline-flex items-center gap-2"
          >
            <FiPlus /> Create Your First Classroom
          </button>
        </Motion.div>
      ) : (
        /* Classroom grid */
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classrooms.map((classroom, index) => (
            <Motion.div
              key={classroom._id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => handleClassroomClick(classroom)}
              className="glass-card card-hover p-5 cursor-pointer group flex flex-col"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="h-11 w-11 rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center text-lg font-bold">
                  {classroom.name.trim().charAt(0).toUpperCase()}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => openEditModal(classroom, e)}
                    className="p-2 rounded-lg hover:bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                  >
                    <FiEdit2 size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(classroom);
                    }}
                    className="p-2 rounded-lg hover:bg-[var(--status-absent-bg)] text-[var(--text-muted)] hover:text-[var(--status-absent-text)] transition-colors"
                  >
                    <FiTrash2 size={16} />
                  </button>
                </div>
              </div>

              <h3 className="font-semibold text-[17px] text-[var(--text-main)] mb-1">
                {classroom.name}
              </h3>
              {classroom.description && (
                <p className="text-sm text-[var(--text-muted)] mb-3 line-clamp-2">
                  {classroom.description}
                </p>
              )}

              {(() => {
                const st = statsFor(classroom._id);
                const students = st?.students ?? classroom.studentCount ?? 0;
                const avg = st?.average30d;
                return (
                  <div className="mt-auto pt-4 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-[var(--text-secondary)] font-medium">
                        <FiUsers size={14} /> {students} {students === 1 ? "student" : "students"}
                        {pendingByClass[classroom._id] > 0 && (
                          <span className="ml-1 px-2 py-0.5 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] text-[10px] font-bold">
                            {pendingByClass[classroom._id]} request{pendingByClass[classroom._id] > 1 ? "s" : ""}
                          </span>
                        )}
                      </span>
                      <span
                        className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${
                          st?.takenToday
                            ? "bg-[var(--status-present-bg)] text-[var(--status-present-text)]"
                            : "bg-[var(--bg-input)] text-[var(--text-muted)]"
                        }`}
                      >
                        {st?.takenToday ? <FiCheckCircle size={12} /> : <FiClock size={12} />}
                        {st?.takenToday ? `${st.presentToday}/${students} today` : "Not taken today"}
                      </span>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--text-muted)]">30-day attendance</span>
                        <span className={`font-bold ${avg == null ? "text-[var(--text-muted)]" : avg >= 75 ? "text-[var(--status-present-text)]" : "text-amber-500"}`}>
                          {avg == null ? "—" : `${avg}%`}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--bg-input)] overflow-hidden">
                        <div
                          className={`h-full rounded-full ${avg != null && avg < 75 ? "bg-amber-500" : "bg-[var(--color-primary)]"}`}
                          style={{ width: `${avg ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)]">
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-1 min-w-0 truncate">
                        <FiCalendar size={12} className="flex-shrink-0" />
                        <span className="truncate">{formatLastTaken(st?.lastTaken)}</span>
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            selectClassroom(classroom);
                            navigate(`/classroom/${classroom._id}/attendance`);
                          }}
                          className="px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-primary)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)] flex items-center gap-1.5 whitespace-nowrap transition-colors"
                          title="Take attendance"
                        >
                          <FiCamera size={13} /> Take attendance
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            selectClassroom(classroom);
                            navigate(`/classroom/${classroom._id}/reports`);
                          }}
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--nav-active-bg)] transition-colors"
                          title="Reports"
                        >
                          <FiBarChart2 size={14} />
                        </button>
                        <FiChevronRight className="text-[var(--text-muted)] group-hover:text-[var(--color-primary)] group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Motion.div>
          ))}

          {/* Add classroom card */}
          <Motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: classrooms.length * 0.05 }}
            onClick={openCreateModal}
            className="rounded-[1.25rem] p-5 cursor-pointer border-2 border-dashed border-[var(--border-dashed)] hover:border-[var(--color-primary)] hover:bg-[var(--nav-active-bg)] transition-colors flex flex-col items-center justify-center min-h-[220px] text-[var(--text-muted)] hover:text-[var(--color-primary)]"
          >
            <div className="h-12 w-12 rounded-xl border-2 border-dashed border-current flex items-center justify-center mb-3">
              <FiPlus className="text-xl" />
            </div>
            <span className="font-semibold">New classroom</span>
            <span className="text-xs mt-1">Add a section, batch or subject</span>
          </Motion.div>
        </div>
      )}

      {/* Create/edit modal */}
      <AnimatePresence>
        {showModal && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
          >
            <Motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-[var(--text-main)]">
                  {editingClassroom ? "Edit Classroom" : "Create Classroom"}
                </h2>
                <button
                  onClick={closeModal}
                  className="p-2 rounded-lg hover:bg-[var(--bg-input)] text-[var(--text-muted)]"
                >
                  <FiX />
                </button>
              </div>

              {formError && (
                <div className="mb-4 p-3 rounded-lg bg-[var(--status-absent-bg)] text-[var(--status-absent-text)] text-sm">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Classroom Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="e.g., Class 10A - Mathematics"
                    className="input-premium w-full px-4 py-3"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Description (optional)
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="Add a brief description..."
                    rows={3}
                    className="input-premium w-full px-4 py-3 resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 px-4 py-3 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-input)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formLoading}
                    className="flex-1 btn-primary px-4 py-3 rounded-xl"
                  >
                    {formLoading ? (
                      <div className="w-5 h-5 border-2 border-[var(--color-primary-text)] border-t-transparent rounded-full animate-spin mx-auto" />
                    ) : editingClassroom ? (
                      "Save Changes"
                    ) : (
                      "Create Classroom"
                    )}
                  </button>
                </div>
              </form>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteConfirm(null)}
          >
            <Motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card p-6 w-full max-w-sm text-center"
            >
              <div className="h-14 w-14 rounded-full bg-[var(--status-absent-bg)] flex items-center justify-center mx-auto mb-4">
                <FiTrash2 className="text-2xl text-[var(--status-absent-text)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-main)] mb-2">
                Delete Classroom?
              </h3>
              <p className="text-[var(--text-muted)] text-sm mb-6">
                This will permanently delete "{deleteConfirm.name}" and all its
                students and attendance records. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-input)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm._id)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--status-absent-text)] text-white hover:opacity-90 transition-opacity"
                >
                  Delete
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>
    </Motion.div>
  );
}
