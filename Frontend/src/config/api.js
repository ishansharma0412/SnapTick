// Centralized API base URL
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default API_URL;

// Build API endpoint URLs
export function apiUrl(path) {
  return `${API_URL}${path.startsWith('/') ? path : '/' + path}`;
}

// Build URLs for temporary scan images (annotated photo, face crops)
export function uploadUrl(filename, bustCache = false) {
  const base = `${API_URL}/uploads/${filename}`;
  return bustCache ? `${base}?t=${Date.now()}` : base;
}
