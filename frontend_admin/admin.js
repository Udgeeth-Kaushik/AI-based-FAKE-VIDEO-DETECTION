/**
 * AI Based Fake Video Detection - Admin Operations Console
 */

document.addEventListener("DOMContentLoaded", async () => {
  // CRITICAL SECURITY CHECK:
  // Must check if user is admin. If not or if API returns 403, immediately redirect to index.html.
  let currentUser = null;
  try {
    const meRes = await window.api.getMe();
    currentUser = meRes && meRes.user ? meRes.user : null;
    if (!currentUser || currentUser.role !== "admin") {
      window.location.href = "/";
      return;
    }
  } catch (err) {
    window.location.href = "/";
    return;
  }

  // DOM Elements
  const statTotalScans = document.getElementById("admin-stat-scans");
  const statTotalUsers = document.getElementById("admin-stat-users");
  const statHighRisk = document.getElementById("admin-stat-highrisk");
  const statLatency = document.getElementById("admin-stat-latency");

  const usersTbody = document.getElementById("admin-users-tbody");
  const activityTbody = document.getElementById("admin-activity-tbody");
  const btnRefresh = document.getElementById("btn-admin-refresh");

  // User Action Modals
  const deleteUserModal = document.getElementById("delete-user-modal");
  const deleteUserName = document.getElementById("delete-user-name");
  const btnConfirmDeleteUser = document.getElementById("btn-confirm-delete-user");
  const btnCancelDeleteUser = document.getElementById("btn-cancel-delete-user");

  let targetUserId = null;
  let cachedUsers = [];

  // Load Admin Dashboard Data
  async function loadAdminData() {
    try {
      // 1. Fetch Stats
      const stats = await window.api.getAdminStats();
      if (stats) {
        if (statTotalScans) statTotalScans.textContent = stats.totalScans.toLocaleString();
        if (statTotalUsers) statTotalUsers.textContent = stats.totalUsers.toLocaleString();
        if (statHighRisk) statHighRisk.textContent = stats.highRiskDetected.toLocaleString();
        if (statLatency) statLatency.textContent = stats.avgLatency;
      }
    } catch (err) {
      if (err.status === 403) {
        window.location.href = "/";
        return;
      }
      window.showToast("Could not load stats: " + err.message, "error");
    }

    try {
      // 2. Fetch Users
      const usersRes = await window.api.getAdminUsers();
      cachedUsers = (usersRes && usersRes.users) || [];
      renderUsersTable(cachedUsers);
    } catch (err) {
      if (err.status === 403) {
        window.location.href = "/";
        return;
      }
      window.showToast("Could not load users: " + err.message, "error");
    }

    try {
      // 3. Fetch Activity
      const actRes = await window.api.getAdminActivity();
      const activities = (actRes && actRes.activities) || [];
      renderActivityTable(activities);
    } catch (err) {
      if (err.status === 403) {
        window.location.href = "/";
        return;
      }
      window.showToast("Could not load activities: " + err.message, "error");
    }
  }

  // Render Users Table
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function renderUsersTable(users) {
    if (!usersTbody) return;

    if (users.length === 0) {
      usersTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No user accounts found.</td></tr>`;
      return;
    }

    usersTbody.innerHTML = users.map(user => {
      const isLocked = user.status === "Locked";
      const isDisabled = user.status === "Disabled";
      const isActive = user.status === "Active";

      const statusBadge = isLocked ?
        `<span style="background: rgba(244,63,94,0.12); color: #f43f5e; border: 1px solid rgba(244,63,94,0.3); padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; font-family: monospace;">Locked</span>` :
        isDisabled ?
        `<span style="background: rgba(148,163,184,0.12); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.3); padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; font-family: monospace;">Disabled</span>` :
        `<span style="background: rgba(163,230,53,0.12); color: #a3e635; border: 1px solid rgba(163,230,53,0.3); padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; font-family: monospace;">Active</span>`;

      return `
        <tr data-user-id="${user.id}">
          <td style="font-weight: 600;">${esc(user.name || 'User')}</td>
          <td style="color: var(--text-muted); font-family: monospace;">${esc(user.email)}</td>
          <td>
            <span class="role-badge ${user.role === 'admin' ? 'admin' : ''}" style="background: ${user.role === 'admin' ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.05)'}; color: ${user.role === 'admin' ? '#c4b5fd' : '#94a3b8'}; border: 1px solid var(--border-subtle); padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.72rem;">
              ${user.role.toUpperCase()}
            </span>
          </td>
          <td>${statusBadge}</td>
          <td style="font-size: 0.82rem; color: var(--text-muted);">${user.createdAt || 'Recent'}</td>
          <td style="text-align: right;">
            <div style="display: inline-flex; gap: 0.35rem;">
              ${isActive ? `
                <button class="btn btn-secondary btn-sm btn-action-disable" data-id="${user.id}" title="Disable User Account">
                  Disable
                </button>
              ` : `
                <button class="btn btn-success btn-sm btn-action-enable" data-id="${user.id}" title="Enable User Account">
                  Enable
                </button>
              `}

              ${isLocked ? `
                <button class="btn btn-secondary btn-sm btn-action-unlock" data-id="${user.id}" title="Unlock 2FA / Password Lock">
                  Unlock
                </button>
              ` : ''}

              <button class="btn btn-danger btn-sm btn-action-delete" data-id="${user.id}" title="Delete Account">
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // Attach User Actions
    usersTbody.querySelectorAll(".btn-action-disable").forEach(btn => {
      btn.addEventListener("click", () => handleUserStatus(btn.dataset.id, "disable"));
    });

    usersTbody.querySelectorAll(".btn-action-enable").forEach(btn => {
      btn.addEventListener("click", () => handleUserStatus(btn.dataset.id, "enable"));
    });

    usersTbody.querySelectorAll(".btn-action-unlock").forEach(btn => {
      btn.addEventListener("click", () => handleUserStatus(btn.dataset.id, "unlock"));
    });

    usersTbody.querySelectorAll(".btn-action-delete").forEach(btn => {
      btn.addEventListener("click", () => {
        targetUserId = btn.dataset.id;
        const u = cachedUsers.find(x => x.id === targetUserId);
        deleteUserName.textContent = u ? `${u.name} (${u.email})` : "this user";
        deleteUserModal.classList.add("active");
      });
    });
  }

  // Handle Enable / Disable / Unlock status
  async function handleUserStatus(userId, action) {
    try {
      await window.api.updateUserStatus(userId, action);
      window.showToast(`User status updated to ${action}d`, "success");

      // Update local store & table
      const u = cachedUsers.find(x => x.id === userId);
      if (u) {
        if (action === "disable") u.status = "Disabled";
        if (action === "enable" || action === "unlock") u.status = "Active";
      }
      renderUsersTable(cachedUsers);
    } catch (err) {
      if (err.status === 403) {
        window.location.href = "/";
        return;
      }
      window.showToast("Failed to update status: " + err.message, "error");
    }
  }

  // Handle Delete User confirmation
  if (btnConfirmDeleteUser) {
    btnConfirmDeleteUser.addEventListener("click", async () => {
      if (!targetUserId) return;

      btnConfirmDeleteUser.disabled = true;
      btnConfirmDeleteUser.textContent = "Deleting...";

      try {
        await window.api.deleteUser(targetUserId);
        window.showToast("User account permanently deleted", "success");
        cachedUsers = cachedUsers.filter(x => x.id !== targetUserId);
        renderUsersTable(cachedUsers);
      } catch (err) {
        if (err.status === 403) {
          window.location.href = "/";
          return;
        }
        window.showToast("Failed to delete user: " + err.message, "error");
      } finally {
        btnConfirmDeleteUser.disabled = false;
        btnConfirmDeleteUser.textContent = "Confirm Delete";
        deleteUserModal.classList.remove("active");
        targetUserId = null;
      }
    });
  }

  if (btnCancelDeleteUser) {
    btnCancelDeleteUser.addEventListener("click", () => {
      deleteUserModal.classList.remove("active");
      targetUserId = null;
    });
  }

  // Render Login Activity Table
  function renderActivityTable(activities) {
    if (!activityTbody) return;

    if (activities.length === 0) {
      activityTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No recent authentication events.</td></tr>`;
      return;
    }

    activityTbody.innerHTML = activities.map(act => {
      const isSuccess = act.status.toLowerCase().includes("success");
      const statusColor = isSuccess ? "#a3e635" : "#f43f5e";

      return `
        <tr>
          <td style="font-size: 0.82rem; color: var(--text-muted); font-family: monospace;">${esc(act.time)}</td>
          <td style="font-weight: 600;">${esc(act.user)}</td>
          <td style="font-family: monospace; font-size: 0.85rem; color: var(--acid-green);">${esc(act.ip)}</td>
          <td style="font-size: 0.85rem; color: var(--text-muted);">${esc(act.browser)}</td>
          <td>
            <span style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; font-weight: 600; font-family: monospace; color: ${statusColor};">
              <span style="width: 7px; height: 7px; border-radius: 50%; background: ${statusColor};"></span>
              ${esc(act.status)}
            </span>
          </td>
        </tr>
      `;
    }).join("");
  }

  // Refresh Dashboard
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      btnRefresh.textContent = "Refreshing...";
      btnRefresh.disabled = true;
      loadAdminData().finally(() => {
        btnRefresh.textContent = "Refresh Data";
        btnRefresh.disabled = false;
        window.showToast("Admin data refreshed", "info");
      });
    });
  }

  // Initial load
  loadAdminData();
});
