"""AI Based Fake Video Detection - backend API (Starlette + MySQL).

Run the server :  python -m uvicorn server:app --host 0.0.0.0 --port 8000
Create the admin:  python server.py create-admin     (one time, owner only)
Check database  :  python server.py check-db

Database settings come from environment variables (MYSQL_HOST, MYSQL_PORT, MYSQL_USER,
MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_SSL=1 for TLS) or, for local use, from
.streamlit/secrets.toml ([mysql] section).
"""
import base64
import contextlib
import gzip
import hashlib
import hmac
import html
import json
import logging
import os
import re
import secrets
import struct
import sys
import tempfile
import threading
import time
import tomllib
import traceback
import uuid
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import cv2
import mysql.connector
import numpy as np
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

log = logging.getLogger("fvd")
APP_NAME = "AI Based Fake Video Detection"
BASE = Path(__file__).resolve().parent
MODEL_PATH = Path(os.environ.get("MODEL_PATH", BASE / "models" / "best.pt"))
FRONTEND = BASE / "frontend"
ADMIN_DIR = BASE / "frontend_admin"      # admin page lives OUTSIDE the public static folder

COOKIE = "fvd_session"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"   # set to 1 when served over HTTPS
TRUST_PROXY = os.environ.get("TRUST_PROXY", "0") == "1"       # set to 1 behind a reverse proxy
IDLE_MINUTES = 30
MAX_SESSION_HOURS = 12
MAX_FAILS = 5
LOCK_MINUTES = 5
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "50")) * 1024 * 1024
MAX_SECONDS = float(os.environ.get("MAX_VIDEO_SECONDS", "60"))
FRAME_CHOICES = (10, 15, 20, 30)
VIDEO_EXT = {".mp4", ".avi", ".mov", ".mkv"}
SUSPICIOUS = 0.5
MAX_QUEUE = 5
REQUIRED_TABLES = {"users", "analyses", "reports", "audit_log", "sessions", "analysis_frames"}
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,30}$")
TEAL_BGR, RED_BGR, GREEN_BGR = (110, 118, 15), (38, 38, 220), (74, 160, 22)
VERDICT_TEXT = {"LOW": "Low risk (likely real)", "MEDIUM": "Medium risk (suspicious)",
                "HIGH": "High risk (likely fake)"}

MODEL = None          # set at startup
MODEL_INFO = {}       # validation metrics stored inside the checkpoint
CASCADE = None


# =====================================================================
# Database
# =====================================================================
def db_cfg():
    if os.environ.get("MYSQL_HOST"):
        return {"host": os.environ["MYSQL_HOST"], "port": os.environ.get("MYSQL_PORT", "3306"),
                "user": os.environ["MYSQL_USER"], "password": os.environ["MYSQL_PASSWORD"],
                "database": os.environ["MYSQL_DATABASE"], "ssl": os.environ.get("MYSQL_SSL", "0")}
    with open(BASE / ".streamlit" / "secrets.toml", "rb") as f:
        return tomllib.load(f)["mysql"]


def _connect():
    cfg = db_cfg()
    kw = dict(host=cfg.get("host", "localhost"), port=int(cfg.get("port", 3306)), user=cfg["user"],
              password=cfg["password"], database=cfg["database"], autocommit=True, connection_timeout=10)
    if str(cfg.get("ssl", "")).lower() in ("1", "true"):
        kw["ssl_disabled"] = False
    return mysql.connector.connect(**kw)


def run(sql, params=(), fetch=None):
    """One parameterized query. fetch: 'one' | 'all' | None (returns lastrowid)."""
    cnx = _connect()
    try:
        cur = cnx.cursor(dictionary=True, buffered=True)
        cur.execute(sql, params)
        if fetch == "one":
            return cur.fetchone()
        if fetch == "all":
            return cur.fetchall()
        return cur.lastrowid
    finally:
        cnx.close()


def run_many(sql, rows):
    cnx = _connect()
    try:
        cur = cnx.cursor()
        cur.executemany(sql, rows)
    finally:
        cnx.close()


def log_event(event, uid=None, username=None):
    try:
        run("INSERT INTO audit_log (user_id, username_tried, event) VALUES (%s,%s,%s)",
            (uid, (username or "")[:50] or None, event))
    except Exception:
        log.exception("audit log failed")


# =====================================================================
# Passwords and 2FA (standard library only)
# =====================================================================
_SCRYPT_MEM = 64 * 1024 * 1024
DUMMY_HASH = "scrypt$16384$8$1$" + "00" * 16 + "$" + "00" * 32  # keeps timing equal for unknown users


def hash_password(pw):
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32, maxmem=_SCRYPT_MEM)
    return f"scrypt$16384$8$1${salt.hex()}${h.hex()}"


def check_password(pw, stored):
    try:
        _, n, r, p, salt, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p),
                              dklen=len(h) // 2, maxmem=_SCRYPT_MEM)
        return hmac.compare_digest(calc.hex(), h)
    except Exception:
        return False


def password_problem(pw, minlen=8):
    if len(pw) < minlen:
        return f"Password must be at least {minlen} characters."
    if len(pw.encode()) > 128:
        return "Password is too long (max 128 characters)."
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        return "Password must contain both letters and numbers."
    return None


