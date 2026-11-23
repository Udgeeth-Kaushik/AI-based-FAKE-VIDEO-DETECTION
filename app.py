import io
import os
import tempfile
import time

import cv2
import numpy as np
import streamlit as st
from PIL import Image

APP_NAME = "Fake Video Detector"

face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)


# ---------- analysis ----------
def get_frames(path, n):
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


def ela_score(img_bgr, quality=90):
    pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO()
    pil.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    resaved = Image.open(buf).convert("RGB")
    diff = np.abs(np.asarray(pil, dtype=np.int16) - np.asarray(resaved, dtype=np.int16))
    return float(diff.mean())


def analyze_frame(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    mask = np.ones(gray.shape, bool)
    mask[y:y + h, x:x + w] = False
    return {
        "box": (x, y, w, h),
        "sharp_ratio": lap[y:y + h, x:x + w].var() / (lap[mask].var() + 1e-6),
        "ela_ratio": (ela_score(frame[y:y + h, x:x + w]) + 1e-6) / (ela_score(frame) + 1e-6),
        "brightness": float(gray[y:y + h, x:x + w].mean()),
    }


def risk_from(results, sensitivity):
    sharp = np.mean([r["sharp_ratio"] for r in results])
    ela = np.mean([r["ela_ratio"] for r in results])
    bright = [r["brightness"] for r in results]
    s1 = min(abs(np.log(sharp + 1e-6)) / 1.5, 1)
    s2 = min(abs(np.log(ela + 1e-6)) / 1.0, 1)
    s3 = min(np.std(np.diff(bright)) / 20, 1) if len(bright) > 2 else 0
    risk = min((0.4 * s1 + 0.3 * s2 + 0.3 * s3) * sensitivity, 1.0)
    return risk, s1, s2, s3


@st.cache_resource
def get_detector():
    """Trained model if models/best.pt exists and torch is installed, else None."""
    try:
        from detector import load_detector
        return load_detector()
    except Exception:
        return None


# ---------- page ----------
st.set_page_config(page_title=f"{APP_NAME} | Video Authenticity Checker", page_icon="🛡️", layout="wide")

st.markdown(
    """
<style>
.hero {background:#0F766E; color:#FFFFFF; padding:2.2rem 2rem; border-radius:14px; margin-bottom:1.2rem;}
.hero h1 {color:#FFFFFF; margin:0 0 .3rem 0; font-size:2.4rem;}
.hero p {color:#E6FFFA; margin:0; font-size:1.1rem;}
.card {background:#F1F5F9; color:#0F172A; border:1px solid #CBD5E1; border-radius:12px; padding:1rem 1.2rem; height:100%;}
.card h4 {color:#0F172A; margin:0 0 .3rem 0;}
.card p {color:#334155; margin:0;}
.badge {display:inline-block; padding:.5rem 1.1rem; border-radius:999px; font-weight:700; font-size:1.2rem;}
.low {background:#DCFCE7; color:#14532D; border:1px solid #166534;}
.med {background:#FEF3C7; color:#78350F; border:1px solid #92400E;}
.high {background:#FEE2E2; color:#7F1D1D; border:1px solid #991B1B;}
.foot {color:#475569; font-size:.9rem; text-align:center; margin-top:2rem;}
</style>
""",
    unsafe_allow_html=True,
)

with st.sidebar:
    st.header("Settings")
    n_frames = st.select_slider("Frames to analyze", options=[10, 15, 20, 30], value=15)
    sensitivity = st.slider("Sensitivity", 0.5, 1.5, 1.0, 0.1,
                            help="Zyada = chhoti gadbad bhi suspicious maanega")
    with st.expander("About / Limitations"):
        st.write(
            "ABOUT SECTION AND LIMITATION"
        )

st.markdown(
    f"""
<div class="hero">
  <h1> {APP_NAME}</h1>
  <p>Video Authenticity Checker. Upload a video, get a risk score in seconds.</p>
</div>
""",
    unsafe_allow_html=True,
)

st.subheader("How it works")
h1, h2, h3 = st.columns(3)
h1.markdown('<div class="card"><h4>1. Upload</h4><p>Upload a video with face. (MP4, AVI, MOV).</p></div>', unsafe_allow_html=True)
h2.markdown('<div class="card"><h4>2. Analyze</h4><p>Extract face from the video, detect and blur faces, ELA and brightness levels.</p></div>', unsafe_allow_html=True)
h3.markdown('<div class="card"><h4>3. Result</h4><p>Display a low, medium, or high risk score, highlight suspicious frames.</p></div>', unsafe_allow_html=True)

st.write("")
st.subheader("Upload video")
video = st.file_uploader(
    "Drag and drop or browse",
    type=["mp4", "avi", "mov", "mkv"],
    help="Supported: MP4, AVI, MOV, MKV. Clear face video would be the best.",
)

if video:
    data = video.getvalue()
    st.video(data)

    if st.button("Analyze video", type="primary"):
        path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
                tmp.write(data)
                path = tmp.name

            frames = get_frames(path, n_frames)
            if not frames:
                st.error("Unable to read video, Please try again.")
                st.stop()

            st.subheader("Analyzing...")
            strip = st.empty()
            bar = st.progress(0)
            results, shown = [], []
            start = time.time()

            for i, f in enumerate(frames):
                r = analyze_frame(f)
                if r:
                    results.append(r)
                    x, y, w, h = r["box"]
                    vis = f.copy()
                    cv2.rectangle(vis, (x, y), (x + w, y + h), (0, 0, 255), 3)
                    shown.append(cv2.cvtColor(vis, cv2.COLOR_BGR2RGB))
                with strip.container():
                    c1, c2, c3, c4 = st.columns(4)
                    c1.metric("Frames processed", f"{i + 1} / {len(frames)}")
                    c2.metric("Faces found", len(results))
                    c3.metric("Checks used", 3)
                    c4.metric("Time", f"{time.time() - start:.1f} s")
                bar.progress((i + 1) / len(frames))

            if len(results) < 3:
                st.warning("Few face frames detected, Please try again.")
            else:
                risk, s1, s2, s3 = risk_from(results, sensitivity)
                detector = get_detector()
                model_used = False
                if detector is not None:
                    from detector import predict_fake_prob
                    p = predict_fake_prob(detector, frames)
                    if p is not None:
                        risk, model_used = p, True
                if risk < 0.35:
                    cls, label = "low", "LOW RISK (likely real)"
                elif risk < 0.6:
                    cls, label = "med", "MEDIUM RISK (suspicious)"
                else:
                    cls, label = "high", "HIGH RISK (likely fake)"

                st.subheader("Result")
                st.markdown(f'<span class="badge {cls}">{label}</span>', unsafe_allow_html=True)
                st.write("")
                st.progress(float(risk), text=f"Risk score: {risk:.2f}")
                st.caption("Score from: trained model" if model_used else "")

                m1, m2, m3 = st.columns(3)
                m1.metric("Face vs background blur", f"{s1:.2f}")
                m2.metric("ELA inconsistency", f"{s2:.2f}")
                m3.metric("Brightness flicker", f"{s3:.2f}")

                st.write("Detected faces:")
                st.image(shown[:6], caption=[f"Frame {i + 1}" for i in range(min(6, len(shown)))], width=220)

                report = (
                    f"{APP_NAME} Report\nResult: {label}\nScore: {risk:.2f}\n"
                    f"Blur: {s1:.2f}\nELA: {s2:.2f}\nFlicker: {s3:.2f}\n"
                    f"Frames with face: {len(results)}/{len(frames)}\n"
                    "Note: I am just a prototype ^-^ "
                )
                st.download_button("Download report", report, "report.txt")
        except Exception:
            st.error("Analysis failed, Try another video.")
        finally:
            if path and os.path.exists(path):
                os.remove(path)
