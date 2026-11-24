/**
 * AI Based Fake Video Detection - Authentication & Navigation Module
 */

// Toast notification helper
function showToast(message, type = "info") {
  let toast = document.getElementById("global-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "global-toast";
    toast.className = "alert-toast";
    document.body.appendChild(toast);
  }

  toast.className = `alert-toast ${type} show`;
  toast.textContent = message;

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 4000);
}

// Global user session state
let currentUser = null;

// Initialize navigation bar dynamically across all pages
async function initNavbar() {
  const navContainer = document.querySelector(".nav-container");
  if (!navContainer) return;

  // Determine current active page
  const path = window.location.pathname;
  const isIndex = path.endsWith("index.html") || path.endsWith("/");
  const isDetect = path.endsWith("detect.html");
  const isHistory = path.endsWith("history.html");
  const isTech = path.endsWith("technology.html");
  const isHowItWorks = path.endsWith("how-it-works.html");
  const isAbout = path.endsWith("about.html");
  const isSecurity = path.endsWith("security.html");
  const isDashboard = path.endsWith("dashboard.html");
  const isReport = path.endsWith("report.html");
  const isSettings = path.endsWith("settings.html") || path.endsWith("profile.html");
  const isAdmin = path.endsWith("admin.html");
  const isLogin = path.endsWith("login.html");

  // Fetch current user details via /api/me
  try {
    const res = await window.api.getMe();
    currentUser = res && res.user && res.user.id !== "usr_demo" ? res.user : null;
  } catch (err) {
    currentUser = null;
  }

  // Build brand logo (CYBERGEEKS)
  let brandHtml = `
    <a href="index.html" class="nav-brand">
      <div class="brand-capsule-icon" style="background: linear-gradient(135deg, rgba(0,240,255,0.2), rgba(139,92,246,0.3)); border: 1px solid var(--cyan-primary);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan-primary)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
      </div>
      <span style="font-weight: 800; letter-spacing: 0.08em; font-family: var(--font-mono); color: #fff;">CYBER<span style="color: var(--cyan-primary);">GEEKS</span></span>
    </a>
  `;

  // Mobile Hamburger Toggle
  const toggleBtnHtml = `
    <button type="button" id="mobile-nav-toggle" class="mobile-nav-toggle" aria-label="Toggle navigation">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>
  `;

  if (currentUser && currentUser.id !== "usr_demo") {
    // Logged in user navigation (USER PORTAL)
    let linksHtml = '<ul class="nav-capsule-links">';
    linksHtml += `
      <li><a href="dashboard.html" class="nav-capsule-item ${isDashboard ? 'active' : ''}">Dashboard</a></li>
      <li><a href="detect.html" class="nav-capsule-item ${isDetect ? 'active' : ''}">Detection Lab</a></li>
      <li><a href="history.html" class="nav-capsule-item ${isHistory ? 'active' : ''}">History</a></li>
      <li><a href="technology.html" class="nav-capsule-item ${isTech ? 'active' : ''}">Technology</a></li>
      <li><a href="settings.html" class="nav-capsule-item ${isSettings ? 'active' : ''}">Settings</a></li>
    `;
    linksHtml += '</ul>';

    let userControlsHtml = `
      <div class="nav-action-pill">
        <a href="settings.html" class="user-badge" title="${window.esc(currentUser.email)}" style="text-decoration: none;">
          <div class="user-avatar" style="background: var(--cyan-subtle); border: 1px solid var(--cyan-primary); color: var(--cyan-primary);">${window.esc((currentUser.name || currentUser.email || "U")[0].toUpperCase())}</div>
          <span>${window.esc(currentUser.name || String(currentUser.email).split('@')[0])}</span>
        </a>
        <button id="logout-btn" class="btn btn-secondary btn-sm" style="border-radius: var(--radius-pill); padding: 0.35rem 0.85rem;" title="Log out">Logout</button>
      </div>
    `;

    navContainer.innerHTML = brandHtml + linksHtml + userControlsHtml + toggleBtnHtml;

    // Attach logout event
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await window.api.logout();
        } catch (e) {}
        showToast("Logged out successfully", "info");
        setTimeout(() => {
          window.location.href = "index.html";
        }, 400);
      });
    }

  } else {
    // Guest navigation (PUBLIC WEBSITE: Accessible to everyone)
    let linksHtml = `
      <ul class="nav-capsule-links">
        <li><a href="index.html" class="nav-capsule-item ${isIndex ? 'active' : ''}">Home</a></li>
        <li><a href="detect.html" class="nav-capsule-item ${isDetect ? 'active' : ''}">Detection Lab</a></li>
        <li><a href="technology.html" class="nav-capsule-item ${isTech ? 'active' : ''}">Technology</a></li>
        <li><a href="how-it-works.html" class="nav-capsule-item ${isHowItWorks ? 'active' : ''}">How It Works</a></li>
        <li><a href="about.html" class="nav-capsule-item ${isAbout ? 'active' : ''}">About</a></li>
      </ul>
    `;

    let userControlsHtml = `
      <div class="nav-action-pill" style="gap: 0.75rem;">
        <a href="login.html" class="btn btn-secondary btn-sm" style="border-radius: var(--radius-pill); font-size: 0.85rem; padding: 0.45rem 1rem;">Sign In</a>
        <a href="detect.html" class="btn-get-started-pill" style="padding: 0.45rem 1.15rem; font-size: 0.85rem;">Analyze Video &rarr;</a>
      </div>
    `;

    navContainer.innerHTML = brandHtml + linksHtml + userControlsHtml + toggleBtnHtml;
  }

  // Bind mobile toggle click
  const mobileToggle = document.getElementById("mobile-nav-toggle");
  const navbarEl = document.querySelector(".navbar");
  if (mobileToggle && navbarEl) {
    mobileToggle.addEventListener("click", () => {
      navbarEl.classList.toggle("nav-mobile-open");
    });
  }
}

