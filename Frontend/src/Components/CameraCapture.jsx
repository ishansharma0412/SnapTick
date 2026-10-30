import React, { useEffect, useRef, useState } from "react";
import { motion as Motion } from "framer-motion";
import { FiAperture, FiRefreshCw, FiX } from "react-icons/fi";

// Full-screen camera modal: shows a live preview and returns a captured JPEG File.
const CameraCapture = ({ onCapture, onClose }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facingMode, setFacingMode] = useState("environment");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      setReady(false);
      setError("");
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access in the browser and try again."
              : "No camera found or it is in use by another app.",
          );
        }
      }
    };
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        onCapture(new File([blob], `camera-${stamp}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4"
    >
      <div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden bg-black border border-white/10">
        <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <span className="animate-spin h-8 w-8 border-2 border-white/30 border-t-white rounded-full mr-3" />
            Starting camera...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-white">
            {error}
          </div>
        )}
        {ready && (
          <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-black/50 text-white text-xs font-bold flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> LIVE
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-6">
        <button
          type="button"
          onClick={onClose}
          className="h-12 w-12 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"
          title="Close camera"
        >
          <FiX size={22} />
        </button>
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          className="h-20 w-20 rounded-full bg-white text-black flex items-center justify-center shadow-2xl disabled:opacity-40 hover:scale-105 transition-transform"
          title="Capture photo"
        >
          <FiAperture size={34} />
        </button>
        <button
          type="button"
          onClick={() => setFacingMode((m) => (m === "environment" ? "user" : "environment"))}
          className="h-12 w-12 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"
          title="Switch camera"
        >
          <FiRefreshCw size={20} />
        </button>
      </div>
      <p className="mt-4 text-white/60 text-sm">Make sure every student's face is visible, then capture.</p>
    </Motion.div>
  );
};

export default CameraCapture;
