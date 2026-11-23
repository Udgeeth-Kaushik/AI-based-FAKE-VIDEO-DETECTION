"""EfficientNet-B0 (per-frame features) + BiLSTM (temporal) deepfake classifier.

Input : (B, T, 3, 224, 224) normalized face crops
Output: (B,) logits, where 1 = FAKE, 0 = REAL
"""
import torch
import torch.nn as nn
from torchvision import models


class DeepfakeNet(nn.Module):
    def __init__(self, pretrained=True, hidden=256):
        super().__init__()
        weights = models.EfficientNet_B0_Weights.DEFAULT if pretrained else None
        backbone = models.efficientnet_b0(weights=weights)
        self.features = backbone.features
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.lstm = nn.LSTM(1280, hidden, batch_first=True, bidirectional=True)
        self.drop = nn.Dropout(0.4)
        self.fc = nn.Linear(hidden * 2, 1)

    def forward(self, x):
        b, t, c, h, w = x.shape
        f = self.pool(self.features(x.reshape(b * t, c, h, w))).flatten(1)
        f = f.reshape(b, t, -1)
        out, _ = self.lstm(f)
        return self.fc(self.drop(out.mean(dim=1))).squeeze(1)
