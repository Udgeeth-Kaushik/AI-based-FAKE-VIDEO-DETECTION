FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV COOKIE_SECURE=1 TRUST_PROXY=1 TORCH_THREADS=1 MODEL_PATH=model/best.pt MYSQL_SSL=1 PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir pillow numpy scikit-learn "opencv-python-headless<5" mysql-connector-python starlette uvicorn python-multipart

COPY common.py model.py detector.py server.py ./
COPY frontend ./frontend
COPY frontend_admin ./frontend_admin
COPY model/best.pt ./model/best.pt

CMD ["sh", "-c", "python -m uvicorn server:app --host 0.0.0.0 --port ${PORT:-10000}"]
