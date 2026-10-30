import API_URL from "../config/api";
import { NETWORK_ERROR } from "./useServiceHealth";

/**
 * fetch() wrapper for the SnapTick API: adds the bearer token, sends JSON bodies,
 * parses JSON responses and throws an Error with a readable message on failure.
 */
export async function api(path, { token, method = "GET", body, form, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || (res.status >= 500 ? NETWORK_ERROR : `Request failed (${res.status})`));
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Download an authenticated file (e.g. the Excel register). */
export async function downloadFile(path, token, filename) {
  const res = await api(path, { token, raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local YYYY-MM-DD for a Date */
export function toDay(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The timetable slot running now (or starting within 15 min) for a schedule */
export function currentSlot(schedule = [], now = new Date()) {
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const t = hhmm(now);
  const soon = hhmm(new Date(now.getTime() + 15 * 60000));
  return schedule.find((s) => s.day === now.getDay() && ((s.start <= t && t < s.end) || (t < s.start && s.start <= soon))) || null;
}

export const STATUS_LABEL = { present: "Present", duty_leave: "Duty leave", medical_leave: "Medical leave" };
