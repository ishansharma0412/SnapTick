"""
Face recognition Flask microservice (InsightFace).
Runs on port 5001 and exposes APIs to:
- Extract face embeddings (enrollment)
- Detect and match multiple faces in group photos
- Verify two faces / diagnose matching

Models (InsightFace "buffalo_l" pack, ONNX Runtime):
- Detection: SCRFD-10G with 5-point landmarks
- Recognition: ArcFace ResNet-50 trained on WebFace600K (512-dim embeddings)

Note: embeddings are not compatible with the previous DeepFace/ArcFace model.
After switching, run `node scripts/reembed-all.js` (or POST /enroll/re-embed).
"""

import os
import base64
import time
import traceback

import cv2
import numpy as np
from flask import Flask, request, jsonify
from insightface.app import FaceAnalysis
from insightface.utils import face_align

app = Flask(__name__)

# =============================================================================
# Model configuration
# =============================================================================
MODEL_PACK = os.environ.get("FACE_MODEL_PACK", "buffalo_l")
MODEL_NAME = f"insightface-{MODEL_PACK}"
DETECTOR_BACKEND = "scrfd"
DET_THRESHOLD = float(os.environ.get("FACE_DET_THRESHOLD", "0.5"))
DET_SIZE = 640          # base detector input; good for close and mid-range faces
DET_SIZE_LARGE = 1280   # second pass for big group photos with small, distant faces

# Cosine distance (1 - cosine similarity) thresholds for buffalo_l.
# Same person typically falls ~0.2-0.65, different people ~0.75+.
FACE_MATCH_THRESHOLD = float(os.environ.get("FACE_MATCH_THRESHOLD", "0.70"))
FACE_MATCH_GAP = 0.10   # required separation from the runner-up for borderline matches

print(f"Face service starting with model: {MODEL_NAME}, detector: {DETECTOR_BACKEND}")
print(f"Thresholds: match <= {FACE_MATCH_THRESHOLD}, borderline gap >= {FACE_MATCH_GAP}")

face_app = FaceAnalysis(
    name=MODEL_PACK,
    allowed_modules=["detection", "recognition"],
    providers=["CPUExecutionProvider"],
)
face_app.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE), det_thresh=DET_THRESHOLD)
detector = face_app.det_model
recognizer = face_app.models["recognition"]


def convert_to_native(obj):
    """Convert numpy types to native Python types for JSON serialization"""
    if isinstance(obj, dict):
        return {k: convert_to_native(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_native(i) for i in obj]
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.str_):
        return str(obj)
    else:
        return obj


def load_image_from_path(image_path):
    """Load image from file path (falls back to the uploads directory)."""
    # Normalize Windows path separators from Node.js inputs
    image_path = image_path.replace("\\", "/") if image_path else image_path

    if not os.path.exists(image_path):
        uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads")
        alt_path = os.path.join(uploads_dir, os.path.basename(image_path))
        if os.path.exists(alt_path):
            image_path = alt_path
        else:
            raise FileNotFoundError(f"Image not found: {image_path} (also tried: {alt_path})")

    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")
    return img


def load_image_from_base64(base64_string):
    """Load image from base64 string"""
    img_data = base64.b64decode(base64_string)
    nparr = np.frombuffer(img_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode base64 image")
    return img


def load_request_image(data):
    """Load the image named by 'image_path' or 'image_base64' in a request body."""
    if "image_path" in data:
        return load_image_from_path(data["image_path"])
    if "image_base64" in data:
        return load_image_from_base64(data["image_base64"])
    return None


def limit_size(img, max_dim=1980):
    """Downscale very large photos; returns (image, scale applied)."""
    h, w = img.shape[:2]
    if max(h, w) <= max_dim:
        return img, 1.0
    scale = max_dim / max(h, w)
    return cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), scale