// Protected Route Guard (Redirects unauthenticated visitors to login.html)
async function checkAuth(requiredRole = null) {
  try {
    const res = await window.api.getMe();
    const user = res && res.user && res.user.id !== "usr_demo" ? res.user : null;

    if (!user) {
      window.location.replace("login.html");
      return null;
    }

    if (requiredRole && user.role !== requiredRole) {
      // If unauthorized role (e.g. non-admin accessing admin.html), redirect to dashboard
      window.location.replace("dashboard.html");
      return null;
    }

    return user;
  } catch (err) {
    window.location.replace("login.html");
    return null;
  }
}

// Index & Login Page Auth Forms Handler (Login, Signup, 2FA, Eye Toggles, Remember Me)
function initAuthForms() {
  const loginForm = document.getElementById("form-login");
  const signupForm = document.getElementById("form-signup");
  const twoFactorBox = document.getElementById("two-factor-box");
  const normalLoginFields = document.getElementById("normal-login-fields");
  const loginSubmitBtn = document.getElementById("login-submit-btn");

  // Optional traditional tabs
  const loginTab = document.getElementById("tab-login");
  const signupTab = document.getElementById("tab-signup");

  // Modern Figma switch links
  const switchToSignup = document.getElementById("switch-to-signup");
  const switchToLogin = document.getElementById("switch-to-login");
  const authHeaderLogin = document.getElementById("auth-header-login");
  const authHeaderSignup = document.getElementById("auth-header-signup");

  if (!loginForm || !signupForm) return;

  let is2FAMode = false;
  let pendingEmail = "";

  function showLoginForm() {
    loginForm.style.display = "block";
    signupForm.style.display = "none";
    if (authHeaderLogin) authHeaderLogin.style.display = "block";
    if (authHeaderSignup) authHeaderSignup.style.display = "none";
    if (loginTab) loginTab.classList.add("active");
    if (signupTab) signupTab.classList.remove("active");
  }

  function showSignupForm() {
    loginForm.style.display = "none";
    signupForm.style.display = "block";
    if (authHeaderLogin) authHeaderLogin.style.display = "none";
    if (authHeaderSignup) authHeaderSignup.style.display = "block";
    if (signupTab) signupTab.classList.add("active");
    if (loginTab) loginTab.classList.remove("active");
  }

  // Bind modern switch buttons
  if (switchToSignup) {
    switchToSignup.addEventListener("click", (e) => {
      e.preventDefault();
      showSignupForm();
    });
  }

  if (switchToLogin) {
    switchToLogin.addEventListener("click", (e) => {
      e.preventDefault();
      showLoginForm();
    });
  }

  // Bind tabs if present
  if (loginTab) loginTab.addEventListener("click", showLoginForm);
  if (signupTab) signupTab.addEventListener("click", showSignupForm);

  // Setup Password Eye Toggles
  const eyeButtons = document.querySelectorAll(".password-toggle-btn");
  eyeButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      if (!input) return;

      const eyeOpen = btn.querySelector(".eye-open");
      const eyeClosed = btn.querySelector(".eye-closed");

      if (input.type === "password") {
        input.type = "text";
        if (eyeOpen) eyeOpen.style.display = "none";
        if (eyeClosed) eyeClosed.style.display = "block";
      } else {
        input.type = "password";
        if (eyeOpen) eyeOpen.style.display = "block";
        if (eyeClosed) eyeClosed.style.display = "none";
      }
    });
  });

  // Check Remember Me
  const rememberCheckbox = document.getElementById("login-remember");
  const emailInput = document.getElementById("login-email");
  if (emailInput && rememberCheckbox) {
    const savedUser = localStorage.getItem("deepshield_remembered_user");
    if (savedUser) {
      emailInput.value = savedUser;
      rememberCheckbox.checked = true;
    }
  }

  // Reset 2FA mode helper
  function reset2FAMode() {
    is2FAMode = false;
    pendingEmail = "";
    if (twoFactorBox) twoFactorBox.style.display = "none";
    if (normalLoginFields) normalLoginFields.style.display = "block";
    if (loginSubmitBtn) loginSubmitBtn.textContent = "Login";
  }

  // Handle Login submission
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const passwordInput = document.getElementById("login-password");
    const code2faInput = document.getElementById("login-2fa-code");

    if (is2FAMode) {
      // Step 2: Submitting 6-digit 2FA code
      const code = (code2faInput ? code2faInput.value : "").trim();
      if (!code || code.length < 6) {
        showToast("Please enter the complete 6-digit verification code", "error");
        return;
      }

      loginSubmitBtn.disabled = true;
      loginSubmitBtn.textContent = "Verifying 2FA...";

      try {
        const res = await window.api.verify2FA({
          email: pendingEmail,
          code: code
        });

        if (res && res.success) {
          showToast("2FA Verified! Redirecting to Forensic Portal...", "success");
          setTimeout(() => {
            window.location.href = "dashboard.html";
          }, 600);
        } else {
          showToast(res.message || "Invalid 2FA verification code", "error");
          loginSubmitBtn.disabled = false;
          loginSubmitBtn.textContent = "Verify 2FA Code";
        }
      } catch (err) {
        showToast(err.message || "2FA Verification failed", "error");
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = "Verify 2FA Code";
      }
      return;
    }

    // Step 1: Initial Login Credentials
    const email = emailInput ? emailInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value : "";

    if (!email || !password) {
      showToast("Please enter both username/email and password", "error");
      return;
    }

    // Handle Remember Me storage
    if (rememberCheckbox && rememberCheckbox.checked) {
      localStorage.setItem("deepshield_remembered_user", email);
    } else {
      localStorage.removeItem("deepshield_remembered_user");
    }

    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = "Authenticating...";

    const loginNameInput = document.getElementById("login-name");
    const name = loginNameInput && loginNameInput.value.trim() ? loginNameInput.value.trim() : email.split("@")[0];

    try {
      const res = await window.api.login({ email, password, name });

      // Check if 2FA is required by backend
      if (res && res.need_2fa) {
        is2FAMode = true;
        pendingEmail = email;

        // Reveal 2FA in the same form (no separate page)
        if (normalLoginFields) normalLoginFields.style.display = "none";
        if (twoFactorBox) twoFactorBox.style.display = "block";
        if (code2faInput) {
          code2faInput.value = "";
          code2faInput.focus();
        }
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = "Verify 2FA Code";
        showToast("Enter the 6-digit code from your authenticator device", "info");
        return;
      }

      if (res && res.success) {
        const loginErrorAlert = document.getElementById("login-error-alert");
        if (loginErrorAlert) loginErrorAlert.style.display = "none";
        showToast("Welcome back, " + (res.user.name || name) + "! Opening your Dashboard...", "success");
        setTimeout(() => {
          window.location.href = "dashboard.html";
        }, 500);
      } else {
        const errorMsg = res.message || "Account not found. Please register an account first.";
        showToast(errorMsg, "error");
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = "Sign In to Dashboard →";

        const loginErrorAlert = document.getElementById("login-error-alert");
        const loginErrorDesc = document.getElementById("login-error-desc");
        if (loginErrorAlert) {
          if (loginErrorDesc) loginErrorDesc.textContent = errorMsg;
          loginErrorAlert.style.display = "block";
        }
      }
    } catch (err) {
      const errorMsg = err.message || "Login failed. Please check credentials or register.";
      showToast(errorMsg, "error");
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = "Sign In to Dashboard →";

      const loginErrorAlert = document.getElementById("login-error-alert");
      const loginErrorDesc = document.getElementById("login-error-desc");
      if (loginErrorAlert) {
        if (loginErrorDesc) loginErrorDesc.textContent = errorMsg;
        loginErrorAlert.style.display = "block";
      }
    }
  });

  // Back to password from 2FA
  const backToPwdBtn = document.getElementById("btn-back-to-pwd");
  if (backToPwdBtn) {
    backToPwdBtn.addEventListener("click", () => {
      reset2FAMode();
    });
  }

  // Handle Signup submission
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nameInput = document.getElementById("signup-name");
    const signupEmailInput = document.getElementById("signup-email");
    const signupPasswordInput = document.getElementById("signup-password");
    const confirmPasswordInput = document.getElementById("signup-confirm-password");
    const signupBtn = document.getElementById("signup-submit-btn");

    const name = nameInput ? nameInput.value.trim() : "";
    const email = signupEmailInput ? signupEmailInput.value.trim() : "";
    const password = signupPasswordInput ? signupPasswordInput.value : "";
    const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : "";

    if (!name || !email || !password) {
      showToast("Please fill all required fields", "error");
      return;
    }

    if (password !== confirmPassword) {
      showToast("Passwords do not match", "error");
      return;
    }

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      showToast("Password must be at least 8 characters with letters and numbers", "error");
      return;
    }

    signupBtn.disabled = true;
    signupBtn.textContent = "Creating Account...";

    try {
      const res = await window.api.signup({ name, email, password });
      if (res && res.success) {
        showToast("Account created successfully! Welcome, " + name + "! Opening your Dashboard...", "success");
        setTimeout(() => {
          window.location.href = "dashboard.html";
        }, 500);
      } else {
        showToast(res.message || "Registration failed", "error");
        signupBtn.disabled = false;
        signupBtn.textContent = "Create Account & Open Dashboard";
      }
    } catch (err) {
      showToast(err.message || "Registration failed", "error");
      signupBtn.disabled = false;
      signupBtn.textContent = "Create Account & Open Dashboard";
    }
  });
}

