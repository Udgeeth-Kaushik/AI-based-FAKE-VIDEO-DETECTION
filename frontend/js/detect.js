/**
 * AI Based Fake Video Detection - Detection & Forensics Module
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Ensure user is authenticated
  const user = await window.checkAuth();
  if (!user) return;

  // DOM Elements
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("video-file-input");
  const uploadWrapper = document.getElementById("upload-wrapper");
  const previewWrapper = document.getElementById("preview-wrapper");
  const previewVideo = document.getElementById("preview-video");
  const fileNameEl = document.getElementById("file-name");
  const fileSizeEl = document.getElementById("file-size");
  const btnAnalyze = document.getElementById("btn-analyze");
  const btnChangeVideo = document.getElementById("btn-change-video");

  // Progress Elements
  const progressSection = document.getElementById("progress-section");
  const progressFill = document.getElementById("progress-bar-fill");
  const progressPercent = document.getElementById("progress-percentage");
  const progressStage = document.getElementById("progress-stage-text");
  const statScanned = document.getElementById("pstat-scanned");
  const statFaces = document.getElementById("pstat-faces");
  const statElapsed = document.getElementById("pstat-elapsed");
  const statTimeLeft = document.getElementById("pstat-timeleft");

  // Result Elements
  const resultSection = document.getElementById("result-section");
  const verdictBadge = document.getElementById("verdict-badge");
  const verdictTitle = document.getElementById("verdict-title");
  const verdictDesc = document.getElementById("verdict-desc");
  const fakeProbabilityVal = document.getElementById("fake-probability-val");
  
  // 4 Stat Cards
  const statFramesWithFace = document.getElementById("stat-frames-face");
  const statSuspiciousFrames = document.getElementById("stat-suspicious-frames");
  const statVideoLength = document.getElementById("stat-video-length");
  const statAnalysisTime = document.getElementById("stat-analysis-time");

  // Chart & Galleries
  const chartContainer = document.getElementById("chart-container");
  const suspiciousGallery = document.getElementById("suspicious-gallery");
  const allFramesContainer = document.getElementById("all-frames-container");
  const allFramesToggle = document.getElementById("all-frames-toggle");
  const allFramesContent = document.getElementById("all-frames-content");
  const btnDownloadReport = document.getElementById("btn-download-report");
  const btnAnalyzeAnother = document.getElementById("btn-analyze-another");

  // Frame Modal
  const frameModal = document.getElementById("frame-modal");
  const modalImage = document.getElementById("modal-frame-image");
  const modalTitle = document.getElementById("modal-frame-title");
  const modalDetails = document.getElementById("modal-frame-details");
  const modalClose = document.getElementById("modal-frame-close");

  let selectedFile = null;
  let videoDurationSec = 15;
  let currentAnalysisResult = null;
  let timerInterval = null;

  // Max file size: 50MB in bytes
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = ["mp4", "avi", "mov", "mkv"];

  // File validation
  function validateFile(file) {
    if (!file) return false;

    const extension = file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      window.showToast("Invalid format. Please upload MP4, AVI, MOV, or MKV.", "error");
      return false;
    }

    if (file.size > MAX_FILE_SIZE) {
      window.showToast("File exceeds the 50 MB limit. Please choose a smaller video.", "error");
      return false;
    }

    return true;
  }

  // Handle selected file
  function handleSelectedFile(file) {
    if (!validateFile(file)) return;

    selectedFile = file;

    // Display metadata
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB • ${file.type || 'video/' + file.name.split('.').pop()}`;

    // Load preview
    const videoUrl = URL.createObjectURL(file);
    previewVideo.src = videoUrl;
    previewVideo.onloadedmetadata = () => {
      videoDurationSec = Math.round(previewVideo.duration) || 15;
    };

    dropzone.style.display = "none";
    previewWrapper.style.display = "block";
    btnAnalyze.disabled = false;
  }

  // Dropzone Events
  dropzone.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectedFile(e.target.files[0]);
    }
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-active");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag-active");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-active");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });

  // Change video button
  btnChangeVideo.addEventListener("click", () => {
    selectedFile = null;
    fileInput.value = "";
    previewVideo.pause();
    previewVideo.src = "";
    previewWrapper.style.display = "none";
    dropzone.style.display = "block";
    btnAnalyze.disabled = true;
  });

  // Analyze button click
  btnAnalyze.addEventListener("click", async () => {
    if (!selectedFile) return;

    // Hide upload wrapper & previous result
    uploadWrapper.style.display = "none";
    resultSection.style.display = "none";
    progressSection.style.display = "block";

    // Scroll to progress
    progressSection.scrollIntoView({ behavior: "smooth" });

    // Start analysis pipeline
    await executeAnalysisPipeline(selectedFile);
  });

  // Run analysis with REAL live progress from the backend
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function executeAnalysisPipeline(file) {
    let elapsedSeconds = 0;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      elapsedSeconds++;
      const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
      const ss = String(elapsedSeconds % 60).padStart(2, "0");
      statElapsed.textContent = `${mm}:${ss}`;
    }, 1000);

    progressFill.style.width = "0%";
    progressPercent.textContent = "0%";
    progressStage.textContent = "Uploading video...";
    statScanned.textContent = "0 / -";
    statFaces.textContent = "0";
    statElapsed.textContent = "00:00";
    statTimeLeft.textContent = "-";

    try {
      const uploadRes = await window.api.uploadVideo(file);
      const jobId = uploadRes.jobId;

      let st;
      for (;;) {
        st = await window.api.getDetectionStatus(jobId);
        const pct = Math.max(0, Math.min(100, st.progress || 0));
        progressFill.style.width = `${pct}%`;
        progressPercent.textContent = `${pct}%`;
        progressStage.textContent = st.status === "queued"
          ? `Waiting in queue (position ${st.position || 1})...`
          : `${st.stage || "Analysing"}...`;
        statScanned.textContent = `${st.framesScanned || 0} / ${st.totalFrames || "-"}`;
        statFaces.textContent = `${st.facesFound || 0}`;
        if (st.timeLeft != null && st.status === "processing") {
          statTimeLeft.textContent = `~ ${Math.ceil(st.timeLeft)}s`;
        }
        if (st.status === "completed" || st.status === "failed") break;
        await sleep(600);
      }
      clearInterval(timerInterval);
      if (st.status === "failed") throw new Error(st.message || "Analysis failed.");

      progressFill.style.width = "100%";
      progressPercent.textContent = "100%";
      statTimeLeft.textContent = "done";

      const result = await window.api.getDetectionResult(jobId);
      currentAnalysisResult = result;

      setTimeout(() => {
        progressSection.style.display = "none";
        renderAnalysisResult(result);
        resultSection.style.display = "block";
        resultSection.scrollIntoView({ behavior: "smooth" });
      }, 400);
    } catch (err) {
      clearInterval(timerInterval);
      window.showToast("Analysis problem: " + err.message, "error");
      progressSection.style.display = "none";
      uploadWrapper.style.display = "block";
    }
  }

  // Render Result on Detect Page
  function renderAnalysisResult(data) {
    const verdict = data.verdict || "High";
    const fakeProb = data.fakeProbability || 0;

    // Set Verdict Badge & Details
    verdictBadge.className = `verdict-badge ${verdict.toLowerCase()}`;
    verdictBadge.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        ${verdict === 'High' ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' :
          verdict === 'Medium' ? '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' :
          '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'}
      </svg>
      <span>${verdict} Risk</span>
    `;

    if (verdict === "High") {
      verdictTitle.textContent = "High Risk: Likely Manipulated Video";
      verdictDesc.textContent = "The model found many frames that look manipulated. Review the flagged frames below; this is an automated estimate, not proof.";
      fakeProbabilityVal.style.color = "#f43f5e";
    } else if (verdict === "Medium") {
      verdictTitle.textContent = "Medium Risk: Suspicious / Inconclusive";
      verdictDesc.textContent = "Some frames look suspicious. This can also be caused by heavy compression, motion blur or poor lighting - treat the result as inconclusive.";
      fakeProbabilityVal.style.color = "#fbbf24";
    } else {
      verdictTitle.textContent = "Low Risk: Likely Real Video";
      verdictDesc.textContent = "Few or no frames looked manipulated. This lowers the risk but cannot guarantee that the video is authentic.";
      fakeProbabilityVal.style.color = "#a3e635";
    }

    fakeProbabilityVal.textContent = `${fakeProb}%`;

    // 4 Stat Cards
    statFramesWithFace.textContent = `${data.stats.framesWithFace} / ${data.stats.totalFrames}`;
    statSuspiciousFrames.textContent = `${data.stats.suspiciousFrames} frames`;
    statVideoLength.textContent = `${data.videoLength || '00:15'}`;
    statAnalysisTime.textContent = `${data.analysisTime || '4.2s'}`;

    // Render SVG Risk Chart
    renderSvgRiskChart(data.riskTimeline || []);

    // Render Suspicious Frames Gallery
    renderSuspiciousFrames(data.suspiciousFrames || []);

    // Render Frame-by-Frame Telemetry Breakdown Table
    renderFrameTelemetryTable(data.suspiciousFrames || [], data.allFrames || []);

    // Render All Frames Strip
    renderAllFrames(data.allFrames || []);

    // Wire Detailed Analysis Report link
    const btnViewDossier = document.getElementById("btn-view-dossier");
    if (btnViewDossier && data.reportId) {
      btnViewDossier.href = `report.html?id=${data.reportId}`;
    }
  }

  // Interactive SVG Risk Chart
  function renderSvgRiskChart(timeline) {
    if (!timeline || timeline.length === 0) {
      chartContainer.innerHTML = "<p class='text-muted'>No timeline data available</p>";
      return;
    }

    const width = 860;
    const height = 220;
    const padding = { top: 25, right: 30, bottom: 35, left: 45 };

    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    const maxRisk = 100;
    const totalPoints = timeline.length;

    // Calculate path points
    const points = timeline.map((pt, index) => {
      const x = padding.left + (index / (totalPoints - 1)) * plotWidth;
      const y = padding.top + plotHeight - (pt.risk / maxRisk) * plotHeight;
      return { x, y, ...pt };
    });

    const dPath = points.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, "");

    const areaPath = `${dPath} L ${points[points.length - 1].x} ${padding.top + plotHeight} L ${points[0].x} ${padding.top + plotHeight} Z`;

    // Grid lines for 25%, 50%, 75%
    let gridLinesSvg = "";
    [25, 50, 75, 100].forEach(val => {
      const y = padding.top + plotHeight - (val / 100) * plotHeight;
      gridLinesSvg += `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-width="1" />
        <text x="${padding.left - 10}" y="${y + 4}" fill="#64748b" font-size="11" text-anchor="end">${val}%</text>
      `;
    });

    // Threshold alert line at 70%
    const threshY = padding.top + plotHeight - (50 / 100) * plotHeight;
    const thresholdSvg = `
      <line x1="${padding.left}" y1="${threshY}" x2="${width - padding.right}" y2="${threshY}" stroke="#f43f5e" stroke-dasharray="4 3" stroke-width="1.5" />
      <text x="${width - padding.right}" y="${threshY - 6}" fill="#f43f5e" font-size="10" text-anchor="end" font-weight="700" font-family="monospace">Suspicious threshold (50%)</text>
    `;

    // Interactive dots
    let dotsSvg = "";
    points.forEach((pt, idx) => {
      const isHigh = pt.risk >= 50;
      dotsSvg += `
        <circle cx="${pt.x}" cy="${pt.y}" r="${isHigh ? 4.5 : 3}" fill="${isHigh ? '#f43f5e' : '#a3e635'}" stroke="${isHigh ? '#090b0e' : 'none'}" stroke-width="1" class="chart-point" data-idx="${idx}" style="cursor: pointer;">
          <title>Frame #${pt.frame} (${pt.time}s) — Risk: ${pt.risk}%</title>
        </circle>
      `;
    });

    // Time Axis labels
    let timeLabelsSvg = "";
    const labelStep = Math.max(1, Math.floor(totalPoints / 6));
    timeline.forEach((pt, idx) => {
      if (idx % labelStep === 0 || idx === totalPoints - 1) {
        const x = padding.left + (idx / (totalPoints - 1)) * plotWidth;
        timeLabelsSvg += `
          <text x="${x}" y="${height - 10}" fill="#64748b" font-size="11" text-anchor="middle">${Math.floor(pt.time / 60)}:${String(Math.floor(pt.time % 60)).padStart(2, '0')}</text>
        `;
      }
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%; overflow: visible;">
        <defs>
          <linearGradient id="riskAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.35"/>
            <stop offset="70%" stop-color="#a3e635" stop-opacity="0.08"/>
            <stop offset="100%" stop-color="#7c3aed" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        ${gridLinesSvg}
        ${thresholdSvg}
        <path d="${areaPath}" fill="url(#riskAreaGrad)" />
        <path d="${dPath}" fill="none" stroke="#8b5cf6" stroke-width="2.2" stroke-linejoin="round" />
        ${dotsSvg}
        ${timeLabelsSvg}
      </svg>
    `;

    chartContainer.innerHTML = svg;
  }

  // Render Suspicious Frames Gallery
  function renderSuspiciousFrames(frames) {
    if (!frames || frames.length === 0) {
      suspiciousGallery.innerHTML = "<p class='text-muted' style='grid-column: 1/-1;'>No suspicious frames detected. Video passes forensic thresholds.</p>";
      return;
    }

    suspiciousGallery.innerHTML = frames.map(f => `
      <div class="frame-card suspicious" data-frame="${f.frameNumber}" data-time="${f.timestamp}" data-risk="${f.riskScore}" data-anomaly="${f.anomalyType}" data-img="${f.thumbnail}">
        <img src="${f.thumbnail}" alt="Frame #${f.frameNumber}" class="frame-thumb" loading="lazy" />
        <div class="frame-meta">
          <div class="frame-title">
            <span>Frame #${f.frameNumber}</span>
            <span class="frame-score-pill high">${f.riskScore}%</span>
          </div>
          <div class="frame-timestamp">${f.timestamp}</div>
          <div style="font-size: 0.76rem; color: #fca5a5; margin-top: 0.3rem;">Flagged by the model</div>
        </div>
      </div>
    `).join("");

    // Attach click event to open frame modal
    suspiciousGallery.querySelectorAll(".frame-card").forEach(card => {
      card.addEventListener("click", () => {
        openFrameModal({
          frameNumber: card.dataset.frame,
          timestamp: card.dataset.time,
          riskScore: card.dataset.risk,
          anomalyType: card.dataset.anomaly,
          thumbnail: card.dataset.img
        });
      });
    });
  }

  // Render Frame-by-Frame Table (real values only)
  function renderFrameTelemetryTable(suspicious, all) {
    const tbody = document.getElementById("frame-telemetry-tbody");
    if (!tbody) return;
    const frames = (all && all.length > 0) ? all : suspicious;
    if (!frames || frames.length === 0) {
      tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:2rem; color:var(--text-dim);'>No frame records available</td></tr>";
      return;
    }
    tbody.innerHTML = frames.map((f) => {
      const hasFace = f.hasFace !== false && f.riskScore != null;
      const risk = hasFace ? f.riskScore : 0;
      const isHigh = hasFace && risk >= 50;
      const color = isHigh ? '#f43f5e' : '#a3e635';
      const verdict = !hasFace ? "No face" : (isHigh ? "Suspicious" : "Looks normal");
      const badgeClass = !hasFace ? "badge" : (isHigh ? "badge-danger" : "badge-success");
      return `
        <tr>
          <td><strong style="color: #fff; font-family: var(--font-mono);">#${f.frameNumber}</strong></td>
          <td><span style="font-family: var(--font-mono); color: var(--text-dim); font-size: 0.85rem;">${f.timestamp}</span></td>
          <td>${hasFace ? "Yes" : "No"}</td>
          <td>
            ${hasFace ? `<div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="width: 60px; height: 6px; background: rgba(255,255,255,0.08); border-radius: 9999px; overflow: hidden;">
                <div style="width: ${risk}%; height: 100%; background: ${color};"></div>
              </div>
              <span style="font-family: var(--font-mono); font-weight: 700; font-size: 0.85rem;">${risk}%</span>
            </div>` : "-"}
          </td>
          <td><span class="badge ${badgeClass}">${verdict}</span></td>
          <td style="text-align: right;">
            <button type="button" class="btn btn-secondary btn-sm" style="padding: 0.25rem 0.65rem; font-size: 0.78rem;" data-inspect="1">Inspect</button>
          </td>
        </tr>`;
    }).join("");

    tbody.querySelectorAll("button[data-inspect]").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const f = frames[i];
        openFrameModal({ frameNumber: f.frameNumber, timestamp: f.timestamp, riskScore: f.riskScore,
                         anomalyType: f.riskScore != null && f.riskScore >= 50 ? "Flagged by the model" : "Looks normal",
                         thumbnail: f.thumbnail });
      });
    });
  }

  // Global helper for frame inspection from table
  window.inspectSpecificFrame = (frameNum, time, risk, anomaly, img) => {
    openFrameModal({
      frameNumber: frameNum,
      timestamp: time,
      riskScore: risk,
      anomalyType: anomaly,
      thumbnail: img
    });
  };

  // Render All Frames Section
  function renderAllFrames(allFrames) {
    if (!allFrames || allFrames.length === 0) {
      allFramesContainer.innerHTML = "<p class='text-muted'>No individual frame records available.</p>";
      return;
    }

    allFramesContainer.innerHTML = allFrames.map(f => `
      <div class="frame-card ${f.isSuspicious ? 'suspicious' : ''}" data-frame="${f.frameNumber}" data-time="${f.timestamp}" data-risk="${f.riskScore}" data-anomaly="${f.isSuspicious ? 'Flagged by the model' : 'Looks normal'}" data-img="${f.thumbnail}">
        <img src="${f.thumbnail}" alt="Frame #${f.frameNumber}" class="frame-thumb" loading="lazy" />
        <div class="frame-meta">
          <div class="frame-title">
            <span>Frame #${f.frameNumber}</span>
            <span class="frame-score-pill ${f.isSuspicious ? 'high' : 'low'}">${f.riskScore == null ? 'no face' : f.riskScore + '%'}</span>
          </div>
          <div class="frame-timestamp">${f.timestamp}</div>
        </div>
      </div>
    `).join("");

    allFramesContainer.querySelectorAll(".frame-card").forEach(card => {
      card.addEventListener("click", () => {
        openFrameModal({
          frameNumber: card.dataset.frame,
          timestamp: card.dataset.time,
          riskScore: card.dataset.risk,
          anomalyType: card.dataset.anomaly,
          thumbnail: card.dataset.img
        });
      });
    });
  }

  // Frame Modal Logic
  function openFrameModal(frame) {
    if (!frameModal) return;
    modalImage.src = frame.thumbnail;
    modalTitle.textContent = `Frame #${frame.frameNumber}`;
    modalDetails.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 1rem; font-size: 0.9rem;">
        <div><strong>Timestamp:</strong> ${frame.timestamp}</div>
        <div><strong>Fake score:</strong> <span style="color: ${Number(frame.riskScore) >= 50 ? '#ef4444' : '#10b981'}; font-weight: bold;">${(frame.riskScore == null || frame.riskScore === "null") ? "no face" : frame.riskScore + "%"}</span></div>
        <div><strong>Result:</strong> ${frame.anomalyType}</div>
      </div>
      <p style="margin-top: 1rem; font-size: 0.85rem; color: #94a3b8;">The box shows the face the model analysed (red = score of 50% or more). One frame is not proof: the final score combines all frames.</p>
    `;
    frameModal.classList.add("active");
  }

  if (modalClose) {
    modalClose.addEventListener("click", () => {
      frameModal.classList.remove("active");
    });
  }

  if (frameModal) {
    frameModal.addEventListener("click", (e) => {
      if (e.target === frameModal) {
        frameModal.classList.remove("active");
      }
    });
  }

  // Toggle All Frames Section
  if (allFramesToggle) {
    allFramesToggle.addEventListener("click", () => {
      const isExpanded = allFramesContent.style.display === "none";
      allFramesContent.style.display = isExpanded ? "block" : "none";
      allFramesToggle.querySelector(".toggle-icon").textContent = isExpanded ? "▲" : "▼";
    });
  }

  // Download the full HTML report (frames, timings, score) built by the server
  btnDownloadReport.addEventListener("click", () => {
    if (!currentAnalysisResult) {
      window.showToast("No analysis result ready to export", "error");
      return;
    }
    window.location.href = window.api.reportDownloadUrl(currentAnalysisResult.reportId);
  });

  // Analyze Another Video
  btnAnalyzeAnother.addEventListener("click", () => {
    resultSection.style.display = "none";
    uploadWrapper.style.display = "block";
    previewWrapper.style.display = "none";
    dropzone.style.display = "block";
    fileInput.value = "";
    selectedFile = null;
    previewVideo.src = "";
    btnAnalyze.disabled = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});