def enhance_for_detection(img):
    """Apply CLAHE to dark or low-contrast photos. Used only for finding faces;
    embeddings are always taken from the original pixels."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mean_brightness, std_brightness = float(np.mean(gray)), float(np.std(gray))
    if mean_brightness >= 100 and std_brightness >= 40:
        return img
    clip_limit = 4.0 if mean_brightness < 60 else 3.0 if mean_brightness < 80 else 2.0
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(8, 8)).apply(l)
    print(f"[DEBUG] Applied CLAHE clip={clip_limit} (brightness {mean_brightness:.0f})")
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


def _iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def detect_faces(img, group_photo=True):
    """
    Detect faces and return (boxes Nx5, landmarks Nx5x2).
    Group photos get a second, higher-resolution pass so small faces in the back
    rows are found; overlapping detections from both passes are merged.
    """
    det_img = enhance_for_detection(img)
    boxes, kpss = detector.detect(det_img, input_size=(DET_SIZE, DET_SIZE))
    if group_photo and max(img.shape[:2]) > 1000:
        boxes2, kpss2 = detector.detect(det_img, input_size=(DET_SIZE_LARGE, DET_SIZE_LARGE))
        if len(boxes2):
            if len(boxes):
                boxes, kpss = np.vstack([boxes, boxes2]), np.vstack([kpss, kpss2])
            else:
                boxes, kpss = boxes2, kpss2
            keep = []
            for i in np.argsort(-boxes[:, 4]):
                if all(_iou(boxes[i], boxes[j]) < 0.4 for j in keep):
                    keep.append(i)
            boxes, kpss = boxes[keep], kpss[keep]
    if len(boxes) == 0 and not group_photo:
        # Very close-up portraits can fill the frame; pad and retry once
        pad = max(img.shape[:2]) // 4
        padded = cv2.copyMakeBorder(det_img, pad, pad, pad, pad, cv2.BORDER_CONSTANT)
        boxes, kpss = detector.detect(padded, input_size=(DET_SIZE, DET_SIZE))
        if len(boxes):
            boxes[:, :4] -= pad
            kpss = kpss - pad
    return boxes, kpss


def embed_faces(img, kpss):
    """Align every face with its landmarks and embed them in one batch (L2-normalized)."""
    crops = [face_align.norm_crop(img, landmark=k, image_size=112) for k in kpss]
    feats = recognizer.get_feat(crops)
    feats = np.asarray(feats, dtype=np.float32).reshape(len(crops), -1)
    return feats / np.linalg.norm(feats, axis=1, keepdims=True)


def detect_faces_robust(img, group_photo=True):
    """Detect + embed all faces. Returns list of {embedding, facial_area, face_confidence}."""
    t0 = time.time()
    boxes, kpss = detect_faces(img, group_photo=group_photo)
    t1 = time.time()
    if len(boxes) == 0:
        print(f"[TIMING] detect={t1 - t0:.2f}s faces=0", flush=True)
        return []
    embeddings = embed_faces(img, kpss)
    t2 = time.time()
    print(f"[TIMING] detect={t1 - t0:.2f}s embed={t2 - t1:.2f}s faces={len(boxes)}", flush=True)

    h, w = img.shape[:2]
    results = []
    for box, emb in zip(boxes, embeddings):
        x1, y1 = max(0, int(box[0])), max(0, int(box[1]))
        x2, y2 = min(w, int(box[2])), min(h, int(box[3]))
        results.append({
            "embedding": emb.tolist(),
            "facial_area": {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1},
            "face_confidence": float(box[4]),
        })
    return results


def scale_facial_area(facial_area, scale):
    """Scale facial area coordinates back to original image size"""
    if scale == 1.0:
        return facial_area
    return {k: int(v / scale) for k, v in facial_area.items()}


def required_gap_for(distance):
    """Confident matches need little separation from the runner-up; borderline ones need more."""
    if distance <= 0.45:
        return 0.03
    if distance <= 0.55:
        return 0.05
    if distance <= 0.65:
        return 0.07
    return FACE_MATCH_GAP


def distance_to_confidence(distance):
    """Map cosine distance to a 0-100 score for the UI (~0.4 or less reads as ~100%)."""
    return int(max(0, min(100, round((1 - distance) / 0.6 * 100))))


def rank_candidates(embedding, enrolled_faces):
    """Return [{rollNumber, name, minDistance, avgDistance, numDescriptors}] sorted by minDistance."""
    emb = np.asarray(embedding, dtype=np.float32)
    candidates = []
    for enrolled in enrolled_faces:
        descs = [d for d in enrolled.get("descriptors", []) if len(d) == len(emb)]
        if not descs:
            continue
        mat = np.asarray(descs, dtype=np.float32)
        mat = mat / np.linalg.norm(mat, axis=1, keepdims=True)
        dists = 1 - mat @ emb
        candidates.append({
            "rollNumber": enrolled["rollNumber"],
            "name": enrolled.get("name", enrolled["rollNumber"]),
            "minDistance": float(dists.min()),
            "avgDistance": float(dists.mean()),
            "numDescriptors": len(descs),
        })
    candidates.sort(key=lambda c: c["minDistance"])
    return candidates


def decide_match(candidates):
    """Apply threshold + adaptive gap rule. Returns (is_match, best, second, gap, required_gap)."""
    best = candidates[0] if candidates else None
    second = candidates[1] if len(candidates) > 1 else None
    if not best:
        return False, None, None, 0.0, FACE_MATCH_GAP
    gap = (second["minDistance"] - best["minDistance"]) if second else 1.0
    required_gap = required_gap_for(best["minDistance"])
    is_match = best["minDistance"] <= FACE_MATCH_THRESHOLD and gap >= required_gap
    return is_match, best, second, gap, required_gap


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "ok", "model": MODEL_NAME, "detector": DETECTOR_BACKEND})


@app.route("/extract-embedding", methods=["POST"])
def extract_embedding():
    """
    Extract the embedding of the main (largest) face in an enrollment photo.
    Expects JSON with either 'image_path' or 'image_base64'.
    """
    try:
        img = load_request_image(request.get_json())
        if img is None:
            return jsonify({"error": "Either 'image_path' or 'image_base64' is required"}), 400
        img, scale = limit_size(img, max_dim=1280)

        faces = detect_faces_robust(img, group_photo=False)
        if not faces:
            return jsonify({"error": "No face detected in the image"}), 400
        main = max(faces, key=lambda f: f["facial_area"]["w"] * f["facial_area"]["h"])

        response = {
            "success": True,
            "embedding": main["embedding"],
            "embedding_size": len(main["embedding"]),
            "facial_area": scale_facial_area(main["facial_area"], scale),
            "face_count": len(faces),
            "model": MODEL_NAME,
        }
        return jsonify(convert_to_native(response))

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/detect-faces", methods=["POST"])
def detect_faces_route():
    """Detect all faces in an image and return their embeddings with bounding boxes."""
    try:
        img = load_request_image(request.get_json())
        if img is None:
            return jsonify({"error": "Either 'image_path' or 'image_base64' is required"}), 400
        img, scale = limit_size(img)
        faces = [
            {
                "embedding": f["embedding"],
                "facial_area": scale_facial_area(f["facial_area"], scale),
                "confidence": f["face_confidence"],
            }
            for f in detect_faces_robust(img)
        ]
        return jsonify(convert_to_native({"success": True, "faces": faces, "face_count": len(faces), "model": MODEL_NAME}))

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/match-faces", methods=["POST"])
def match_faces():
    """
    Match detected faces against enrolled face descriptors.
    Expects JSON with:
    - 'image_path' or 'image_base64': The group photo
    - 'enrolled_faces': List of {rollNumber, descriptors: [[...]]}
    Returns matched faces with roll numbers and bounding boxes
    """
    try:
        data = request.get_json()
        img = load_request_image(data)
        if img is None:
            return jsonify({"error": "Either 'image_path' or 'image_base64' is required"}), 400

        enrolled_faces = data.get("enrolled_faces", [])
        if not enrolled_faces:
            return jsonify({"error": "No enrolled faces provided"}), 400

        img, scale = limit_size(img)
        detections = detect_faces_robust(img)
        if not detections:
            return jsonify({
                "success": True,
                "matches": [],
                "face_count": 0,
                "recognized_count": 0,
                "message": "No faces detected in the image"
            })

        # Stable ordering: top-to-bottom, left-to-right
        detections.sort(key=lambda d: (d["facial_area"]["y"] // 40, d["facial_area"]["x"]))

        results = []
        label_winners = {}
        for i, det in enumerate(detections):
            is_match, best, second, gap, req_gap = decide_match(rank_candidates(det["embedding"], enrolled_faces))
            distance = best["minDistance"] if best else 1.0
            label = best["rollNumber"] if is_match else "unknown"
            print(
                f"[MATCH] face#{i} best={best['rollNumber'] if best else '-'} dist={distance:.3f} "
                f"gap={gap:.3f}/{req_gap:.2f} -> {'MATCH' if is_match else 'unknown'}",
                flush=True,
            )
            results.append({"index": i, "label": label, "distance": distance, "is_match": is_match})
            # One student can only appear once; keep the closest face
            if is_match and (label not in label_winners or distance < label_winners[label]["distance"]):
                label_winners[label] = {"index": i, "distance": distance}

        matches = []
        for r in results:
            is_winner = r["is_match"] and label_winners.get(r["label"], {}).get("index") == r["index"]
            det = detections[r["index"]]
            matches.append({
                "facial_area": scale_facial_area(det["facial_area"], scale),
                "roll_number": r["label"] if is_winner else "unknown",
                "distance": r["distance"],
                "confidence": distance_to_confidence(r["distance"]),
                "is_recognized": bool(is_winner),
                "embedding": det["embedding"],
            })

        response = {
            "success": True,
            "matches": matches,
            "face_count": len(detections),
            "recognized_count": len(label_winners),
            "model": MODEL_NAME,
        }
        return jsonify(convert_to_native(response))

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/verify", methods=["POST"])
def verify_faces():
    """
    Verify if two faces belong to the same person.
    Expects JSON with 'image1_path'/'image1_base64' and 'image2_path'/'image2_base64'.
    """
    try:
        data = request.get_json()
        embeddings = []
        for key in ("image1", "image2"):
            sub = {}
            if f"{key}_path" in data:
                sub["image_path"] = data[f"{key}_path"]
            elif f"{key}_base64" in data:
                sub["image_base64"] = data[f"{key}_base64"]
            img = load_request_image(sub)
            if img is None:
                return jsonify({"error": f"{key}_path or {key}_base64 required"}), 400
            faces = detect_faces_robust(limit_size(img, 1280)[0], group_photo=False)
            if not faces:
                return jsonify({"error": f"No face detected in {key}"}), 400
            main = max(faces, key=lambda f: f["facial_area"]["w"] * f["facial_area"]["h"])
            embeddings.append(np.asarray(main["embedding"]))

        distance = float(1 - embeddings[0] @ embeddings[1])
        return jsonify({
            "success": True,
            "verified": distance <= FACE_MATCH_THRESHOLD,
            "distance": distance,
            "threshold": FACE_MATCH_THRESHOLD,
            "model": MODEL_NAME,
            "detector": DETECTOR_BACKEND,
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/diagnose", methods=["POST"])
def diagnose_matching():
    """
    Diagnostic endpoint to analyze why a face might not be matching.
    Expects JSON with:
    - 'image_path' or 'image_base64': The photo to analyze
    - 'enrolled_faces': List of {rollNumber, name, descriptors: [[...]]}
    Returns detailed matching analysis for each detected face
    """
    try:
        data = request.get_json()
        img = load_request_image(data)
        if img is None:
            return jsonify({"error": "Either 'image_path' or 'image_base64' is required"}), 400

        enrolled_faces = data.get("enrolled_faces", [])
        if not enrolled_faces:
            return jsonify({"error": "No enrolled faces provided"}), 400

        img, scale = limit_size(img)
        detections = detect_faces_robust(img)
        if not detections:
            return jsonify({
                "success": True,
                "message": "No faces detected in the image",
                "faces": [],
                "recommendations": ["Try a clearer photo with better lighting"]
            })

        face_analyses = []
        for i, det in enumerate(detections):
            facial_area = scale_facial_area(det["facial_area"], scale)
            candidates = rank_candidates(det["embedding"], enrolled_faces)
            for c in candidates:
                c["wouldMatch"] = c["minDistance"] <= FACE_MATCH_THRESHOLD
                c["minDistance"] = round(c["minDistance"], 4)
                c["avgDistance"] = round(c["avgDistance"], 4)

            is_match, best, second, gap, required_gap = decide_match(candidates)
            if not best:
                face_analyses.append({
                    "faceIndex": i,
                    "facialArea": facial_area,
                    "bestMatch": None,
                    "isMatch": False,
                    "matchedTo": "Unknown",
                    "recommendations": ["No valid enrolled faces to compare against (re-embed students?)"]
                })
                continue

            recommendations = []
            if not is_match:
                if best["minDistance"] > FACE_MATCH_THRESHOLD:
                    recommendations.append(f"Distance {best['minDistance']:.3f} exceeds threshold {FACE_MATCH_THRESHOLD}")
                    recommendations.append(f"Consider re-enrolling {best['name']} with a photo similar to how they appear here")
                    if best["numDescriptors"] < 3:
                        recommendations.append(f"{best['name']} only has {best['numDescriptors']} enrollment photo(s). Add more photos with different angles")
                    if facial_area["w"] < 60:
                        recommendations.append(f"Face is only {facial_area['w']}px wide; take the photo closer or send it uncompressed")
                elif gap < required_gap:
                    recommendations.append(f"Gap between top matches ({gap:.3f}) is too small (need {required_gap:.3f})")
                    recommendations.append("The face is too similar to multiple enrolled people")

            face_analyses.append({
                "faceIndex": i,
                "facialArea": facial_area,
                "bestMatch": best,
                "secondBestMatch": second,
                "gap": round(gap, 4),
                "requiredGap": required_gap,
                "isMatch": is_match,
                "matchedTo": best["name"] if is_match else "Unknown",
                "allCandidates": candidates[:5],
                "recommendations": recommendations
            })

        response = {
            "success": True,
            "faceCount": len(detections),
            "threshold": FACE_MATCH_THRESHOLD,
            "maxGap": FACE_MATCH_GAP,
            "model": MODEL_NAME,
            "faces": face_analyses
        }
        return jsonify(convert_to_native(response))

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def warm_up():
    """Run both detector sizes and the recognizer once so the first real scan is fast."""
    warm = np.full((1200, 1200, 3), 128, dtype=np.uint8)
    detect_faces_robust(warm)
    recognizer.get_feat([np.zeros((112, 112, 3), dtype=np.uint8)])
    print(f"Model {MODEL_NAME} loaded successfully", flush=True)


# Warm up at import time so it also happens under gunicorn, not only `python app.py`
if os.environ.get("FACE_WARMUP", "1") == "1":
    warm_up()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    print(f"Starting face service on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
