import API_URL from "../config/api";

// Student photos are private: they are fetched with the teacher's token and
// shown through a temporary object URL instead of a public link.
const cache = new Map(); // `${id}:${version}` -> object URL

export function cachedStudentPhoto(studentId, version = "") {
  return cache.get(`${studentId}:${version}`) || "";
}

export async function fetchStudentPhoto(studentId, token, version = "") {
  const key = `${studentId}:${version}`;
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(`${API_URL}/enroll/${studentId}/photo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Photo unavailable");
  const url = URL.createObjectURL(await res.blob());
  cache.set(key, url);
  return url;
}
