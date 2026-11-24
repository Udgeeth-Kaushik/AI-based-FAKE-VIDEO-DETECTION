/**
 * AI Based Fake Video Detection - History Management Module
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Strict Session Check: History is accessible ONLY for logged-in users through their Dashboard!
  const user = await window.checkAuth();
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const historyTbody = document.getElementById("history-tbody");
  const historyLoading = document.getElementById("history-loading");
  const historyEmpty = document.getElementById("history-empty");
  const searchInput = document.getElementById("history-search");
  const verdictFilter = document.getElementById("history-verdict-filter");

  // Details Modal
  const detailsModal = document.getElementById("history-details-modal");
  const detailsTitle = document.getElementById("modal-history-title");
  const detailsBody = document.getElementById("modal-history-body");
  const detailsClose = document.getElementById("modal-history-close");
  const btnModalDownload = document.getElementById("btn-modal-history-download");

  // Delete Confirm Modal
  const deleteModal = document.getElementById("delete-confirm-modal");
  const deleteModalClose = document.getElementById("modal-delete-close");
  const btnConfirmDelete = document.getElementById("btn-confirm-delete");
  const btnCancelDelete = document.getElementById("btn-cancel-delete");

  let historyData = [];
  let itemToDeleteId = null;
  let activeModalItem = null;

  // Load history from API
  async function loadHistory() {
    if (historyLoading) historyLoading.style.display = "block";
    if (historyEmpty) historyEmpty.style.display = "none";
    if (historyTbody) historyTbody.innerHTML = "";

    try {
      const res = await window.api.getHistory();
      historyData = (res && res.history) || [];

      if (historyLoading) historyLoading.style.display = "none";

      renderHistoryTable(historyData);
    } catch (err) {
      if (historyLoading) historyLoading.style.display = "none";
      window.showToast("Failed to load scan history: " + err.message, "error");
    }
  }

  // Render Table
  function renderHistoryTable(items) {
    if (!historyTbody) return;

    if (items.length === 0) {
      historyTbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 3.5rem 1.5rem;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(0, 240, 255, 0.1); color: var(--chroma-cyan); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 0.75rem;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div style="font-size: 1.15rem; font-weight: 800; color: #fff; margin-bottom: 0.35rem;">No Recorded Forensic Scans Yet</div>
            <div style="font-size: 0.88rem; color: var(--text-dim); margin-bottom: 1.5rem; max-width: 440px; margin-left: auto; margin-right: auto; line-height: 1.6;">
              Your forensic history archive is empty. Start your first video detection to record automated frame telemetry and risk audits here.
            </div>
            <a href="detect.html" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.65rem 1.4rem; font-size: 0.9rem; border-radius: var(--radius-pill); box-shadow: 0 0 15px rgba(0, 240, 255, 0.25);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polygon points="10 8 16 12 10 16 10 8"/>
              </svg>
              <span>+ Start Video Detection</span>
            </a>
          </td>
        </tr>`;
      return;
    }

    historyTbody.innerHTML = items.map(item => {
      const verdict = item.verdict || "Low";
      const riskClass = verdict.toLowerCase();
      const riskColor = riskClass === "high" ? "#f43f5e" : riskClass === "medium" ? "#fbbf24" : "#a3e635";
      const prob = item.fakeProbability || 0;

      return `
        <tr data-id="${item.id}" style="cursor: pointer;">
          <td>
            <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #fff;">${item.id.toUpperCase()}</div>
            <div style="font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-dim);">${item.date || 'N/A'}</div>
          </td>
          <td style="font-weight: 600;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--chroma-cyan);">
                <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              <span>${window.esc(item.fileName || 'Untitled.mp4')}</span>
            </div>
          </td>
          <td style="font-family: var(--font-mono); font-size: 0.85rem;">${item.videoLength || '-'}</td>
          <td>
            <div style="font-size: 0.82rem; color: var(--chroma-acid); font-family: var(--font-mono); font-weight: 600;">EfficientNet-B0 + BiLSTM</div>
            <div style="font-size: 0.74rem; color: var(--text-darker);">${item.datasetSource || ''}</div>
          </td>
          <td>
            <span class="verdict-badge ${riskClass}" style="padding: 0.25rem 0.75rem; font-size: 0.78rem;">
              ${verdict} Risk
            </span>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="width: 50px; height: 6px; background: rgba(255,255,255,0.08); border-radius: 9999px; overflow: hidden;">
                <div style="width: ${prob}%; height: 100%; background: ${riskColor};"></div>
              </div>
              <span style="font-family: var(--font-mono); font-weight: 700; color: ${riskColor};">${prob}%</span>
            </div>
          </td>
          <td style="color: var(--text-dim); font-family: var(--font-mono); font-size: 0.85rem;">${item.analysisTime || '-'}</td>
          <td style="text-align: right;" onclick="event.stopPropagation();">
            <div style="display: inline-flex; gap: 0.45rem; align-items: center; justify-content: flex-end;">
              <a href="report.html?id=${item.id}" class="btn btn-secondary btn-sm" style="color: var(--cyan-primary); text-decoration: none; border-color: rgba(0, 240, 255, 0.25);" title="View detailed analysis report">
                View Report &rarr;
              </a>
              <button class="btn btn-secondary btn-sm btn-download-row" data-id="${item.id}" title="Download Report" style="padding: 0.4rem 0.55rem; color: var(--text-silver);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
              <button class="btn btn-danger btn-sm btn-delete-row" data-id="${item.id}" title="Delete scan" style="padding: 0.4rem 0.55rem;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // Row Click Event: Open Details
    historyTbody.querySelectorAll("tr").forEach(tr => {
      tr.addEventListener("click", () => {
        const id = tr.dataset.id;
        openScanDetails(id);
      });
    });

    // View Details Buttons
    historyTbody.querySelectorAll(".btn-view-report").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openScanDetails(btn.dataset.id);
      });
    });

    // Download Report Buttons
    historyTbody.querySelectorAll(".btn-download-row").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const item = historyData.find(x => x.id === id);
        if (item) {
          window.location.href = window.api.reportDownloadUrl(id);
        }
      });
    });

    // Delete Buttons
    historyTbody.querySelectorAll(".btn-delete-row").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        itemToDeleteId = btn.dataset.id;
        if (deleteModal) deleteModal.classList.add("active");
      });
    });
  }

  // Open Full Scan Details Modal
  function openScanDetails(id) {
    const item = historyData.find(x => x.id === id);
    if (!item) return;

    activeModalItem = item;
    const verdict = item.verdict || "Low";
    const riskColor = verdict === "High" ? "#f43f5e" : verdict === "Medium" ? "#fbbf24" : "#a3e635";

    detailsTitle.textContent = `Analysis: ${item.fileName}`;
    detailsBody.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.6); padding: 1.25rem; border-radius: 8px; border: 1px solid var(--border-subtle); margin-bottom: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <span style="font-size: 0.85rem; color: var(--text-muted);">SCAN ID: ${item.id}</span>
          <span class="verdict-badge ${verdict.toLowerCase()}" style="font-size: 0.82rem; padding: 0.25rem 0.75rem;">${verdict} Risk</span>
        </div>
        <div style="font-size: 2rem; font-weight: 800; color: ${riskColor}; font-family: monospace;">
          ${item.fakeProbability}% <span style="font-size: 0.9rem; font-weight: normal; color: var(--text-muted);">Fake Probability</span>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.9rem;">
        <div><strong>Timestamp:</strong> <span style="color: var(--text-muted);">${item.date}</span></div>
        <div><strong>Video Length:</strong> <span style="color: var(--text-muted);">${item.videoLength}</span></div>
        <div><strong>Total Frames Analyzed:</strong> <span style="color: var(--text-muted);">${item.totalFrames ?? '-'}</span></div>
        <div><strong>Frames with a face:</strong> <span style="color: var(--text-muted);">${item.framesWithFace ?? "-"}</span></div>
        <div><strong>Inference Time:</strong> <span style="color: var(--text-muted);">${item.analysisTime}</span></div>
        <div><strong>Algorithm Engine:</strong> <span style="color: var(--neon-green); font-weight: 700;">EfficientNet-B0 + BiLSTM</span></div>
      </div>

      <div style="margin-top: 1.25rem; font-size: 0.85rem; color: var(--text-muted); line-height: 1.5; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">
        <strong>Note:</strong> automated estimate from the AI model, not proof. Open the full report to see every analysed frame.
      </div>
    `;

    detailsModal.classList.add("active");
  }

  let activeFilterChip = "all";

  // Chip Filters Handler (All, Real, Fake, High Risk, Medium Risk, Low Risk)
  const chipButtons = document.querySelectorAll(".chip-btn");
  chipButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      chipButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilterChip = btn.dataset.filter || "all";
      applyFilters();
    });
  });

  // Filter & Search Logic
  function applyFilters() {
    const q = (searchInput ? searchInput.value : "").toLowerCase().trim();

    const filtered = historyData.filter(item => {
      const matchName = (item.fileName || "").toLowerCase().includes(q);
      const verdict = (item.verdict || "").toLowerCase();
      const prob = item.fakeProbability || 0;

      let matchFilter = true;
      if (activeFilterChip === "real") {
        matchFilter = verdict === "low" || prob < 50;
      } else if (activeFilterChip === "fake") {
        matchFilter = verdict === "high" || verdict === "medium" || prob >= 50;
      } else if (activeFilterChip === "high") {
        matchFilter = verdict === "high";
      } else if (activeFilterChip === "medium") {
        matchFilter = verdict === "medium";
      } else if (activeFilterChip === "low") {
        matchFilter = verdict === "low";
      }

      return matchName && matchFilter;
    });

    renderHistoryTable(filtered);
  }

  if (searchInput) searchInput.addEventListener("input", applyFilters);

  // Close Details Modal
  if (detailsClose) {
    detailsClose.addEventListener("click", () => {
      detailsModal.classList.remove("active");
    });
  }

  // Modal Download Action
  if (btnModalDownload) {
    btnModalDownload.addEventListener("click", () => {
      if (activeModalItem) window.location.href = window.api.reportDownloadUrl(activeModalItem.id);
    });
  }

  // Delete Confirmation Handling
  if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener("click", async () => {
      if (!itemToDeleteId) return;

      btnConfirmDelete.disabled = true;
      btnConfirmDelete.textContent = "Deleting...";

      try {
        await window.api.deleteHistoryItem(itemToDeleteId);
        window.showToast("Scan record deleted successfully", "success");
        historyData = historyData.filter(h => h.id !== itemToDeleteId);
        applyFilters();
      } catch (err) {
        window.showToast("Failed to delete record: " + err.message, "error");
      } finally {
        btnConfirmDelete.disabled = false;
        btnConfirmDelete.textContent = "Yes, Delete";
        deleteModal.classList.remove("active");
        itemToDeleteId = null;
      }
    });
  }

  if (btnCancelDelete) {
    btnCancelDelete.addEventListener("click", () => {
      deleteModal.classList.remove("active");
      itemToDeleteId = null;
    });
  }

  if (deleteModalClose) {
    deleteModalClose.addEventListener("click", () => {
      deleteModal.classList.remove("active");
      itemToDeleteId = null;
    });
  }

  // Initial load
  loadHistory();
});