// Responsive Device Adaptation & Switcher (Phone / Desktop View)
function initDeviceViewManager() {
  if (document.getElementById("device-view-pill")) return;

  const pill = document.createElement("div");
  pill.id = "device-view-pill";
  pill.className = "device-view-pill";
  pill.innerHTML = `
    <div class="device-pill-content" id="device-pill-btn" title="Click to preview Phone View on desktop or auto-adapt">
      <span class="device-pill-icon" id="device-pill-icon">📱</span>
      <span class="device-pill-text" id="device-pill-text">Responsive: Auto</span>
    </div>
  `;
  document.body.appendChild(pill);

  const pillBtn = document.getElementById("device-pill-btn");
  const pillIcon = document.getElementById("device-pill-icon");
  const pillText = document.getElementById("device-pill-text");

  function updatePillState() {
    const isMobile = window.innerWidth <= 768;
    const isForcedPhone = document.body.classList.contains("force-phone-view");

    if (isForcedPhone) {
      pillIcon.textContent = "🖥️";
      pillText.textContent = "Exit Phone View";
      pill.classList.add("pill-active");
    } else if (isMobile) {
      pillIcon.textContent = "📱";
      pillText.textContent = "Phone Mode (Active)";
      pill.classList.remove("pill-active");
    } else {
      pillIcon.textContent = "📱";
      pillText.textContent = "Preview Phone View";
      pill.classList.remove("pill-active");
    }
  }

  pillBtn.addEventListener("click", () => {
    document.body.classList.toggle("force-phone-view");
    updatePillState();
    if (document.body.classList.contains("force-phone-view")) {
      window.showToast?.("📱 Phone Simulation Activated: Viewport scaled to mobile screen", "info");
    } else {
      window.showToast?.("🖥️ Desktop View Restored", "info");
    }
  });

  window.addEventListener("resize", updatePillState);
  updatePillState();
}

// Auto init on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  initAuthForms();
  initDeviceViewManager();
});

// Export helpers to window
window.showToast = showToast;
window.checkAuth = checkAuth;
