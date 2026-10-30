import React from "react";
import { Link } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { FiCamera, FiArrowRight, FiArrowUpRight, FiMoon, FiSun } from "react-icons/fi";

const EASE = [0.22, 1, 0.36, 1];

const CAPABILITIES = [
  {
    title: "Group recognition",
    desc: "A single classroom photograph is matched against every enrolled student using SCRFD detection and ArcFace embeddings.",
  },
  {
    title: "Faculty review",
    desc: "Nothing is saved automatically. Each match is shown with its face crop so the instructor confirms, corrects or skips it.",
  },
  {
    title: "On-the-spot enrolment",
    desc: "An unrecognised face can be enrolled as a new student directly from the review queue and marked present in the same step.",
  },
  {
    title: "Eligibility analytics",
    desc: "Per-student attendance percentage, at-risk and defaulter status against the 75% norm, and day-wise trends.",
  },
  {
    title: "Manual register",
    desc: "Students who are absent from the photograph can be marked from the register, with a clear audit of today's records.",
  },
  {
    title: "Exports",
    desc: "Attendance reports for any date range as CSV for spreadsheets, or a print-ready PDF for submission.",
  },
];

const WORKFLOW = [
  ["Enrol", "Register each student once with a reference photograph. The face template is stored, not shared."],
  ["Capture", "Upload or capture a photograph of the class. Detection and matching complete in about a second."],
  ["Verify", "Review the matches, resolve the unrecognised faces and mark absentees from the register."],
  ["Report", "Attendance is recorded for the day and immediately reflected in classroom analytics."],
];

