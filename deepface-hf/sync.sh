#!/bin/bash
# Copy the face service into this folder for upload to a Hugging Face Docker Space.
set -e
cd "$(dirname "$0")"
for f in app.py requirements.txt Dockerfile; do cp ../Backend/deepface_service/$f .; done
echo "deepface-hf ready: README.md Dockerfile requirements.txt app.py"
