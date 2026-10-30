# SnapTick face recognition service (InsightFace buffalo_l on ONNX Runtime, CPU)
# Works on Hugging Face Spaces (Docker SDK, port 7860), Render, Railway or any Docker host.
FROM python:3.11-slim

# OpenCV runtime libraries; a compiler is needed to build insightface's extension
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 build-essential \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces run containers as uid 1000
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PORT=7860
WORKDIR $HOME/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt

# Download the model pack at build time so cold starts do not depend on GitHub
RUN python -c "from insightface.app import FaceAnalysis; \
a = FaceAnalysis(name='buffalo_l', allowed_modules=['detection','recognition'], providers=['CPUExecutionProvider']); \
a.prepare(ctx_id=-1, det_size=(640, 640)); print('model ready')"

COPY --chown=user app.py .

EXPOSE 7860
# One process keeps memory low; threads let several teachers scan at the same time
CMD gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 4 --timeout 180 app:app
