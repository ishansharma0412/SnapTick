import React, { useState, useEffect, useRef } from "react";
import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import {
  FiCamera,
  FiMenu,
  FiMoon,
  FiSun,
  FiLogOut,
  FiHome,
  FiSettings,
  FiUser,
  FiChevronRight,
} from "react-icons/fi";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { useAuth } from "./context/AuthContext";
import useServiceHealth from "./utils/useServiceHealth";
import { ClassroomProvider, useClassroom } from "./context/ClassroomContext";
import { ToastProvider } from "./context/ToastContext";
import LandingPage from "./Components/LandingPage";
import LoginPage from "./Components/LoginPage";
import ClassroomDashboard from "./Components/ClassroomDashboard";
import ClassroomView from "./Components/ClassroomView";
import EnrollForm from "./Components/EnrollForm";
import AttendanceUploader from "./Components/AttendanceUploader";
import ManualAttendance from "./Components/ManualAttendance";
import Reports from "./Components/Reports";

// Protected route wrapper
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

// Dashboard layout with sidebar navigation
function DashboardLayout({ children, isDark, setIsDark }) {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { teacher, logout } = useAuth();
  const { classrooms } = useClassroom();
  const health = useServiceHealth();
  const settingsRef = useRef(null);

  // Close settings menu on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand block */}
      <div className="mb-6 flex items-center justify-between px-2">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-[10px] bg-[var(--accent)] flex items-center justify-center text-[var(--accent-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_4px_12px_-4px_rgba(120,160,0,0.6)]">
            <FiCamera className="text-xl" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-[var(--text-main)] leading-tight">
              SnapTick
            </h1>
            <p className="eyebrow !text-[10px]">Attendance Intelligence</p>
          </div>
        </div>
      </div>

      {/* Teacher profile summary */}
      <div className="mb-6 px-2">
        <button
          onClick={() => setProfileOpen(true)}
          className="w-full rounded-xl bg-[var(--glass-bg)] p-3 border border-[var(--glass-border)] shadow-[inset_0_1px_0_var(--glass-highlight)] hover:border-[var(--text-muted)] transition-colors text-left group"
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center">
              <FiUser className="text-[var(--color-primary)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                {teacher?.name}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {teacher?.email}
              </p>
            </div>
            <FiChevronRight className="text-[var(--text-muted)] group-hover:text-[var(--color-primary)] transition-colors" />
          </div>
        </button>
      </div>

      {/* Navigation links */}
      <nav className="space-y-2 flex-1">
        <Link
          to="/dashboard"
          onClick={() => setMobileMenuOpen(false)}
          className={`group flex items-center gap-3 rounded-xl px-5 py-3.5 text-sm font-medium transition-all duration-300 border ${
            location.pathname === "/dashboard"
              ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] border-[var(--border-subtle)]"
              : "text-[var(--text-secondary)] border-transparent hover:text-[var(--text-main)]"
          }`}
        >
          <span
            className={`text-lg ${location.pathname === "/dashboard" ? "text-[var(--nav-active-text)]" : "text-[var(--text-muted)] group-hover:text-[var(--color-primary)]"}`}
          >
            <FiHome />
          </span>
          Overview
        </Link>

        {classrooms.length > 0 && (
          <div className="pt-4">
            <p className="eyebrow px-5 pb-2">Classrooms</p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {classrooms.slice(0, 8).map((c) => {
                const active = location.pathname.startsWith(`/classroom/${c._id}`);
                return (
                  <Link
                    key={c._id}
                    to={`/classroom/${c._id}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[var(--bg-input)]"
                    }`}
                  >
                    <span
                      className={`h-6 w-6 rounded-md flex items-center justify-center text-[11px] font-bold ${
                        active ? "bg-[var(--color-primary)] text-[var(--color-primary-text)]" : "bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
                      }`}
                    >
                      {c.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate">{c.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Sidebar footer and settings */}
      <div className="mt-auto space-y-3">
        {/* Settings button and menu */}
        <div className="relative" ref={settingsRef}>
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors ${
              settingsOpen
                ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] text-[var(--color-primary)]"
                : "bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-main)]"
            }`}
          >
            <span className="text-sm font-medium flex items-center gap-2">
              <FiSettings className={settingsOpen ? "animate-spin" : ""} />
              Settings
            </span>
            <FiChevronRight
              className={`transition-transform ${settingsOpen ? "rotate-90" : ""}`}
            />
          </button>

          {/* Settings menu */}
          <AnimatePresence>
            {settingsOpen && (
              <Motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute bottom-full left-0 right-0 mb-2 bg-[var(--bg-modal)] rounded-xl border border-[var(--border-subtle)] shadow-xl overflow-hidden z-50"
              >
                {/* Theme toggle */}
                <button
                  onClick={() => {
                    setIsDark(!isDark);
                  }}
                  className="w-full flex items-center justify-between p-3 hover:bg-[var(--bg-input)] transition-colors"
                >
                  <span className="text-sm font-medium flex items-center gap-2 text-[var(--text-main)]">
                    {isDark ? (
                      <FiMoon className="text-[var(--color-primary)]" />
                    ) : (
                      <FiSun className="text-amber-500" />
                    )}
                    {isDark ? "Dark Mode" : "Light Mode"}
                  </span>
                  <div
                    className={`w-10 h-5 rounded-full p-0.5 transition-colors ${isDark ? "bg-[var(--color-primary)]" : "bg-gray-300"}`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isDark ? "translate-x-5" : "translate-x-0"}`}
                    />
                  </div>
                </button>

                {/* Profile entry */}
                <button
                  onClick={() => {
                    setProfileOpen(true);
                    setSettingsOpen(false);
                  }}
                  className="w-full flex items-center gap-2 p-3 hover:bg-[var(--bg-input)] transition-colors text-[var(--text-main)]"
                >
                  <FiUser />
                  <span className="text-sm font-medium">My Profile</span>
                </button>

                {/* Section divider */}
                <div className="border-t border-[var(--border-subtle)]" />

                {/* Logout action */}
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2 p-3 hover:bg-[var(--status-absent-bg)] transition-colors text-[var(--status-absent-text)]"
                >
                  <FiLogOut />
                  <span className="text-sm font-medium">Logout</span>
                </button>
              </Motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="rounded-xl bg-[var(--glass-bg)] p-4 border border-[var(--glass-border)] shadow-[inset_0_1px_0_var(--glass-highlight)]">
          <div className="flex items-center gap-2 mb-1">
            {health.ready ? (
              <span className="accent-dot" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            )}
            <span className="text-xs font-semibold text-[var(--text-main)]">
              {health.ready
                ? "All systems online"
                : health.api !== "ok"
                  ? "Connecting to server…"
                  : health.database !== "ok"
                    ? "Database reconnecting…"
                    : "Recognition engine waking up…"}
            </span>
          </div>
          <p className="text-[11px] font-mono text-[var(--text-muted)]">
            {health.ready ? "InsightFace buffalo_l · ONNX" : "This can take up to a minute"}
          </p>
        </div>
      </div>
    </div>
  );

  // Profile modal
  const ProfileModal = () => (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => setProfileOpen(false)}
    >
      <Motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg-modal)] rounded-2xl border border-[var(--border-subtle)] shadow-2xl w-full max-w-md overflow-hidden"
      >
        {/* Modal header */}
        <div className="p-6 border-b border-[var(--border-subtle)] bg-[var(--color-primary)]/5">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center">
              <FiUser className="text-2xl text-[var(--color-primary)]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-main)]">
                {teacher?.name}
              </h2>
              <p className="text-sm text-[var(--text-muted)]">
                {teacher?.email}
              </p>
            </div>
          </div>
        </div>

        {/* Modal body */}
        <div className="p-6 space-y-4">
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-[var(--border-subtle)]">
              <span className="text-sm text-[var(--text-muted)]">
                Account Type
              </span>
              <span className="text-sm font-medium text-[var(--text-main)]">
                Teacher
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[var(--border-subtle)]">
              <span className="text-sm text-[var(--text-muted)]">
                Member Since
              </span>
              <span className="text-sm font-medium text-[var(--text-main)]">
                {teacher?.createdAt
                  ? new Date(teacher.createdAt).toLocaleDateString()
                  : "N/A"}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-[var(--text-muted)]">Theme</span>
              <button
                onClick={() => setIsDark(!isDark)}
                className="flex items-center gap-2 text-sm font-medium text-[var(--color-primary)]"
              >
                {isDark ? <FiMoon /> : <FiSun />}
                {isDark ? "Dark" : "Light"}
              </button>
            </div>
          </div>
        </div>

        {/* Modal footer */}
        <div className="p-6 border-t border-[var(--border-subtle)] flex gap-3">
          <button
            onClick={() => setProfileOpen(false)}
            className="flex-1 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] font-medium hover:bg-[var(--bg-input)] transition-colors"
          >
            Close
          </button>
          <button
            onClick={logout}
            className="flex-1 py-2.5 rounded-xl bg-[var(--status-absent-bg)] text-[var(--status-absent-text)] font-medium hover:opacity-80 transition-opacity flex items-center justify-center gap-2"
          >
            <FiLogOut />
            Logout
          </button>
        </div>
      </Motion.div>
    </Motion.div>
  );

  return (
    <div className="flex min-h-screen relative overflow-hidden transition-colors duration-300">
      {/* Profile modal */}
      <AnimatePresence>{profileOpen && <ProfileModal />}</AnimatePresence>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex print:!hidden w-80 flex-col p-6 fixed h-full z-20">
        <div className="glass-panel h-full rounded-[22px] p-5">
          <SidebarContent />
        </div>
      </aside>

      {/* Mobile header */}
      <div className="glass-panel lg:hidden print:hidden fixed top-0 w-full z-30 flex items-center justify-between p-4 !rounded-none">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-[var(--accent)] flex items-center justify-center text-[var(--accent-ink)]">
            <FiCamera />
          </div>
          <span className="font-bold text-[var(--text-main)]">SnapTick</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open menu"
          className="p-2 text-[var(--text-main)]"
        >
          <FiMenu size={24} />
        </button>
      </div>

      {/* Mobile menu overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <Motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-0 h-full w-[86vw] max-w-80 p-5 bg-[var(--bg-card)] border-r border-[var(--border-subtle)] shadow-2xl overflow-y-auto"
            >
              <SidebarContent />
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 min-w-0 lg:ml-80 print:!ml-0 pt-20 lg:pt-0 print:pt-0 relative">
        <div className="p-6 lg:p-12 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}

function App() {
  const { isAuthenticated, loading } = useAuth();

  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem("theme") === "dark";
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  // Show loading spinner while auth state resolves
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <ClassroomProvider>
        <Routes>
          {/* Public routes */}
          <Route
            path="/"
            element={
              isAuthenticated ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <LandingPage isDark={isDark} setIsDark={setIsDark} />
              )
            }
          />
          <Route
            path="/login"
            element={
              isAuthenticated ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <LoginPage isDark={isDark} setIsDark={setIsDark} />
              )
            }
          />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardLayout isDark={isDark} setIsDark={setIsDark}>
                  <ClassroomDashboard />
                </DashboardLayout>
              </ProtectedRoute>
            }
          />

          {/* Classroom routes */}
          <Route
            path="/classroom/:classroomId"
            element={
              <ProtectedRoute>
                <DashboardLayout isDark={isDark} setIsDark={setIsDark}>
                  <ClassroomView />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            <Route index element={<EnrollForm />} />
            <Route path="attendance" element={<AttendanceUploader />} />
            <Route path="records" element={<ManualAttendance />} />
            <Route path="reports" element={<Reports />} />
          </Route>

          {/* Fallback: redirect to dashboard or landing */}
          <Route
            path="*"
            element={
              isAuthenticated ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        </Routes>
      </ClassroomProvider>
    </ToastProvider>
  );
}

export default App;
