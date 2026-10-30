import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AnimatePresence, motion as Motion } from "framer-motion";
import {
  FiUserPlus,
  FiEdit2,
  FiTrash2,
  FiSearch,
  FiCamera,
  FiCheck,
  FiPlus,
  FiRefreshCw,
  FiCpu,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { useClassroom } from "../context/ClassroomContext";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "./ConfirmModal";
import API_URL from "../config/api";
import { downscaleImage } from "../utils/image";
import StudentPhoto from "./StudentPhoto";
import RosterImport from "./RosterImport";
import { fetchStudentPhoto } from "../utils/studentPhoto";

// Compress preview image to reduce browser load
const createCompressedPreview = (file, maxWidth = 400) => {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
};

const EnrollForm = () => {
  const { classroomId } = useOutletContext();
  const { getAuthHeadersMultipart, token } = useAuth();
  const { updateStudentCount } = useClassroom();
  const [name, setName] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [image, setImage] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [students, setStudents] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState("");
  const [addingPhoto, setAddingPhoto] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [resetConfirm, setResetConfirm] = useState(null);
  const [reembedConfirm, setReembedConfirm] = useState(false);
  const [reembedding, setReembedding] = useState(false);
  const [reembedResults, setReembedResults] = useState(null);
  const toast = useToast();

  const fetchStudents = async () => {
    try {
      const res = await fetch(
        `${API_URL}/enroll?classroomId=${classroomId}&t=${Date.now()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setStudents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (classroomId) fetchStudents();
  }, [token, classroomId]);

  const [consent, setConsent] = useState(false);

  const resetForm = () => {
    setConsent(false);
    setName("");
    setRollNumber("");
    setImage(null);
    setImagePreview("");
    setEditing(null);
    setAddingPhoto(null);
    setMessage("");
    setError("");
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      if (editing) setEditing({ ...editing, image: file });
      else if (addingPhoto) setAddingPhoto({ ...addingPhoto, image: file });
      else setImage(file);
      const compressed = await createCompressedPreview(file);
      setImagePreview(compressed || URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("name", name);
    formData.append("rollNumber", rollNumber);
    formData.append("image", await downscaleImage(image, 1280));
    formData.append("classroomId", classroomId);
    formData.append("consent", String(consent));
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`${API_URL}/enroll`, {
        method: "POST",
        headers: getAuthHeadersMultipart(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMessage("Enrolled successfully!");
      resetForm();
      fetchStudents();
      updateStudentCount(classroomId, 1); // Increase student count
    } catch (err) {
      setError(err.message || "Failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editing) return;
    const formData = new FormData();
    formData.append("name", editing.name);
    formData.append("rollNumber", editing.rollNumber);
    for (const key of ["email", "phone", "guardianEmail", "guardianPhone"]) formData.append(key, editing[key] || "");
    if (editing.image) formData.append("image", await downscaleImage(editing.image, 1280));
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`${API_URL}/enroll/${editing._id}`, {
        method: "PUT",
        headers: getAuthHeadersMultipart(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setMessage("Updated!");
      resetForm();
      fetchStudents();
    } catch (err) {
      setError(err.message || "Update failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddPhoto = async (e) => {
    e.preventDefault();
    if (!addingPhoto || !addingPhoto.image) return;
    const formData = new FormData();
    formData.append("image", await downscaleImage(addingPhoto.image, 1280));
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(
        `${API_URL}/enroll/${addingPhoto._id}/add-photo`,
        {
          method: "POST",
          headers: getAuthHeadersMultipart(),
          body: formData,
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add photo");
      setMessage(data.message || "Photo added!");
      resetForm();
      fetchStudents();
    } catch (err) {
      setError(err.message || "Failed to add photo.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`${API_URL}/enroll/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Student deleted successfully");
      setDeleteConfirm(null);
      fetchStudents();
      updateStudentCount(classroomId, -1); // Decrease student count
    } catch (err) {
      toast.error(err.message || "Failed to delete student");
    }
  };

  const handleResetPhotos = async (id) => {
    try {
      const res = await fetch(`${API_URL}/enroll/${id}/reset-photos`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      toast.success("Photos reset successfully");
      setResetConfirm(null);
      fetchStudents();
    } catch (err) {
      toast.error(err.message || "Failed to reset photos");
    }
  };

  const handleReembed = async () => {
    setReembedding(true);
    setReembedResults(null);
    try {
      const res = await fetch(`${API_URL}/enroll/re-embed`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ classroomId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Re-embed failed");
      setReembedResults(data.results);
      toast.success(data.message || "Re-embedding complete!");
      setReembedConfirm(false);
      fetchStudents();
    } catch (err) {
      toast.error(err.message || "Failed to re-embed students");
    } finally {
      setReembedding(false);
    }
  };

  const startEdit = (student) => {
    setEditing({ ...student, image: null });
    setAddingPhoto(null);
    setImagePreview("");
    fetchStudentPhoto(student._id, token, student.image).then(setImagePreview).catch(() => {});
    setName("");
    setRollNumber("");
    setImage(null);
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startAddPhoto = (student) => {
    setAddingPhoto({ ...student, image: null });
    setEditing(null);
    setImagePreview("");
    fetchStudentPhoto(student._id, token, student.image).then(setImagePreview).catch(() => {});
    setName("");
    setRollNumber("");
    setImage(null);
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <Motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="grid xl:grid-cols-12 gap-8">
        {/* Enrollment form */}
        <div className="xl:col-span-4">
          <div className="glass-card p-5 sm:p-8">
            <h2 className="text-xl font-bold text-[var(--text-main)] mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--bg-app)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                {addingPhoto ? (
                  <FiPlus size={14} />
                ) : editing ? (
                  <FiEdit2 size={14} />
                ) : (
                  <FiUserPlus size={14} />
                )}
              </span>
              {addingPhoto
                ? `Add Photo: ${addingPhoto.name}`
                : editing
                  ? "Edit Profile"
                  : "New Enrollment"}
            </h2>

            <form
              onSubmit={
                addingPhoto
                  ? handleAddPhoto
                  : editing
                    ? handleUpdate
                    : handleSubmit
              }
              className="space-y-6"
            >
              <div className="flex justify-center">
                <div className="relative group cursor-pointer">
                  <div className="w-28 h-28 rounded-full overflow-hidden bg-[var(--bg-input)] border-4 border-[var(--border-subtle)] shadow-xl flex items-center justify-center transition-all">
                    {imagePreview ? (
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <FiCamera className="text-3xl text-[var(--text-muted)]" />
                    )}
                  </div>
                  <label className="absolute bottom-0 right-0 bg-[var(--border-subtle)] text-[var(--bg-sidebar)] p-2 rounded-full shadow-lg cursor-pointer hover:bg-[var(--text-main)] hover:text-[var(--bg-app)] transition-colors">
                    <FiCamera size={14} />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                      required={!editing && !addingPhoto}
                    />
                  </label>
                </div>
              </div>

              {addingPhoto ? (
                <div className="text-center text-sm text-[var(--text-muted)]">
                  <p>
                    Current photos:{" "}
                    <span className="font-bold text-[var(--text-main)]">
                      {addingPhoto.descriptorCount || 1}
                    </span>
                  </p>
                  <p className="mt-1">
                    Upload a new photo to improve recognition
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-bold text-[var(--text-muted)] ml-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={editing ? editing.name : name}
                      onChange={(e) =>
                        editing
                          ? setEditing({ ...editing, name: e.target.value })
                          : setName(e.target.value)
                      }
                      className="input-premium w-full mt-1 px-4 py-3"
                      placeholder="John Doe"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-[var(--text-muted)] ml-1">
                      Roll ID
                    </label>
                    <input
                      type="text"
                      value={editing ? editing.rollNumber : rollNumber}
                      onChange={(e) =>
                        editing
                          ? setEditing({
                              ...editing,
                              rollNumber: e.target.value,
                            })
                          : setRollNumber(e.target.value)
                      }
                      className="input-premium w-full mt-1 px-4 py-3"
                      placeholder="CS-001"
                      required
                    />
                  </div>
                  {editing && (
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ["email", "Student email"],
                        ["phone", "Student phone"],
                        ["guardianEmail", "Guardian email"],
                        ["guardianPhone", "Guardian phone"],
                      ].map(([key, label]) => (
                        <div key={key}>
                          <label className="text-xs font-bold text-[var(--text-muted)] ml-1">{label}</label>
                          <input
                            type="text"
                            value={editing[key] || ""}
                            onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                            className="input-premium w-full mt-1 px-3 py-2 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {!editing && (
                    <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[var(--color-primary)]" />
                      The student has agreed to their photo and face data being stored for attendance.
                    </label>
                  )}
                </div>
              )}

              <div className="pt-2 flex gap-3">
                {(editing || addingPhoto) && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-5 py-3 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] font-bold hover:bg-[var(--bg-app)]"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading || (addingPhoto && !addingPhoto.image) || (!editing && !addingPhoto && !consent)}
                  className="btn-primary flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2"
                >
                  {loading
                    ? "Processing..."
                    : addingPhoto
                      ? "Add Photo"
                      : editing
                        ? "Save Changes"
                        : "Enroll Student"}
                </button>
              </div>

              {message && (
                <div className="p-3 rounded-xl bg-[var(--status-present-bg)] text-[var(--status-present-text)] text-sm font-semibold flex items-center gap-2">
                  <FiCheck /> {message}
                </div>
              )}
              {error && (
                <div className="p-3 rounded-xl bg-[var(--status-absent-bg)] text-[var(--status-absent-text)] text-sm font-semibold">
                  {error}
                </div>
              )}
            </form>
          </div>
          {!editing && !addingPhoto && (
            <RosterImport
              classroomId={classroomId}
              onDone={(created) => {
                fetchStudents();
                if (created) updateStudentCount(classroomId, created);
              }}
            />
          )}
        </div>

        {/* Student list */}
        <div className="xl:col-span-8">
          {/* Re-embed controls */}
          {students.length > 0 && (
            <div className="mb-6 p-4 glass-card flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <FiCpu className="text-[var(--color-primary)] text-xl" />
                <div>
                  <p className="text-sm font-bold text-[var(--text-main)]">
                    Face Recognition Model
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Re-embed all students if recognition isn't working well
                  </p>
                </div>
              </div>
              <button
                onClick={() => setReembedConfirm(true)}
                disabled={reembedding}
                className="px-4 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[var(--text-main)] font-bold text-sm hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {reembedding ? (
                  <>
                    <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"></span>
                    Processing...
                  </>
                ) : (
                  <>
                    <FiRefreshCw size={14} />
                    Re-embed All
                  </>
                )}
              </button>
            </div>
          )}

          {/* Re-embed results */}
          {reembedResults && (
            <Motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 glass-card border-l-4 border-l-[var(--color-primary)]"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="font-bold text-[var(--text-main)]">
                  Re-embed Results
                </p>
                <button
                  onClick={() => setReembedResults(null)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Dismiss
                </button>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-[var(--status-present-text)]">
                  <strong>{reembedResults.success}</strong> updated
                </span>
                {reembedResults.failed > 0 && (
                  <span className="text-[var(--status-absent-text)]">
                    <strong>{reembedResults.failed}</strong> failed
                  </span>
                )}
                {reembedResults.skipped > 0 && (
                  <span className="text-[var(--text-muted)]">
                    <strong>{reembedResults.skipped}</strong> skipped
                  </span>
                )}
              </div>
            </Motion.div>
          )}

          {students.length === 0 ? (
            <div className="glass-card p-12 text-center flex flex-col items-center justify-center text-[var(--text-muted)]">
              <FiSearch size={32} className="opacity-50 mb-3" />
              <p>No students enrolled in this classroom yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
              <AnimatePresence>
                {students.map((student) => (
                  <Motion.div
                    key={student._id || student.rollNumber}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="group relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden hover:shadow-lg transition-all"
                  >
                    <div className="aspect-[4/3] relative overflow-hidden">
                      <StudentPhoto
                        student={student}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 lg:group-hover:opacity-100 transition-opacity" />
                      {/* Always visible on touch screens; revealed on hover on desktop */}
                      <div className="absolute top-2 right-2 sm:top-3 sm:right-3 flex flex-wrap justify-end gap-1.5 sm:gap-2 transition-all lg:opacity-0 lg:translate-y-2 lg:group-hover:opacity-100 lg:group-hover:translate-y-0">
                        <button
                          onClick={() => startAddPhoto(student)}
                          title="Add Photo"
                          className="p-1.5 sm:p-2 bg-white/90 backdrop-blur rounded-full shadow-sm text-slate-800 hover:text-green-600"
                        >
                          <FiPlus size={14} />
                        </button>
                        <button
                          onClick={() => startEdit(student)}
                          title="Edit"
                          className="p-1.5 sm:p-2 bg-white/90 backdrop-blur rounded-full shadow-sm text-slate-800 hover:text-[var(--text-accent)]"
                        >
                          <FiEdit2 size={14} />
                        </button>
                        <button
                          onClick={() => setResetConfirm(student)}
                          title="Reset Photos"
                          className="p-1.5 sm:p-2 bg-white/90 backdrop-blur rounded-full shadow-sm text-slate-800 hover:text-orange-600"
                        >
                          <FiRefreshCw size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(student)}
                          title="Delete"
                          className="p-1.5 sm:p-2 bg-white/90 backdrop-blur rounded-full shadow-sm text-slate-800 hover:text-red-600"
                        >
                          <FiTrash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="p-3 sm:p-5">
                      <h3 className="text-[var(--text-main)] font-semibold text-sm sm:text-lg truncate">
                        {student.name}
                      </h3>
                      <div className="flex flex-wrap items-center justify-between gap-1 mt-1.5">
                        <span className="font-mono text-[11px] sm:text-xs text-[var(--text-secondary)] bg-[var(--bg-input)] px-2 py-0.5 rounded border border-[var(--border-subtle)] truncate max-w-full">
                          {student.rollNumber}
                        </span>
                        <span className="text-[11px] sm:text-xs text-[var(--text-muted)]">
                          {student.descriptorCount
                            ? `${student.descriptorCount} ${student.descriptorCount === 1 ? "sample" : "samples"}`
                            : "No face yet"}
                        </span>
                      </div>
                    </div>
                  </Motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      <ConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => handleDelete(deleteConfirm._id)}
        title="Delete Student?"
        message={`This will permanently delete "${deleteConfirm?.name}" and all their data.`}
        confirmText="Delete"
        type="danger"
      />

      {/* Reset photos confirmation modal */}
      <ConfirmModal
        isOpen={!!resetConfirm}
        onClose={() => setResetConfirm(null)}
        onConfirm={() => handleResetPhotos(resetConfirm._id)}
        title="Reset Photos?"
        message={`This will remove all additional photos for "${resetConfirm?.name}". Only the original photo will be kept.`}
        confirmText="Reset"
        type="warning"
      />

      {/* Re-embed confirmation modal */}
      <ConfirmModal
        isOpen={reembedConfirm}
        onClose={() => setReembedConfirm(false)}
        onConfirm={handleReembed}
        title="Re-embed All Students?"
        message={`This will regenerate face embeddings for all ${students.length} students using the latest AI model. Use this if face recognition isn't working well. This may take a few minutes.`}
        confirmText="Re-embed"
        type="warning"
      />
    </Motion.div>
  );
};

export default EnrollForm;
