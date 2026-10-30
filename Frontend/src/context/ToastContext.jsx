import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { FiCheck, FiX, FiAlertCircle, FiInfo } from "react-icons/fi";

const ToastContext = createContext(null);

const TOAST_TYPES = {
  success: {
    icon: FiCheck,
    className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  },
  error: {
    icon: FiX,
    className: "bg-red-500/10 border-red-500/30 text-red-400",
  },
  warning: {
    icon: FiAlertCircle,
    className: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  },
  info: {
    icon: FiInfo,
    className: "bg-blue-500/10 border-blue-500/30 text-blue-400",
  },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Stable identity so components can list `toast` in effect dependencies
  const toast = useMemo(
    () => ({
      success: (msg, duration) => addToast(msg, "success", duration),
      error: (msg, duration) => addToast(msg, "error", duration),
      warning: (msg, duration) => addToast(msg, "warning", duration),
      info: (msg, duration) => addToast(msg, "info", duration),
      dismiss: removeToast,
    }),
    [addToast, removeToast],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => {
            const config = TOAST_TYPES[t.type] || TOAST_TYPES.info;
            const Icon = config.icon;

            return (
              <Motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 100, scale: 0.95 }}
                className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm shadow-lg min-w-[280px] max-w-[400px] ${config.className}`}
              >
                <Icon className="flex-shrink-0 text-lg" />
                <p className="flex-1 text-sm font-medium">{t.message}</p>
                <button
                  onClick={() => removeToast(t.id)}
                  className="flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
                >
                  <FiX size={14} />
                </button>
              </Motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