export default function LandingPage({ isDark, setIsDark }) {
  return (
    <div className="min-h-screen overflow-hidden">
      {/* Top navigation */}
      <nav className="glass-panel !rounded-none !border-x-0 !border-t-0 fixed top-0 w-full z-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-md bg-[var(--color-primary)] flex items-center justify-center">
                <FiCamera className="text-[var(--color-primary-text)]" />
              </div>
              <span className="font-semibold text-[var(--text-main)] tracking-tight">SnapTick</span>
              <span className="eyebrow hidden sm:inline ml-2">Attendance Intelligence</span>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              <a href="#capabilities" className="hidden md:inline text-sm text-[var(--text-secondary)] hover:text-[var(--text-main)] px-3 py-2">
                Capabilities
              </a>
              <a href="#workflow" className="hidden md:inline text-sm text-[var(--text-secondary)] hover:text-[var(--text-main)] px-3 py-2">
                Workflow
              </a>
              <button
                onClick={() => setIsDark(!isDark)}
                className="hidden sm:block p-2.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card)] transition-colors"
                aria-label="Toggle theme"
              >
                {isDark ? <FiSun size={16} /> : <FiMoon size={16} />}
              </button>
              <Link to="/student" className="hidden sm:inline text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-main)] px-3 py-2 whitespace-nowrap">
                Students
              </Link>
              <Link to="/login" className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-main)] px-2 sm:px-3 py-2 whitespace-nowrap">
                Sign in
              </Link>
              <Link to="/login?register=true" className="btn-primary px-3 sm:px-4 py-2 rounded-md text-sm whitespace-nowrap">
                <span className="sm:hidden">Get started</span>
                <span className="hidden sm:inline">Create workspace</span>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-36 pb-20 px-6">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.1fr_0.9fr] gap-14 items-end">
          <Motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE }}>
            <p className="eyebrow mb-6 flex items-center gap-2">
              <span className="accent-dot" /> Biometric attendance for higher education
            </p>
            <h1 className="font-display text-[56px] sm:text-[76px] lg:text-[92px] leading-[0.95] text-[var(--text-main)] mb-8">
              Every lecture,
              <br />
              <span className="italic">accounted for.</span>
            </h1>
            <p className="text-lg text-[var(--text-secondary)] max-w-xl leading-relaxed mb-10">
              SnapTick records classroom attendance through verified face recognition,
              keeps faculty in control of every entry, and turns the register into
              eligibility analytics your department can act on.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/login?register=true" className="btn-primary px-6 py-3.5 rounded-md flex items-center gap-2 group">
                Create faculty workspace
                <FiArrowRight className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <a
                href="#workflow"
                className="px-6 py-3.5 rounded-md font-medium text-[var(--text-main)] border border-[var(--border-subtle)] hover:border-[var(--text-muted)] bg-[var(--bg-card)] transition-colors"
              >
                See the workflow
              </a>
            </div>
          </Motion.div>

          {/* Product preview */}
          <Motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.15, ease: EASE }}
            className="surface-ink rounded-2xl bg-[var(--bg-sidebar)] border border-black/30 p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="eyebrow">Review queue</p>
                <p className="font-semibold mt-1">BCA · Semester V · Lecture 3</p>
              </div>
              <span className="flex items-center gap-2 text-xs font-mono text-[var(--text-secondary)]">
                <span className="accent-dot" /> 0.8 s
              </span>
            </div>
            <div className="grid grid-cols-3 gap-px rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--border-subtle)] mb-5">
              {[
                ["42", "Verified"],
                ["2", "To review"],
                ["1", "Absent"],
              ].map(([v, l]) => (
                <div key={l} className="bg-[var(--bg-card)] p-4">
                  <p className={`font-display text-4xl leading-none ${l === "Verified" ? "text-[var(--color-primary)]" : ""}`}>{v}</p>
                  <p className="eyebrow mt-2">{l}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
              {[
                ["2300320100107", "Verified", "0.91"],
                ["2300320100091", "Verified", "0.88"],
                ["2300320100081", "Verified", "0.86"],
                ["Unrecognised face", "Needs review", "0.62"],
              ].map(([who, status, score]) => (
                <div key={who} className="flex items-center justify-between gap-3 px-3 sm:px-4 py-3 border-b last:border-b-0 border-[var(--border-subtle)] bg-[var(--bg-card)]">
                  <span className="font-mono text-xs text-[var(--text-secondary)] truncate min-w-0">{who}</span>
                  <span className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    <span className="font-mono text-xs text-[var(--text-muted)]">{score}</span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap ${
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
          </Motion.div>
        </div>
      </section>

      {/* Fact strip */}
      <section className="px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 border-y border-[var(--border-subtle)]">
          {[
            ["~1 s", "recognition per photograph"],
            ["512-d", "ArcFace face embeddings"],
            ["75%", "eligibility threshold built in"],
            ["0", "records saved without review"],
          ].map(([v, l], i) => (
            <div key={l} className={`py-8 px-2 md:px-6 ${i > 0 ? "md:border-l border-[var(--border-subtle)]" : ""}`}>
              <p className="font-display text-5xl leading-none text-[var(--text-main)]">{v}</p>
              <p className="text-sm text-[var(--text-muted)] mt-3">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-10 mb-14">
            <div>
              <p className="eyebrow mb-4">Capabilities</p>
              <h2 className="font-display text-5xl leading-[1.02] text-[var(--text-main)]">
                Built around how faculty actually take attendance.
              </h2>
            </div>
            <p className="text-[var(--text-secondary)] leading-relaxed self-end max-w-lg">
              Recognition does the repetitive work; the instructor makes the decisions.
              Every screen is designed so that a full class can be recorded and verified
              in under a minute.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 border-t border-l border-[var(--border-subtle)]">
            {CAPABILITIES.map((c, i) => (
              <Motion.div
                key={c.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.05, ease: EASE }}
                viewport={{ once: true }}
                className="p-8 border-r border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/60 hover:bg-[var(--bg-card)] transition-colors"
              >
                <p className="font-mono text-xs text-[var(--text-muted)] mb-6">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="text-lg font-semibold text-[var(--text-main)] mb-2">{c.title}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{c.desc}</p>
              </Motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="pb-28 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="eyebrow mb-4">Workflow</p>
          <h2 className="font-display text-5xl leading-none text-[var(--text-main)] mb-14">From roll call to report.</h2>
          <div className="grid md:grid-cols-4 gap-8">
            {WORKFLOW.map(([title, desc], i) => (
              <div key={title} className="border-t-2 border-[var(--text-main)] pt-5">
                <p className="font-mono text-xs text-[var(--text-muted)] mb-3">Step {i + 1}</p>
                <h3 className="font-display text-3xl text-[var(--text-main)] mb-3">{title}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="px-6 pb-24">
        <div className="surface-ink max-w-6xl mx-auto rounded-2xl bg-[var(--bg-sidebar)] px-8 py-14 sm:px-14 flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div>
            <p className="eyebrow mb-4 flex items-center gap-2">
              <span className="accent-dot" /> Ready for your next lecture
            </p>
            <h2 className="font-display text-5xl sm:text-6xl leading-none">
              Set up a classroom
              <br />
              <span className="italic text-[var(--color-primary)]">in five minutes.</span>
            </h2>
          </div>
          <Link to="/login?register=true" className="btn-primary px-6 py-3.5 rounded-md inline-flex items-center gap-2 self-start md:self-auto">
            Create faculty workspace <FiArrowUpRight />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-[var(--border-subtle)]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-[var(--color-primary)] flex items-center justify-center">
              <FiCamera className="text-[var(--color-primary-text)] text-xs" />
            </div>
            <span className="font-semibold text-sm text-[var(--text-main)]">SnapTick</span>
          </div>
          <p className="eyebrow">On-premise face recognition · Faculty-verified records</p>
        </div>
      </footer>
    </div>
  );
}
