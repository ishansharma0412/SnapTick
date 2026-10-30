import React, { createContext, useContext, useState, useEffect } from "react";
import API_URL from "../config/api";
import { NETWORK_ERROR } from "../utils/useServiceHealth";

// Read name/email/role from the token so the app can render while the server wakes up
function teacherFromToken(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return { _id: payload.id, name: payload.name, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}

async function postJson(path, body) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (res.status >= 500 ? NETWORK_ERROR : "Request failed"));
  return data;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [teacher, setTeacher] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [loading, setLoading] = useState(true);

  // Verify stored token on mount
  useEffect(() => {
    async function verifyToken() {
      if (!token) {
        setLoading(false);
        return;
      }

      const local = teacherFromToken(token);
      if (!local) {
        // Expired or unreadable token
        localStorage.removeItem("token");
        setToken(null);
        setLoading(false);
        return;
      }

      // Only an explicit rejection signs the teacher out. A sleeping or unreachable
      // server must not log everyone out, so keep the session and retry in the background.
      for (let attempt = 0; !cancelled; attempt++) {
        try {
          const res = await fetch(`${API_URL}/auth/verify`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            setTeacher(data.teacher);
            break;
          }
          if (res.status === 401 || res.status === 403) {
            localStorage.removeItem("token");
            setToken(null);
            setTeacher(null);
            break;
          }
        } catch (error) {
          console.warn("Token verification deferred:", error.message);
        }
        // Server waking up: show the app from the token and keep trying
        setTeacher((t) => t || local);
        setLoading(false);
        await new Promise((r) => setTimeout(r, Math.min(15000, 3000 * (attempt + 1))));
      }
      setLoading(false);
    }

    let cancelled = false;
    verifyToken();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function login(email, password) {
    const data = await postJson("/auth/login", { email, password });

    localStorage.setItem("token", data.token);
    setToken(data.token);
    setTeacher(data.teacher);

    return data;
  }

  async function register(name, email, password) {
    const data = await postJson("/auth/register", { name, email, password });

    localStorage.setItem("token", data.token);
    setToken(data.token);
    setTeacher(data.teacher);

    return data;
  }

  function logout() {
    localStorage.removeItem("token");
    setToken(null);
    setTeacher(null);
  }

  // Build auth headers for JSON requests
  function getAuthHeaders() {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  // Build auth headers for FormData (browser sets Content-Type)
  function getAuthHeadersMultipart() {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  const value = {
    teacher,
    token,
    loading,
    isAuthenticated: !!teacher,
    login,
    register,
    logout,
    getAuthHeaders,
    getAuthHeadersMultipart,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export default AuthContext;
