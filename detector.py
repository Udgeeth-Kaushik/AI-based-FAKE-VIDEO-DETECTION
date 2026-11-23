"""Inference helper used by app.py."""
from pathlib import Path

import torch

from common import crop_face, crops_to_array
from model import DeepfakeNet


def load_detector(path="models/best.pt"):
    """Return a ready model, or None if no trained checkpoint exists yet."""
    if not Path(path).exists():
        return None
    ckpt = torch.load(path, map_location="cpu")
    model = DeepfakeNet(pretrained=False)
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model


@torch.no_grad()
def predict_fake_prob(model, frames, min_faces=3):
    """Probability (0-1) that the video is fake, or None if too few faces."""
    crops = [c for c in (crop_face(f) for f in frames) if c is not None]
    if len(crops) < min_faces:
        return None
    x = torch.from_numpy(crops_to_array(crops)).unsqueeze(0)
    return float(torch.sigmoid(model(x))[0])
