import React, { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import {
  FiMail,
  FiLock,
  FiUser,
  FiArrowLeft,
  FiMoon,
  FiSun,
  FiCamera,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";

export default function LoginPage({ isDark, setIsDark }) {
  const [searchParams] = useSearchParams();
  const [isLogin, setIsLogin] = useState(!searchParams.get("register"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const { login, register } = useAuth();

  useEffect(() => {
    if (searchParams.get("register") === "true") {
      setIsLogin(false);
    }
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        if (!name) {
          setError("Name is required");
          setLoading(false);
          return;
        }
        await register(name, email, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError("");
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel: branding (desktop only) */}
      <div className="surface-ink hidden lg:flex lg:w-[52%] relative overflow-hidden bg-[var(--bg-sidebar)]">
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[var(--color-primary)] flex items-center justify-center text-[var(--color-primary-text)]">
              <FiCamera className="text-lg" />
            </div>
            <span className="font-semibold text-lg tracking-tight">SnapTick</span>
            <span className="eyebrow ml-2">Attendance Intelligence</span>
          </div>

          <div className="max-w-lg">
            <p className="eyebrow mb-5 flex items-center gap-2">
              <span className="accent-dot" /> Biometric attendance for higher education
            </p>
            <h1 className="font-display text-[64px] leading-[0.98] mb-6">
              Every lecture,
              <br />
              <span className="italic text-[var(--color-primary)]">accounted for.</span>
            </h1>
            <p className="text-[15px] text-[var(--text-secondary)] mb-10 leading-relaxed max-w-md">
              Verified face recognition, faculty review on every match, and eligibility
              analytics aligned with the 75% attendance norm.
            </p>

            {/* Product preview: review queue */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)]">
                <span className="eyebrow">Review · BCA-III · 09:40</span>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">42 / 45 matched</span>
              </div>
              {[
                ["2300320100107", "Verified", "0.91"],
                ["2300320100091", "Verified", "0.88"],
                ["2300320100035", "Needs review", "0.62"],
              ].map(([roll, status, score]) => (
                <div key={roll} className="flex items-center justify-between px-4 py-2.5 border-b last:border-b-0 border-[var(--border-subtle)]">
                  <span className="font-mono text-xs text-[var(--text-secondary)]">{roll}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-xs text-[var(--text-muted)]">{score}</span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                        status === "Verified"
                          ? "bg-[var(--color-primary)] text-[var(--color-primary-text)]"
                          : "border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {status}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-6 eyebrow">
            <span>On-premise processing</span>
            <span>·</span>
            <span>Audit-ready records</span>
            <span>·</span>
            <span>CSV &amp; PDF export</span>
          </div>
        </div>
      </div>

      {/* Right panel: auth form */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between p-4 sm:p-6">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
          >
            <FiArrowLeft size={16} />
            <span className="hidden sm:inline">Back</span>
          </Link>

          <button
            onClick={() => setIsDark(!isDark)}
            className="p-2.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card)] transition-all"
          >
            {isDark ? <FiSun size={18} /> : <FiMoon size={18} />}
          </button>
        </div>

        {/* Form container */}
        <div className="flex-1 flex items-center justify-center p-6">
          <Motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-sm"
          >
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
              <div className="h-10 w-10 rounded-xl bg-[var(--color-primary)] flex items-center justify-center">
                <FiCamera className="text-xl text-[var(--color-primary-text)]" />
              </div>
              <span className="font-bold text-xl text-[var(--text-main)]">
                SnapTick
              </span>
            </div>

            {/* Form header */}
            <div className="mb-8">
              <p className="eyebrow mb-3">{isLogin ? "Faculty sign in" : "Faculty registration"}</p>
              <h2 className="font-display text-[40px] leading-none text-[var(--text-main)] mb-3">
                {isLogin ? "Welcome back." : "Create your account."}
              </h2>
              <p className="text-[var(--text-secondary)] text-sm">
                {isLogin
                  ? "Sign in with your institutional email to open your classrooms."
                  : "Set up your faculty workspace to enrol students and record attendance."}
              </p>
            </div>

            {/* Error message */}
            {error && (
              <Motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
              >
                {error}
              </Motion.div>
            )}

            {/* Auth form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {!isLogin && (
                <Motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    Full Name
                  </label>
                  <div className="relative">
                    <FiUser className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="John Doe"
                      className="input-premium w-full pl-11 pr-4 py-3"
                      required={!isLogin}
                    />
                  </div>
                </Motion.div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Email
                </label>
                <div className="relative">
                  <FiMail className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.edu"
                    className="input-premium w-full pl-11 pr-4 py-3"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Password
                </label>
                <div className="relative">
                  <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isLogin ? "Your password" : "At least 8 characters"}
                    className="input-premium w-full pl-11 pr-4 py-3"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3.5 rounded-xl flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-[var(--color-primary-text)]/30 border-t-[var(--color-primary-text)] rounded-full animate-spin" />
                ) : isLogin ? (
                  "Sign in"
                ) : (
                  "Create account"
                )}
              </button>
            </form>

            {/* Mode toggle */}
            <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
              {isLogin ? "Don't have an account?" : "Already have an account?"}
              <button
                onClick={toggleMode}
                className="ml-1 text-[var(--color-primary)] hover:underline font-medium"
              >
                {isLogin ? "Sign up" : "Sign in"}
              </button>
            </p>
          </Motion.div>
        </div>
      </div>
    </div>
  );
}