def totp_code(secret, step):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    off = digest[-1] & 0x0F
    num = (struct.unpack(">I", digest[off:off + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{num:06d}"


def verify_totp(secret, code, last_step=None):
    """Returns the matched time step (stored, so a code cannot be reused) or None."""
    code = (code or "").strip().replace(" ", "")
    if not re.fullmatch(r"\d{6}", code):
        return None
    now = int(time.time() // 30)
    for step in (now - 1, now, now + 1):
        if (last_step is None or step > int(last_step)) and hmac.compare_digest(totp_code(secret, step), code):
            return step
    return None


# =====================================================================
# Login, sessions, rate limiting
# =====================================================================
LOGIN_SQL = ("SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked "
             "FROM users WHERE {} = %s")


def register_failure(uid):
    run("UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id=%s", (uid,))
    run("UPDATE users SET locked_until = DATE_ADD(NOW(), INTERVAL %s MINUTE), failed_attempts = 0 "
        "WHERE id=%s AND failed_attempts >= %s", (LOCK_MINUTES, uid, MAX_FAILS))


def attempt_login(username, password):
    """Returns ('ok' | 'need_totp' | 'fail', user_id)."""
    u = run("SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked FROM users "
            "WHERE username=%s OR email=%s LIMIT 1", (username, username), "one")
    matched = check_password(password, u["password_hash"] if u else DUMMY_HASH)  # always runs scrypt
    if not u:
        log_event("login_fail", None, username)
        return "fail", None
    if u["is_locked"]:
        return "fail", None
    if not matched:
        register_failure(u["id"])
        log_event("login_fail", u["id"], username)
        return "fail", None
    if not u["is_active"]:
        return "fail", None
    if u["role"] == "admin":
        return ("need_totp", u["id"]) if u["totp_secret"] else ("fail", None)
    run("UPDATE users SET failed_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=%s", (u["id"],))
    log_event("login_ok", u["id"], username)
    return "ok", u["id"]


def finish_admin_login(uid, code):
    u = run(LOGIN_SQL.format("id") + " AND role='admin'", (uid,), "one")
    if not u or u["is_locked"] or not u["is_active"] or not u["totp_secret"]:
        return False
    step = verify_totp(u["totp_secret"], code, u["last_totp_step"])
    if step is None:
        register_failure(uid)
        log_event("admin_2fa_fail", uid, u["username"])
        return False
    run("UPDATE users SET last_totp_step=%s, failed_attempts=0, locked_until=NULL, last_login=NOW() "
        "WHERE id=%s", (step, uid))
    log_event("admin_login_ok", uid, u["username"])
    return True


def create_user(email, name, password):
    username = "u" + secrets.token_hex(7)  # internal id; people sign in with their email
    uid = run("INSERT INTO users (username, email, display_name, password_hash, role) VALUES (%s,%s,%s,%s,'user')",
              (username, email, name, hash_password(password)))
    log_event("signup", uid, username)
    return uid


def tok_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(uid, pending):
    token = secrets.token_urlsafe(32)
    run("INSERT INTO sessions (token_hash, user_id, pending_2fa) VALUES (%s,%s,%s)",
        (tok_hash(token), uid, int(pending)))
    if secrets.randbelow(20) == 0:  # occasional cleanup of dead sessions
        run("DELETE FROM sessions WHERE last_active < DATE_SUB(NOW(), INTERVAL %s HOUR)", (MAX_SESSION_HOURS,))
    return token


SESSION_SQL = ("SELECT s.token_hash, s.user_id AS id, s.pending_2fa, s.tries, u.username, u.email, u.display_name, u.role, u.is_active "
               "FROM sessions s JOIN users u ON u.id = s.user_id "
               "WHERE s.token_hash=%s AND s.last_active > DATE_SUB(NOW(), INTERVAL %s MINUTE) "
               "AND s.created_at > DATE_SUB(NOW(), INTERVAL %s HOUR)")


def get_session(request, pending_ok=False):
    """The logged-in user for this request (validated in the database every time) or None."""
    token = request.cookies.get(COOKIE)
    if not token or len(token) > 100:
        return None
    s = run(SESSION_SQL, (tok_hash(token), IDLE_MINUTES, MAX_SESSION_HOURS), "one")
    if not s or not s["is_active"]:
        return None
    if s["pending_2fa"] and not pending_ok:
        return None
    run("UPDATE sessions SET last_active=NOW() WHERE token_hash=%s", (s["token_hash"],))
    return s


def require_admin(request):
    s = get_session(request)
    return s if s and s["role"] == "admin" else None


_hits = defaultdict(deque)
_hits_lock = threading.Lock()


def limited(key, limit, window):
    now = time.time()
    with _hits_lock:
        if len(_hits) > 5000:
            _hits.clear()
        q = _hits[key]
        while q and q[0] < now - window:
            q.popleft()
        if len(q) >= limit:
            return True
        q.append(now)
        return False


def client_ip(request):
    if TRUST_PROXY:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# =====================================================================
# Video analysis
# =====================================================================
class UserError(Exception):
    """Problem to show to the user as-is."""


def read_frames(path, n):
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    idxs = sorted(set(np.linspace(0, max(total - 1, 0), n).astype(int).tolist()))
    out = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, f = cap.read()
        if ok:
            out.append((int(i), (i / fps) if fps > 0 else 0.0, f))
    cap.release()
    return out, ((total / fps) if fps > 0 else 0.0)


def video_seconds(path):
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    cap.release()
    return total, ((total / fps) if fps > 0 else 0.0)


def detect_and_crop(frame):
    """Same crop as common.crop_face (used in training), but also returns the face box."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = CASCADE.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))
    if len(faces) == 0:
        return None, None
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    m = int(0.3 * max(w, h))
    x0, y0 = max(x - m, 0), max(y - m, 0)
    x1, y1 = min(x + w + m, frame.shape[1]), min(y + h + m, frame.shape[0])
    return (int(x), int(y), int(w), int(h)), cv2.resize(frame[y0:y1, x0:x1], (224, 224))


def small(frame, box, width=480):
    s = width / frame.shape[1]
    img = cv2.resize(frame, (width, max(int(frame.shape[0] * s), 1)))
    return img, (tuple(int(v * s) for v in box) if box else None)


def draw_box(base_bgr, box, color_bgr):
    img = base_bgr.copy()
    if box:
        x, y, w, h = box
        cv2.rectangle(img, (x, y), (x + w, y + h), color_bgr, 3)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def frame_image(f):
    flagged = f["prob"] is not None and f["prob"] >= SUSPICIOUS
    return draw_box(f["base"], f["box"], RED_BGR if flagged else GREEN_BGR)


def jpeg_bytes(rgb, q=82):
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, q])
    return buf.tobytes()


def score_frames(model, crops):
    """Per-frame fake probabilities; the video score is the sigmoid of the mean frame logit,
    which is exactly what model.forward computes (the last layer is linear)."""
    import torch
    from common import crops_to_array
    with torch.no_grad():
        x = torch.from_numpy(crops_to_array(crops)).unsqueeze(0)
        b, t, c, h, w = x.shape
        feats = model.pool(model.features(x.reshape(b * t, c, h, w))).flatten(1).reshape(b, t, -1)
        seq, _ = model.lstm(feats)
        logits = model.fc(seq).squeeze(-1)[0]
        return float(torch.sigmoid(logits.mean())), [float(v) for v in torch.sigmoid(logits)]


def verdict_for(p):
    return "LOW" if p < 0.35 else ("MEDIUM" if p < 0.60 else "HIGH")


def model_note():
    i = MODEL_INFO or {}
    if i.get("val_acc") is None or i.get("val_auc") is None:
        return "The model was trained on public deepfake datasets."
    per = {k: v for k, v in (i.get("per_dataset") or {}).items() if k != "overall"}
    s = (f"On held-out validation videos it reached about {i['val_acc'] * 100:.0f}% accuracy "
         f"and {i['val_auc']:.2f} AUC")
    if per:
        s += " (" + ", ".join(f"{k}: {v['acc'] * 100:.0f}%" for k, v in per.items()) + ")"
    return s + "."


def build_report(username, filename, r):
    e = html.escape
    scored = [f for f in r["frames"] if f["prob"] is not None]
    flagged = [f for f in scored if f["prob"] >= SUSPICIOUS]
    top = sorted(scored, key=lambda f: -f["prob"])[:4]
    nofaces = [f for f in r["frames"] if f["prob"] is None]
    pal = {"LOW": ("#DCFCE7", "#14532D"), "MEDIUM": ("#FEF3C7", "#78350F"), "HIGH": ("#FEE2E2", "#7F1D1D")}
    bg, fg = pal[r["verdict"]]
    for f in scored:
        f["b64"] = base64.b64encode(jpeg_bytes(frame_image(f))).decode()

    def card(f):
        bad = f["prob"] >= SUSPICIOUS
        col = "#B91C1C" if bad else "#15803D"
        return (f'<div class="fc {"bad" if bad else ""}"><img src="data:image/jpeg;base64,{f["b64"]}">'
                f'<div class="fm"><b>Frame #{f["idx"]}</b> &middot; {f["time"]:.1f}s</div>'
                f'<div class="bar"><span style="width:{f["prob"] * 100:.0f}%;background:{col}"></span></div>'
                f'<div class="fm" style="color:{col}">{f["prob"] * 100:.0f}% fake &mdash; '
                f'{"Suspicious" if bad else "Looks normal"}</div></div>')

    bars = "".join(
        f'<div class="tb" title="{f["time"]:.1f}s: {f["prob"] * 100:.0f}%" '
        f'style="height:{max(int(f["prob"] * 100), 3)}px;background:{"#B91C1C" if f["prob"] >= SUSPICIOUS else "#15803D"}"></div>'
        for f in scored)
    t = r["timings"]
    rows = [("File", e(filename)), ("Analysed by", e(username)), ("Date", e(r["created"])),
            ("Video length", f'{r["video_seconds"]:.1f} s'), ("Frames sampled", r["n_sampled"]),
            ("Frames with a face", len(scored)), ("Suspicious frames (&ge;50%)", len(flagged)),
            ("Reading frames", f'{t["read"]:.2f} s'), ("Face detection", f'{t["faces"]:.2f} s'),
            ("AI model", f'{t["model"]:.2f} s'), ("Total analysis time", f'{t["total"]:.2f} s')]
    table = "".join(f"<tr><td>{a}</td><td><b>{b}</b></td></tr>" for a, b in rows)
    missed = ""
    if nofaces:
        missed = ("<p class='note'>No face detected in (skipped): " +
                  ", ".join(f'#{f["idx"]} ({f["time"]:.1f}s)' for f in nofaces) + "</p>")
    summary = (f'The AI model estimates a <b>{r["prob"] * 100:.0f}%</b> probability that this video is manipulated. '
               f'{len(flagged)} of {len(scored)} analysed frames were flagged as suspicious.')
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{APP_NAME} - Report</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;background:#F1F5F9;color:#0F172A;margin:0;padding:24px}}
.wrap{{max-width:980px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px #0001}}
.head{{background:#0F766E;color:#fff;padding:24px 28px}}.head h1{{margin:0;font-size:24px}}.head p{{margin:4px 0 0;color:#CCFBF1}}
.sec{{padding:20px 28px}}h2{{font-size:18px;margin:0 0 10px;color:#0F766E}}
.badge{{display:inline-block;padding:8px 18px;border-radius:999px;font-weight:700;font-size:18px;background:{bg};color:{fg}}}
table{{border-collapse:collapse;width:100%}}td{{padding:7px 10px;border-bottom:1px solid #E2E8F0;font-size:14px}}td:first-child{{color:#475569;width:45%}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}}
.fc{{border:1px solid #CBD5E1;border-radius:10px;padding:8px;background:#fff}}.fc.bad{{border-color:#B91C1C;background:#FEF2F2}}
.fc img{{width:100%;border-radius:6px}}.fm{{font-size:13px;margin-top:5px}}
.bar{{height:7px;background:#E2E8F0;border-radius:4px;margin-top:5px}}.bar span{{display:block;height:100%;border-radius:4px}}
.tl{{display:flex;align-items:flex-end;gap:3px;height:104px;border-bottom:1px solid #94A3B8}}.tb{{flex:1;border-radius:3px 3px 0 0}}
.note{{font-size:13px;color:#475569}}.meter{{height:14px;background:#E2E8F0;border-radius:8px;margin:12px 0}}
.meter span{{display:block;height:100%;border-radius:8px;background:{fg}}}
@media print{{body{{background:#fff;padding:0}}.wrap{{box-shadow:none}}}}
</style></head><body><div class="wrap">
<div class="head"><h1>{APP_NAME}</h1><p>Video authenticity report</p></div>
<div class="sec"><span class="badge">{e(VERDICT_TEXT[r["verdict"]])}</span>
<div class="meter"><span style="width:{r["prob"] * 100:.0f}%"></span></div>
<p style="font-size:15px">Risk score: <b>{r["prob"] * 100:.0f}%</b></p><p>{summary}</p></div>
<div class="sec"><h2>Summary</h2><table>{table}</table></div>
<div class="sec"><h2>Risk over time</h2><div class="tl">{bars}</div>
<p class="note">Each bar is one analysed frame, left to right through the video. Red = suspicious (&ge;50%).</p></div>
<div class="sec"><h2>Most suspicious frames</h2><div class="grid">{"".join(card(f) for f in top)}</div></div>
<div class="sec"><h2>All analysed frames</h2><div class="grid">{"".join(card(f) for f in scored)}</div>{missed}</div>
<div class="sec"><h2>How this was produced</h2>
<p class="note">Evenly spaced frames are taken from the video, the largest face in each frame is detected and cropped, and a
deep-learning model (EfficientNet-B0 features + BiLSTM over time) scores each frame. The video score is the average of the
frame scores. {e(model_note())}</p>
<p class="note"><b>Limitations:</b> this is an automated estimate, not proof. Accuracy can drop on videos that differ from the
training data (phone videos, heavy compression, new AI generators, non-frontal or covered faces). Do not use it as the only
evidence for important decisions.</p></div></div></body></html>"""


def save_analysis(uid, filename, r, report_html):
    detail = json.dumps({"timings": {k: round(v, 3) for k, v in r["timings"].items()}})
    aid = run("INSERT INTO analyses (user_id, filename, video_seconds, frames_sampled, frames_with_face, "
              "risk_score, verdict, time_taken_sec, detail) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
              (uid, filename[:255], r["video_seconds"], r["n_sampled"], r["n_faces"], r["prob"],
               r["verdict"], r["timings"]["total"], detail))
    run("INSERT INTO reports (analysis_id, html_gz) VALUES (%s,%s)",
        (aid, gzip.compress(report_html.encode("utf-8"))))
    run_many("INSERT INTO analysis_frames (analysis_id, frame_no, video_frame, time_sec, probability, jpeg) "
             "VALUES (%s,%s,%s,%s,%s,%s)",
             [(aid, k, f["idx"], f["time"], f["prob"],
               jpeg_bytes(frame_image(f) if f["prob"] is not None else cv2.cvtColor(f["base"], cv2.COLOR_BGR2RGB)))
              for k, f in enumerate(r["frames"])])
    return aid


# ---------------- background jobs ----------------
JOBS = {}
EXECUTOR = ThreadPoolExecutor(max_workers=1)  # one analysis at a time (CPU is limited)


def purge_jobs():
    cutoff = time.time() - 3600
    for k in [k for k, j in JOBS.items() if j["created"] < cutoff]:
        JOBS.pop(k, None)


def active_jobs(uid=None):
    return [j for j in JOBS.values() if j["status"] in ("queued", "running") and (uid is None or j["uid"] == uid)]


def run_job(job, path, filename, n_frames, username):
    job.update(status="running", t0=time.time())
    try:
        if MODEL is None or CASCADE is None:
            raise RuntimeError("model not loaded")
        t = time.time()
        frames, vsec = read_frames(path, n_frames)
        t_read = time.time() - t
        if not frames:
            raise UserError("Could not read this video. Please try another file.")
        job.update(stage="scanning", frames_total=len(frames))
        records, crops, t_face = [], [], 0.0
        for i, (idx, ts, fr) in enumerate(frames):
            t = time.time()
            box, crop = detect_and_crop(fr)
            t_face += time.time() - t
            base, sbox = small(fr, box)
            records.append({"idx": idx, "time": ts, "base": base, "box": sbox, "prob": None})
            if crop is not None:
                crops.append(crop)
            el = time.time() - job["t0"]
            job.update(frames_done=i + 1, faces_found=len(crops), eta_sec=el / (i + 1) * (len(frames) - i - 1))
        if len(crops) < 3:
            raise UserError("A face was found in fewer than 3 frames. Please upload a video with a clearly visible face.")
        job.update(stage="model", eta_sec=0.0)
        t = time.time()
        p, probs = score_frames(MODEL, crops)
        t_model = time.time() - t
        it = iter(probs)
        for rec in records:
            if rec["box"] is not None:
                rec["prob"] = next(it)
        res = {"prob": p, "verdict": verdict_for(p), "frames": records, "n_sampled": len(frames),
               "n_faces": len(crops), "video_seconds": vsec,
               "created": datetime.now().strftime("%d %b %Y, %H:%M"),
               "timings": {"read": t_read, "faces": t_face, "model": t_model, "total": time.time() - job["t0"]}}
        aid = save_analysis(job["uid"], filename, res, build_report(username, filename, res))
        job.update(status="done", stage="done", analysis_id=aid, elapsed=time.time() - job["t0"])
    except UserError as ex:
        job.update(status="error", stage="error", message=str(ex), elapsed=time.time() - job["t0"])
    except Exception:
        log.exception("analysis failed")
        job.update(status="error", stage="error", message="Analysis failed. Please try another video.",
                   elapsed=time.time() - job["t0"])
    finally:
        with contextlib.suppress(OSError):
            os.remove(path)


# =====================================================================
# HTTP handlers  (contract = teammate's frontend/js/api.js)
# =====================================================================
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,200}\.[A-Za-z]{2,24}$")
VERDICT_UI = {"LOW": "Low", "MEDIUM": "Medium", "HIGH": "High"}


def jerr(msg, status=400):
    return JSONResponse({"success": False, "error": msg, "message": msg}, status_code=status)


async def body_json(request):
    try:
        data = await request.json()
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def set_session_cookie(resp, token):
    resp.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=COOKIE_SECURE,
                    max_age=MAX_SESSION_HOURS * 3600, path="/")


def clear_cookie(resp):
    resp.delete_cookie(COOKIE, path="/")


def fmt_dt(dt):
    return dt.strftime("%Y-%m-%d %H:%M") if dt else None


def mmss(sec):
    sec = max(float(sec or 0), 0)
    return f"{int(sec // 60):02d}:{int(sec % 60):02d}"


def rep_id(n):
    return f"rep_{int(n)}"


def parse_rep(s):
    m = re.fullmatch(r"rep_(\d{1,18})", s or "")
    return int(m.group(1)) if m else None


def user_json(s):
    return {"id": str(s["id"]), "name": s.get("display_name") or s.get("username"),
            "email": s.get("email") or s.get("username"), "role": s["role"]}


def fetch_user(uid):
    return run("SELECT id, username, email, display_name, role FROM users WHERE id=%s", (uid,), "one")


async def health(request):
    return JSONResponse({"ok": True, "model_loaded": MODEL is not None})


async def model_info(request):
    i = MODEL_INFO or {}
    per = {k: {"accuracy": round(v["acc"] * 100, 1), "auc": v["auc"], "videos": v["n"]}
           for k, v in (i.get("per_dataset") or {}).items()}
    return JSONResponse({"loaded": MODEL is not None,
                         "accuracy": None if i.get("val_acc") is None else round(i["val_acc"] * 100, 1),
                         "auc": i.get("val_auc"), "per_dataset": per})


# ---------------- auth ----------------
async def signup(request):
    if limited(f"signup:{client_ip(request)}", 5, 600):
        return jerr("Too many attempts. Please try again later.", 429)
    d = await body_json(request)
    if d is None:
        return jerr("Invalid request.")
    email = str(d.get("email", "")).strip().lower()
    name = re.sub(r"\s+", " ", str(d.get("name", ""))).strip()
    password = str(d.get("password", ""))
    if not EMAIL_RE.match(email) or len(email) > 120:
        return jerr("Please enter a valid email address.")
    if not (1 <= len(name) <= 60) or any(ord(c) < 32 for c in name):
        return jerr("Please enter your name (max 60 characters).")
    problem = password_problem(password)
    if problem:
        return jerr(problem)
    try:
        uid = await run_in_threadpool(create_user, email, name, password)
    except mysql.connector.IntegrityError:
        return jerr("An account with this email is already registered. Please sign in.", 409)
    token = await run_in_threadpool(create_session, uid, False)
    u = await run_in_threadpool(fetch_user, uid)
    resp = JSONResponse({"success": True, "user": user_json(u)}, status_code=201)
    set_session_cookie(resp, token)
    return resp


async def login(request):
    if limited(f"login:{client_ip(request)}", 15, 60):
        return jerr("Too many attempts. Please wait a minute.", 429)
    d = await body_json(request)
    if d is None:
        return jerr("Invalid request.")
    ident = str(d.get("email") or d.get("username") or "").strip()[:120]
    password = str(d.get("password", ""))
    if len(password) > 128:
        password = ""
    status, uid = await run_in_threadpool(attempt_login, ident, password)
    if status == "fail":
        return jerr("Invalid email/username or password (or account temporarily locked).", 401)
    token = await run_in_threadpool(create_session, uid, status == "need_totp")
    if status == "need_totp":
        resp = JSONResponse({"success": False, "need_2fa": True, "message": "Enter your 6-digit authenticator code."})
    else:
        u = await run_in_threadpool(fetch_user, uid)
        resp = JSONResponse({"success": True, "user": user_json(u)})
    set_session_cookie(resp, token)
    return resp


async def login_2fa(request):
    s = await run_in_threadpool(get_session, request, True)
    if not s or not s["pending_2fa"]:
        return jerr("Please sign in first.", 401)
    if limited(f"2fa:{s['id']}", 10, 300):
        return jerr("Too many attempts. Please wait.", 429)
    d = await body_json(request)
    if d is None:
        return jerr("Invalid request.")
    ok = await run_in_threadpool(finish_admin_login, s["id"], str(d.get("code", "")))
    if not ok:
        tries = s["tries"] + 1
        if tries >= 3:
            await run_in_threadpool(run, "DELETE FROM sessions WHERE token_hash=%s", (s["token_hash"],))
            resp = jerr("Verification failed. Please sign in again.", 401)
            clear_cookie(resp)
            return resp
        await run_in_threadpool(run, "UPDATE sessions SET tries=%s WHERE token_hash=%s", (tries, s["token_hash"]))
        return jerr("Invalid code.", 401)
    await run_in_threadpool(run, "DELETE FROM sessions WHERE token_hash=%s", (s["token_hash"],))
    token = await run_in_threadpool(create_session, s["id"], False)  # fresh token after privilege change
    u = await run_in_threadpool(fetch_user, s["id"])
    resp = JSONResponse({"success": True, "user": user_json(u)})
    set_session_cookie(resp, token)
    return resp


async def logout(request):
    token = request.cookies.get(COOKIE)
    if token:
        await run_in_threadpool(run, "DELETE FROM sessions WHERE token_hash=%s", (tok_hash(token),))
    resp = JSONResponse({"success": True})
    clear_cookie(resp)
    return resp


async def me(request):
    s = await run_in_threadpool(get_session, request)
    return JSONResponse({"user": user_json(s) if s else None})


# ---------------- detection ----------------
async def analyze(request):
    s = await run_in_threadpool(get_session, request)
    if not s:
        return jerr("Please sign in first.", 401)
    if MODEL is None:
        return jerr("The AI model is not available right now.", 503)
    if limited(f"analyze:{s['id']}", 20, 3600):
        return jerr("Hourly limit reached. Please try again later.", 429)
    purge_jobs()
    if active_jobs(s["id"]):
        return jerr("You already have an analysis running. Please wait for it to finish.", 429)
    if len(active_jobs()) >= MAX_QUEUE:
        return jerr("The server is busy. Please try again in a minute.", 503)
    form = await request.form()
    path = None
    try:
        up = form.get("video")
        if up is None or not hasattr(up, "read"):
            return jerr("No video file received.")
        name = os.path.basename(str(up.filename or "video"))[:200]
        ext = os.path.splitext(name)[1].lower()
        if ext not in VIDEO_EXT:
            return jerr("Unsupported file type. Use MP4, AVI, MOV or MKV.")
        try:
            n_frames = int(form.get("frames", 15))
        except (TypeError, ValueError):
            n_frames = 15
        if n_frames not in FRAME_CHOICES:
            n_frames = 15
        fd, path = tempfile.mkstemp(suffix=ext)
        size = 0
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await up.read(1 << 20)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD:
                    out.close()
                    os.remove(path)
                    path = None
                    return jerr(f"Video is too large (max {MAX_UPLOAD // (1024 * 1024)} MB).", 413)
                out.write(chunk)
        total, secs = await run_in_threadpool(video_seconds, path)
        if total < 1:
            return jerr("Could not read this video. Please try another file.")
        if secs > MAX_SECONDS:
            return jerr(f"Video is too long (max {int(MAX_SECONDS)} seconds).")
        job_id = "job_" + uuid.uuid4().hex[:12]
        job = {"id": job_id, "uid": s["id"], "status": "queued", "stage": "queued", "frames_done": 0,
               "frames_total": 0, "faces_found": 0, "eta_sec": None, "created": time.time(), "t0": None,
               "elapsed": None, "analysis_id": None, "message": None}
        JOBS[job_id] = job
        EXECUTOR.submit(run_job, job, path, name, n_frames, s.get("display_name") or s["username"])
        path = None  # the job now owns (and deletes) the file
        return JSONResponse({"jobId": job_id, "status": "queued",
                             "message": "Video uploaded. Analysis queued."}, status_code=202)
    finally:
        await form.close()
        if path:
            with contextlib.suppress(OSError):
                os.remove(path)


STAGE_TEXT = {"queued": "Waiting in queue", "scanning": "Sampling frames & detecting faces",
              "model": "AI model scoring", "done": "Analysis complete", "error": "Analysis failed"}


async def job_status(request):
    s = await run_in_threadpool(get_session, request)
    if not s:
        return jerr("Please sign in first.", 401)
    j = JOBS.get(request.path_params["job_id"])
    if not j or j["uid"] != s["id"]:
        return jerr("Not found.", 404)
    ft, fd = j["frames_total"], j["frames_done"]
    if j["status"] == "done":
        progress = 100
    elif j["stage"] == "model":
        progress = 85
    elif ft:
        progress = int(fd / ft * 75)
    else:
        progress = 0
    out = {"status": {"queued": "queued", "running": "processing", "done": "completed", "error": "failed"}[j["status"]],
           "progress": progress, "stage": STAGE_TEXT.get(j["stage"], j["stage"]), "framesScanned": fd,
           "totalFrames": ft, "facesFound": j["faces_found"]}
    if j["status"] == "running":
        out["elapsedTime"] = round(time.time() - j["t0"], 1)
        out["timeLeft"] = None if j["eta_sec"] is None else round(j["eta_sec"] + 1, 1)
    elif j["status"] == "queued":
        out["position"] = 1 + sum(1 for x in active_jobs() if x["created"] < j["created"])
    else:
        out["elapsedTime"] = round(j["elapsed"] or 0, 1)
    if j["status"] == "done":
        out["reportId"] = rep_id(j["analysis_id"])
    if j["status"] == "error":
        out["message"] = j["message"]
    return JSONResponse(out)


def get_result(uid, aid):
    a = run("SELECT * FROM analyses WHERE id=%s AND user_id=%s", (aid, uid), "one")
    if not a:
        return None
    rows = run("SELECT frame_no, video_frame, time_sec, probability FROM analysis_frames "
               "WHERE analysis_id=%s ORDER BY frame_no", (aid,), "all")
    detail = a["detail"]
    if isinstance(detail, (str, bytes)):
        detail = json.loads(detail)
    timings = (detail or {}).get("timings") or {"total": a["time_taken_sec"]}
    prob_pct = round(a["risk_score"] * 100, 1)
    allf, sus, timeline = [], [], []
    for r in rows:
        p = r["probability"]
        item = {"frameNumber": r["video_frame"], "timestamp": mmss(r["time_sec"]), "time": round(r["time_sec"], 2),
                "riskScore": None if p is None else round(p * 100, 1), "hasFace": p is not None,
                "isSuspicious": p is not None and p >= SUSPICIOUS,
                "thumbnail": f"/api/frames/{aid}/{r['frame_no']}.jpg"}
        allf.append(item)
        if p is not None:
            timeline.append({"frame": r["video_frame"], "time": round(r["time_sec"], 2), "risk": round(p * 100)})
            if p >= SUSPICIOUS:
                sus.append({**item, "anomalyType": "Flagged by the model (score of 50% or more)"})
    sus.sort(key=lambda f: -f["riskScore"])
    return {"jobId": rep_id(aid), "reportId": rep_id(aid), "fileName": a["filename"], "date": fmt_dt(a["created_at"]),
            "videoLength": mmss(a["video_seconds"]), "analysisTime": f"{a['time_taken_sec']:.1f}s",
            "verdict": VERDICT_UI[a["verdict"]], "verdictText": VERDICT_TEXT[a["verdict"]],
            "fakeProbability": prob_pct, "timings": timings, "modelNote": model_note(),
            "stats": {"totalFrames": a["frames_sampled"], "framesWithFace": a["frames_with_face"],
                      "suspiciousFrames": len(sus), "videoLengthSeconds": a["video_seconds"],
                      "analysisDurationSeconds": a["time_taken_sec"]},
            "riskTimeline": timeline, "suspiciousFrames": sus, "allFrames": allf,
            "downloadUrl": f"/api/report/{rep_id(aid)}/download"}


async def result_get(request):
    s = await run_in_threadpool(get_session, request)
    if not s:
        return jerr("Please sign in first.", 401)
    ident = request.path_params["ident"]
    aid = parse_rep(ident)
    if aid is None:
        j = JOBS.get(ident)
        if not j or j["uid"] != s["id"]:
            return jerr("Not found.", 404)
        if j["status"] == "error":
            return jerr(j["message"] or "Analysis failed.", 422)
        if j["status"] != "done":
            return jerr("Analysis is not finished yet.", 409)
        aid = j["analysis_id"]
    res = await run_in_threadpool(get_result, s["id"], aid)
    return JSONResponse(res) if res else jerr("Not found.", 404)


async def report_get(request):
    s = await run_in_threadpool(get_session, request)
    if not s:
        return jerr("Please sign in first.", 401)
    aid = parse_rep(request.path_params["ident"])
    res = await run_in_threadpool(get_result, s["id"], aid) if aid else None
    return JSONResponse(res) if res else jerr("Not found.", 404)


def get_frame(uid, aid, n):
    return run("SELECT f.jpeg FROM analysis_frames f JOIN analyses a ON a.id = f.analysis_id "
               "WHERE a.id=%s AND a.user_id=%s AND f.frame_no=%s", (aid, uid, n), "one")


async def frame_image_get(request):
    s = await run_in_threadpool(get_session, request)
    if not s:
        return jerr("Please sign in first.", 401)
    row = await run_in_threadpool(get_frame, s["id"], request.path_params["aid"], request.path_params["n"])
    if not row or not row["jpeg"]:
        return jerr("Not found.", 404)
    return Response(bytes(row["jpeg"]), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=600"})


def get_report_html(uid, aid):
    return run("SELECT r.html_gz FROM reports r JOIN analyses a ON a.id = r.analysis_id "
               "WHERE a.id=%s AND a.user_id=%s", (aid, uid), "one")


async def report_download(request):
    s = await run_in_threadpool(get_session, request)
    if not s:
        return jerr("Please sign in first.", 401)
    aid = parse_rep(request.path_params["ident"])
    row = await run_in_threadpool(get_report_html, s["id"], aid) if aid else None
    if not row:
        return jerr("Not found.", 404)
    return Response(gzip.decompress(bytes(row["html_gz"])), media_type="text/html; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="fake_video_report_{aid}.html"',
                             "Content-Security-Policy": "sandbox"})


def get_history(uid):
    return run("SELECT id, filename, created_at, video_seconds, frames_sampled, frames_with_face, risk_score, "
               "verdict, time_taken_sec FROM analyses WHERE user_id=%s ORDER BY created_at DESC, id DESC LIMIT 200",
               (uid,), "all")


async def history(request):
    s = await run_in_threadpool(get_session, request)
    if not s:
        return jerr("Please sign in first.", 401)
    rows = await run_in_threadpool(get_history, s["id"])
    return JSONResponse({"history": [{
        "id": rep_id(r["id"]), "fileName": r["filename"], "date": fmt_dt(r["created_at"]),
        "videoLength": mmss(r["video_seconds"]), "verdict": VERDICT_UI[r["verdict"]],
        "fakeProbability": round(r["risk_score"] * 100, 1), "analysisTime": f"{r['time_taken_sec']:.1f}s",
        "totalFrames": r["frames_sampled"], "framesWithFace": r["frames_with_face"],
        "datasetSource": "EfficientNet-B0 + BiLSTM"} for r in rows]})


async def history_delete(request):
    s = await run_in_threadpool(get_session, request)
    if not s:
        return jerr("Please sign in first.", 401)
    aid = parse_rep(request.path_params["ident"])
    if aid:
        await run_in_threadpool(run, "DELETE FROM analyses WHERE id=%s AND user_id=%s", (aid, s["id"]))
    return JSONResponse({"success": True})


# ---------------- admin (everything answers 404 unless a 2FA-verified admin asks) ----------------
async def admin_guard(request):
    return await run_in_threadpool(require_admin, request)


def not_found():
    return JSONResponse({"success": False, "message": "Not found."}, status_code=404)


def admin_stats_data():
    return run("SELECT (SELECT COUNT(*) FROM users WHERE role='user') AS users, "
               "(SELECT COUNT(*) FROM analyses) AS scans, "
               "(SELECT COUNT(*) FROM analyses WHERE verdict='HIGH') AS high, "
               "(SELECT AVG(time_taken_sec) FROM analyses) AS lat", fetch="one")


async def admin_stats(request):
    if not await admin_guard(request):
        return not_found()
    r = await run_in_threadpool(admin_stats_data)
    lat = r["lat"]
    return JSONResponse({"totalScans": int(r["scans"]), "totalUsers": int(r["users"]),
                         "highRiskDetected": int(r["high"]),
                         "avgLatency": "-" if lat is None else f"{float(lat):.1f}s"})


def admin_users_data():
    return run("SELECT id, username, email, display_name, role, is_active, created_at, "
               "(locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked "
               "FROM users WHERE role='user' ORDER BY id DESC LIMIT 500", fetch="all")


async def admin_users(request):
    if not await admin_guard(request):
        return not_found()
    rows = await run_in_threadpool(admin_users_data)
    return JSONResponse({"users": [{
        "id": str(r["id"]), "name": r["display_name"] or r["username"], "email": r["email"] or r["username"],
        "role": r["role"], "status": "Disabled" if not r["is_active"] else ("Locked" if r["is_locked"] else "Active"),
        "createdAt": fmt_dt(r["created_at"])} for r in rows]})


EVENT_TEXT = {"login_ok": "Success", "admin_login_ok": "Success (admin, 2FA)", "signup": "Success (new account)",
              "login_fail": "Failed (bad password)", "admin_2fa_fail": "Failed (2FA code)"}


async def admin_activity(request):
    if not await admin_guard(request):
        return not_found()
    rows = await run_in_threadpool(
        run, "SELECT l.id, l.created_at, l.event, l.username_tried, u.email, u.username FROM audit_log l "
             "LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 100", (), "all")
    return JSONResponse({"activities": [{
        "id": str(r["id"]), "time": fmt_dt(r["created_at"]),
        "user": r["email"] or r["username"] or r["username_tried"] or "unknown",
        "ip": "-", "browser": "-", "status": EVENT_TEXT.get(r["event"], r["event"])} for r in rows]})


def admin_action(uid, action):
    if action == "disable":
        run("UPDATE users SET is_active=0 WHERE id=%s AND role='user'", (uid,))
        run("DELETE FROM sessions WHERE user_id=%s", (uid,))
    elif action == "enable":
        run("UPDATE users SET is_active=1 WHERE id=%s AND role='user'", (uid,))
    elif action == "unlock":
        run("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=%s AND role='user'", (uid,))
    elif action == "delete":
        run("DELETE FROM users WHERE id=%s AND role='user'", (uid,))


async def admin_user_status(request):
    if not await admin_guard(request):
        return not_found()
    d = await body_json(request)
    action = str((d or {}).get("action", ""))
    if action not in ("disable", "enable", "unlock"):
        return jerr("Unknown action.")
    await run_in_threadpool(admin_action, request.path_params["uid"], action)
    return JSONResponse({"success": True})


async def admin_user_delete(request):
    if not await admin_guard(request):
        return not_found()
    await run_in_threadpool(admin_action, request.path_params["uid"], "delete")
    return JSONResponse({"success": True})


async def admin_page(request):
    if not await admin_guard(request) or not (ADMIN_DIR / "admin.html").is_file():
        return not_found()
    return FileResponse(ADMIN_DIR / "admin.html", headers={"Cache-Control": "no-store"})


async def admin_asset(request):
    if not await admin_guard(request):
        return not_found()
    f = (ADMIN_DIR / request.path_params["name"]).resolve()
    if f.parent != ADMIN_DIR.resolve() or not f.is_file() or f.name == "admin.html":
        return not_found()
    return FileResponse(f, headers={"Cache-Control": "no-store"})


async def root(request):
    return JSONResponse({"app": APP_NAME, "status": "API is running (no frontend folder found)"})


# =====================================================================
# App
# =====================================================================
class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            is_upload = request.url.path == "/api/detect/upload"
            cl = request.headers.get("content-length")
            if is_upload and cl is None:
                return jerr("Content-Length required.", 411)
            if cl and cl.isdigit() and int(cl) > (MAX_UPLOAD + (1 << 20) if is_upload else 100_000):
                return jerr("Request too large.", 413)
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        if request.url.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp


def load_model():
    global MODEL, MODEL_INFO, CASCADE
    CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    try:
        import torch
        from detector import load_detector
        torch.set_num_threads(int(os.environ.get("TORCH_THREADS", "2")))
        MODEL = load_detector(str(MODEL_PATH))
        if MODEL is None:
            log.error("Model file not found: %s", MODEL_PATH)
            return
        ckpt = torch.load(str(MODEL_PATH), map_location="cpu")
        MODEL_INFO = {k: ckpt.get(k) for k in ("val_auc", "val_acc", "per_dataset")}
        log.info("Model loaded from %s", MODEL_PATH)
    except Exception:
        MODEL = None
        log.exception("Could not load the model")


@contextlib.asynccontextmanager
async def lifespan(app):
    await run_in_threadpool(load_model)
    yield


routes = [
    Route("/api/health", health),
    Route("/api/model-info", model_info),
    Route("/api/auth/signup", signup, methods=["POST"]),
    Route("/api/auth/login", login, methods=["POST"]),
    Route("/api/auth/verify-2fa", login_2fa, methods=["POST"]),
    Route("/api/auth/logout", logout, methods=["POST"]),
    Route("/api/me", me),
    Route("/api/detect/upload", analyze, methods=["POST"]),
    Route("/api/detect/status/{job_id}", job_status),
    Route("/api/detect/result/{ident}", result_get),
    Route("/api/frames/{aid:int}/{n:int}.jpg", frame_image_get),
    Route("/api/report/{ident}/download", report_download),
    Route("/api/report/{ident}", report_get),
    Route("/api/history", history),
    Route("/api/history/{ident}", history_delete, methods=["DELETE"]),
    Route("/api/admin/stats", admin_stats),
    Route("/api/admin/users", admin_users),
    Route("/api/admin/activity", admin_activity),
    Route("/api/admin/users/{uid:int}/status", admin_user_status, methods=["PATCH"]),
    Route("/api/admin/users/{uid:int}", admin_user_delete, methods=["DELETE"]),
    Route("/admin.html", admin_page),
    Route("/admin", admin_page),
    Route("/admin-assets/{name}", admin_asset),
]
if FRONTEND.is_dir():
    routes.append(Mount("/", StaticFiles(directory=str(FRONTEND), html=True)))
else:
    routes.append(Route("/", root))

app = Starlette(routes=routes, middleware=[Middleware(SecurityMiddleware)], lifespan=lifespan)


# =====================================================================
# Command line (owner only): python server.py create-admin | check-db
# =====================================================================
def cli():
    import getpass
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "check-db":
        try:
            have = {list(r.values())[0] for r in run("SHOW TABLES", fetch="all")}
            print("Connected to MySQL.")
            print("Tables found:", ", ".join(sorted(have)) or "none")
            missing = REQUIRED_TABLES - have
            print("Missing tables:", ", ".join(sorted(missing)) if missing else "none  -> all good")
        except Exception as ex:
            print("DATABASE ERROR:", type(ex).__name__, ex)
        return
    if cmd != "create-admin":
        print("Usage:\n  python server.py create-admin\n  python server.py check-db")
        return
    if run("SELECT id FROM users WHERE role='admin' LIMIT 1", fetch="one"):
        print("An admin already exists. Only one admin is allowed.")
        return
    username = input("Admin username: ").strip()
    if not USERNAME_RE.match(username):
        print("Username must be 3-30 characters: letters, numbers, underscore.")
        return
    if run("SELECT id FROM users WHERE username=%s", (username,), "one"):
        print("That username is already taken by a normal user. Pick another.")
        return
    pw = getpass.getpass("Admin password (min 10 chars, letters+numbers): ")
    if pw != getpass.getpass("Repeat password: "):
        print("Passwords do not match.")
        return
    problem = password_problem(pw, 10)
    if problem:
        print(problem)
        return
    secret = base64.b32encode(os.urandom(20)).decode().rstrip("=")
    uri = f"otpauth://totp/{quote(APP_NAME)}:{quote(username)}?secret={secret}&issuer={quote(APP_NAME)}"
    print("\n2FA setup. In Google Authenticator / Microsoft Authenticator choose")
    print("'Enter a setup key' (or scan the QR below if shown) and use:")
    print("  Account:", username)
    print("  Key    :", secret, "  (time based)\n")
    try:
        import qrcode
        qr = qrcode.QRCode()
        qr.add_data(uri)
        qr.print_ascii(invert=True)
    except Exception:
        pass
    step = verify_totp(secret, input("Enter the 6-digit code now showing in the app: "))
    if step is None:
        print("Wrong code. Nothing was saved. Run the command again.")
        return
    run("INSERT INTO users (username, password_hash, role, totp_secret, last_totp_step) "
        "VALUES (%s,%s,'admin',%s,%s)", (username, hash_password(pw), secret, step))
    print("Admin created. Log in on the website with this username, password and a fresh 2FA code.")


if __name__ == "__main__":
    cli()
