import { useEffect, useState } from "react";
import API_URL from "../config/api";

// Shared poller for GET /health. Calling it as soon as the app opens also wakes
// free-tier hosts (API and face service) before the teacher needs them.
let state = { api: "checking", database: "checking", faceService: "checking" };
const listeners = new Set();
let timer = null;

async function poll() {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
    const data = await res.json();
    state = { api: "ok", database: data.database || "down", faceService: data.faceService || "starting" };
  } catch {
    state = { api: "starting", database: "checking", faceService: "checking" };
  }
  listeners.forEach((fn) => fn(state));
  const healthy = state.api === "ok" && state.database === "ok" && state.faceService === "ok";
  timer = setTimeout(poll, healthy ? 60000 : 8000);
}

export default function useServiceHealth() {
  const [status, setStatus] = useState(state);
  useEffect(() => {
    listeners.add(setStatus);
    if (!timer) poll();
    return () => {
      listeners.delete(setStatus);
      if (!listeners.size) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
  const ready = status.api === "ok" && status.database === "ok" && status.faceService === "ok";
  return { ...status, ready };
}

// Message for fetch() failures (network down, server asleep or returning HTML)
export const NETWORK_ERROR =
  "Can't reach the SnapTick server. Check the internet connection; if the server was idle it can take up to a minute to wake up.";
