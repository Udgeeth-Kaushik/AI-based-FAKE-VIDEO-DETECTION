"""Shared helpers: frame sampling, face cropping, tensor conversion."""
import cv2
import numpy as np

IMG_SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)


def sample_frames(path, n):
    """Return n evenly spaced BGR frames from a video."""
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    idxs = np.linspace(0, max(total - 1, 0), n).astype(int)
    frames = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, f = cap.read()
        if ok:
            frames.append(f)
    cap.release()
    return frames


def crop_face(frame, margin=0.3, size=IMG_SIZE):
    """Largest face with some margin, resized to size x size. None if no face."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = _cascade.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    m = int(margin * max(w, h))
    x0, y0 = max(x - m, 0), max(y - m, 0)
    x1, y1 = min(x + w + m, frame.shape[1]), min(y + h + m, frame.shape[0])
    return cv2.resize(frame[y0:y1, x0:x1], (size, size))


def crops_to_array(crops):
    """List of BGR uint8 crops -> normalized float32 array (T, 3, H, W)."""
    arr = np.stack([cv2.cvtColor(c, cv2.COLOR_BGR2RGB) for c in crops]).astype(np.float32) / 255.0
    arr = (arr - MEAN) / STD
    return arr.transpose(0, 3, 1, 2)
