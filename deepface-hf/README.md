---
title: SnapTick Face Service
emoji: 📸
colorFrom: gray
colorTo: green
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# SnapTick face recognition service

InsightFace `buffalo_l` (SCRFD-10G detection + ArcFace R50, 512-d embeddings) on ONNX Runtime, CPU only.

## Endpoints

- `GET /health` – service status
- `POST /extract-embedding` – embedding of the main face in an enrolment photo
- `POST /match-faces` – detect and match every face in a class photo against enrolled students
- `POST /detect-faces`, `POST /verify`, `POST /diagnose`

Images are sent as `image_base64` when the service is hosted remotely.

## Deploying this Space

The Space is built from the files in `Backend/deepface_service/`. Run

```bash
./deepface-hf/sync.sh
```

from the repository root, then upload `README.md`, `Dockerfile`, `requirements.txt` and `app.py`
from `deepface-hf/` to a new **Docker** Space. The model is downloaded during the image build.
