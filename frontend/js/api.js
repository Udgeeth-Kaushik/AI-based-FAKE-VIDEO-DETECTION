/**
 * AI Based Fake Video Detection - API Client
 * Talks to the real backend (same origin). Login is a secure HttpOnly cookie set by the server;
 * localStorage only keeps a copy of the user's name/email/role to speed up page rendering.
 * (The server checks every request itself - this copy is NOT used for security.)
 */
const API_BASE = "";

function setAuthSession(user) {
  if (user) localStorage.setItem("auth_user", JSON.stringify(user));
}

function clearAuthSession() {
  localStorage.removeItem("auth_user");
  localStorage.removeItem("auth_token");
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id ? parsed : null;
  } catch (e) {
    return null;
  }
}

async function request(endpoint, options = {}) {
  const headers = { "Accept": "application/json", ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && options.method && options.method !== "GET" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers, credentials: "same-origin" });
  } catch (e) {
    const err = new Error("Cannot reach the server. Please check your connection and try again.");
    err.status = 0;
    throw err;
  }

  let data = null;
  try { data = await response.json(); } catch (e) { data = null; }

  if (!response.ok) {
    const err = new Error((data && (data.message || data.error)) || `Request failed (${response.status})`);
    err.status = response.status;
    err.data = data;
    // Session ended on the server -> forget local copy (but not for the login form itself)
    if (response.status === 401 && !endpoint.startsWith("/api/auth/")) clearAuthSession();
    throw err;
  }
  return data;
}

const api = {
  // Authentication
  login: async (credentials) => {
    const res = await request("/api/auth/login", { method: "POST", body: JSON.stringify(credentials) });
    if (res && res.success) setAuthSession(res.user);
    return res;
  },
  verify2FA: async (data) => {
    const res = await request("/api/auth/verify-2fa", { method: "POST", body: JSON.stringify(data) });
    if (res && res.success) setAuthSession(res.user);
    return res;
  },
  signup: async (userData) => {
    const res = await request("/api/auth/signup", { method: "POST", body: JSON.stringify(userData) });
    if (res && res.success) setAuthSession(res.user);
    return res;
  },
  getMe: async () => {
    const res = await request("/api/me", { method: "GET" });
    if (res && res.user) setAuthSession(res.user); else clearAuthSession();
    return res;
  },
  logout: async () => {
    try { await request("/api/auth/logout", { method: "POST" }); } catch (e) { /* ignore */ }
    clearAuthSession();
  },

  // Video detection
  uploadVideo: (file) => {
    const formData = new FormData();
    formData.append("video", file);
    return request("/api/detect/upload", { method: "POST", body: formData });
  },
  getDetectionStatus: (jobId) => request(`/api/detect/status/${jobId}`, { method: "GET" }),
  getDetectionResult: (jobId) => request(`/api/detect/result/${jobId}`, { method: "GET" }),

  // History & report
  getHistory: () => request("/api/history", { method: "GET" }),
  deleteHistoryItem: (id) => request(`/api/history/${id}`, { method: "DELETE" }),
  getReport: (reportId) => request(`/api/report/${reportId}`, { method: "GET" }),
  reportDownloadUrl: (reportId) => `${API_BASE}/api/report/${reportId}/download`,
  getModelInfo: () => request("/api/model-info", { method: "GET" }),

  // Admin (the server answers 404 to everybody except the signed-in, 2FA-verified admin)
  getAdminStats: () => request("/api/admin/stats", { method: "GET" }),
  getAdminUsers: () => request("/api/admin/users", { method: "GET" }),
  updateUserStatus: (userId, action) =>
    request(`/api/admin/users/${userId}/status`, { method: "PATCH", body: JSON.stringify({ action }) }),
  deleteUser: (userId) => request(`/api/admin/users/${userId}`, { method: "DELETE" }),
  getAdminActivity: () => request("/api/admin/activity", { method: "GET" }),

  // Utilities
  getStoredUser,
  clearAuthSession
};

window.api = api;
window.esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
