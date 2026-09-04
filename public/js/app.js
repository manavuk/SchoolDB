// User Recommendation & Authentication State
let currentSessionId = localStorage.getItem('school_db_session_id') || null;
let currentUserAccount = null; // Authenticated user profile ID
let currentUserName = '';
let currentPermissions = []; // Explicit session capabilities (Directory View & Admin Portal hidden by default)
let userSelectedSchools = []; // List of school objects user has added
let userRemovedSchoolIds = []; // Set of school IDs user has removed from recommendations
let compareList = []; // List of schools currently selected for comparison
let currentSchools = []; // Active filtered schools list for directory view
let allSchools = []; // Full schools dataset
let currentViewMode = 'table'; // 'table' or 'cards'
let currentDetailViewVersion = localStorage.getItem('schooldb_detail_view_version') || 'v2'; // 'v1' (classic) or 'v2' (timeline & summary)

// Parent Portal 2.0 Dual-Track State
let parent2State = {
  cafList: [],          // Up to 6 State/Grammar schools in preference rank order (1st to 6th)
  independentList: [],  // Unlimited independent schools
  parentNotes: {},      // schoolId -> { notes, bursary, scholarship, openDay }
  activeSubView: 'matchmaker' // 'matchmaker', 'matrix', 'calendar'
};

// System & Feature Flag Settings
let systemSettings = {
  parentPortal2Enabled: false
};

// Fetch global system configuration & feature flags
async function fetchSystemSettings() {
  try {
    const res = await fetch('/api/system-settings');
    if (res.ok) {
      const data = await res.json();
      systemSettings = { ...systemSettings, ...data };
    }
  } catch (err) {
    console.error('Failed to fetch system settings:', err);
  }
}

// Helper to show non-blocking persistent toast notifications
function showToast(message, type = 'success', duration = 5000) {
  const toast = document.getElementById('toast-notification');
  const msgEl = document.getElementById('toast-message');
  const iconEl = document.getElementById('toast-icon');
  if (!toast || !msgEl || !iconEl) return;

  toast.className = `toast-banner ${type}`;
  msgEl.textContent = message;

  if (type === 'success') iconEl.className = 'fa-solid fa-circle-check';
  else if (type === 'error') iconEl.className = 'fa-solid fa-triangle-exclamation';
  else iconEl.className = 'fa-solid fa-circle-info';

  toast.style.display = 'flex';

  const closeBtn = document.getElementById('toast-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      toast.style.display = 'none';
    };
  }

  if (duration > 0) {
    setTimeout(() => {
      toast.style.display = 'none';
    }, duration);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  // 1. Immediately check URL query parameters for session ID (e.g. after Google OAuth redirect)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('sessionId')) {
    currentSessionId = urlParams.get('sessionId');
    localStorage.setItem('school_db_session_id', currentSessionId);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // 2. Validate active session immediately before heavy data loading
  const authenticated = await checkActiveSession();

  if (authenticated) {
    hideGatekeeperLoginScreen();
    // Immediately apply UI permissions so admin portal is not delayed by heavy catalog loads
    applyPermissionsUI();
  } else {
    showGatekeeperLoginScreen();
  }

  // 3. Register DOM event listeners
  setupEventListeners();

  // 4. Fetch initial school catalog, stats & system settings before UI permission routing
  try {
    await fetchSystemSettings();
    await fetchStats();
    await loadSchools();
    loadAdminSettings();
    populateManualMergeDropdowns();
  } catch (err) {
    console.error('Initial data load error:', err);
  }

  // 5. Fetch user portfolio & refresh permissions with loaded settings
  if (authenticated) {
    try {
      await loadUserPortfolio(currentUserAccount);
      await loadUserRecProfile();
    } catch (err) {
      console.error('Portfolio load error:', err);
    }
    applyPermissionsUI();
  }

  // 6. Fetch recommendations if currently viewing parent/recommendations tab
  const activeTab = localStorage.getItem('app_active_primary_tab');
  if (activeTab !== 'admin') {
    await fetchRecommendations();
  }

  // 7. Check and restore active background scanner/crawler state immediately on load
  checkAndPollScannerStatus();

  // 8. Restore active crawling state when user returns to window/tab
  if (!window._scannerVisibilityBound) {
    window._scannerVisibilityBound = true;
    window.addEventListener('focus', () => {
      checkAndPollScannerStatus();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        checkAndPollScannerStatus();
      }
    });
  }
}

// Check active session with backend /api/auth/me
async function checkActiveSession() {
  // 1. Try localStorage token first
  let token = currentSessionId || localStorage.getItem('school_db_session_id');

  // 2. Fallback to document.cookie on localhost
  if (!token) {
    const match = document.cookie.match(/school_db_session_id=([^;]+)/);
    if (match) token = match[1];
  }

  if (token) {
    currentSessionId = token;
    localStorage.setItem('school_db_session_id', token);
  }

  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      headers: token ? { 'x-session-id': token } : {}
    });

    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        currentUserAccount = data.user.id;
        currentUserName = data.user.name;
        currentPermissions = Array.isArray(data.user.permissions) ? data.user.permissions : [];
        if (data.sessionId) {
          currentSessionId = data.sessionId;
          localStorage.setItem('school_db_session_id', currentSessionId);
          document.cookie = `school_db_session_id=${currentSessionId}; Path=/; Max-Age=2592000; SameSite=Lax`;
        }
        return true;
      }
    }
  } catch (err) {
    console.error('Session check failed:', err);
  }

  currentSessionId = null;
  localStorage.removeItem('school_db_session_id');
  document.cookie = 'school_db_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  return false;
}

// Open Sign In Modal Directly
function openLoginModal(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  const modal = document.getElementById('auth-login-modal');
  if (modal) {
    modal.style.display = 'flex';
    modal.style.zIndex = '25000';
    modal.classList.add('active');
  }
}

// Close Sign In Modal Directly
function closeLoginModal(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  const modal = document.getElementById('auth-login-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

// Trigger Google Sign-In Workflow across application
async function triggerGoogleSignInWorkflow(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }

  try {
    const res = await fetch('/api/auth/google/config');
    if (res.ok) {
      const data = await res.json();
      if (data.configured && data.authUrl) {
        window.location.href = data.authUrl;
        return;
      }
    }
  } catch (err) {}

  // If live Google OAuth server-side config is not present, open the Google SSO modal or gatekeeper
  const googleSsoModal = document.getElementById('google-sso-modal');
  if (googleSsoModal) {
    googleSsoModal.style.display = 'flex';
    googleSsoModal.classList.add('active');
    googleSsoModal.style.zIndex = '25000';
  } else {
    openLoginModal();
  }
}

window.openLoginModal = openLoginModal;
window.closeLoginModal = closeLoginModal;
window.triggerGoogleSignInWorkflow = triggerGoogleSignInWorkflow;

// Show full-screen unauthenticated login screen
function showGatekeeperLoginScreen() {
  document.documentElement.classList.remove('session-pending');
  const overlay = document.getElementById('auth-gatekeeper-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.add('active');
    overlay.style.zIndex = '20000';
  }

  const badge = document.getElementById('auth-user-badge-container');
  const logoutBtn = document.getElementById('auth-logout-btn');
  const loginBtn = document.getElementById('auth-login-btn');

  if (badge) badge.style.display = 'none';
  if (logoutBtn) logoutBtn.style.display = 'none';
  if (loginBtn) loginBtn.style.display = 'inline-flex';
}

// Hide gatekeeper login screen on successful authentication
function hideGatekeeperLoginScreen() {
  document.documentElement.classList.remove('session-pending');
  const overlay = document.getElementById('auth-gatekeeper-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.remove('active');
  }
  const loginModal = document.getElementById('auth-login-modal');
  if (loginModal) {
    loginModal.style.display = 'none';
    loginModal.classList.remove('active');
  }
  const signupModal = document.getElementById('auth-signup-modal');
  if (signupModal) {
    signupModal.style.display = 'none';
    signupModal.classList.remove('active');
  }
  updateAuthUserBadge();
}

// Set authenticated session state and navigate to Parent View
async function setAuthenticatedSession(sessionData, toastMessage) {
  currentSessionId = sessionData.sessionId;
  localStorage.setItem('school_db_session_id', currentSessionId);
  document.cookie = `school_db_session_id=${currentSessionId}; Path=/; Max-Age=2592000; SameSite=Lax`;

  currentUserAccount = sessionData.user.id;
  currentUserName = sessionData.user.name;
  currentPermissions = Array.isArray(sessionData.user.permissions) ? sessionData.user.permissions : [];

  hideGatekeeperLoginScreen();
  updateAuthUserBadge();

  if (toastMessage) showToast(toastMessage, 'success');

  await loadUserPortfolio(currentUserAccount);
  await loadUserRecProfile();
  await fetchRecommendations();
  applyPermissionsUI();
}

// Sign out authenticated session and show login screen
async function logoutSession() {
  // Flush and save current portfolio to SQLite before destroying session
  if (currentUserAccount) {
    try {
      await saveUserPortfolio(true);
    } catch (e) {
      console.error('Error auto-saving portfolio on logout:', e);
    }
  }

  if (currentSessionId) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': currentSessionId,
          'Authorization': `Bearer ${currentSessionId}`
        },
        body: JSON.stringify({ sessionId: currentSessionId })
      });
    } catch (err) {
      console.error('Logout error:', err);
    }
  }

  // 1. Purge all session credentials & user state from memory and storage
  currentSessionId = null;
  currentUserAccount = null;
  currentUserName = '';
  currentPermissions = [];
  userSelectedSchools = [];
  userRemovedSchoolIds = [];
  compareList = [];
  localStorage.removeItem('school_db_session_id');
  document.cookie = 'school_db_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';

  // 2. Clear input fields in login/signup forms
  const gatekeeperEmail = document.getElementById('gatekeeper-email');
  const gatekeeperPass = document.getElementById('gatekeeper-password');
  if (gatekeeperEmail) gatekeeperEmail.value = '';
  if (gatekeeperPass) gatekeeperPass.value = '';

  const locInput = document.getElementById('rec-location-input');
  if (locInput) locInput.value = '';

  // 3. Reset UI tab permissions & user badge
  applyPermissionsUI();
  updateUserSchoolsUI();

  showToast('Signed out successfully. Please log in to continue.', 'info');
  showGatekeeperLoginScreen();
}

// Update Header Authenticated User Badge & Status Indicator
function updateAuthUserBadge() {
  const badgeContainer = document.getElementById('auth-user-badge-container');
  const nameEl = document.getElementById('auth-user-display-name');
  const statusEl = document.getElementById('auth-user-display-status');
  const logoutBtn = document.getElementById('auth-logout-btn');
  const loginBtn = document.getElementById('auth-login-btn');

  if (currentUserAccount) {
    if (badgeContainer) badgeContainer.style.display = 'flex';
    if (nameEl) nameEl.textContent = currentUserName;
    if (statusEl) statusEl.textContent = 'Authenticated';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    if (loginBtn) loginBtn.style.display = 'none';
  } else {
    if (badgeContainer) badgeContainer.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (loginBtn) loginBtn.style.display = 'inline-flex';
  }
}

// Load User Portfolio
async function loadUserPortfolio(userId) {
  if (!userId) return;
  try {
    const res = await fetch(`/api/user-portfolio/${userId}`, {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (!res.ok && res.status === 401) {
      logoutSession();
      return;
    }
    const data = await res.json();

    userSelectedSchools = data.selectedSchools || [];
    userRemovedSchoolIds = data.removedSchoolIds || [];

    // Populate Parent Portal 2.0 dual track state
    if (Array.isArray(data.cafRankings) && data.cafRankings.length > 0) {
      parent2State.cafList = data.cafRankings;
    } else {
      parent2State.cafList = userSelectedSchools.filter(s => s.schoolType !== 'Independent').slice(0, 6);
    }

    if (Array.isArray(data.independentSchools) && data.independentSchools.length > 0) {
      parent2State.independentList = data.independentSchools;
    } else {
      parent2State.independentList = userSelectedSchools.filter(s => s.schoolType === 'Independent');
    }

    parent2State.parentNotes = data.parentNotes || {};

    const locInput = document.getElementById('rec-location-input');
    if (locInput) locInput.value = data.targetLocation || '';

    const p2PostcodeInput = document.getElementById('p2-input-postcode');
    if (p2PostcodeInput && data.targetLocation) p2PostcodeInput.value = data.targetLocation;

    updateUserSchoolsUI();
    renderUserDashboard();
    renderParent2Views();
    fetchRecommendations();
  } catch (err) {
    console.error('Failed to load user portfolio:', err);
  }
}

// Save Current User Portfolio to Backend (Silent Auto-Save)
async function saveUserPortfolio(silent = false) {
  if (!currentUserAccount) return;
  const targetLocation = document.getElementById('rec-target-locations')?.value || document.getElementById('p2-input-postcode')?.value || document.getElementById('rec-location-input')?.value || '';
  
  // Ensure userSelectedSchools contains all shortlisted schools from both tracks
  userSelectedSchools = [...parent2State.cafList, ...parent2State.independentList];

  try {
    const res = await fetch(`/api/user-portfolio/${currentUserAccount}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({
        targetLocation,
        selectedSchools: userSelectedSchools,
        removedSchoolIds: userRemovedSchoolIds,
        cafRankings: parent2State.cafList,
        independentSchools: parent2State.independentList,
        parentNotes: parent2State.parentNotes
      })
    });

    if (res.ok) {
      if (!silent) showToast(`Portfolio saved successfully for ${currentUserName}!`, 'success');
      renderParent2Views();
    } else {
      if (res.status === 401) {
        logoutSession();
      } else if (!silent) {
        showToast('Failed to save portfolio.', 'error');
      }
    }
  } catch (err) {
    console.error('Error saving user portfolio:', err);
    if (!silent) showToast('Error saving user portfolio.', 'error');
  }
}

// Add a school to user selected list (Auto-saved by default)
async function addUserSchool(school) {
  if (!school || !school.id) return;
  
  if (school.schoolType === 'Independent') {
    addSchoolToIndependent(school);
  } else {
    addSchoolToStateCaf(school);
  }
}

// Remove a school from user selected list (Auto-saved by default)
async function removeUserSchool(schoolId) {
  parent2State.cafList = parent2State.cafList.filter(s => s.id !== schoolId);
  parent2State.independentList = parent2State.independentList.filter(s => s.id !== schoolId);
  userSelectedSchools = [...parent2State.cafList, ...parent2State.independentList];

  updateUserSchoolsUI();
  renderParent2Views();
  fetchRecommendations();
  await saveUserPortfolio(true); // Auto-save changes immediately
}

// Explicitly remove a school from ever appearing in recommendations for this user (Auto-saved by default)
async function removeRecommendation(schoolId) {
  if (!userRemovedSchoolIds.includes(schoolId)) {
    userRemovedSchoolIds.push(schoolId);
  }
  fetchRecommendations();
  await saveUserPortfolio(true); // Auto-save changes immediately
  showToast('School removed from recommendations list.', 'info');
}

// Apply Permissions UI controls & tab visibility based on session capabilities
function applyPermissionsUI() {
  const directoryTabBtn = document.getElementById('tab-directory-btn');
  const adminTabBtn = document.getElementById('tab-admin-btn');
  const parent2TabBtn = document.getElementById('tab-parent2-btn');
  const recommendTabBtn = document.getElementById('tab-recommend-btn');
  const recommendTabLabel = document.getElementById('recommend-tab-label');

  // Enforce tab access permissions: Admin Portal hidden unless session holds explicit permission
  const canViewAdmin = Array.isArray(currentPermissions) && currentPermissions.includes('admin:portal');

  if (directoryTabBtn) directoryTabBtn.style.display = 'none';
  if (adminTabBtn) adminTabBtn.style.display = canViewAdmin ? 'inline-flex' : 'none';

  updateAuthUserBadge();

  const isP2Enabled = Boolean(systemSettings.parentPortal2Enabled);

  // Update Classic/Parent Portal label dynamically
  if (recommendTabLabel) {
    recommendTabLabel.textContent = isP2Enabled ? 'Classic Portal' : 'Parent Portal';
  }

  if (!currentUserAccount || !isP2Enabled) {
    if (parent2TabBtn) parent2TabBtn.style.display = 'none';
  } else {
    if (parent2TabBtn) parent2TabBtn.style.display = 'inline-flex';
  }

  // Landing page hierarchy:
  // 1. If user previously selected a primary tab, restore that tab if allowed
  // 2. Otherwise: Admin lands on Admin Portal, Parent lands on Parent Portal 2.0 or Classic
  const savedPrimaryTab = localStorage.getItem('app_active_primary_tab');
  if (canViewAdmin) {
    if (savedPrimaryTab && ['admin', 'recommend', 'parent2'].includes(savedPrimaryTab)) {
      switchTab(savedPrimaryTab);
    } else {
      switchTab('admin');
    }
  } else if (isP2Enabled && currentUserAccount) {
    switchTab(savedPrimaryTab === 'recommend' ? 'recommend' : 'parent2');
  } else {
    switchTab('recommend');
  }
}

// Switch between Primary Views: Parent Portal 2.0 vs Classic Recommendations vs Directory vs Admin
function switchTab(tabName) {
  const parent2TabBtn = document.getElementById('tab-parent2-btn');
  const recommendTabBtn = document.getElementById('tab-recommend-btn');
  const adminTabBtn = document.getElementById('tab-admin-btn');
  const directoryTabBtn = document.getElementById('tab-directory-btn');

  const parent2Content = document.getElementById('parent2-tab-content') || document.getElementById('parent2-content');
  const recommendContent = document.getElementById('recommend-tab-content') || document.getElementById('recommend-content');
  const adminContent = document.getElementById('admin-tab-content') || document.getElementById('admin-content');
  const directoryContent = document.getElementById('directory-tab-content') || document.getElementById('directory-content');

  const isP2Enabled = Boolean(systemSettings.parentPortal2Enabled);
  const canViewAdmin = Array.isArray(currentPermissions) && currentPermissions.includes('admin:portal');

  // If tabName is parent2 but feature is disabled and not admin, route to Classic Portal
  if (tabName === 'parent2' && !isP2Enabled && !canViewAdmin) {
    tabName = 'recommend';
  }

  // Persist user selected primary tab
  localStorage.setItem('app_active_primary_tab', tabName);

  // Reset tab button states
  [parent2TabBtn, recommendTabBtn, adminTabBtn, directoryTabBtn].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });

  // Hide all view containers
  [parent2Content, recommendContent, adminContent, directoryContent].forEach(c => {
    if (c) c.style.display = 'none';
  });

  if (tabName === 'parent2') {
    if (parent2TabBtn) parent2TabBtn.classList.add('active');
    if (parent2Content) parent2Content.style.display = 'block';
    renderParent2Views();
    fetchRecommendations();
  } else if (tabName === 'recommend') {
    if (recommendTabBtn) recommendTabBtn.classList.add('active');
    if (recommendContent) recommendContent.style.display = 'block';
    const targetSubTab = localStorage.getItem('classic_active_subtab') || 'find';
    switchClassicSubTab(targetSubTab);
  } else if (tabName === 'dashboard') {
    if (recommendTabBtn) recommendTabBtn.classList.add('active');
    if (recommendContent) recommendContent.style.display = 'block';
    switchClassicSubTab('shortlist');
  } else if ((tabName === 'admin' || tabName === 'directory') && canViewAdmin) {
    if (adminTabBtn) adminTabBtn.classList.add('active');
    if (adminContent) adminContent.style.display = 'block';
    const targetSubTab = tabName === 'directory' ? 'directory' : (localStorage.getItem('admin_active_subtab') || 'directory');
    initAdminSidebarCollapse();
    switchAdminSubTab(targetSubTab);
    loadAdminFieldReports();
  } else {
    // Default fallback: If P2 enabled, parent2; otherwise recommend
    if (isP2Enabled) {
      if (parent2TabBtn) parent2TabBtn.classList.add('active');
      if (parent2Content) parent2Content.style.display = 'block';
      renderParent2Views();
      fetchRecommendations();
    } else {
      if (recommendTabBtn) recommendTabBtn.classList.add('active');
      if (recommendContent) recommendContent.style.display = 'block';
      const targetSubTab = localStorage.getItem('classic_active_subtab') || 'find';
      switchClassicSubTab(targetSubTab);
    }
  }
}

// Switch sub-tab within Classic Parent Portal
function switchClassicSubTab(subTabName) {
  const tabs = document.querySelectorAll('.classic-side-tab');
  const panes = document.querySelectorAll('.classic-subpane');

  tabs.forEach(tab => {
    if (tab.getAttribute('data-target-classic-tab') === subTabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  panes.forEach(pane => {
    if (pane.id === `classic-subpane-${subTabName}`) {
      pane.style.display = 'block';
    } else {
      pane.style.display = 'none';
    }
  });

  localStorage.setItem('classic_active_subtab', subTabName);

  if (subTabName === 'find') {
    fetchRecommendations();
  } else if (subTabName === 'shortlist' || subTabName === 'timeline') {
    renderUserDashboard();
  } else if (subTabName === 'dualtrack') {
    renderDualTrackHub();
  }
}

// Setup Collapsible Sidebar for Classic Parent Portal
function setupClassicSidebarToggle() {
  const toggleBtn = document.getElementById('btn-toggle-classic-sidebar');
  const sideLayout = document.getElementById('classic-side-layout');
  const sideNav = document.getElementById('classic-side-nav');
  const toggleIcon = document.getElementById('icon-toggle-classic-sidebar');

  if (!toggleBtn || !sideLayout || !sideNav) return;

  function setSidebarCollapsed(collapsed, save = true) {
    if (collapsed) {
      sideLayout.classList.add('collapsed');
      sideNav.classList.add('collapsed');
      if (toggleIcon) {
        toggleIcon.className = 'fa-solid fa-angles-right';
      }
      toggleBtn.title = 'Expand sidebar';
    } else {
      sideLayout.classList.remove('collapsed');
      sideNav.classList.remove('collapsed');
      if (toggleIcon) {
        toggleIcon.className = 'fa-solid fa-angles-left';
      }
      toggleBtn.title = 'Collapse sidebar';
    }
    if (save) {
      localStorage.setItem('classic_sidebar_collapsed', collapsed ? 'true' : 'false');
    }
  }

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isCurrentlyCollapsed = sideLayout.classList.contains('collapsed');
    setSidebarCollapsed(!isCurrentlyCollapsed, true);
  });

  // Restore previous user preference
  const savedState = localStorage.getItem('classic_sidebar_collapsed');
  if (savedState === 'true') {
    setSidebarCollapsed(true, false);
  }
}

// Switch sub-tab within Admin Portal
function switchAdminSubTab(subTabName) {
  const tabs = document.querySelectorAll('.admin-side-tab[data-target-tab]');
  const panes = document.querySelectorAll('.admin-subpane');

  tabs.forEach(tab => {
    if (tab.getAttribute('data-target-tab') === subTabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  panes.forEach(pane => {
    if (pane.id === `admin-subpane-${subTabName}`) {
      pane.style.display = 'block';
      pane.classList.add('active');
    } else {
      pane.style.display = 'none';
      pane.classList.remove('active');
    }
  });

  localStorage.setItem('admin_active_subtab', subTabName);

  if (subTabName === 'directory') {
    renderSchools();
  } else if (subTabName === 'data-enrichment') {
    initDataEnrichmentTab();
  } else if (subTabName === 'bulk-edit') {
    renderBulkEditTable();
  } else if (subTabName === 'corrections') {
    loadAdminFieldReports();
  } else if (subTabName === 'gias-backfill') {
    initGiasBackfillTab();
  } else if (subTabName === 'admissions-guardrails') {
    initAdmissionsGuardrailsTab();
  } else if (subTabName === 'website-health') {
    initWebsiteHealthTab();
  } else if (subTabName === 'deduplication' || subTabName === 'merge') {
    initDeduplicationTab();
  } else if (subTabName === 'settings') {
    loadAdminSettings();
  }
}

// Collapsible Admin Portal Sidebar Controller
function initAdminSidebarCollapse() {
  const toggleBtn = document.getElementById('admin-sidebar-toggle-btn');
  const layout = document.getElementById('admin-side-layout');
  const nav = document.getElementById('admin-side-nav');
  const wrapper = document.getElementById('admin-portal-wrapper');

  if (!toggleBtn || !layout || !nav) return;

  // Restore saved state from localStorage
  const isCollapsed = localStorage.getItem('admin_sidebar_collapsed') === 'true';
  if (isCollapsed) {
    layout.classList.add('collapsed');
    nav.classList.add('collapsed');
    if (wrapper) wrapper.classList.add('sidebar-collapsed');
    toggleBtn.innerHTML = '<i class="fa-solid fa-angles-right"></i>';
    toggleBtn.title = 'Expand Sidebar';
  } else {
    layout.classList.remove('collapsed');
    nav.classList.remove('collapsed');
    if (wrapper) wrapper.classList.remove('sidebar-collapsed');
    toggleBtn.innerHTML = '<i class="fa-solid fa-angles-left"></i>';
    toggleBtn.title = 'Collapse Sidebar';
  }

  toggleBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const willCollapse = !layout.classList.contains('collapsed');
    if (willCollapse) {
      layout.classList.add('collapsed');
      nav.classList.add('collapsed');
      if (wrapper) wrapper.classList.add('sidebar-collapsed');
      toggleBtn.innerHTML = '<i class="fa-solid fa-angles-right"></i>';
      toggleBtn.title = 'Expand Sidebar';
      localStorage.setItem('admin_sidebar_collapsed', 'true');
    } else {
      layout.classList.remove('collapsed');
      nav.classList.remove('collapsed');
      if (wrapper) wrapper.classList.remove('sidebar-collapsed');
      toggleBtn.innerHTML = '<i class="fa-solid fa-angles-left"></i>';
      toggleBtn.title = 'Collapse Sidebar';
      localStorage.setItem('admin_sidebar_collapsed', 'false');
    }
  };
}



// Fetch dashboard statistics
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();

    // Populate LA dropdown
    const laSelect = document.getElementById('la-select');
    if (laSelect) {
      const prevVal = laSelect.value;
      laSelect.innerHTML = '<option value="">All Boroughs / Local Authorities</option>';
      data.localAuthorities.forEach(la => {
        const opt = document.createElement('option');
        opt.value = la;
        opt.textContent = la;
        laSelect.appendChild(opt);
      });
      laSelect.value = prevVal;
    }

    // Populate Region dropdown
    const regionSelect = document.getElementById('region-select');
    if (regionSelect && data.regions) {
      const prevReg = regionSelect.value;
      regionSelect.innerHTML = '<option value="">All UK Regions</option>';
      data.regions.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        regionSelect.appendChild(opt);
      });
      regionSelect.value = prevReg;
    }
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}


// Setup typeahead search input for school selection
function setupMergeTypeahead(inputId, hiddenId, containerId) {
  const inputEl = document.getElementById(inputId);
  const hiddenEl = document.getElementById(hiddenId);
  const suggestionsEl = document.getElementById(containerId);

  if (!inputEl || !hiddenEl || !suggestionsEl) return;

  // Render suggestion popup based on query
  const doSearch = async (query = '') => {
    const q = query.toLowerCase().trim();
    try {
      const res = await fetch(`/api/schools?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      const matches = data.schools || [];

      if (matches.length === 0) {
        suggestionsEl.innerHTML = '<div style="padding:0.6rem 0.8rem; color:#94a3b8; font-size:0.85rem;">No matching schools found</div>';
        suggestionsEl.style.display = 'block';
        return;
      }

      suggestionsEl.innerHTML = matches.slice(0, 50).map(s => {
        const laStr = s.la ? ` (${s.la})` : '';
        const urnStr = s.urn ? ` [URN: ${s.urn}]` : '';
        const escName = (s.name || '').replace(/"/g, '&quot;');
        return `
          <div class="typeahead-item" data-id="${s.id}" data-name="${escName}${laStr}" style="padding:0.6rem 0.85rem; border-bottom:1px solid #f1f5f9; cursor:pointer; font-size:0.85rem; background:#ffffff;">
            <strong style="color:#1e293b; display:block;">${s.name}</strong>
            <span style="color:#64748b; font-size:0.78rem;">${laStr}${urnStr}</span>
          </div>`;
      }).join('');

      suggestionsEl.style.display = 'block';

      suggestionsEl.querySelectorAll('.typeahead-item').forEach(item => {
        item.onmousedown = (e) => {
          e.preventDefault();
          hiddenEl.value = item.dataset.id;
          inputEl.value = item.dataset.name;
          inputEl.dataset.selectedId = item.dataset.id;
          suggestionsEl.style.display = 'none';
        };
      });
    } catch (err) {
      console.error('Typeahead search error:', err);
    }
  };

  inputEl.onfocus = () => doSearch(inputEl.value);
  inputEl.onclick = () => doSearch(inputEl.value);
  inputEl.oninput = (e) => {
    hiddenEl.value = '';
    delete inputEl.dataset.selectedId;
    doSearch(e.target.value);
  };

  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !suggestionsEl.contains(e.target)) {
      suggestionsEl.style.display = 'none';
    }
  });
}

// Populate / initialize manual merge typeahead inputs
function populateManualMergeDropdowns() {
  setupMergeTypeahead('manual-merge-input-a', 'manual-merge-school-a', 'manual-merge-suggestions-a');
  setupMergeTypeahead('manual-merge-input-b', 'manual-merge-school-b', 'manual-merge-suggestions-b');
}

// Render active filter chips above results
function renderActiveFilterChips() {
  const container = document.getElementById('active-filters-chips');
  if (!container) return;

  const chips = [];

  const tagSelect = document.getElementById('tag-select');
  if (tagSelect && tagSelect.value) {
    const text = tagSelect.options[tagSelect.selectedIndex]?.text || tagSelect.value;
    chips.push({ id: 'tag-select', label: text });
  }

  const regionSelect = document.getElementById('region-select');
  if (regionSelect && regionSelect.value) {
    chips.push({ id: 'region-select', label: `Region: ${regionSelect.value}` });
  }

  const laSelect = document.getElementById('la-select');
  if (laSelect && laSelect.value) {
    chips.push({ id: 'la-select', label: `Borough: ${laSelect.value}` });
  }

  const typeSelect = document.getElementById('type-select');
  if (typeSelect && typeSelect.value) {
    chips.push({ id: 'type-select', label: `Type: ${typeSelect.value}` });
  }

  const searchInput = document.getElementById('search-input');
  if (searchInput && searchInput.value.trim()) {
    chips.push({ id: 'search-input', label: `"${searchInput.value.trim()}"` });
  }

  const stageSelect = document.getElementById('second-stage-select');
  if (stageSelect && stageSelect.value) {
    chips.push({ id: 'second-stage-select', label: `2nd Stage: ${stageSelect.value === 'yes' ? 'Yes' : 'No'}` });
  }

  const feeSelect = document.getElementById('fee-select');
  if (feeSelect && feeSelect.value) {
    chips.push({ id: 'fee-select', label: `Funding: ${feeSelect.value}` });
  }

  if (chips.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = chips.map(c => `
    <span class="active-filter-chip" data-clear-filter="${c.id}" style="display: inline-flex; align-items: center; gap: 0.3rem; background: #e0e7ff; color: #4338ca; border: 1px solid #c7d2fe; border-radius: 999px; padding: 0.15rem 0.55rem; font-size: 0.75rem; font-weight: 600; cursor: pointer;" title="Click to remove filter">
      ${c.label} <i class="fa-solid fa-xmark" style="font-size: 0.7rem; opacity: 0.7;"></i>
    </span>
  `).join('');

  container.querySelectorAll('[data-clear-filter]').forEach(el => {
    el.addEventListener('click', () => {
      const targetId = el.getAttribute('data-clear-filter');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.value = '';
        loadSchools();
      }
    });
  });
}

// Fetch schools based on filters
async function loadSchools() {
  const search = document.getElementById('search-input') ? document.getElementById('search-input').value.trim() : '';
  const tag = document.getElementById('tag-select') ? document.getElementById('tag-select').value.trim() : '';
  const region = document.getElementById('region-select') ? document.getElementById('region-select').value.trim() : '';
  const la = document.getElementById('la-select') ? document.getElementById('la-select').value.trim() : '';
  const type = document.getElementById('type-select') ? document.getElementById('type-select').value.trim() : '';
  const gender = document.getElementById('gender-select') ? document.getElementById('gender-select').value.trim() : '';
  const ofsted = document.getElementById('ofsted-select') ? document.getElementById('ofsted-select').value.trim() : '';
  const exam = document.getElementById('exam-select') ? document.getElementById('exam-select').value.trim() : '';
  const secondStage = document.getElementById('second-stage-select') ? document.getElementById('second-stage-select').value.trim() : '';
  const confidence = document.getElementById('confidence-select') ? document.getElementById('confidence-select').value.trim() : '';
  const fee = document.getElementById('fee-select') ? document.getElementById('fee-select').value.trim() : '';
  const hotSelect = document.getElementById('hot-select') ? document.getElementById('hot-select').value.trim() : '';

  // Distance from User Home Postcode
  const postcodeEl = document.getElementById('filter-user-postcode') || document.getElementById('rec-target-locations');
  const userPostcode = postcodeEl ? postcodeEl.value.trim() : (localStorage.getItem('user_home_postcode') || '');
  const distanceSelectEl = document.getElementById('filter-max-distance') || document.getElementById('rec-max-distance-select');
  const maxDistance = distanceSelectEl ? distanceSelectEl.value.trim() : '';

  if (userPostcode && userPostcode.length >= 2) {
    try { localStorage.setItem('user_home_postcode', userPostcode); } catch (e) {}
  }

  renderActiveFilterChips();

  const queryParams = new URLSearchParams();
  if (search) queryParams.append('search', search);
  if (userPostcode) queryParams.append('userPostcode', userPostcode);
  if (maxDistance) queryParams.append('maxDistance', maxDistance);
  if (tag) queryParams.append('tag', tag);
  if (region) queryParams.append('region', region);
  if (la) queryParams.append('la', la);
  if (type) queryParams.append('type', type);
  if (gender) queryParams.append('gender', gender);
  if (ofsted) queryParams.append('ofsted', ofsted);
  if (exam) queryParams.append('exam', exam);
  if (secondStage) queryParams.append('secondStage', secondStage);
  if (confidence) queryParams.append('confidence', confidence);
  if (fee) queryParams.append('fee', fee);
  if (hotSelect === 'hot') queryParams.append('hot', 'true');
  if (hotSelect === 'official') queryParams.append('official', 'true');

  try {
    const res = await fetch(`/api/schools?${queryParams.toString()}`);
    const data = await res.json();
    currentSchools = data.schools || [];

    const resNum = document.getElementById('results-num');
    if (resNum) {
      resNum.textContent = data.total !== undefined ? data.total.toLocaleString() : currentSchools.length.toLocaleString();
    }
    const quickTotal = document.getElementById('admin-quick-total-schools');
    if (quickTotal && data.total !== undefined) {
      quickTotal.textContent = data.total.toLocaleString();
    }
    renderSchools();
    if (typeof populateManualMergeDropdowns === 'function') {
      populateManualMergeDropdowns();
    }
  } catch (err) {
    console.error('Error fetching schools list:', err);
  }
}
window.loadSchools = loadSchools;

// Global format helpers
const formatOfsted = r => (r === 'Independent (ISI Excellent)' ? 'ISI Excellent' : (r || 'N/A'));

const formatExam = t => {
  if (!t) return 'None';
  const str = String(t).trim();
  const lower = str.toLowerCase();

  if (lower.includes('iseb') && lower.includes('common')) return 'ISEB Pre-Test';
  if (lower.includes('iseb')) return 'ISEB Test';
  if (lower.includes('gl assessment') || lower.includes('gl test')) return 'GL Assessment';
  if (lower.includes('kent test')) return 'Kent 11+';
  if (lower.includes('medway test')) return 'Medway 11+';
  if (lower.includes('selective eligibility test') || lower.includes('set')) return 'SET 11+';
  if (lower.includes('london consortium')) return 'London 11+';
  if (lower.includes('consortium')) return 'Consortium 11+';
  if (lower.includes('two-stage') || lower.includes('stage 1')) return 'Two-Stage 11+';
  if (lower.includes('csse')) return 'CSSE 11+';
  if (lower.includes('bexley')) return 'Bexley 11+';
  if (lower.includes('redbridge')) return 'Redbridge 11+';
  if (lower.includes('tiffin')) return 'Tiffin 11+';
  if (lower.includes('newstead')) return 'Newstead 11+';
  if (lower.includes('wandsworth')) return 'Wandsworth 11+';
  if (lower.includes('quest')) return 'Quest 11+';
  if (lower.includes('aptitude') || lower.includes('banding')) return 'Aptitude/Band';
  if (lower.includes('faith')) return 'Faith Criteria';
  if (lower.includes('non-selective') || lower.includes('none')) return 'Non-selective';
  if (lower.includes('own') || lower.includes('bespoke') || lower.includes('school')) return 'School Test';

  return str.length > 14 ? str.slice(0, 14).trim() + '…' : str;
};

// Render schools either in card view or table view
function renderSchools() {

  const cardsContainer = document.getElementById('schools-container');
  const tableBody = document.getElementById('schools-table-body');

  if (cardsContainer) cardsContainer.innerHTML = '';
  if (tableBody) tableBody.innerHTML = '';

  if (currentSchools.length === 0) {
    if (cardsContainer) {
      cardsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: white; border-radius: 12px; border: 1px solid #e2e8f0;">
          <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; color: #94a3b8; margin-bottom: 1rem;"></i>
          <h3>No matching high schools found</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Try adjusting your filter criteria or search keyword.</p>
        </div>
      `;
    }
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 3rem; color: #64748b;">
            <i class="fa-solid fa-folder-open" style="font-size: 2rem; color: #94a3b8; margin-bottom: 0.5rem; display: block;"></i>
            <strong>No matching high schools found</strong>
            <div style="font-size: 0.85rem; margin-top: 0.25rem;">Try adjusting your filter criteria or search keyword.</div>
          </td>
        </tr>
      `;
    }
    return;
  }

  currentSchools.forEach(school => {
    // Card Element
    const card = document.createElement('div');
    card.className = 'school-card';



    let pillClass = 'pill-comprehensive';
    if (school.schoolType && school.schoolType.includes('Grammar')) pillClass = 'pill-grammar';
    if (school.schoolType && school.schoolType.includes('Independent')) pillClass = 'pill-independent';

    const isCompared = compareList.some(s => s.id === school.id);

    // Dynamic Badges & Tags
    let tagsArr = [];
    if (Array.isArray(school.verification_tags)) tagsArr = school.verification_tags;
    else if (typeof school.verification_tags === 'string') {
      try { tagsArr = JSON.parse(school.verification_tags); } catch(e) { tagsArr = [school.verification_tags]; }
    }

    const isLLM = tagsArr.includes('llm_enriched') || tagsArr.includes('llm_verified') || tagsArr.includes('gemini_crawl') || tagsArr.includes('chatgpt_crawl') || school.verification_status === 'llm_enriched' || Boolean(school.llm_enriched_at);
    const isAutoVerified = tagsArr.includes('auto_verified') || tagsArr.includes('web_verified') || school.verification_status === 'auto_verified' || school.verification_status === 'verified' || Boolean(school.verified_at);
    const isTwoStage = school.second_stage_exam_required === 'Yes' || (school.entranceExamType && (school.entranceExamType.includes('Two-Stage') || school.entranceExamType.includes('Stage 2'))) || tagsArr.includes('two_stage_exam');
    const hasDatesVerified = tagsArr.includes('dates_verified') || tagsArr.includes('dates_current') || tagsArr.includes('p0_cycle_current');
    const hasDates = school.entranceExamDates && school.entranceExamDates !== '{}' && school.entranceExamDates !== 'null';
    const hasFees = Boolean(school.feesTermly || school.registrationFee);

    let tagBadgesHtml = '';
    const isAdminUser = Array.isArray(currentPermissions) && (currentPermissions.includes('admin:portal') || currentPermissions.includes('admin:edit'));
    if (isAdminUser && typeof school.completeness_score === 'number') {
      const cScore = school.completeness_score;
      let bg = '#fef2f2', fg = '#991b1b', border = '#fecaca', label = 'Incomplete';
      if (cScore >= 80) { bg = '#f0fdf4'; fg = '#166534'; border = '#bbf7d0'; label = 'High Quality'; }
      else if (cScore >= 60) { bg = '#eff6ff'; fg = '#1e40af'; border = '#bfdbfe'; label = 'Good Quality'; }
      else if (cScore >= 40) { bg = '#fffbeb'; fg = '#92400e'; border = '#fde68a'; label = 'Fair Quality'; }
      tagBadgesHtml += `<span class="badge-tag" style="background:${bg}; color:${fg}; border:1px solid ${border}; font-weight:700;" title="Admin Completeness Score: ${cScore}% (${label})"><i class="fa-solid fa-chart-pie"></i> ${cScore}% Complete</span>`;
    }
    if (isLLM) tagBadgesHtml += `<span class="badge-tag badge-tag-llm" data-tag-filter="llm_enriched" title="Filter by AI LLM Enriched"><i class="fa-solid fa-robot"></i> LLM Enriched</span>`;
    if (isAutoVerified) tagBadgesHtml += `<span class="badge-tag badge-tag-verified" data-tag-filter="auto_verified" title="Filter by Web Verified"><i class="fa-solid fa-circle-check"></i> Web Verified</span>`;
    if (hasDatesVerified) tagBadgesHtml += `<span class="badge-tag badge-tag-dates" data-tag-filter="dates_verified" title="Filter by Verified Admissions Dates"><i class="fa-regular fa-calendar-check"></i> Dates</span>`;
    else if (hasDates) tagBadgesHtml += `<span class="badge-tag badge-tag-dates" data-tag-filter="dates_recorded" title="Filter by Admissions Dates Available"><i class="fa-regular fa-calendar"></i> Dates</span>`;
    if (isTwoStage) tagBadgesHtml += `<span class="badge-tag badge-tag-stage" data-tag-filter="two_stage_exam" title="Filter by 2nd Stage Exam Required"><i class="fa-solid fa-layer-group"></i> 2-Stage</span>`;
    if (hasFees) tagBadgesHtml += `<span class="badge-tag badge-tag-fees" data-tag-filter="fees_recorded" title="Filter by Fees Recorded"><i class="fa-solid fa-sterling-sign"></i> Fees</span>`;

    card.innerHTML = `
      <div>
        <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap; margin-bottom:0.35rem;">
          <span class="school-type-pill ${pillClass}">${school.schoolType}</span>
          ${school.active === false ? `<span class="badge-closed" style="background:#fee2e2; color:#991b1b; font-size:0.7rem; font-weight:700; padding:0.12rem 0.45rem; border-radius:999px; border:1px solid #fca5a5;"><i class="fa-solid fa-ban"></i> Closed</span>` : ''}
          ${school.hot ? `<span class="badge-hot"><i class="fa-solid fa-fire"></i> Hot</span>` : ''}
        </div>
        <h3 class="school-name">${school.name}</h3>
        <div class="school-location">
          <i class="fa-solid fa-location-dot"></i> ${school.la}, ${school.postcode || ''}
          ${school.distanceMiles !== undefined ? `
            <a href="${school.distanceDirectionsUrl || '#'}" target="_blank" rel="noopener noreferrer" class="school-distance-pill" style="display: inline-flex; align-items: center; gap: 0.3rem; margin-left: 0.5rem; background: #ecfdf5; color: #047857; font-weight: 700; font-size: 0.75rem; padding: 0.15rem 0.55rem; border-radius: 9999px; text-decoration: none; border: 1px solid #a7f3d0;" title="Exact straight-line distance from your postcode. Click for Google Maps directions.">
              <i class="fa-solid fa-route"></i> ${school.distanceFormatted || (school.distanceMiles + ' mi')}
              <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.65rem; opacity: 0.8;"></i>
            </a>
          ` : ''}
        </div>
        
        <div class="card-badges-row">
          <span class="badge-ofsted"><i class="fa-solid fa-star"></i> ${formatOfsted(school.ofstedRating)}</span>
          <span class="badge-exam" title="${(school.entranceExamType || '').replace(/"/g, '&quot;')}"><i class="fa-solid fa-pen-to-square"></i> ${formatExam(school.entranceExamType)}</span>
        </div>

        ${tagBadgesHtml ? `<div class="card-tags-row">${tagBadgesHtml}</div>` : ''}

        <div class="card-metrics-row">
          <div>
            <div class="sub-metric-val">${school.pupilCount ? school.pupilCount.toLocaleString() : 'N/A'}</div>
            <div class="sub-metric-lbl">Pupil Count</div>
          </div>
          <div>
            <div class="sub-metric-val">${school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined ? school.gcseAttainment8 : 'N/A'}</div>
            <div class="sub-metric-lbl">Attainment 8</div>
          </div>
        </div>
      </div>

      <div class="card-actions">
        <button class="btn btn-outline btn-detail-trigger" data-id="${school.id}">
          <i class="fa-solid fa-circle-info"></i> Details
        </button>
        <button class="btn ${isCompared ? 'btn-primary' : 'btn-outline'} btn-compare-trigger" data-id="${school.id}">
          <i class="fa-solid ${isCompared ? 'fa-check' : 'fa-plus'}"></i> ${isCompared ? 'Added' : 'Compare'}
        </button>
        ${currentPermissions.includes('admin:edit') ? `
          <button class="btn btn-outline btn-edit-trigger" data-id="${school.id}" style="color: #7c3aed; border-color: #ddd6fe; max-width: 40px; padding: 0.6rem;" title="Edit Record">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-outline btn-delete-trigger" data-id="${school.id}" style="color: #ef4444; border-color: #fca5a5; max-width: 40px; padding: 0.6rem;" title="Delete Record">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        ` : ''}
      </div>
    `;

    // Attach safe event listeners for card actions
    card.querySelector('.btn-detail-trigger').addEventListener('click', () => openSchoolDetail(school.id));
    card.querySelector('.btn-compare-trigger').addEventListener('click', () => toggleCompare(school.id));
    card.querySelectorAll('[data-tag-filter]').forEach(tagEl => {
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const tagVal = tagEl.getAttribute('data-tag-filter');
        const tagSelect = document.getElementById('tag-select');
        if (tagSelect) {
          tagSelect.value = tagVal;
          loadSchools();
        }
      });
    });

    if (currentPermissions.includes('admin:edit')) {
      const editBtn = card.querySelector('.btn-edit-trigger');
      const delBtn = card.querySelector('.btn-delete-trigger');
      if (editBtn) editBtn.addEventListener('click', () => openEditModal(school.id));
      if (delBtn) delBtn.addEventListener('click', () => deleteSchool(school.id));
    }

    cardsContainer.appendChild(card);


    // Type Icon Badge
    let typeIcon = '<i class="fa-solid fa-school" style="color: #64748b;"></i>';
    let typeTitle = school.schoolType || 'School';
    if (typeTitle.includes('Independent')) {
      typeIcon = '<i class="fa-solid fa-building-columns" style="color: #7c3aed;"></i>';
    } else if (typeTitle.includes('Grammar')) {
      typeIcon = '<i class="fa-solid fa-award" style="color: #d97706;"></i>';
    } else if (typeTitle.includes('Academy') || typeTitle.includes('Free')) {
      typeIcon = '<i class="fa-solid fa-graduation-cap" style="color: #0284c7;"></i>';
    } else if (typeTitle.includes('Community') || typeTitle.includes('Voluntary') || typeTitle.includes('Foundation')) {
      typeIcon = '<i class="fa-solid fa-school" style="color: #16a34a;"></i>';
    }

    // Gender Icon Badge
    let genderIcon = '<i class="fa-solid fa-users" style="color: #0284c7;"></i>';
    let genderTitle = school.gender || 'Mixed';
    const gLower = genderTitle.toLowerCase();
    if (gLower.includes('girl')) {
      genderIcon = '<i class="fa-solid fa-venus" style="color: #ec4899;"></i>';
    } else if (gLower.includes('boy')) {
      genderIcon = '<i class="fa-solid fa-mars" style="color: #2563eb;"></i>';
    } else if (gLower.includes('mixed') || gLower.includes('co-ed')) {
      genderIcon = '<i class="fa-solid fa-venus-mars" style="color: #8b5cf6;"></i>';
    }

    // Truncate name to 25 characters for list view
    const fullName = school.name || '';
    const displayName = fullName.length > 25 ? fullName.slice(0, 25).trim() + '…' : fullName;


    // Truncate Local Authority to 20 characters for list view
    const fullLA = school.la || '';
    const displayLA = fullLA.length > 20 ? fullLA.slice(0, 20).trim() + '…' : fullLA;

    // Table Row Element
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="nowrap-cell" title="${fullName.replace(/"/g, '&quot;')}">
        <div>
          <strong>${displayName}</strong>
          ${school.active === false ? `<span class="badge-closed" style="font-size:0.65rem; padding:0.08rem 0.35rem; margin-left:0.35rem; background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; border-radius:999px; font-weight:700; display:inline-flex; align-items:center; gap:0.15rem;"><i class="fa-solid fa-ban"></i>&nbsp;Closed</span>` : ''}
          ${school.hot ? `<span class="badge-hot" style="font-size:0.68rem; padding:0.1rem 0.4rem; margin-left:0.4rem; display:inline-flex;"><i class="fa-solid fa-fire"></i>&nbsp;Hot</span>` : ''}
        </div>
        ${tagBadgesHtml ? `<div style="display:flex; gap:0.25rem; flex-wrap:wrap; margin-top:0.25rem;">${tagBadgesHtml}</div>` : ''}
      </td>

      <td class="nowrap-cell" title="${fullLA.replace(/"/g, '&quot;')}">
        <div>${displayLA}</div>
        ${school.distanceMiles !== undefined ? `
          <div style="margin-top: 0.2rem;">
            <a href="${school.distanceDirectionsUrl || '#'}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; color: #047857; font-weight: 700; text-decoration: none;" title="Straight-line distance. Click for Google Maps directions.">
              <i class="fa-solid fa-route"></i> ${school.distanceFormatted || (school.distanceMiles + ' mi')}
            </a>
          </div>
        ` : ''}
      </td>

      <td class="nowrap-cell" style="text-align: center;" title="${typeTitle.replace(/"/g, '&quot;')}">
        <span style="font-size: 1.1rem; cursor: help;">${typeIcon}</span>
      </td>
      <td class="nowrap-cell" style="text-align: center;" title="${genderTitle.replace(/"/g, '&quot;')}">
        <span style="font-size: 1.1rem; cursor: help;">${genderIcon}</span>
      </td>
      <td class="nowrap-cell"><span class="badge-ofsted">${formatOfsted(school.ofstedRating)}</span></td>
      <td class="nowrap-cell" title="${(school.entranceExamType || '').replace(/"/g, '&quot;')}">${formatExam(school.entranceExamType)}</td>
      <td class="nowrap-cell">${school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined ? school.gcseAttainment8 : 'N/A'}</td>


      <td class="table-actions-cell nowrap-cell">
        <div style="display: flex; gap: 0.35rem; align-items: center;">
          <button class="btn btn-outline btn-tbl-detail" data-id="${school.id}" style="padding: 0.45rem; font-size: 0.85rem; color: #2563eb; border-color: #bfdbfe;" title="View Details">
            <i class="fa-solid fa-circle-info"></i>
          </button>
          <button class="btn ${isCompared ? 'btn-primary' : 'btn-outline'} btn-tbl-compare" data-id="${school.id}" style="padding: 0.45rem; font-size: 0.85rem;" title="${isCompared ? 'Remove from Compare' : 'Add to Compare'}">
            <i class="fa-solid ${isCompared ? 'fa-check' : 'fa-plus'}"></i>
          </button>
          ${currentPermissions.includes('admin:edit') ? `
            <button class="btn btn-outline btn-tbl-edit" data-id="${school.id}" style="padding: 0.45rem; font-size: 0.85rem; color: #7c3aed; border-color: #ddd6fe;" title="Edit Record">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn btn-outline btn-tbl-delete" data-id="${school.id}" style="padding: 0.45rem; font-size: 0.85rem; color: #ef4444; border-color: #fca5a5;" title="Delete Record">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : ''}
        </div>
      </td>
    `;

    // Attach safe event listeners for table row actions
    tr.querySelector('.btn-tbl-detail').addEventListener('click', () => openSchoolDetail(school.id));
    tr.querySelector('.btn-tbl-compare').addEventListener('click', () => toggleCompare(school.id));
    tr.querySelectorAll('[data-tag-filter]').forEach(tagEl => {
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const tagVal = tagEl.getAttribute('data-tag-filter');
        const tagSelect = document.getElementById('tag-select');
        if (tagSelect) {
          tagSelect.value = tagVal;
          loadSchools();
        }
      });
    });

    if (currentPermissions.includes('admin:edit')) {
      const editBtn = tr.querySelector('.btn-tbl-edit');
      const delBtn = tr.querySelector('.btn-tbl-delete');
      if (editBtn) editBtn.addEventListener('click', () => openEditModal(school.id));
      if (delBtn) delBtn.addEventListener('click', () => deleteSchool(school.id));
    }

    tableBody.appendChild(tr);

  });
}

// Setup Event Listeners
function setupEventListeners() {
  setupClassicSidebarToggle();

  // User account switcher listener
  const userAccSelect = document.getElementById('user-account-select');

  if (userAccSelect) {
    userAccSelect.addEventListener('change', async (e) => {
      currentUserAccount = e.target.value;
      await loadUserPortfolio(currentUserAccount);
      showToast(`Switched user account profile to ${e.target.options[e.target.selectedIndex].text}`, 'info');
    });
  }

  // Save portfolio button
  const savePortBtn = document.getElementById('save-portfolio-btn');
  if (savePortBtn) {
    savePortBtn.addEventListener('click', saveUserPortfolio);
  }

  // Save Recommendation Profile button (Classic Matchmaker Wizard)
  const saveRecProfileBtn = document.getElementById('btn-save-rec-profile');
  if (saveRecProfileBtn) {
    saveRecProfileBtn.addEventListener('click', saveUserRecProfile);
  }

  // Reset Recommendation Wizard button (Classic Matchmaker Wizard)
  const resetRecWizardBtn = document.getElementById('btn-reset-rec-wizard');
  if (resetRecWizardBtn) {
    resetRecWizardBtn.addEventListener('click', () => {
      const locInput = document.getElementById('rec-target-locations');
      if (locInput) locInput.value = '';
      const genderSelect = document.getElementById('rec-gender');
      if (genderSelect) genderSelect.value = 'NA';
      document.querySelectorAll('.rec-gender-chk').forEach(c => c.checked = (c.value === 'NA'));
      const abilitySelect = document.getElementById('rec-child-ability');
      if (abilitySelect) abilitySelect.value = 'NA';
      document.querySelectorAll('.rec-school-type-chk').forEach(c => c.checked = (c.value === 'NA'));
      
      const proxSlider = document.getElementById('rec-qual-prox-slider');
      if (proxSlider) proxSlider.value = 1;
      const acadSlider = document.getElementById('rec-qual-acad-slider');
      if (acadSlider) acadSlider.value = 2;
      const progSlider = document.getElementById('rec-qual-prog-slider');
      if (progSlider) progSlider.value = 2;

      updatePrioritySlidersUI();
      updateSchoolTypeDropdownLabel();
      updateGenderDropdownLabel();
      triggerAutoRecommend(0);
    });
  }

  // Priority Presets in Omni-Discovery Bar
  const presetAcadBtn = document.getElementById('btn-preset-academic');
  if (presetAcadBtn) {
    presetAcadBtn.addEventListener('click', () => {
      const p = document.getElementById('rec-qual-prox-slider'); if (p) p.value = 2;
      const a = document.getElementById('rec-qual-acad-slider'); if (a) a.value = 4;
      const pr = document.getElementById('rec-qual-prog-slider'); if (pr) pr.value = 2;
      const ab = document.getElementById('rec-child-ability'); if (ab) ab.value = 'top_class';
      updatePrioritySlidersUI();
      triggerAutoRecommend(0);
    });
  }

  const presetBalBtn = document.getElementById('btn-preset-balanced');
  if (presetBalBtn) {
    presetBalBtn.addEventListener('click', () => {
      const p = document.getElementById('rec-qual-prox-slider'); if (p) p.value = 3;
      const a = document.getElementById('rec-qual-acad-slider'); if (a) a.value = 2;
      const pr = document.getElementById('rec-qual-prog-slider'); if (pr) pr.value = 2;
      const ab = document.getElementById('rec-child-ability'); if (ab) ab.value = 'average';
      updatePrioritySlidersUI();
      triggerAutoRecommend(0);
    });
  }

  const presetGroBtn = document.getElementById('btn-preset-growth');
  if (presetGroBtn) {
    presetGroBtn.addEventListener('click', () => {
      const p = document.getElementById('rec-qual-prox-slider'); if (p) p.value = 2;
      const a = document.getElementById('rec-qual-acad-slider'); if (a) a.value = 2;
      const pr = document.getElementById('rec-qual-prog-slider'); if (pr) pr.value = 4;
      const ab = document.getElementById('rec-child-ability'); if (ab) ab.value = 'below_average';
      updatePrioritySlidersUI();
      triggerAutoRecommend(0);
    });
  }

  // Auto-recommend on text input change
  const locInputEl = document.getElementById('rec-target-locations');
  if (locInputEl) {
    locInputEl.addEventListener('input', () => triggerAutoRecommend(300));
    locInputEl.addEventListener('change', () => triggerAutoRecommend(0));
  }

  // Auto-recommend on ability profile change
  const abilitySelectEl = document.getElementById('rec-child-ability');
  if (abilitySelectEl) {
    abilitySelectEl.addEventListener('change', () => triggerAutoRecommend(0));
  }

  // Priority Sliders input & change listeners
  ['rec-qual-prox-slider', 'rec-qual-acad-slider', 'rec-qual-prog-slider'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        updatePrioritySlidersUI();
        triggerAutoRecommend(100);
      });
      el.addEventListener('change', () => {
        updatePrioritySlidersUI();
        triggerAutoRecommend(0);
      });
    }
  });

  // Priority Weights Dropdown toggle & interaction
  const prioDropdownBtn = document.getElementById('rec-priorities-btn');
  const prioDropdown = document.getElementById('rec-priorities-dropdown');
  const prioWrap = document.getElementById('rec-priorities-multiselect-wrap');

  if (prioDropdownBtn && prioDropdown) {
    prioDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = prioDropdown.style.display === 'none';
      prioDropdown.style.display = isHidden ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (prioWrap && !prioWrap.contains(e.target)) {
        prioDropdown.style.display = 'none';
      }
    });
  }

  // Target School Types Multi-Select Dropdown toggle & interaction
  const typeDropdownBtn = document.getElementById('rec-school-type-btn');
  const typeDropdown = document.getElementById('rec-school-type-dropdown');
  const typeWrap = document.getElementById('rec-school-type-multiselect-wrap');

  if (typeDropdownBtn && typeDropdown) {
    typeDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = typeDropdown.style.display === 'none';
      typeDropdown.style.display = isHidden ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (typeWrap && !typeWrap.contains(e.target)) {
        typeDropdown.style.display = 'none';
      }
    });

    document.querySelectorAll('.rec-school-type-chk').forEach(chk => {
      chk.addEventListener('change', (e) => {
        if (e.target.value === 'NA' && e.target.checked) {
          document.querySelectorAll('.rec-school-type-chk').forEach(c => {
            if (c.value !== 'NA') c.checked = false;
          });
        } else if (e.target.value !== 'NA' && e.target.checked) {
          const naChk = document.querySelector('.rec-school-type-chk[value="NA"]');
          if (naChk) naChk.checked = false;
        }

        const checkedTypes = Array.from(document.querySelectorAll('.rec-school-type-chk:checked'));
        if (checkedTypes.length === 0) {
          const naChk = document.querySelector('.rec-school-type-chk[value="NA"]');
          if (naChk) naChk.checked = true;
        }

        updateSchoolTypeDropdownLabel();
        triggerAutoRecommend(50);
      });
    });
  }

  // Gender Multi-Select Dropdown toggle & interaction
  const genderDropdownBtn = document.getElementById('rec-gender-btn');
  const genderDropdown = document.getElementById('rec-gender-dropdown');
  const genderWrap = document.getElementById('rec-gender-multiselect-wrap');

  if (genderDropdownBtn && genderDropdown) {
    genderDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = genderDropdown.style.display === 'none';
      genderDropdown.style.display = isHidden ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (genderWrap && !genderWrap.contains(e.target)) {
        genderDropdown.style.display = 'none';
      }
    });

    document.querySelectorAll('.rec-gender-chk').forEach(chk => {
      chk.addEventListener('change', (e) => {
        if (e.target.value === 'NA' && e.target.checked) {
          document.querySelectorAll('.rec-gender-chk').forEach(c => {
            if (c.value !== 'NA') c.checked = false;
          });
        } else if (e.target.value !== 'NA' && e.target.checked) {
          const naChk = document.querySelector('.rec-gender-chk[value="NA"]');
          if (naChk) naChk.checked = false;
        }

        const checkedGenders = Array.from(document.querySelectorAll('.rec-gender-chk:checked'));
        if (checkedGenders.length === 0) {
          const naChk = document.querySelector('.rec-gender-chk[value="NA"]');
          if (naChk) naChk.checked = true;
        }

        updateGenderDropdownLabel();
        triggerAutoRecommend(50);
      });
    });
  }

  // Refresh Admin Field Error Audit button
  const refreshReportsBtn = document.getElementById('refresh-field-reports-btn');
  if (refreshReportsBtn) {
    refreshReportsBtn.addEventListener('click', loadAdminFieldReports);
  }

  const startWebScannerBtn = document.getElementById('btn-start-web-scanner');
  if (startWebScannerBtn) {
    startWebScannerBtn.addEventListener('click', startWebVerificationScan);
  }

  const stopWebScannerBtn = document.getElementById('btn-stop-web-scanner');
  if (stopWebScannerBtn) {
    stopWebScannerBtn.addEventListener('click', stopWebVerificationScan);
  }

  const runFullEnrichmentBtn = document.getElementById('btn-run-full-enrichment');
  if (runFullEnrichmentBtn) {
    runFullEnrichmentBtn.addEventListener('click', openEnrichmentPreviewModal);
  }

  // Enrichment Preview Modal Controls
  const closeEnrichmentPreviewBtn = document.getElementById('btn-close-enrichment-preview');
  if (closeEnrichmentPreviewBtn) {
    closeEnrichmentPreviewBtn.addEventListener('click', closeEnrichmentPreviewModal);
  }

  const rejectAllEnrichmentBtn = document.getElementById('btn-reject-all-enrichment');
  if (rejectAllEnrichmentBtn) {
    rejectAllEnrichmentBtn.addEventListener('click', closeEnrichmentPreviewModal);
  }

  const acceptAllEnrichmentBtn = document.getElementById('btn-accept-all-enrichment');
  if (acceptAllEnrichmentBtn) {
    acceptAllEnrichmentBtn.addEventListener('click', acceptAllEnrichmentChanges);
  }

  const commitSelectedEnrichmentBtn = document.getElementById('btn-commit-selected-enrichment');
  if (commitSelectedEnrichmentBtn) {
    commitSelectedEnrichmentBtn.addEventListener('click', commitSelectedEnrichmentChanges);
  }

  // Apply Verified Fixes Modal Controls
  const closeApplyFixModalBtn = document.getElementById('btn-close-apply-fix-modal');
  if (closeApplyFixModalBtn) {
    closeApplyFixModalBtn.addEventListener('click', closeApplyVerifiedFixModal);
  }
  const cancelApplyFixBtn = document.getElementById('btn-cancel-apply-fix');
  if (cancelApplyFixBtn) {
    cancelApplyFixBtn.addEventListener('click', closeApplyVerifiedFixModal);
  }
  const confirmApplyFixBtn = document.getElementById('btn-confirm-apply-fix');
  if (confirmApplyFixBtn) {
    confirmApplyFixBtn.addEventListener('click', handleConfirmApplyVerifiedFix);
  }
  const applyFixModal = document.getElementById('apply-verified-fix-modal');
  if (applyFixModal) {
    applyFixModal.addEventListener('click', (e) => {
      if (e.target === applyFixModal) closeApplyVerifiedFixModal();
    });
  }

  const filterPreviewSearch = document.getElementById('filter-preview-search');
  if (filterPreviewSearch) {
    filterPreviewSearch.addEventListener('input', () => {
      renderEnrichmentPreviewCards();
    });
  }

  const filterPreviewCategory = document.getElementById('filter-preview-category');
  if (filterPreviewCategory) {
    filterPreviewCategory.addEventListener('change', () => {
      renderEnrichmentPreviewCards();
    });
  }

  const toggleSelectAllPreview = document.getElementById('toggle-select-all-preview');
  if (toggleSelectAllPreview) {
    toggleSelectAllPreview.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      const visibleCheckboxes = document.querySelectorAll('.preview-school-checkbox');
      visibleCheckboxes.forEach(cb => {
        cb.checked = isChecked;
        const sId = cb.getAttribute('data-school-id');
        if (isChecked) selectedEnrichmentIds.add(sId);
        else selectedEnrichmentIds.delete(sId);
      });
      updateSelectedEnrichmentCount();
    });
  }

  // Field Custom Override Form Submit
  const overrideForm = document.getElementById('field-override-form');
  if (overrideForm) {
    overrideForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sId = document.getElementById('override-school-id').value;
      const fName = document.getElementById('override-field-name').value;
      const origVal = document.getElementById('override-original-val').value;
      const customVal = document.getElementById('override-custom-value-input').value.trim();

      if (!customVal) return;

      try {
        const res = await fetch('/api/user-reports', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
          },
          body: JSON.stringify({
            schoolId: sId,
            fieldName: fName,
            status: 'down',
            originalValue: origVal,
            customValue: customVal
          })
        });

        if (res.ok) {
          document.getElementById('field-override-modal').style.display = 'none';
          showToast('Updated custom field value in your personal records!', 'success');
          openSchoolDetail(sId);
        } else {
          showToast('Failed to save custom value', 'error');
        }
      } catch (err) {
        showToast('Error saving custom value', 'error');
      }
    });
  }

  const overrideClose = document.getElementById('override-modal-close');
  const overrideCancel = document.getElementById('override-modal-cancel');
  const hideOverrideModal = () => {
    const modal = document.getElementById('field-override-modal');
    if (modal) modal.style.display = 'none';
  };

  if (overrideClose) overrideClose.onclick = hideOverrideModal;
  if (overrideCancel) overrideCancel.onclick = hideOverrideModal;

  // Header Logout Button
  const logoutBtn = document.getElementById('auth-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logoutSession);
  }

  // Header Open Login Button
  const openLoginBtn = document.getElementById('auth-login-btn');
  if (openLoginBtn) {
    openLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLoginModal(e);
    });
  }

  // Gatekeeper Close Button
  const gatekeeperCloseBtn = document.getElementById('gatekeeper-close-btn');
  if (gatekeeperCloseBtn) {
    gatekeeperCloseBtn.addEventListener('click', () => {
      const overlay = document.getElementById('auth-gatekeeper-overlay');
      if (overlay) overlay.style.display = 'none';
    });
  }

  // --- Google OAuth / SSO Handler ---
  const btnGoogleSso = document.getElementById('btn-google-sso');
  const googleSsoModal = document.getElementById('google-sso-modal');
  const googleSsoForm = document.getElementById('google-sso-form');
  const closeGoogleModalBtn = document.getElementById('modal-close-google-sso');
  const cancelGoogleModalBtn = document.getElementById('modal-cancel-google-sso');

  const hideGoogleSsoModal = () => {
    if (googleSsoModal) googleSsoModal.style.display = 'none';
  };

  if (btnGoogleSso) {
    btnGoogleSso.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerGoogleSignInWorkflow();
    });
  }

  if (closeGoogleModalBtn) closeGoogleModalBtn.addEventListener('click', hideGoogleSsoModal);
  if (cancelGoogleModalBtn) cancelGoogleModalBtn.addEventListener('click', hideGoogleSsoModal);

  if (googleSsoForm) {
    googleSsoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailVal = document.getElementById('google-sso-email-input').value.trim();
      const nameVal = document.getElementById('google-sso-name-input').value.trim();

      if (!emailVal) {
        showToast('Please enter a valid Google Account email', 'error');
        return;
      }

      hideGoogleSsoModal();
      showToast(`Authenticating Google Account (${emailVal})...`, 'info');

      try {
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: emailVal,
            name: nameVal,
            googleId: `google-${Date.now()}`
          })
        });

        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Google authentication failed', 'error');
          return;
        }

        await setAuthenticatedSession(data, `Welcome ${data.user.name}! Authenticated with Google Account.`);
      } catch (err) {
        console.error('Google authentication error:', err);
        showToast('Google authentication request failed', 'error');
      }
    });
  }

  // Gatekeeper Quick Demo Profile Select Handler
  const gatekeeperDemoSelect = document.getElementById('gatekeeper-demo-select');
  if (gatekeeperDemoSelect) {
    gatekeeperDemoSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      const [email, role] = val.split('|');
      const emailInput = document.getElementById('gatekeeper-email');
      const passInput = document.getElementById('gatekeeper-password');
      if (emailInput) emailInput.value = email;
      if (passInput) passInput.value = role === 'admin' ? 'admin' : 'user';
    });
  }

  // Gatekeeper Form Submit Handler
  const gatekeeperForm = document.getElementById('gatekeeper-login-form');
  if (gatekeeperForm) {
    gatekeeperForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('gatekeeper-email').value.trim();
      const password = document.getElementById('gatekeeper-password').value;

      let data;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Invalid email or password', 'error');
          return;
        }
      } catch (err) {
        console.error('Gatekeeper login network error:', err);
        showToast('Login request failed', 'error');
        return;
      }

      try {
        await setAuthenticatedSession(data, `Logged in successfully as ${data.user.name}!`);
      } catch (uiErr) {
        console.error('Post-login UI initialization error:', uiErr);
      }
    });
  }

  // Modal Cancel / Close Triggers

  const closeLoginBtn = document.getElementById('modal-close-login');
  const cancelLoginBtn = document.getElementById('modal-cancel-login');
  const handleCloseLogin = () => {
    const loginModal = document.getElementById('auth-login-modal');
    if (loginModal) loginModal.style.display = 'none';
    if (!currentUserAccount) {
      showGatekeeperLoginScreen();
    }
  };
  if (closeLoginBtn) closeLoginBtn.addEventListener('click', handleCloseLogin);
  if (cancelLoginBtn) cancelLoginBtn.addEventListener('click', handleCloseLogin);

  // Auth Modals & Triggers
  const loginModal = document.getElementById('auth-login-modal');
  const signupModal = document.getElementById('auth-signup-modal');

  // Quick Demo Account Select Handler in Modal
  const quickDemoSelect = document.getElementById('quick-demo-account-select');
  if (quickDemoSelect) {
    quickDemoSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      if (!val) return;
      const [email, role] = val.split('|');
      const emailEl = document.getElementById('login-email');
      const passEl = document.getElementById('login-password');
      if (emailEl) emailEl.value = email;
      if (passEl) passEl.value = role === 'admin' ? 'admin' : 'user';
    });
  }

  // Login Form Submit Handler
  const loginForm = document.getElementById('auth-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      let data;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Invalid email or password', 'error');
          return;
        }
      } catch (err) {
        console.error('Login network error:', err);
        showToast('Login request failed', 'error');
        return;
      }

      try {
        await setAuthenticatedSession(data, `Logged in successfully as ${data.user.name}!`);
      } catch (uiErr) {
        console.error('Post-login UI initialization error:', uiErr);
      }
    });
  }

  // Signup Form Submit Handler
  const signupForm = document.getElementById('auth-signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameEl = document.getElementById('signup-name');
      const emailEl = document.getElementById('signup-email');
      const passwordEl = document.getElementById('signup-password');

      if (!nameEl || !emailEl || !passwordEl) return;

      const name = nameEl.value.trim();
      const email = emailEl.value.trim();
      const password = passwordEl.value;

      let data;
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });
        data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Registration failed', 'error');
          return;
        }
      } catch (err) {
        console.error('Signup network error:', err);
        showToast('Signup request failed', 'error');
        return;
      }

      try {
        if (signupModal) signupModal.style.display = 'none';
        await setAuthenticatedSession(data, `Welcome ${data.user.name}! Account created.`);
      } catch (uiErr) {
        console.error('Post-signup UI initialization error:', uiErr);
      }
    });
  }




  // Nav Tab Buttons
  if (document.getElementById('tab-parent2-btn')) document.getElementById('tab-parent2-btn').addEventListener('click', () => switchTab('parent2'));
  if (document.getElementById('tab-recommend-btn')) document.getElementById('tab-recommend-btn').addEventListener('click', () => switchTab('recommend'));
  if (document.getElementById('tab-directory-btn')) document.getElementById('tab-directory-btn').addEventListener('click', () => switchTab('directory'));
  if (document.getElementById('tab-admin-btn')) document.getElementById('tab-admin-btn').addEventListener('click', () => switchTab('admin'));

  // Parent Portal 2.0 Sub-navigation and Wizard Listeners
  setupParent2EventListeners();

  // Admin Side Tabs Navigation Buttons
  document.querySelectorAll('.admin-side-tab[data-target-tab]').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.getAttribute('data-target-tab');
      if (target) switchAdminSubTab(target);
    });
  });

  // Admin Sidebar Collapse Toggle
  initAdminSidebarCollapse();

  // Classic Portal Side Tabs Navigation Buttons
  document.querySelectorAll('.classic-side-tab[data-target-classic-tab]').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.getAttribute('data-target-classic-tab');
      if (target) switchClassicSubTab(target);
    });
  });

  // Bulk Edit Event Listeners
  const bulkSearchInput = document.getElementById('bulk-search-input');
  if (bulkSearchInput) bulkSearchInput.addEventListener('input', debounce(renderBulkEditTable, 200));

  const bulkFilters = ['bulk-la-filter', 'bulk-type-filter', 'bulk-ofsted-filter'];
  bulkFilters.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderBulkEditTable);
  });

  const bulkResetFilterBtn = document.getElementById('bulk-reset-filter-btn');
  if (bulkResetFilterBtn) {
    bulkResetFilterBtn.addEventListener('click', () => {
      if (bulkSearchInput) bulkSearchInput.value = '';
      bulkFilters.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      renderBulkEditTable();
    });
  }

  const bulkSelectAllBtn = document.getElementById('bulk-select-all-filtered-btn');
  if (bulkSelectAllBtn) {
    bulkSelectAllBtn.addEventListener('click', () => {
      bulkFilteredSchools.forEach(s => bulkSelectedSchoolIds.add(s.id));
      renderBulkEditTable();
    });
  }

  const bulkDeselectAllBtn = document.getElementById('bulk-deselect-all-btn');
  if (bulkDeselectAllBtn) {
    bulkDeselectAllBtn.addEventListener('click', () => {
      bulkSelectedSchoolIds.clear();
      renderBulkEditTable();
    });
  }

  const bulkInvertBtn = document.getElementById('bulk-invert-selection-btn');
  if (bulkInvertBtn) {
    bulkInvertBtn.addEventListener('click', () => {
      bulkFilteredSchools.forEach(s => {
        if (bulkSelectedSchoolIds.has(s.id)) {
          bulkSelectedSchoolIds.delete(s.id);
        } else {
          bulkSelectedSchoolIds.add(s.id);
        }
      });
      renderBulkEditTable();
    });
  }

  const bulkMasterCheckbox = document.getElementById('bulk-master-checkbox');
  if (bulkMasterCheckbox) {
    bulkMasterCheckbox.addEventListener('change', (e) => {
      const visible = bulkFilteredSchools.slice(0, 250);
      if (e.target.checked) {
        visible.forEach(s => bulkSelectedSchoolIds.add(s.id));
      } else {
        visible.forEach(s => bulkSelectedSchoolIds.delete(s.id));
      }
      renderBulkEditTable();
    });
  }

  const bulkFieldSelect = document.getElementById('bulk-field-select');
  if (bulkFieldSelect) {
    bulkFieldSelect.addEventListener('change', (e) => {
      updateBulkValueInput(e.target.value);
    });
  }

  const applyBulkBtn = document.getElementById('btn-apply-bulk-edit');
  if (applyBulkBtn) {
    applyBulkBtn.addEventListener('click', executeBulkUpdate);
  }

  // Live Weight Sliders
  const weightIds = ['location', 'exam', 'academic', 'ofsted', 'type'];
  weightIds.forEach(key => {
    const slider = document.getElementById(`weight-${key}`);
    const label = document.getElementById(`weight-val-${key}`);
    if (slider && label) {
      slider.addEventListener('input', () => {
        label.textContent = `${slider.value}%`;
        updateTotalWeightsPill();
      });
    }
  });

  // Recommendation Event Handlers
  setupRecAutocomplete();
  const locInput = document.getElementById('rec-location-input');
  if (locInput) locInput.addEventListener('input', debounce(fetchRecommendations, 300));

  // Gender filter listeners
  document.querySelectorAll('input[name="rec-gender"]').forEach(radio => {
    radio.addEventListener('change', fetchRecommendations);
  });
  const includeCoedCheck = document.getElementById('rec-include-coed');
  if (includeCoedCheck) includeCoedCheck.addEventListener('change', fetchRecommendations);

  const refreshRecBtn = document.getElementById('refresh-rec-btn');
  if (refreshRecBtn) refreshRecBtn.addEventListener('click', fetchRecommendations);

  const finishSelBtn = document.getElementById('btn-finish-selection');
  if (finishSelBtn) finishSelBtn.addEventListener('click', () => switchClassicSubTab('shortlist'));

  const viewDashTopBtn = document.getElementById('btn-view-dashboard-top');
  if (viewDashTopBtn) viewDashTopBtn.addEventListener('click', () => switchClassicSubTab('shortlist'));

  const backRecBtn = document.getElementById('btn-back-to-rec');
  if (backRecBtn) backRecBtn.addEventListener('click', () => switchClassicSubTab('find'));

  const weightsForm = document.getElementById('rec-weights-form');
  if (weightsForm) weightsForm.addEventListener('submit', saveRecWeights);

  const btnRunLiveSearch = document.getElementById('btn-run-live-llm-search');
  if (btnRunLiveSearch) {
    btnRunLiveSearch.addEventListener('click', runLiveLlmSearchHandler);
  }

  const inputLiveQuery = document.getElementById('llm-live-school-query');
  if (inputLiveQuery) {
    inputLiveQuery.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runLiveLlmSearchHandler();
      }
    });
  }

  const btnApplyLiveSearch = document.getElementById('btn-apply-live-search-school');
  if (btnApplyLiveSearch) {
    btnApplyLiveSearch.addEventListener('click', applyLiveSearchResultHandler);
  }

  // LLM live search result inspector tab switcher
  document.querySelectorAll('.btn-llm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      document.querySelectorAll('.btn-llm-tab').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = '#64748b';
        b.style.fontWeight = '600';
      });
      btn.classList.add('active');
      btn.style.background = '#ede9fe';
      btn.style.color = '#6d28d9';
      btn.style.fontWeight = '700';

      document.querySelectorAll('.llm-tab-pane').forEach(pane => {
        pane.style.display = 'none';
      });
      const activePane = document.getElementById(targetId);
      if (activePane) activePane.style.display = 'block';
    });
  });

  const btnTestLlmCrawlSingle = document.getElementById('btn-test-llm-crawl-single');
  if (btnTestLlmCrawlSingle) {
    btnTestLlmCrawlSingle.addEventListener('click', testLlmCrawlSingleHandler);
  }

  // Database Instance Controls
  const btnSelectProdDb = document.getElementById('btn-select-prod-db');
  if (btnSelectProdDb) {
    btnSelectProdDb.addEventListener('click', () => switchDatabaseInstance('production'));
  }

  const btnSelectTestDb = document.getElementById('btn-select-test-db');
  if (btnSelectTestDb) {
    btnSelectTestDb.addEventListener('click', () => switchDatabaseInstance('test'));
  }

  const btnBannerSwitchProd = document.getElementById('btn-banner-switch-prod');
  if (btnBannerSwitchProd) {
    btnBannerSwitchProd.addEventListener('click', () => switchDatabaseInstance('production'));
  }



  const filterInputs = [
    'search-input', 'tag-select', 'region-select', 'la-select', 'hot-select',
    'type-select', 'gender-select', 'ofsted-select', 'exam-select',
    'second-stage-select', 'confidence-select', 'fee-select',
    'filter-user-postcode', 'filter-max-distance'
  ];
  filterInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadSchools);
  });

  const searchInputEl = document.getElementById('search-input');
  if (searchInputEl) {
    searchInputEl.addEventListener('input', debounce(loadSchools, 300));
  }

  const userPostcodeEl = document.getElementById('filter-user-postcode');
  if (userPostcodeEl) {
    const savedPc = localStorage.getItem('user_home_postcode');
    if (savedPc && !userPostcodeEl.value) {
      userPostcodeEl.value = savedPc;
    }
    userPostcodeEl.addEventListener('input', debounce(() => {
      if (userPostcodeEl.value.trim().length >= 2 || userPostcodeEl.value.trim().length === 0) {
        loadSchools();
      }
    }, 500));
  }

  // Reset Filters
  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      try { localStorage.removeItem('user_home_postcode'); } catch (e) {}
      loadSchools();
    });
  }

  // View Toggles
  document.getElementById('view-cards-btn').addEventListener('click', () => {
    currentViewMode = 'cards';
    document.getElementById('view-cards-btn').classList.add('active');
    document.getElementById('view-table-btn').classList.remove('active');
    document.getElementById('schools-container').style.display = 'grid';
    document.getElementById('schools-table-container').style.display = 'none';
  });

  document.getElementById('view-table-btn').addEventListener('click', () => {
    currentViewMode = 'table';
    document.getElementById('view-table-btn').classList.add('active');
    document.getElementById('view-cards-btn').classList.remove('active');
    document.getElementById('schools-container').style.display = 'none';
    document.getElementById('schools-table-container').style.display = 'block';
  });

  // Add School Modal Trigger
  document.querySelectorAll('.add-school-btn-trigger, #add-school-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openAddModal();
    });
  });
  document.getElementById('modal-close-add').addEventListener('click', () => {
    document.getElementById('add-modal').style.display = 'none';
  });
  document.getElementById('modal-cancel-add').addEventListener('click', () => {
    document.getElementById('add-modal').style.display = 'none';
  });

  // Detail Modal Close
  document.getElementById('modal-close-detail').addEventListener('click', () => {
    document.getElementById('detail-modal').style.display = 'none';
  });

  // Compare Modal Trigger & Close
  const compareBarBtn = document.getElementById('compare-bar-btn');
  if (compareBarBtn) compareBarBtn.addEventListener('click', openCompareModal);

  const modalCloseCompare = document.getElementById('modal-close-compare');
  if (modalCloseCompare) {
    modalCloseCompare.addEventListener('click', () => {
      const compareModal = document.getElementById('compare-modal');
      if (compareModal) compareModal.style.display = 'none';
    });
  }

  // Add / Edit School Form Submit Handler
  document.getElementById('add-school-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('edit-school-id').value;

    const schoolPayload = {
      name: document.getElementById('add-name').value,
      urn: document.getElementById('add-urn').value,
      la: document.getElementById('add-la').value,
      region: document.getElementById('add-region').value,
      address: document.getElementById('add-address').value,
      postcode: document.getElementById('add-postcode').value,
      schoolType: document.getElementById('add-type').value,
      active: document.getElementById('add-active') ? (document.getElementById('add-active').value === 'true') : true,
      gender: document.getElementById('add-gender').value,
      ageRange: document.getElementById('add-age-range').value,
      pupilCount: document.getElementById('add-pupils').value ? parseInt(document.getElementById('add-pupils').value, 10) : 0,
      ofstedRating: document.getElementById('add-ofsted').value,
      gcseProgress8: document.getElementById('add-progress8').value !== '' ? parseFloat(document.getElementById('add-progress8').value) : null,
      gcseAttainment8: document.getElementById('add-attainment8').value !== '' ? parseFloat(document.getElementById('add-attainment8').value) : null,
      ebaccAveragePointScore: document.getElementById('add-ebacc').value !== '' ? parseFloat(document.getElementById('add-ebacc').value) : null,
      entranceExamType: document.getElementById('add-exam-type').value,
      entranceExamDates: {
        registrationOpen: document.getElementById('add-exam-reg-open').value || 'TBC',
        registrationDeadline: document.getElementById('add-exam-reg-deadline').value || 'TBC',
        examDate: document.getElementById('add-exam-date').value || 'TBC',
        secondExamDate: document.getElementById('add-exam-second-date').value || 'TBC',
        resultsDate: document.getElementById('add-exam-results-date').value || 'TBC',
        interviewInfo: document.getElementById('add-exam-interview').value || '',
        openEvents: document.getElementById('add-exam-open-events').value || '',
        scholarships: document.getElementById('add-exam-scholarships').value || ''
      },
      gcseSubjects: document.getElementById('add-subjects').value,
      admissionsPolicy: document.getElementById('add-policy').value,
      description: document.getElementById('add-description').value,
      phone: document.getElementById('add-phone').value,
      email: document.getElementById('add-email').value,
      website: document.getElementById('add-website').value,
      hot: document.getElementById('add-hot').checked,
      official: document.getElementById('add-official').checked
    };

    try {
      const isEdit = Boolean(editId);
      const url = isEdit ? `/api/schools/${editId}` : '/api/schools';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schoolPayload)
      });

      if (res.ok) {
        document.getElementById('add-modal').style.display = 'none';
        document.getElementById('add-school-form').reset();
        document.getElementById('edit-school-id').value = '';
        await fetchStats();
        await loadSchools();
        showToast(isEdit ? 'School record updated successfully!' : 'New school record created!', 'success');
      } else {
        const errData = await res.json();
        showToast('Operation failed: ' + (errData.error || 'Server error'), 'error');
      }
    } catch (err) {
      console.error('Error saving school record:', err);
      showToast('Failed to save school record.', 'error');
    }
  });


// Client-side Blob download trigger function to guarantee file saving on local filesystem
async function triggerDownload(event, url, defaultFilename) {
  event.preventDefault();
  try {
    showToast(`Preparing ${defaultFilename} for download...`, 'info', 2000);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    }, 200);

    showToast(`Downloaded ${defaultFilename} successfully to your local filesystem!`, 'success');
  } catch (err) {
    console.error('Download failed:', err);
    showToast(`Failed to download file: ${err.message}`, 'error');
  }
}

// ==========================================================
// MERGE & DE-DUPLICATE SCANNER (DB-Wide)
// ==========================================================

// Context for the currently open DB-wide merge modal
let dbMergeTarget = null;

// Field definitions for comparison and merge
const MERGE_FIELDS = [
  { key: 'name',                        label: 'School Name' },
  { key: 'urn',                         label: 'URN Number' },
  { key: 'hot',                         label: 'Hot School Status', format: v => v === true ? '🔥 Hot School' : '— Standard' },
  { key: 'official',                    label: 'Official DfE Record', format: v => v === true ? '✅ Yes (DfE GIAS)' : '❌ No (unofficial)' },
  { key: 'compareSchoolPerformanceUrl', label: 'Gov Performance Link', format: v => v ? `<a href="${v}" target="_blank" style="color:#059669; text-decoration:underline; font-size:0.8em;">View ↗</a>` : '—' },

  { key: 'la',                          label: 'Local Authority' },
  { key: 'postcode',                    label: 'Postcode' },
  { key: 'address',                     label: 'Address' },
  { key: 'schoolType',                  label: 'School Type' },
  { key: 'gender',                      label: 'Gender' },
  { key: 'ageRange',                    label: 'Age Range' },
  { key: 'pupilCount',                  label: 'Pupil Count' },
  { key: 'ofstedRating',                label: 'Ofsted Rating' },
  { key: 'gcseAttainment8',             label: 'Attainment 8' },
  { key: 'gcseProgress8',               label: 'Progress 8' },
  { key: 'entranceExamType',            label: 'Entrance Exam Type' },
  { key: 'gcseSubjects',                label: 'GCSE Subjects', format: v => Array.isArray(v) ? v.join(', ') : (v || '') },
  { key: 'admissionsPolicy',            label: 'Admissions Policy' },
  { key: 'website',                     label: 'Website' },
  { key: 'phone',                       label: 'Phone' },
  { key: 'email',                       label: 'Email' },
  { key: 'description',                 label: 'Description' }
];


// Run DB-wide duplicate scan
async function runDedupScan() {
  const loadingEl    = document.getElementById('dedup-loading');
  const resultsEl    = document.getElementById('dedup-scan-results');
  const summaryEl    = document.getElementById('dedup-scan-summary');
  const pairsEl      = document.getElementById('dedup-pairs-container');
  const emptyEl      = document.getElementById('dedup-empty-state');
  const pairCountEl  = document.getElementById('dedup-pair-count');
  const totalCountEl = document.getElementById('dedup-total-count');

  // Show loading
  loadingEl.style.display  = 'block';
  resultsEl.style.display  = 'none';
  summaryEl.style.display  = 'none';

  try {
    const res  = await fetch('/api/admin/scan-duplicates');
    const data = await res.json();

    loadingEl.style.display = 'none';
    summaryEl.style.display = 'flex';
    resultsEl.style.display = 'block';

    pairCountEl.textContent  = data.pairsFound;
    totalCountEl.textContent = data.totalScanned;

    pairsEl.innerHTML = '';

    if (data.pairsFound === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    data.pairs.forEach((pair, idx) => {
      const pairEl = document.createElement('div');
      pairEl.className = 'dedup-pair-card';
      pairEl.dataset.pairIdx = idx;

      // Calculate how many fields differ
      const diffCount = MERGE_FIELDS.filter(f => {
        const va = f.format ? f.format(pair.recordA[f.key]) : String(pair.recordA[f.key] ?? '');
        const vb = f.format ? f.format(pair.recordB[f.key]) : String(pair.recordB[f.key] ?? '');
        return va.trim().toLowerCase() !== vb.trim().toLowerCase();
      }).length;

      const matchColor = pair.similarity === 1 ? '#dc2626' : pair.similarity >= 0.9 ? '#ea580c' : '#d97706';

      // --- Header ---
      const headerEl = document.createElement('div');
      headerEl.className = 'dedup-pair-header';

      const leftEl = document.createElement('div');
      leftEl.style.cssText = 'display:flex; align-items:center; gap:0.75rem; flex:1; min-width:0;';

      const badge = document.createElement('span');
      badge.className = 'dedup-match-badge';
      badge.style.cssText = `background:${matchColor}20; color:${matchColor}; border:1px solid ${matchColor}40;`;
      badge.innerHTML = `<i class="fa-solid fa-link"></i> ${pair.matchType} — ${Math.round(pair.similarity * 100)}%`;

      const nameWrap = document.createElement('div');
      nameWrap.style.minWidth = '0';
      nameWrap.innerHTML = `
        <div style="font-weight:700; font-size:0.95rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${pair.recordA.name.replace(/"/g, '&quot;')}">
          ${pair.recordA.name}
        </div>
        <div style="font-size:0.78rem; color:#64748b; margin-top:0.1rem;">
          vs. <span style="color:#7c3aed; font-weight:600;">${pair.recordB.name}</span>
          &nbsp;·&nbsp; ${diffCount} field${diffCount !== 1 ? 's' : ''} differ
        </div>`;

      leftEl.appendChild(badge);
      leftEl.appendChild(nameWrap);

      // --- Right side: Mark Reviewed button + Merge button + Chevron ---
      const rightEl = document.createElement('div');
      rightEl.style.cssText = 'display:flex; align-items:center; gap:0.5rem; flex-shrink:0;';

      const reviewBtn = document.createElement('button');
      reviewBtn.className = 'btn btn-outline';
      reviewBtn.style.cssText = 'font-size:0.78rem; padding:0.35rem 0.75rem; color:#059669; border-color:#a7f3d0; background:#ecfdf5;';
      reviewBtn.innerHTML = '<i class="fa-solid fa-check"></i> Mark Reviewed';
      reviewBtn.title = 'Mark pair as reviewed (not a duplicate) so it won\'t appear in future scans';
      reviewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        markPairReviewed(pair.recordA.id, pair.recordB.id, pair.recordA.name, pair.recordB.name);
      });

      const mergeBtn = document.createElement('button');
      mergeBtn.className = 'btn btn-primary';
      mergeBtn.style.cssText = 'font-size:0.78rem; padding:0.35rem 0.8rem; background:#7c3aed; border-color:#7c3aed;';
      mergeBtn.innerHTML = '<i class="fa-solid fa-code-merge"></i> Merge';
      mergeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDbMergeModal(idx, pair.recordA.id, pair.recordB.id);
      });

      const chevron = document.createElement('i');
      chevron.className = 'fa-solid fa-chevron-down dedup-chevron';
      chevron.id = `dedup-chevron-${idx}`;

      rightEl.appendChild(reviewBtn);
      rightEl.appendChild(mergeBtn);
      rightEl.appendChild(chevron);

      headerEl.appendChild(leftEl);
      headerEl.appendChild(rightEl);

      // Toggle expand/collapse on header click
      headerEl.addEventListener('click', () => toggleDedupPair(idx));

      // --- Body (collapsed by default) ---
      const bodyEl = document.createElement('div');
      bodyEl.className = 'dedup-pair-body';
      bodyEl.id = `dedup-body-${idx}`;
      bodyEl.style.display = 'none';
      bodyEl.innerHTML = renderDedupFieldTable(pair.recordA, pair.recordB);

      pairEl.appendChild(headerEl);
      pairEl.appendChild(bodyEl);
      pairsEl.appendChild(pairEl);
    });


    // Store pairs for merge modal access
    window._dedupPairs = data.pairs;
    showToast(`Scan complete — ${data.pairsFound} potential duplicate pair${data.pairsFound !== 1 ? 's' : ''} found across ${data.totalScanned} records.`,
      data.pairsFound > 0 ? 'warn' : 'success', 5000);

  } catch (err) {
    loadingEl.style.display = 'none';
    console.error('Scan failed:', err);
    showToast('Failed to run duplicate scan. Is the server running?', 'error');
  }
}

// Toggle collapse/expand of a duplicate pair row
function toggleDedupPair(idx) {
  const body    = document.getElementById(`dedup-body-${idx}`);
  const chevron = document.getElementById(`dedup-chevron-${idx}`);
  const isOpen  = body.style.display !== 'none';
  body.style.display    = isOpen ? 'none' : 'block';
  chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// Mark a duplicate pair as reviewed so it will not show in future scan results
async function markPairReviewed(idA, idB, nameA, nameB) {
  try {
    const res = await fetch('/api/admin/mark-reviewed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idA, idB })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Marked recommendation reviewed: ${nameA} vs ${nameB}. Pair will no longer appear as a duplicate.`, 'success', 5000);
      await runDedupScan();
    } else {
      showToast('Failed to mark pair as reviewed: ' + (data.error || 'Server error'), 'error');
    }
  } catch (err) {
    console.error('Error marking pair reviewed:', err);
    showToast('Error marking pair as reviewed.', 'error');
  }
}

// Render a mini field-comparison table inside the pair card
function renderDedupFieldTable(recA, recB) {
  let rows = '';
  MERGE_FIELDS.forEach(f => {
    const va = f.format ? f.format(recA[f.key]) : String(recA[f.key] ?? '');
    const vb = f.format ? f.format(recB[f.key]) : String(recB[f.key] ?? '');
    const match = va.trim().toLowerCase() === vb.trim().toLowerCase();

    rows += `
      <tr>
        <td class="merge-field-name">
          ${f.label}
          <div>${match
            ? '<span class="status-badge-match"><i class="fa-solid fa-check"></i> Match</span>'
            : '<span class="status-badge-diff"><i class="fa-solid fa-code-compare"></i> Conflict</span>'}</div>
        </td>
        <td class="merge-cell ${match ? 'same-cell' : 'diff-cell'}" style="font-size:0.85rem;">
          ${va || '<em style="color:#94a3b8">—</em>'}
        </td>
        <td class="merge-cell ${match ? 'same-cell' : 'diff-cell'}" style="font-size:0.85rem;">
          ${vb || '<em style="color:#94a3b8">—</em>'}
        </td>
      </tr>`;
  });

  return `
    <div style="overflow-x:auto; padding: 0.5rem 0 1rem 0;">
      <table class="merge-table" style="font-size:0.85rem;">
        <thead>
          <tr>
            <th>Field</th>
            <th style="color:#2563eb;">Record A (Primary)</th>
            <th style="color:#7c3aed;">Record B (Candidate)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Open merge modal for a DB-wide duplicate pair
function openDbMergeModal(pairIdx, idA, idB) {
  const pair = (window._dedupPairs || [])[pairIdx];
  if (!pair) { showToast('Pair data not found.', 'error'); return; }

  dbMergeTarget = { pairIdx, idA, idB, recA: pair.recordA, recB: pair.recordB };

  const { recordA: recA, recordB: recB } = pair;

  let rowsHtml = '';
  MERGE_FIELDS.forEach(f => {
    const va = f.format ? f.format(recA[f.key]) : String(recA[f.key] ?? '');
    const vb = f.format ? f.format(recB[f.key]) : String(recB[f.key] ?? '');
    const match = va.trim().toLowerCase() === vb.trim().toLowerCase();
    const cellClass = match ? 'same-cell' : 'diff-cell';

    // Escape values for safe use in HTML attributes
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    rowsHtml += `
      <tr>
        <td class="merge-field-name">
          ${f.label}
          <div>${match
            ? '<span class="status-badge-match"><i class="fa-solid fa-check"></i> Match</span>'
            : '<span class="status-badge-diff"><i class="fa-solid fa-code-compare"></i> Conflict</span>'}</div>
        </td>
        <td class="merge-cell ${cellClass}">
          <label class="merge-radio-label">
            <input type="radio" name="dbmerge_${f.key}" value="a" ${!va && vb ? '' : 'checked'}>
            <span>${esc(va) || '<em style="color:#94a3b8">—</em>'}</span>
          </label>
        </td>
        <td class="merge-cell ${cellClass}">
          <label class="merge-radio-label">
            <input type="radio" name="dbmerge_${f.key}" value="b" ${!va && vb ? 'checked' : ''}>
            <span>${esc(vb) || '<em style="color:#94a3b8">—</em>'}</span>
          </label>
        </td>
      </tr>`;
  });

  const contentDiv = document.getElementById('merge-modal-content');
  contentDiv.innerHTML = `
    <div style="margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
      <div style="font-size:0.83rem; color:#64748b;">
        <code style="background:#f1f5f9; padding:0.15rem 0.4rem; border-radius:4px;">${recA.id}</code> vs
        <code style="background:#f5f3ff; padding:0.15rem 0.4rem; border-radius:4px; color:#7c3aed;">${recB.id}</code>
        &nbsp;— Merged result saves under <strong>Record A</strong>. Record B will be deleted.
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button id="use-all-a-btn" class="btn btn-outline" style="font-size:0.78rem; padding:0.3rem 0.65rem;">
          <i class="fa-solid fa-a"></i> Use All A
        </button>
        <button id="use-all-b-btn" class="btn btn-outline" style="font-size:0.78rem; padding:0.3rem 0.65rem;">
          <i class="fa-solid fa-b"></i> Use All B
        </button>
      </div>
    </div>
    <div style="overflow-y:auto; max-height:55vh;">
      <table class="merge-table">
        <thead>
          <tr>
            <th style="width: 25%;">Field</th>
            <th style="width: 37.5%;">
              <div style="color:#2563eb; font-weight:700;"><i class="fa-solid fa-a"></i> Record A — Primary (${recA.id})</div>
              ${renderQuickAccessInvestigationLinks(recA)}
            </th>
            <th style="width: 37.5%;">
              <div style="color:#7c3aed; font-weight:700;"><i class="fa-solid fa-b"></i> Record B — Candidate (${recB.id})</div>
              ${renderQuickAccessInvestigationLinks(recB)}
            </th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;

  // Wire up the batch-select buttons safely
  contentDiv.querySelector('#use-all-a-btn').addEventListener('click', () => setDbMergeAll('a'));
  contentDiv.querySelector('#use-all-b-btn').addEventListener('click', () => setDbMergeAll('b'));

  document.getElementById('merge-modal').style.display = 'flex';
}


function setDbMergeAll(source) {
  document.querySelectorAll('#merge-modal-content input[type="radio"]').forEach(r => {
    if (r.value === source) r.checked = true;
  });
}

// Handle confirm merge for DB-wide pairs
async function confirmDbMerge() {
  if (!dbMergeTarget) { showToast('No active merge context.', 'error'); return; }
  const { idA, idB, recA, recB } = dbMergeTarget;

  const mergedRecord = {};
  MERGE_FIELDS.forEach(f => {
    const radio  = document.querySelector(`input[name="dbmerge_${f.key}"]:checked`);
    const choice = radio ? radio.value : 'a';
    const source = choice === 'b' ? recB : recA;
    mergedRecord[f.key] = source[f.key];
  });

  try {
    // 1. Update Record A with merged data
    const mergeRes = await fetch('/api/admin/merge-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ existingId: idA, mergedRecord })
    });
    const mergeData = await mergeRes.json();
    if (!mergeRes.ok) { showToast('Merge update failed: ' + mergeData.error, 'error'); return; }

    // 2. Delete Record B
    const delRes = await fetch(`/api/admin/schools/${idB}`, { method: 'DELETE' });
    const delData = await delRes.json();
    if (!delRes.ok) { showToast('Record B deletion failed: ' + delData.error, 'error'); return; }

    showToast(`Merge complete! Record A (${idA}) updated, Record B (${idB}) removed.`, 'success', 6000);
    document.getElementById('merge-modal').style.display = 'none';
    dbMergeTarget = null;

    // Refresh data and re-run scan to update UI
    window._allSchoolsList = null;
    await fetchStats();
    await loadSchools();
    if (document.getElementById('dedup-scan-results').style.display !== 'none') {
      await runDedupScan();
    }

  } catch (err) {
    console.error('DB merge error:', err);
    showToast('Failed to complete merge operation.', 'error');
  }
}

// Fetch and cache all schools list for typeaheads
async function getAllSchoolsList() {
  if (!window._allSchoolsList) {
    const res = await fetch('/api/schools');
    const data = await res.json();
    window._allSchoolsList = data.schools || [];
  }
  return window._allSchoolsList;
}

// Pre-select School A from School Details modal
function preselectMergeSchoolA(school) {
  const inputA = document.getElementById('manual-merge-input-a');
  const hiddenA = document.getElementById('manual-merge-school-a');
  if (inputA && hiddenA && school) {
    hiddenA.value = school.id;
    inputA.dataset.selectedId = school.id;
    const laStr = school.la ? ` (${school.la})` : '';
    inputA.value = `${school.name}${laStr}`;
  }
}

// Open merge modal for two manually selected schools
async function openManualMergeModal() {
  const hiddenA = document.getElementById('manual-merge-school-a');
  const hiddenB = document.getElementById('manual-merge-school-b');
  const inputA = document.getElementById('manual-merge-input-a');
  const inputB = document.getElementById('manual-merge-input-b');

  const idA = (hiddenA && hiddenA.value) || (inputA && inputA.dataset.selectedId) || '';
  const idB = (hiddenB && hiddenB.value) || (inputB && inputB.dataset.selectedId) || '';

  if (!idA || !idB) {
    showToast('Please select both School A and School B from the search suggestions to perform a merge.', 'warn');
    return;
  }

  if (idA === idB) {
    showToast('School A and School B cannot be the same school record.', 'warn');
    return;
  }

  let list = window._allSchoolsList;
  if (!list) {
    const res = await fetch('/api/schools');
    const data = await res.json();
    list = data.schools || [];
    window._allSchoolsList = list;
  }

  const recA = list.find(s => s.id === idA);
  const recB = list.find(s => s.id === idB);

  if (!recA || !recB) {
    showToast('One or both selected school records could not be loaded.', 'error');
    return;
  }

  // Create temporary pair and trigger DB merge modal
  if (!window._dedupPairs) window._dedupPairs = [];
  const pairIdx = window._dedupPairs.length;
  window._dedupPairs.push({
    recordA: recA,
    recordB: recB,
    similarity: 1.0,
    matchType: 'Manual Selection'
  });

  openDbMergeModal(pairIdx, idA, idB);
}

  // --- ADMIN BULK IMPORT EVENT HANDLERS ---
  const promptBox = document.getElementById('ai-prompt-box');

  document.getElementById('show-ai-prompt-btn').addEventListener('click', () => {
    promptBox.style.display = promptBox.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('copy-prompt-btn').addEventListener('click', () => {
    const textToCopy = document.getElementById('prompt-template-text').textContent;
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('AI Prompt copied to clipboard! Paste into ChatGPT/Gemini/Claude to get data in JSON format.', 'info');
    }).catch(err => {
      console.error('Failed to copy text:', err);
    });
  });

  document.getElementById('load-sample-bulk-btn').addEventListener('click', () => {
    const sampleBatch = [
      {
        "name": "Queen Elizabeth's School, Barnet",
        "urn": "136270",
        "la": "Barnet",
        "schoolType": "Grammar",
        "gender": "Boys",
        "pupilCount": 1280,
        "ofstedRating": "Outstanding",
        "gcseAttainment8": 87.4,
        "entranceExamType": "11+ GL Assessment"
      },
      {
        "name": "Harris Academy Bermondsey",
        "urn": "135119",
        "la": "Southwark",
        "schoolType": "Comprehensive",
        "gender": "Girls",
        "pupilCount": 950,
        "ofstedRating": "Outstanding",
        "gcseAttainment8": 61.2,
        "gcseProgress8": 0.74,
        "entranceExamType": "Non-selective (Cognitive Banding)",
        "gcseSubjects": ["Mathematics", "English", "Science", "History", "Spanish"]
      },
      {
        "name": "Harris Boys' Academy East Dulwich",
        "urn": "135763",
        "la": "Southwark",
        "schoolType": "Comprehensive",
        "gender": "Boys",
        "pupilCount": 880,
        "ofstedRating": "Outstanding",
        "gcseAttainment8": 58.5,
        "gcseProgress8": 0.68,
        "entranceExamType": "Non-selective",
        "gcseSubjects": ["Mathematics", "English", "Science", "Geography", "Computer Science"]
      },
      {
        "name": "Harris Boys' Academy East Dulwich", // Duplicate within batch
        "urn": "135763",
        "la": "Southwark",
        "schoolType": "Comprehensive"
      }
    ];
    document.getElementById('bulk-json-input').value = JSON.stringify(sampleBatch, null, 2);
    showToast('Loaded sample bulk batch into JSON editor.', 'info', 3000);
  });

  // Run Bulk Verification & De-duplication
  document.getElementById('verify-bulk-btn').addEventListener('click', async () => {
    const rawJsonStr = document.getElementById('bulk-json-input').value.trim();
    if (!rawJsonStr) {
      showToast('Please paste or load JSON school objects into the text box first.', 'error');
      return;
    }

    let parsedArray = [];
    try {
      parsedArray = JSON.parse(rawJsonStr);
      if (!Array.isArray(parsedArray)) {
        showToast('Bulk JSON input must be a valid JSON array of school objects.', 'error');
        return;
      }
    } catch (err) {
      showToast('Invalid JSON syntax: ' + err.message, 'error');
      return;
    }

    try {
      const res = await fetch('/api/admin/bulk-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schools: parsedArray })
      });
      const data = await res.json();

      if (res.ok) {
        currentVerifiedBatch = data;
        renderVerificationPreview(data);
        showToast(`Verification complete: ${data.summary.validToImportCount} clean, ${data.summary.duplicateCount} duplicate skipped.`, 'success');
      } else {

        showToast('Verification error: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      console.error('Bulk verify failed:', err);
      showToast('Failed to connect to bulk verification API.', 'error');
    }
  });

  // Verification Preview Sub-tabs
  document.getElementById('tab-clean-preview').addEventListener('click', () => {
    document.getElementById('tab-clean-preview').classList.add('active');
    document.getElementById('tab-dup-preview').classList.remove('active');
    document.getElementById('preview-clean-view').style.display = 'block';
    document.getElementById('preview-dup-view').style.display = 'none';
  });

  document.getElementById('tab-dup-preview').addEventListener('click', () => {
    document.getElementById('tab-dup-preview').classList.add('active');
    document.getElementById('tab-clean-preview').classList.remove('active');
    document.getElementById('preview-clean-view').style.display = 'none';
    document.getElementById('preview-dup-view').style.display = 'block';
  });

  // Merge Modal Close & Cancel Handlers
  document.getElementById('modal-close-merge').addEventListener('click', () => {
    document.getElementById('merge-modal').style.display = 'none';
  });
  document.getElementById('modal-cancel-merge').addEventListener('click', () => {
    document.getElementById('merge-modal').style.display = 'none';
  });

  // Scan for Duplicates button
  document.getElementById('run-dedup-scan-btn').addEventListener('click', runDedupScan);

  // Manual Merge button
  const manualMergeBtn = document.getElementById('manual-merge-trigger-btn');
  if (manualMergeBtn) {
    manualMergeBtn.addEventListener('click', openManualMergeModal);
  }

  // Confirm Merge Handler — routes to either DB-wide or bulk-import merge
  document.getElementById('modal-confirm-merge').addEventListener('click', async () => {
    // Route 1: DB-wide pair merge
    if (dbMergeTarget) {
      await confirmDbMerge();
      return;
    }

    // Route 2: Bulk-import duplicate merge
    if (!currentMergeTarget) {
      showToast('No active merge context.', 'error');
      return;
    }

    const { existingId, existing, incoming, dupIdx } = currentMergeTarget;
    const mergedRecord = {};

    const fields = [
      'name', 'urn', 'la', 'postcode', 'address', 'schoolType', 'gender', 'ageRange',
      'pupilCount', 'ofstedRating', 'gcseProgress8', 'gcseAttainment8', 'ebaccAveragePointScore',
      'entranceExamType', 'entranceExamDates', 'gcseSubjects', 'admissionsPolicy',
      'website', 'phone', 'email', 'description'
    ];

    fields.forEach(fKey => {
      const radio  = document.querySelector(`input[name="merge_${fKey}"]:checked`);
      const choice = radio ? radio.value : 'existing';
      if (choice === 'incoming' && incoming[fKey] !== undefined && incoming[fKey] !== null && incoming[fKey] !== '') {
        mergedRecord[fKey] = incoming[fKey];
      } else {
        mergedRecord[fKey] = existing[fKey];
      }
    });

    try {
      const res  = await fetch('/api/admin/merge-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ existingId, mergedRecord })
      });
      const data = await res.json();

      if (res.ok) {
        showToast(`Successfully merged incoming data into database record (${existingId})!`, 'success');
        document.getElementById('merge-modal').style.display = 'none';
        currentMergeTarget = null;

        // Remove merged item from duplicates list in UI
        if (currentVerifiedBatch && currentVerifiedBatch.duplicates) {
          currentVerifiedBatch.duplicates.splice(dupIdx, 1);
          currentVerifiedBatch.summary.duplicateCount = currentVerifiedBatch.duplicates.length;
          renderVerificationPreview(currentVerifiedBatch);
        }

        await fetchStats();
        await loadSchools();
      } else {
        showToast('Merge failed: ' + (data.error || 'Server error'), 'error');
      }
    } catch (err) {
      console.error('Merge submit error:', err);
      showToast('Failed to complete record merge.', 'error');
    }
  });



  // Confirm and Commit Cleaned Bulk Records
  document.getElementById('confirm-commit-btn').addEventListener('click', async () => {

    if (!currentVerifiedBatch || !currentVerifiedBatch.verified || currentVerifiedBatch.verified.length === 0) {
      showToast('No verified clean school records to import.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/admin/bulk-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifiedSchools: currentVerifiedBatch.verified })
      });

      const data = await res.json();

      if (res.ok) {
        showToast(data.message, 'success', 6000);
        document.getElementById('bulk-json-input').value = '';
        document.getElementById('verification-results-section').style.display = 'none';
        currentVerifiedBatch = null;
        await fetchStats();
        await loadSchools();
        switchTab('directory');
      } else {
        showToast('Failed to commit records: ' + (data.error || 'Server error'), 'error');
      }
    } catch (err) {
      console.error('Commit failed:', err);
      showToast('Error committing batch to server.', 'error');
    }
  });
}


// Render verification results summary tables
function renderVerificationPreview(data) {
  document.getElementById('preview-valid-count').textContent = data.summary.validToImportCount;
  document.getElementById('preview-dup-count').textContent = data.summary.duplicateCount;
  document.getElementById('preview-invalid-count').textContent = data.summary.invalidCount;

  document.getElementById('count-tab-clean').textContent = data.summary.validToImportCount;
  document.getElementById('count-tab-dup').textContent = data.summary.duplicateCount;

  const cleanBody = document.getElementById('preview-clean-table-body');
  cleanBody.innerHTML = '';

  if (data.verified.length === 0) {
    cleanBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b;">No clean records ready for import. All entries were duplicate or invalid.</td></tr>`;
  } else {
    data.verified.forEach((s, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><strong>${s.name}</strong></td>
        <td>${s.la}</td>
        <td>${s.schoolType}</td>
        <td>${s.gender}</td>
        <td><span class="badge-ofsted">${s.ofstedRating}</span></td>
        <td>${s.gcseAttainment8 !== null && s.gcseAttainment8 !== undefined ? s.gcseAttainment8 : 'N/A'}</td>
      `;
      cleanBody.appendChild(tr);
    });
  }

  const dupBody = document.getElementById('preview-dup-table-body');
  dupBody.innerHTML = '';

  if (data.duplicates.length === 0) {
    dupBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#64748b;">No duplicates detected in this batch.</td></tr>`;
  } else {
    data.duplicates.forEach((d, dupIdx) => {
      const tr = document.createElement('tr');
      const canMerge = Boolean(d.existingRecord);
      tr.innerHTML = `
        <td>Row ${d.rowNum}</td>
        <td><strong>${d.name}</strong></td>
        <td>${d.urn}</td>
        <td><span style="color:#b45309; font-weight:700;">${d.reason}</span></td>
        <td>
          ${canMerge ? `
            <button class="btn btn-outline" style="padding: 0.35rem 0.65rem; font-size: 0.8rem; color: #7c3aed; border-color: #c4b5fd;" onclick="openMergeModal(${dupIdx})">
              <i class="fa-solid fa-code-merge"></i> Merge Record
            </button>
          ` : `
            <span style="font-size:0.75rem; color:#94a3b8;">Batch Duplicate</span>
          `}
        </td>
      `;
      dupBody.appendChild(tr);
    });
  }

  document.getElementById('verification-results-section').style.display = 'block';
}

// Current active merge target context
let currentMergeTarget = null;

// Open Merge & De-duplicate Comparison Modal
function openMergeModal(dupIdx) {
  if (!currentVerifiedBatch || !currentVerifiedBatch.duplicates || !currentVerifiedBatch.duplicates[dupIdx]) {
    showToast('Invalid duplicate selection.', 'error');
    return;
  }

  const dup = currentVerifiedBatch.duplicates[dupIdx];
  const existing = dup.existingRecord;
  const incoming = dup.incomingRecord;

  if (!existing) {
    showToast('Cannot merge: No matching existing database record found for this batch item.', 'error');
    return;
  }

  currentMergeTarget = { dupIdx, existingId: existing.id, existing, incoming };

  const fields = [
    { key: 'name', label: 'School Name' },
    { key: 'urn', label: 'URN Number' },
    { key: 'la', label: 'Local Authority (Borough)' },
    { key: 'postcode', label: 'Postcode' },
    { key: 'schoolType', label: 'School Type' },
    { key: 'gender', label: 'Gender' },
    { key: 'pupilCount', label: 'Pupil Count' },
    { key: 'ofstedRating', label: 'Ofsted Rating' },
    { key: 'gcseAttainment8', label: 'Attainment 8 Score' },
    { key: 'entranceExamType', label: 'Entrance Exam Type' },
    { key: 'gcseSubjects', label: 'GCSE Subjects Offered', format: val => Array.isArray(val) ? val.join(', ') : (val || '') },
    { key: 'admissionsPolicy', label: 'Admissions Policy Summary' },
    { key: 'website', label: 'Website URL' },
    { key: 'phone', label: 'Phone Number' }
  ];

  let rowsHtml = '';
  fields.forEach(f => {
    const rawExist = existing[f.key];
    const rawIn = incoming[f.key];

    const valExist = f.format ? f.format(rawExist) : (rawExist !== null && rawExist !== undefined ? String(rawExist) : '');
    const valIn = f.format ? f.format(rawIn) : (rawIn !== null && rawIn !== undefined ? String(rawIn) : '');

    const isMatch = valExist.trim().toLowerCase() === valIn.trim().toLowerCase();
    const cellClass = isMatch ? 'same-cell' : 'diff-cell';

    rowsHtml += `
      <tr class="${cellClass}">
        <td class="merge-field-name">
          ${f.label}
          <div>${isMatch ? '<span class="status-badge-match"><i class="fa-solid fa-check"></i> Match</span>' : '<span class="status-badge-diff"><i class="fa-solid fa-code-compare"></i> Conflict</span>'}</div>
        </td>
        <td class="merge-cell ${cellClass}">
          <label class="merge-radio-label">
            <input type="radio" name="merge_${f.key}" value="existing" checked>
            <div>
              <strong>${valExist || '<em style="color:#94a3b8;">Empty / Unspecified</em>'}</strong>
            </div>
          </label>
        </td>
        <td class="merge-cell ${cellClass}">
          <label class="merge-radio-label">
            <input type="radio" name="merge_${f.key}" value="incoming" ${!valExist && valIn ? 'checked' : ''}>
            <div>
              <strong>${valIn || '<em style="color:#94a3b8;">Empty / Unspecified</em>'}</strong>
            </div>
          </label>
        </td>
      </tr>
    `;
  });

  const contentContainer = document.getElementById('merge-modal-content');
  contentContainer.innerHTML = `
    <div style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <span style="font-size: 0.85rem; color: #64748b;">Existing Record ID: <code>${existing.id}</code></span>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button class="btn btn-outline" style="font-size: 0.8rem; padding: 0.35rem 0.7rem;" onclick="setAllMergeSelection('existing')">
          <i class="fa-solid fa-box-archive"></i> Select All Existing
        </button>
        <button class="btn btn-outline" style="font-size: 0.8rem; padding: 0.35rem 0.7rem;" onclick="setAllMergeSelection('incoming')">
          <i class="fa-solid fa-file-import"></i> Select All Incoming
        </button>
      </div>
    </div>
    <table class="merge-table">
      <thead>
        <tr>
          <th>Field Specification</th>
          <th>Existing Database Record (<span style="color:#2563eb;">Primary</span>)</th>
          <th>Incoming Duplicate Data (<span style="color:#7c3aed;">Candidate</span>)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  document.getElementById('merge-modal').style.display = 'flex';
}

// Quick batch selection helper
function setAllMergeSelection(source) {
  const radios = document.querySelectorAll('#merge-modal-content input[type="radio"]');
  radios.forEach(r => {
    if (r.value === source) r.checked = true;
  });
}


// Open Add Modal
function openAddModal() {
  document.getElementById('add-school-form').reset();
  document.getElementById('edit-school-id').value = '';
  if (document.getElementById('add-active')) document.getElementById('add-active').value = 'true';
  document.getElementById('modal-title-text').innerHTML = '<i class="fa-solid fa-plus-circle"></i> Add New High School Entry';
  document.getElementById('modal-subtitle-text').textContent = 'Expand database records with new school data in England / Greater London';
  document.getElementById('add-modal').style.display = 'flex';
}

// Open Edit Modal with pre-filled school values
async function openEditModal(id) {
  if (!currentPermissions.includes('admin:edit')) return;

  try {
    const res = await fetch(`/api/schools/${id}`);
    if (!res.ok) {
      showToast('Could not fetch school details to edit.', 'error');
      return;
    }
    const school = await res.json();

    const dates = school.entranceExamDates || {};
    const k = school.kpsDetails || {};
    const p = school.pillaiDetails || {};

    document.getElementById('edit-school-id').value = school.id;
    document.getElementById('add-name').value = school.name || '';
    document.getElementById('add-urn').value = school.urn !== 'N/A' ? (school.urn || '') : '';
    document.getElementById('add-la').value = school.la || '';
    document.getElementById('add-region').value = school.region || 'Greater London';
    document.getElementById('add-address').value = school.address || '';
    document.getElementById('add-postcode').value = school.postcode || '';
    document.getElementById('add-type').value = school.schoolType || 'Comprehensive';
    if (document.getElementById('add-active')) {
      document.getElementById('add-active').value = (school.active !== false && school.active !== 0 && school.active !== 'false') ? 'true' : 'false';
    }
    document.getElementById('add-gender').value = school.gender || 'Mixed';
    document.getElementById('add-age-range').value = school.ageRange || '11-18';
    document.getElementById('add-pupils').value = school.pupilCount || '';
    document.getElementById('add-ofsted').value = school.ofstedRating || 'Good';
    
    document.getElementById('add-progress8').value = school.gcseProgress8 !== null && school.gcseProgress8 !== undefined ? school.gcseProgress8 : '';
    document.getElementById('add-attainment8').value = school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined ? school.gcseAttainment8 : '';
    document.getElementById('add-ebacc').value = school.ebaccAveragePointScore !== null && school.ebaccAveragePointScore !== undefined ? school.ebaccAveragePointScore : '';

    // Entrance Exam & Key Dates Fields
    document.getElementById('add-exam-type').value = school.entranceExamType || '';
    document.getElementById('add-exam-reg-open').value = p.registrationOpens || dates.registrationOpen || '';
    document.getElementById('add-exam-reg-deadline').value = p.registrationDeadline || k.registrationCloseDate || dates.registrationDeadline || '';
    document.getElementById('add-exam-date').value = p.firstExamDate || k.firstExamDate || dates.examDate || '';
    document.getElementById('add-exam-second-date').value = p.secondExamDate || k.secondStageExamDate || dates.secondExamDate || '';
    document.getElementById('add-exam-results-date').value = p.offersAcceptance || k.offerDate || dates.resultsDate || '';
    document.getElementById('add-exam-interview').value = p.interview || k.interviewsDate || dates.interviewInfo || '';
    document.getElementById('add-exam-open-events').value = p.openDayEvening || dates.openEvents || '';
    document.getElementById('add-exam-scholarships').value = k.scholarshipsOffered || dates.scholarships || '';

    // Other Details
    document.getElementById('add-subjects').value = Array.isArray(school.gcseSubjects) ? school.gcseSubjects.join(', ') : (school.gcseSubjects || '');
    document.getElementById('add-policy').value = school.admissionsPolicy || '';
    document.getElementById('add-description').value = school.description || '';
    document.getElementById('add-phone').value = school.phone || '';
    document.getElementById('add-email').value = school.email || '';
    document.getElementById('add-website').value = school.website || '';
    document.getElementById('add-hot').checked = Boolean(school.hot);
    document.getElementById('add-official').checked = Boolean(school.official);

    document.getElementById('modal-title-text').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Edit High School Record';
    document.getElementById('modal-subtitle-text').textContent = `Update specs and details for ${school.name}`;
    document.getElementById('add-modal').style.display = 'flex';
  } catch (err) {
    console.error('Error opening edit modal:', err);
    showToast('Error opening edit modal.', 'error');
  }
}

// Delete single school record
async function deleteSchool(id) {
  if (!currentPermissions.includes('admin:edit')) return;
  if (!confirm('Are you sure you want to delete this school record?')) return;

  try {
    const res = await fetch(`/api/schools/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchStats();
      await loadSchools();
      showToast('School record deleted from database.', 'info');
    } else {
      showToast('Failed to delete school record.', 'error');
    }
  } catch (err) {
    console.error('Failed to delete school:', err);
    showToast('Error deleting school record.', 'error');
  }
}


// Render simplified field-level data confidence status icon indicator (High / Low only; Medium is implicit)
function renderFieldConfidenceBadge(schoolId, fieldName, confidenceStats) {
  const stat = (confidenceStats && confidenceStats[fieldName]) || {
    score: 60,
    level: 'Medium',
    isAdminVerified: false,
    label: '60% Confidence',
    upvotes: 0,
    downvotes: 0,
    userVote: 0
  };

  const isAdmin = stat.isAdminVerified;

  // Medium confidence is implicit and does NOT show an indicator
  if (isAdmin) {
    const tooltipText = 'Admin Verified (100% Data Accuracy)';
    return `<span class="confidence-icon-indicator icon-admin" title="${tooltipText}" data-school-id="${schoolId}" data-field-name="${fieldName}"><i class="fa-solid fa-check-double" style="color: #10b981; font-weight: 800;"></i></span>`;
  } else if (stat.level === 'High' || stat.score >= 80) {
    const tooltipText = `${stat.score}% High Confidence (${stat.upvotes} confirm, ${stat.downvotes} report)`;
    return `<span class="confidence-icon-indicator icon-high" title="${tooltipText}" data-school-id="${schoolId}" data-field-name="${fieldName}"><i class="fa-solid fa-check" style="color: #22c55e; font-weight: 800;"></i></span>`;
  } else if (stat.level === 'Low' || (stat.score < 50 && stat.score > 0)) {
    const tooltipText = `${stat.score}% Low Confidence (${stat.upvotes} confirm, ${stat.downvotes} report)`;
    return `<span class="confidence-icon-indicator icon-low" title="${tooltipText}" data-school-id="${schoolId}" data-field-name="${fieldName}"><i class="fa-solid fa-circle-exclamation" style="color: #f43f5e; font-weight: 800;"></i></span>`;
  }

  return '';
}

// Bind event listeners to confidence vote buttons
function bindConfidenceVoteEvents() {
  // Confidence icon indicators display confidence details on mouse hover
}

// Render Admissions Timeline Stepper (5 Chronological Milestones)
function renderAdmissionsTimeline(dates, examType, secondStageRequired, openEvents, firstExamDate, secondExamDate, interviewInfo, offersInfo, regDeadline, regOpen, offerAcceptBy) {
  const is2Stage = secondStageRequired && secondStageRequired.startsWith('Yes');

  return `
    <div class="admissions-timeline-container">
      <div class="timeline-header-bar">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: #1e293b; margin: 0; display: flex; align-items: center; gap: 0.45rem;">
          <i class="fa-solid fa-route" style="color: #4f46e5;"></i> 11+ Admissions Journey &amp; Milestones
        </h4>
        <span style="font-size: 0.72rem; font-weight: 700; color: #4338ca; background: #eef2ff; border: 1px solid #c7d2fe; padding: 0.15rem 0.55rem; border-radius: 6px;">
          <i class="fa-solid fa-graduation-cap"></i> ${examType}
        </span>
      </div>

      <div class="timeline-stepper">
        <!-- Step 1: Open Events & Tours -->
        <div class="timeline-step ${openEvents ? 'step-highlight' : ''}">
          <div class="step-top-row">
            <div class="step-icon-circle step-icon-open"><i class="fa-solid fa-door-open"></i></div>
            <div class="step-title">1. Open Events</div>
          </div>
          <div class="step-date-pill ${openEvents ? 'has-date' : ''}">
            ${openEvents || 'Dates on website'}
          </div>
          <div class="step-subtext">School tours &amp; talks</div>
        </div>

        <!-- Step 2: Registration Window -->
        <div class="timeline-step ${regDeadline ? 'step-highlight' : ''}">
          <div class="step-top-row">
            <div class="step-icon-circle step-icon-reg"><i class="fa-solid fa-pen-to-square"></i></div>
            <div class="step-title">2. Registration</div>
          </div>
          <div class="step-date-pill ${regDeadline ? 'is-deadline' : (regOpen ? 'has-date' : '')}">
            ${regDeadline ? `Closes: ${regDeadline}` : (regOpen ? `Opens: ${regOpen}` : 'Standard cycle')}
          </div>
          <div class="step-subtext">${regOpen ? `Opens: ${regOpen}` : 'Application deadline'}</div>
        </div>

        <!-- Step 3: Stage 1 Exam -->
        <div class="timeline-step ${firstExamDate ? 'step-highlight' : ''}">
          <div class="step-top-row">
            <div class="step-icon-circle step-icon-exam1"><i class="fa-solid fa-feather-pointed"></i></div>
            <div class="step-title">3. Stage 1 Exam</div>
          </div>
          <div class="step-date-pill ${firstExamDate ? 'has-date' : ''}">
            ${firstExamDate ? `Exam: ${firstExamDate}` : 'Autumn term'}
          </div>
          <div class="step-subtext">1st stage assessment</div>
        </div>

        <!-- Step 4: Stage 2 / Interview -->
        <div class="timeline-step ${is2Stage ? 'step-highlight' : ''}">
          <div class="step-top-row">
            <div class="step-icon-circle step-icon-exam2"><i class="fa-solid ${is2Stage ? 'fa-bullseye' : 'fa-check'}"></i></div>
            <div class="step-title">4. ${is2Stage ? 'Stage 2 &amp; Interview' : 'Stage 2'}</div>
          </div>
          <div class="step-date-pill ${secondExamDate || interviewInfo ? 'has-date' : ''}">
            ${secondExamDate ? `2nd Exam: ${secondExamDate}` : (interviewInfo ? `Interview: ${interviewInfo}` : (is2Stage ? 'Selective 2nd Stage' : 'Single Stage Only'))}
          </div>
          <div class="step-subtext">${interviewInfo && secondExamDate ? `Interview: ${interviewInfo}` : (is2Stage ? 'For qualified candidates' : 'No 2nd stage required')}</div>
        </div>

        <!-- Step 5: Offers & Acceptance -->
        <div class="timeline-step ${offersInfo || offerAcceptBy ? 'step-highlight' : ''}">
          <div class="step-top-row">
            <div class="step-icon-circle step-icon-offers"><i class="fa-solid fa-envelope-open-text"></i></div>
            <div class="step-title">5. Offers &amp; Accept</div>
          </div>
          <div class="step-date-pill ${offersInfo || offerAcceptBy ? 'has-date' : ''}">
            ${offersInfo ? `Offers: ${offersInfo}` : (offerAcceptBy ? `Accept: ${offerAcceptBy}` : '1 Mar (National Day)')}
          </div>
          <div class="step-subtext">${offerAcceptBy ? `Deadline: ${offerAcceptBy}` : 'National Offer Day'}</div>
        </div>
      </div>
    </div>
  `;
}

// Render At-a-Glance Parent Summary Tiles
function renderParentSummaryTiles(school, feesTermly, annualFeesEst, examType, examBoard, secondStageRequired) {
  const isIndep = school.schoolType === 'Independent' || Boolean(feesTermly);
  const isRanked = Boolean(school.national_rank_england);

  const prog8Val = school.gcseProgress8 !== null && school.gcseProgress8 !== undefined && school.gcseProgress8 !== ''
    ? (typeof school.gcseProgress8 === 'number' && school.gcseProgress8 > 0 ? `+${school.gcseProgress8}` : `${school.gcseProgress8}`)
    : (school.gcseAttainment8 ? `Attain 8: ${school.gcseAttainment8}` : (school.ofstedRating ? `${school.ofstedRating}` : 'N/A'));

  const prog8Sub = school.gcseProgress8 > 0.5 ? 'Well Above Average' : (school.gcseProgress8 >= 0 ? 'Above Average' : (school.ofstedRating ? 'Ofsted Graded' : 'Academic Rating'));

  return `
    <div class="parent-summary-grid">
      <!-- Tile 1: National Secondary Rank -->
      <div class="summary-tile tile-rank">
        <div class="summary-tile-label"><i class="fa-solid fa-trophy" style="color: #d97706;"></i> National Rank</div>
        <div class="summary-tile-value" style="color: ${isRanked ? '#b45309' : '#475569'};">
          ${isRanked ? `#${school.national_rank_england}` : 'Unranked'}
        </div>
        <div class="summary-tile-sub">
          ${school.gcse_rank_england ? `GCSE: #${school.gcse_rank_england} in England` : (isRanked ? 'England Secondary Rank' : 'Official State Register')}
        </div>
      </div>

      <!-- Tile 2: Academic Progress 8 / Performance -->
      <div class="summary-tile tile-progress">
        <div class="summary-tile-label"><i class="fa-solid fa-arrow-trend-up" style="color: #059669;"></i> Progress 8</div>
        <div class="summary-tile-value" style="color: #047857;">
          ${prog8Val}
        </div>
        <div class="summary-tile-sub">${prog8Sub}</div>
      </div>

      <!-- Tile 3: Tuition Fees / Funding Status -->
      <div class="summary-tile tile-fees">
        <div class="summary-tile-label"><i class="fa-solid fa-coins" style="color: #059669;"></i> Funding &amp; Fees</div>
        <div class="summary-tile-value" style="font-size: ${feesTermly ? '1.05rem' : '1.15rem'}; color: #0f172a;">
          ${feesTermly || (isIndep ? 'Fee-Paying' : 'State Funded')}
        </div>
        <div class="summary-tile-sub">
          ${annualFeesEst || (isIndep ? 'Termly Tuition Rate' : 'Free State Education')}
        </div>
      </div>

      <!-- Tile 4: 11+ Entrance Assessment -->
      <div class="summary-tile tile-exam">
        <div class="summary-tile-label"><i class="fa-solid fa-clipboard-check" style="color: #4f46e5;"></i> Exam Format</div>
        <div class="summary-tile-value" style="font-size: 0.95rem; color: #3730a3;">
          ${examBoard ? `${examBoard}` : (school.entranceExamType || 'Standard Entry')}
        </div>
        <div class="summary-tile-sub">
          ${secondStageRequired && secondStageRequired.startsWith('Yes') ? '2-Stage Selective Test' : 'Single Stage Assessment'}
        </div>
      </div>
    </div>
  `;
}

// Open School Detail View
async function openSchoolDetail(id) {
  try {
    const res = await fetch(`/api/schools/${id}`);
    if (!res.ok) {
      showToast('Failed to load school details.', 'error');
      return;
    }
    const school = await res.json();

    let confidenceStats = {};
    try {
      const confRes = await fetch(`/api/schools/${id}/confidence`, {
        headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
      });
      if (confRes.ok) {
        const confData = await confRes.json();
        confidenceStats = confData.confidence || {};
      }
    } catch (confErr) {
      console.warn('Could not fetch confidence stats:', confErr);
    }

    const detailContent = document.getElementById('detail-modal-content');
    const isAdminUser = Array.isArray(currentPermissions) && (currentPermissions.includes('admin:portal') || currentPermissions.includes('admin:edit'));

    let subjectsArray = [];
    if (Array.isArray(school.gcseSubjects)) {
      subjectsArray = school.gcseSubjects;
    } else if (typeof school.gcseSubjects === 'string' && school.gcseSubjects.trim()) {
      try {
        const parsed = JSON.parse(school.gcseSubjects);
        subjectsArray = Array.isArray(parsed) ? parsed : school.gcseSubjects.split(',').map(s => s.trim()).filter(Boolean);
      } catch (e) {
        subjectsArray = school.gcseSubjects.split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    const subjectsHtml = subjectsArray.length > 0
      ? subjectsArray.map(sub => `<span class="subject-tag">${sub}</span>`).join('')
      : '<span style="color:#94a3b8; font-size: 0.85rem;">No GCSE subjects cataloged</span>';

    const dates = school.entranceExamDates || {};
    const k = school.kpsDetails || {};
    const p = school.pillaiDetails || {};

    // ----------------------------------------------------
    // Reconcile Multi-Source Admissions Data
    // ----------------------------------------------------
    const examBoard = p.examBoard || dates.examBoard || null;
    const examType = school.entranceExamType || dates.entranceExamType || (examBoard ? `11+ Entrance Assessment (${examBoard})` : 'Standard 11+ Assessment');
    const regStatus = p.registrationStatus || dates.registrationStatus || (dates.registrationDeadline ? 'Active / Configured' : null);
    const regFee = school.registrationFee || k.registrationFee || dates.registrationFee || null;
    const regOpen = p.registrationOpens || dates.registrationOpen || dates.registrationOpens || null;
    const regDeadline = p.registrationDeadline || k.registrationCloseDate || k.registrationCloses || dates.registrationDeadline || null;
    const openEvents = p.openDayEvening || dates.openDayEvening || dates.openDays || dates.openEvents || null;

    const formatDisplayDates = (d) => Array.isArray(d) ? d.filter(Boolean).join(', ') : (d || null);

    // Stage 1 Examination
    const rawFirstExamDate = p.firstExamDate || k.firstExamDate || dates.stage_one_examDate || dates.examDate || dates.firstExamDate || null;
    const firstExamDate = formatDisplayDates(rawFirstExamDate);
    const firstExamSubjects = school.stage_one_format_and_subjects || dates.stage_one_format_and_subjects || p.firstExamSubjects || k.firstExamFormatSubjects || k.examFormat || dates.firstExamSubjects || null;
    const firstStageResult = p.firstExamResults || k.firstStageResult || dates.firstStageResult || dates.firstExamResults || null;

    // Stage 2 Examination
    const secondStageRequired = school.second_stage_exam_required || dates.second_stage_exam_required || (p.secondExamDate || k.secondStageExamDate || dates.secondExamDate ? 'Yes (Selective 2nd Stage)' : 'No (Single Stage Examination)');
    const rawSecondExamDate = p.secondExamDate || k.secondStageExamDate || dates.stage_two_examDate || dates.secondExamDate || null;
    const secondExamDate = formatDisplayDates(rawSecondExamDate);
    const secondExamSubjects = school.stage_two_format_and_subjects || dates.stage_two_format_and_subjects || p.secondExamSubjects || k.secondExamFormatSubjects || dates.secondExamSubjects || null;
    const secondStageResult = p.secondExamResults || k.secondStageResult || dates.secondStageResult || dates.secondExamResults || null;

    // Interviews & Offers
    const rawInterviewInfo = p.interview || k.interviewGroupActivity || k.interviewsDate || dates.interviewDates || dates.interviewInfo || dates.interviewDate || null;
    const interviewInfo = formatDisplayDates(rawInterviewInfo);
    const offersInfo = p.offersAcceptance || k.offerDate || dates.resultsDate || dates.offersDate || dates.offersAcceptance || dates.offerDate || null;
    const offerAcceptBy = k.offerAcceptByDate || dates.offerAcceptByDate || dates.offerAcceptBy || dates.acceptanceDeadline || null;

    // Financials & Tuition Fees
    const feesTermly = school.feesTermly || dates.feesTermly || dates.feesPerTerm || p.feesTermly || null;
    let annualFeesEst = null;
    if (feesTermly) {
      const matchNum = feesTermly.replace(/,/g, '').match(/\d+/);
      if (matchNum) {
        const num = parseInt(matchNum[0], 10);
        if (num > 500) {
          annualFeesEst = `£${(num * 3).toLocaleString()} / year (est. 3 terms)`;
        }
      }
    }
    const scholarships = k.scholarshipsOffered || dates.scholarshipsOffered || dates.scholarships || p.scholarships || null;
    const bursaryDeadline = dates.bursaryDeadline || dates.scholarshipDeadline || k.bursaryDeadline || null;

    // Admissions Policy & Catchment
    const admissionsPolicy = school.admissionsPolicy || dates.admissionsPolicy || null;
    const catchmentInfo = dates.catchmentArea || dates.oversubscriptionCriteria || p.catchment || null;
    const notes = p.notes || k.notes || dates.notes || school.notes || null;

    // AI & Verification Metadata
    const verificationStatus = school.verification_status || (school.official ? 'official_gov' : 'unverified');
    const isLlmEnriched = school.verification_status === 'llm_enriched' || (Array.isArray(school.verification_tags) && school.verification_tags.includes('llm_verified'));
    const confidenceScore = school.confidence_score || (isLlmEnriched ? 95 : (school.official ? 90 : 80));
    const verifiedAt = school.verified_at ? new Date(school.verified_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
    const sourceUrl = school.sourceUrl || null;
    const verificationTags = Array.isArray(school.verification_tags) ? school.verification_tags : [];
    const scanModelName = (school.verification_report && school.verification_report.model) ? school.verification_report.model : (isLlmEnriched ? 'Google Gemini / OpenAI AI' : 'Standard Ingestion');

    const userReports = school.userReports || {};
    const userOverrides = school.userCustomOverrides || {};

    const renderWidget = (fieldName, fieldLabel, origValue, iconClass = '') => {
      const report = userReports[fieldName] || null;
      const isUp = report && report.status === 'up';
      const isDown = report && report.status === 'down';
      const customVal = userOverrides[fieldName] !== undefined ? userOverrides[fieldName] : (report && report.customValue ? report.customValue : null);
      const isCustom = customVal !== null && customVal !== undefined && customVal !== '';
      const displayVal = isCustom ? customVal : (origValue !== null && origValue !== undefined && origValue !== '' ? origValue : 'N/A');

      const confBadge = typeof renderFieldConfidenceBadge === 'function' ? renderFieldConfidenceBadge(school.id, fieldName, confidenceStats) : '';
      const iconHtml = iconClass ? `<i class="${iconClass}" style="color: #64748b; margin-right: 0.35rem; width: 14px; text-align: center;"></i>` : '';

      return `
        <div class="field-rating-row" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; width: 100%; margin-bottom: 0.35rem; font-size: 0.85rem; color: #334155;">
          <div style="flex: 1; word-break: break-word;">
            ${iconHtml}<span style="font-weight: 600; color: #475569;">${fieldLabel}:</span> <span style="font-weight: ${displayVal !== 'N/A' ? '700' : '400'}; color: ${displayVal !== 'N/A' ? '#0f172a' : '#94a3b8'};">${displayVal}</span> ${confBadge}
            ${isCustom ? `
              <span class="badge-custom-value" style="background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; font-size:0.72rem; font-weight:700; padding:0.15rem 0.45rem; border-radius:999px; margin-left:0.35rem; display:inline-flex; align-items:center; gap:0.2rem;" title="Custom value updated in your personal record">
                <i class="fa-solid fa-user-pen"></i> Custom Value Updated by You
              </span>
              <button type="button" class="btn-reset-field-report" data-school-id="${school.id}" data-field-name="${fieldName}" style="background:none; border:none; color:#ef4444; font-size:0.75rem; text-decoration:underline; cursor:pointer; margin-left:0.35rem;">Reset</button>
            ` : ''}
          </div>

          <div style="display: flex; align-items: center; gap: 0.25rem; flex-shrink: 0;">
            <button type="button" class="btn-field-thumb btn-thumb-up ${isUp ? 'active' : ''}" data-school-id="${school.id}" data-field-name="${fieldName}" data-label="${fieldLabel}" data-orig="${origValue || ''}" title="Confirm accurate" style="padding: 0.16rem 0.35rem; font-size: 0.72rem; border-radius: 5px; border: 1px solid ${isUp ? '#16a34a' : '#cbd5e1'}; background: ${isUp ? '#dcfce7' : '#ffffff'}; color: ${isUp ? '#15803d' : '#64748b'}; cursor: pointer;">
              <i class="fa-solid fa-thumbs-up"></i>
            </button>
            <button type="button" class="btn-field-thumb btn-thumb-down ${isDown ? 'active' : ''}" data-school-id="${school.id}" data-field-name="${fieldName}" data-label="${fieldLabel}" data-orig="${origValue || ''}" data-custom="${customVal || ''}" title="Suggest correction" style="padding: 0.16rem 0.35rem; font-size: 0.72rem; border-radius: 5px; border: 1px solid ${isDown ? '#dc2626' : '#cbd5e1'}; background: ${isDown ? '#fee2e2' : '#ffffff'}; color: ${isDown ? '#b91c1c' : '#64748b'}; cursor: pointer;">
              <i class="fa-solid fa-thumbs-down"></i>
            </button>
          </div>
        </div>
      `;
    };

    // ----------------------------------------------------
    // Build Unified Admissions & Examination Milestone Card
    // ----------------------------------------------------
    const admissionsUnifiedHtml = `
      <div class="detail-box" style="grid-column: 1 / -1; background: #ffffff; border: 1px solid #cbd5e1; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.6rem; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
          <h4 style="color: #1e293b; font-size: 1.08rem; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
            <i class="fa-solid fa-calendar-check" style="color: #4338ca;"></i> 11+ Admissions Milestones &amp; Entrance Profile
          </h4>
          <span style="font-size: 0.78rem; font-weight: 700; color: #4338ca; background: #eef2ff; border: 1px solid #c7d2fe; padding: 0.2rem 0.6rem; border-radius: 6px;">
            <i class="fa-solid fa-graduation-cap"></i> ${examType}
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
          <!-- Column 1: Registration & Key Deadlines -->
          <div style="background: #f8fafc; padding: 0.85rem; border-radius: 6px; border: 1px solid #e2e8f0;">
            <strong style="color: #2563eb; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem; font-size: 0.9rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 0.35rem;">
              <i class="fa-solid fa-file-pen"></i> Registration &amp; Deadlines
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.25rem;">
              ${renderWidget('entranceExamType', 'Exam Board / Format', examBoard ? `${examType} (${examBoard})` : examType, 'fa-solid fa-clipboard-check')}
              ${renderWidget('registrationStatus', 'Registration Status', regStatus || 'Active', 'fa-solid fa-circle-info')}
              ${renderWidget('registrationOpen', 'Registration Opens', regOpen, 'fa-solid fa-calendar-plus')}
              ${renderWidget('registrationDeadline', 'Registration Deadline', regDeadline, 'fa-solid fa-calendar-xmark')}
              ${renderWidget('openDayEvening', 'Open Events / Tours', openEvents, 'fa-solid fa-door-open')}
            </div>
          </div>

          <!-- Column 2: Stage 1 Assessment -->
          <div style="background: #f8fafc; padding: 0.85rem; border-radius: 6px; border: 1px solid #e2e8f0;">
            <strong style="color: #d97706; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem; font-size: 0.9rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 0.35rem;">
              <i class="fa-solid fa-pen-nib"></i> 1st Stage Assessment
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.25rem;">
              ${renderWidget('firstExamDate', '1st Exam Date', firstExamDate, 'fa-solid fa-calendar-day')}
              ${renderWidget('stage_one_format_and_subjects', 'Format & Subjects', firstExamSubjects, 'fa-solid fa-pen-ruler')}
              ${renderWidget('firstStageResult', 'Results Release Date', firstStageResult, 'fa-solid fa-chart-pie')}
            </div>
          </div>

          <!-- Column 3: Stage 2 Assessment, Interviews & Offers -->
          <div style="background: #f8fafc; padding: 0.85rem; border-radius: 6px; border: 1px solid #e2e8f0;">
            <strong style="color: #059669; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem; font-size: 0.9rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 0.35rem;">
              <i class="fa-solid fa-award"></i> Stage 2, Interview &amp; Offers
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.25rem;">
              ${renderWidget('second_stage_exam_required', '2nd Stage Required', secondStageRequired, 'fa-solid fa-bolt-lightning')}
              ${renderWidget('secondExamDate', '2nd Exam Date', secondExamDate, 'fa-solid fa-calendar-days')}
              ${renderWidget('stage_two_format_and_subjects', '2nd Exam Format', secondExamSubjects, 'fa-solid fa-dice-two')}
              ${renderWidget('secondStageResult', '2nd Stage Results', secondStageResult, 'fa-solid fa-square-poll-vertical')}
              ${renderWidget('interviewInfo', 'Interview / Audition', interviewInfo, 'fa-solid fa-comments')}
              ${renderWidget('offersInfo', 'Offers / Notification Date', offersInfo, 'fa-solid fa-envelope-open-text')}
              ${renderWidget('offerAcceptBy', 'Acceptance Deadline', offerAcceptBy, 'fa-solid fa-calendar-check')}
            </div>
          </div>
        </div>
      </div>
    `;

    // ----------------------------------------------------
    // Build Financials, Tuition & Scholarships Card
    // ----------------------------------------------------
    const hasFinancials = Boolean(feesTermly || regFee || scholarships || bursaryDeadline);
    const financialsHtml = hasFinancials ? `
      <div class="detail-box" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px;">
        <h4 style="color: #059669; font-size: 1.02rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-sterling-sign"></i> Tuition Fees, Financials &amp; Scholarships
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.3rem;">
          ${renderWidget('feesTermly', 'Termly Tuition Fee', feesTermly, 'fa-solid fa-coins')}
          ${annualFeesEst ? `
            <div class="field-rating-row" style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #334155; margin-bottom: 0.35rem;">
              <div><i class="fa-solid fa-calculator" style="color: #64748b; margin-right: 0.35rem; width: 14px; text-align: center;"></i><span style="font-weight: 600; color: #475569;">Annual Fee (Estimated):</span> <strong style="color: #059669;">${annualFeesEst}</strong></div>
            </div>
          ` : ''}
          ${renderWidget('registrationFee', 'Registration Fee', regFee, 'fa-solid fa-receipt')}
          ${renderWidget('scholarshipsOffered', 'Scholarships &amp; Bursaries', scholarships, 'fa-solid fa-award')}
          ${bursaryDeadline ? renderWidget('bursaryDeadline', 'Bursary Deadline', bursaryDeadline, 'fa-solid fa-clock-rotate-left') : ''}
        </div>
      </div>
    ` : '';

    // ----------------------------------------------------
    // Build Admissions Policy & Catchment Card
    // ----------------------------------------------------
    const hasPolicy = Boolean(admissionsPolicy || catchmentInfo || notes);
    const policyHtml = hasPolicy ? `
      <div class="detail-box" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px;">
        <h4 style="color: #7c3aed; font-size: 1.02rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-shield-halved"></i> Admissions Policy &amp; Catchment
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.3rem;">
          ${renderWidget('admissionsPolicy', 'Admissions Policy Summary', admissionsPolicy || 'Standard 11+ entry policy.', 'fa-solid fa-scale-balanced')}
          ${catchmentInfo ? renderWidget('catchmentArea', 'Catchment Area / Criteria', catchmentInfo, 'fa-solid fa-map-location-dot') : ''}
          ${notes ? renderWidget('additionalNotes', 'Admissions Notes', notes, 'fa-solid fa-circle-info') : ''}
        </div>
      </div>
    ` : '';

    // ----------------------------------------------------
    // Build Academic Performance Card
    // ----------------------------------------------------
    const academicMetricsHtml = `
      <div class="detail-box" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px;">
        <h4 style="color: #2563eb; font-size: 1.02rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-chart-line"></i> Academic Metrics &amp; GCSE Performance
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.3rem;">
          ${renderWidget('national_rank_england', 'National Rank in England', school.national_rank_england ? `#${school.national_rank_england} in England` : null, 'fa-solid fa-trophy')}
          ${renderWidget('gcse_rank_england', 'GCSE Rank in England', school.gcse_rank_england ? `#${school.gcse_rank_england} in England` : null, 'fa-solid fa-medal')}
          ${renderWidget('a_level_rank_england', 'A-Level Rank in England', school.a_level_rank_england ? `#${school.a_level_rank_england} in England` : null, 'fa-solid fa-award')}
          ${renderWidget('pupilCount', 'Total Pupil Roll', school.pupilCount ? `${school.pupilCount.toLocaleString()} pupils` : 'N/A', 'fa-solid fa-users-line')}
          ${renderWidget('ageRange', 'Age Range', school.ageRange || '11 to 18', 'fa-solid fa-id-badge')}
          ${renderWidget('gcseAttainment8', 'GCSE Attainment 8 Score', school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined && school.gcseAttainment8 !== '' ? school.gcseAttainment8 : 'N/A', 'fa-solid fa-graduation-cap')}
          ${renderWidget('gcseProgress8', 'GCSE Progress 8 Score', school.gcseProgress8 !== null && school.gcseProgress8 !== undefined && school.gcseProgress8 !== '' ? school.gcseProgress8 : 'N/A', 'fa-solid fa-arrow-trend-up')}
          ${renderWidget('ebaccAveragePointScore', 'EBacc Average Point Score', school.ebaccAveragePointScore !== null && school.ebaccAveragePointScore !== undefined && school.ebaccAveragePointScore !== '' ? school.ebaccAveragePointScore : 'N/A', 'fa-solid fa-globe')}
        </div>
        <div style="margin-top: 0.8rem; border-top: 1px dashed #cbd5e1; padding-top: 0.6rem;">
          <div style="font-size: 0.85rem; font-weight: 700; color: #334155; margin-bottom: 0.35rem; display: flex; align-items: center; justify-content: space-between;">
            <span><i class="fa-solid fa-book-open" style="color: #6366f1;"></i> Offered GCSE Curriculum</span>
            <span style="font-size: 0.75rem; color: #64748b; font-weight: 600;">${subjectsArray.length} Subjects</span>
          </div>
          <div class="subjects-tags" style="display: flex; flex-wrap: wrap; gap: 0.35rem;">${subjectsHtml}</div>
        </div>
      </div>
    `;

    // ----------------------------------------------------
    // Build School Contact Card
    // ----------------------------------------------------
    const contactHtml = `
      <div class="detail-box" style="grid-column: 1 / -1; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px;">
        <h4 style="color: #0284c7; font-size: 1.02rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-address-book"></i> School Contact &amp; Location Details
        </h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem;">
          <div>
            ${renderWidget('phone', 'Phone Number', school.phone, 'fa-solid fa-phone-volume')}
            ${renderWidget('email', 'Email Address', school.email, 'fa-solid fa-paper-plane')}
          </div>
          <div>
            ${renderWidget('website', 'Official Website', school.website, 'fa-solid fa-globe')}
            ${renderWidget('address', 'Postal Address', school.address ? `${school.address}, ${school.postcode || ''}` : school.la, 'fa-solid fa-location-dot')}
            <!-- Interactive Exact Distance Calculator -->
            <div id="modal-distance-calculator" style="margin-top: 0.65rem; padding: 0.65rem 0.85rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
              <div style="font-size: 0.78rem; font-weight: 700; color: #166534; display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
                <span><i class="fa-solid fa-route"></i> Distance From Your Postcode</span>
                <span id="modal-distance-value" style="font-size: 0.85rem; font-weight: 800; color: #047857;">--</span>
              </div>
              <div style="display: flex; gap: 0.4rem; align-items: center;">
                <input type="text" id="modal-user-postcode-input" placeholder="Enter your postcode (e.g. SW19 4TT)..." style="flex: 1; padding: 0.38rem 0.6rem; border: 1px solid #86efac; border-radius: 6px; font-size: 0.82rem; background: white;">
                <button type="button" id="modal-btn-calc-distance" class="btn btn-sm" style="background: #16a34a; color: white; border: none; font-size: 0.78rem; padding: 0.38rem 0.75rem; border-radius: 6px; font-weight: 700; cursor: pointer;">
                  <i class="fa-solid fa-calculator"></i> Calculate
                </button>
                <a id="modal-maps-link" href="#" target="_blank" rel="noopener noreferrer" class="btn btn-sm" style="background: white; color: #15803d; border: 1px solid #86efac; font-size: 0.78rem; padding: 0.38rem 0.65rem; border-radius: 6px; text-decoration: none; font-weight: 700; display: none;">
                  <i class="fa-solid fa-diamond-turn-right"></i> Maps
                </a>
              </div>
              <div id="modal-distance-notes" style="font-size: 0.72rem; color: #15803d; margin-top: 0.3rem;"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // ----------------------------------------------------
    // Build Admin Data Quality & AI Verification Card (ADMIN ONLY)
    // ----------------------------------------------------
    const adminQualityHtml = isAdminUser ? `
      <div class="admin-quality-card">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.6rem; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
          <h4 style="color: #4338ca; font-size: 1.05rem; margin: 0; display: flex; align-items: center; gap: 0.45rem;">
            <i class="fa-solid fa-shield-halved"></i> Data Quality &amp; AI Verification Intelligence
          </h4>
          <span style="font-size: 0.74rem; font-weight: 700; color: #4338ca; background: #e0e7ff; border: 1px solid #c7d2fe; padding: 0.2rem 0.55rem; border-radius: 5px;">
            <i class="fa-solid fa-user-shield"></i> Administrator Controls
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.85rem; margin-bottom: 0.85rem;">
          <div style="background: #ffffff; padding: 0.75rem 0.85rem; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="font-size: 0.78rem; color: #64748b; font-weight: 600; margin-bottom: 0.25rem;">Quality &amp; Confidence Level</div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.25rem; font-weight: 800; color: ${confidenceScore >= 80 ? '#16a34a' : (confidenceScore < 50 ? '#dc2626' : '#d97706')};">
                ${confidenceScore}%
              </span>
              <div style="flex: 1; height: 7px; background: #e2e8f0; border-radius: 999px; overflow: hidden;">
                <div style="width: ${confidenceScore}%; height: 100%; background: ${confidenceScore >= 80 ? '#22c55e' : (confidenceScore < 50 ? '#ef4444' : '#f59e0b')};"></div>
              </div>
            </div>
            <div style="font-size: 0.72rem; color: #64748b; margin-top: 0.25rem;">
              Status: <strong style="color: #1e293b;">${verificationStatus}</strong>
            </div>
          </div>

          <div style="background: #ffffff; padding: 0.75rem 0.85rem; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="font-size: 0.78rem; color: #64748b; font-weight: 600; margin-bottom: 0.25rem;">Last Intelligence Scan</div>
            <div style="font-size: 0.88rem; font-weight: 700; color: #1e293b;">
              <i class="fa-solid fa-clock" style="color: #6366f1;"></i> ${verifiedAt || 'Not scanned yet'}
            </div>
            <div style="font-size: 0.72rem; color: #64748b; margin-top: 0.25rem;">
              Model: <strong style="color: #4338ca;">${scanModelName}</strong>
            </div>
          </div>
        </div>

        <!-- Admin Data Completeness Breakdown Widget -->
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem 0.85rem; margin-bottom: 0.75rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
            <span style="font-size: 0.78rem; font-weight: 700; color: #334155;"><i class="fa-solid fa-chart-pie" style="color: #059669;"></i> Data Completeness Score:</span>
            <span style="font-size: 0.88rem; font-weight: 800; color: ${(school.completeness_score || 0) >= 80 ? '#16a34a' : ((school.completeness_score || 0) >= 50 ? '#2563eb' : '#dc2626')};">${school.completeness_score || 0}% Complete</span>
          </div>
          <div style="height: 6px; background: #e2e8f0; border-radius: 999px; overflow: hidden; margin-bottom: 0.5rem;">
            <div style="width: ${school.completeness_score || 0}%; height: 100%; background: ${(school.completeness_score || 0) >= 80 ? '#22c55e' : ((school.completeness_score || 0) >= 50 ? '#3b82f6' : '#ef4444')};"></div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.3rem; font-size: 0.72rem; color: #475569;">
            <div><i class="fa-solid fa-${school.website ? 'check" style="color:#16a34a;"' : 'xmark" style="color:#dc2626;"'}></i> Website</div>
            <div><i class="fa-solid fa-${(school.entranceExamDates && school.entranceExamDates !== '{}') ? 'check" style="color:#16a34a;"' : 'xmark" style="color:#dc2626;"'}></i> 11+ Exam Dates</div>
            <div><i class="fa-solid fa-${school.entranceExamType ? 'check" style="color:#16a34a;"' : 'xmark" style="color:#dc2626;"'}></i> Exam Format</div>
            <div><i class="fa-solid fa-${school.ofstedRating ? 'check" style="color:#16a34a;"' : 'xmark" style="color:#dc2626;"'}></i> Ofsted Rating</div>
          </div>
        </div>

        <div style="margin-bottom: 0.75rem;">
          <div style="font-size: 0.76rem; font-weight: 700; color: #475569; margin-bottom: 0.3rem;">System Verification Tags:</div>
          <div style="display: flex; flex-wrap: wrap; gap: 0.3rem;">
            ${verificationTags.length > 0 ? verificationTags.map(t => `<span class="admin-quality-badge">${t}</span>`).join('') : '<span style="font-size:0.75rem; color:#94a3b8;">No tags</span>'}
          </div>
        </div>

        <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; border-top: 1px dashed #cbd5e1; padding-top: 0.65rem; font-size: 0.78rem;">
          ${school.urn ? `<span><strong>URN:</strong> ${school.urn}</span>` : ''}
          ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" style="color: #4f46e5; font-weight: 700; text-decoration: underline;"><i class="fa-solid fa-arrow-up-right-from-square"></i> Verification Source Link</a>` : ''}
        </div>
      </div>
    ` : '';

    // ----------------------------------------------------
    // Top-Left View Switcher Toolbar (v1 Classic vs v2 Timeline)
    // ----------------------------------------------------
    const viewSwitcherToolbarHtml = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.6rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.6rem;">
        <div class="view-toggle-container">
          <button type="button" class="btn-toggle-view ${currentDetailViewVersion === 'v1' ? 'active v1-active' : ''}" data-version="v1" title="Switch to Classic Tabular View">
            <i class="fa-solid fa-table-list"></i> Classic (v1)
          </button>
          <button type="button" class="btn-toggle-view ${currentDetailViewVersion === 'v2' ? 'active' : ''}" data-version="v2" title="Switch to Admissions Timeline View">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Timeline (v2)
          </button>
        </div>
        <div style="font-size: 0.76rem; color: #64748b; font-weight: 600; display: flex; align-items: center; gap: 0.35rem;">
          ${currentDetailViewVersion === 'v2'
            ? '<span style="color: #4f46e5;"><i class="fa-solid fa-sparkles"></i> Interactive Admissions Timeline Active</span>'
            : '<span><i class="fa-solid fa-table-cells"></i> Standard Classic View Active</span>'
          }
        </div>
      </div>
    `;

    // ----------------------------------------------------
    // Assemble Full Modal Content (v1 Classic vs v2 Enhanced Timeline)
    // ----------------------------------------------------
    if (currentDetailViewVersion === 'v2') {
      // Version 2: Enhanced Visual Timeline + At-a-Glance Summary Tiles
      const summaryTilesHtml = renderParentSummaryTiles(school, feesTermly, annualFeesEst, examType, examBoard, secondStageRequired);
      const timelineStepperHtml = renderAdmissionsTimeline(dates, examType, secondStageRequired, openEvents, firstExamDate, secondExamDate, interviewInfo, offersInfo, regDeadline, regOpen, offerAcceptBy);

      detailContent.innerHTML = `
        ${viewSwitcherToolbarHtml}

        <div class="detail-header-hero" style="border-bottom: 1px solid #e2e8f0; padding-bottom: 1.1rem; margin-bottom: 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
            <div>
              <h2 style="font-size: 1.6rem; font-weight: 800; color: #0f172a; margin: 0 0 0.35rem 0; letter-spacing: -0.02em;">
                ${school.name}
              </h2>
              <div style="color: #64748b; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span><i class="fa-solid fa-location-dot" style="color: #ef4444;"></i> ${school.address || school.la}, ${school.postcode || ''}</span>
                <span>•</span>
                <span><i class="fa-solid fa-map" style="color: #3b82f6;"></i> <strong>Region:</strong> ${school.region || school.la}</span>
                ${school.urn ? `<span>•</span><span><strong>URN:</strong> ${school.urn}</span>` : ''}
              </div>
            </div>
          </div>

          <!-- Clean Parent-Relevant Tags with Rich Icons -->
          <div class="detail-tags-row" style="display: flex; gap: 0.45rem; margin-top: 0.85rem; flex-wrap: wrap; align-items: center;">
            <span class="badge-ofsted" style="font-size: 0.78rem;"><i class="fa-solid fa-star"></i> ${formatOfsted(userOverrides.ofstedRating || school.ofstedRating)}</span>
            <span class="badge-exam" style="font-size: 0.78rem; background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe;">
              <i class="fa-solid ${school.schoolType === 'Grammar' ? 'fa-landmark' : (school.schoolType === 'Independent' ? 'fa-graduation-cap' : 'fa-school')}"></i> ${userOverrides.schoolType || school.rawSchoolType || school.schoolType}
            </span>
            <span class="badge-exam" style="font-size: 0.78rem; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1;">
              <i class="fa-solid ${school.gender === 'Girls' ? 'fa-venus' : (school.gender === 'Boys' ? 'fa-mars' : 'fa-venus-mars')}"></i> ${userOverrides.gender || school.gender}
            </span>
            ${school.ageRange ? `<span class="badge-exam" style="font-size: 0.78rem; background: #f8fafc; color: #475569; border: 1px solid #cbd5e1;"><i class="fa-solid fa-id-badge"></i> Age ${school.ageRange}</span>` : ''}
            ${school.pupilCount ? `<span class="badge-exam" style="font-size: 0.78rem; background: #f8fafc; color: #475569; border: 1px solid #cbd5e1;"><i class="fa-solid fa-users-line"></i> ${school.pupilCount.toLocaleString()} pupils</span>` : ''}
            ${school.hot ? `<span class="badge-hot" style="font-size: 0.76rem;"><i class="fa-solid fa-fire-flame-curved"></i> Hot School</span>` : ''}
            ${school.active === false
              ? '<span class="badge" style="font-size: 0.78rem; background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; font-weight: 700;"><i class="fa-solid fa-ban"></i> Permanently Closed / Inactive</span>'
              : '<span class="badge" style="font-size: 0.78rem; background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Active School</span>'}
            ${secondStageRequired.startsWith('Yes') ? `<span class="badge-exam" style="font-size: 0.76rem; background: #fef3c7; color: #92400e; border: 1px solid #fde68a;"><i class="fa-solid fa-bolt-lightning"></i> 2-Stage Selective Exam</span>` : ''}

            <!-- Admin Quick Toggles (Admin Only) -->
            ${currentPermissions.includes('admin:edit') ? `
              <button type="button" class="btn" id="toggle-active-btn" style="border:none; cursor:pointer; padding:0;" title="Click to toggle Active/Closed status">
                <span style="font-size:0.72rem; padding:0.18rem 0.45rem; border-radius:999px; background:${school.active === false ? '#fee2e2' : '#f0fdf4'}; color:${school.active === false ? '#991b1b' : '#166534'}; border:1px solid ${school.active === false ? '#fca5a5' : '#bbf7d0'};"><i class="fa-solid ${school.active === false ? 'fa-ban' : 'fa-circle-check'}"></i> ${school.active === false ? 'Status: Closed' : 'Status: Active'} ✏️</span>
              </button>
              <button type="button" class="btn" id="toggle-hot-btn" style="border:none; cursor:pointer; padding:0;" title="Click to toggle Hot status">
                <span style="font-size:0.72rem; padding:0.18rem 0.45rem; border-radius:999px; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;"><i class="fa-solid fa-fire"></i> ${school.hot ? 'Hot (Active)' : 'Mark Hot'} ✏️</span>
              </button>
              <button type="button" class="btn" id="toggle-official-btn" style="border:none; cursor:pointer; padding:0;" title="Click to toggle Official status">
                <span style="font-size:0.72rem; padding:0.18rem 0.45rem; border-radius:999px; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;"><i class="fa-solid fa-circle-check"></i> ${school.official ? 'Official DfE' : 'Unofficial'} ✏️</span>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- At-a-Glance Parent Summary Tiles (v2) -->
        ${summaryTilesHtml}

        <!-- Chronological Admissions Timeline Stepper (v2) -->
        ${timelineStepperHtml}

        <p style="margin-bottom: 1.25rem; color: #334155; font-size: 0.92rem; line-height: 1.5; background: #f8fafc; padding: 0.85rem 1rem; border-radius: 8px; border: 1px solid #e2e8f0;">
          ${school.description || 'Comprehensive admissions and curriculum profile verified across UK official educational registers and examination guides.'}
        </p>

        <div class="detail-sections-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.1rem;">
          ${admissionsUnifiedHtml}
          ${financialsHtml}
          ${academicMetricsHtml}
          ${policyHtml}
          ${adminQualityHtml}
          ${contactHtml}
        </div>

        <div style="margin-top: 1.5rem; display: flex; gap: 0.65rem; flex-wrap:wrap; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 1.25rem;">
          <button type="button" class="btn ${userSelectedSchools.some(u => u.id === school.id) ? 'btn-primary' : 'btn-outline'}" id="detail-shortlist-btn" style="${userSelectedSchools.some(u => u.id === school.id) ? 'background:#059669; border-color:#059669;' : 'color:#059669; border-color:#6ee7b7;'}">
            <i class="fa-solid ${userSelectedSchools.some(u => u.id === school.id) ? 'fa-check' : 'fa-plus'}"></i> ${userSelectedSchools.some(u => u.id === school.id) ? 'Shortlisted' : 'Add to Shortlist'}
          </button>

          ${school.website ? `<a href="${school.website}" target="_blank" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-globe"></i> Official Website</a>` : ''}
          ${school.compareSchoolPerformanceUrl ? `<a href="${school.compareSchoolPerformanceUrl}" target="_blank" class="btn btn-outline" style="color:#059669; border-color:#6ee7b7; display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-chart-bar"></i> Compare Performance</a>` : ''}
          ${school.phone ? `<a href="tel:${school.phone}" class="btn btn-outline" style="display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-phone"></i> ${school.phone}</a>` : ''}
          ${school.email ? `<a href="mailto:${school.email}" class="btn btn-outline" style="display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-envelope"></i> Email School</a>` : ''}

          ${isAdminUser ? `
            <button type="button" class="btn btn-outline" id="detail-edit-specs-btn" style="color:#0284c7; border-color:#bae6fd; margin-left:auto; display: inline-flex; align-items: center; gap: 0.35rem;">
              <i class="fa-solid fa-pen-to-square"></i> Edit Specs
            </button>
            <button type="button" class="btn btn-outline" id="detail-version-history-btn" style="color:#4f46e5; border-color:#c7d2fe; display: inline-flex; align-items: center; gap: 0.35rem;">
              <i class="fa-solid fa-clock-rotate-left"></i> Version History
            </button>
            <button type="button" class="btn btn-primary" id="detail-merge-btn" style="background:#7c3aed; border-color:#7c3aed; display: inline-flex; align-items: center; gap: 0.35rem;">
              <i class="fa-solid fa-code-merge"></i> Merge Record
            </button>
          ` : ''}
        </div>
      `;
    } else {
      // Version 1: Classic Tabular View
      detailContent.innerHTML = `
        ${viewSwitcherToolbarHtml}

        <div class="detail-header-hero" style="border-bottom: 1px solid #e2e8f0; padding-bottom: 1.25rem; margin-bottom: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
            <div>
              <h2 style="font-size: 1.55rem; font-weight: 800; color: #0f172a; margin: 0 0 0.35rem 0; letter-spacing: -0.02em;">
                ${school.name}
              </h2>
              <div style="color: #64748b; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span><i class="fa-solid fa-location-dot" style="color: #ef4444;"></i> ${school.address || school.la}, ${school.postcode || ''}</span>
                <span>•</span>
                <span><strong>Region:</strong> ${school.region || school.la}</span>
              </div>
            </div>
          </div>

          <!-- Clean Parent-Relevant Tags -->
          <div class="detail-tags-row" style="display: flex; gap: 0.45rem; margin-top: 0.85rem; flex-wrap: wrap; align-items: center;">
            <span class="badge-ofsted" style="font-size: 0.78rem;"><i class="fa-solid fa-star"></i> ${formatOfsted(userOverrides.ofstedRating || school.ofstedRating)}</span>
            <span class="badge-exam" style="font-size: 0.78rem; background: #e0e7ff; color: #3730a3;"><i class="fa-solid fa-school"></i> ${userOverrides.schoolType || school.rawSchoolType || school.schoolType}</span>
            <span class="badge-exam" style="font-size: 0.78rem; background: #f1f5f9; color: #334155;"><i class="fa-solid fa-venus-mars"></i> ${userOverrides.gender || school.gender}</span>
            ${school.ageRange ? `<span class="badge-exam" style="font-size: 0.78rem; background: #f8fafc; color: #475569; border: 1px solid #cbd5e1;"><i class="fa-solid fa-user-group"></i> Age ${school.ageRange}</span>` : ''}
            ${school.pupilCount ? `<span class="badge-exam" style="font-size: 0.78rem; background: #f8fafc; color: #475569; border: 1px solid #cbd5e1;"><i class="fa-solid fa-users"></i> ${school.pupilCount.toLocaleString()} pupils</span>` : ''}
            ${school.hot ? `<span class="badge-hot" style="font-size: 0.76rem;"><i class="fa-solid fa-fire"></i> Hot School</span>` : ''}
            ${school.active === false
              ? '<span class="badge" style="font-size: 0.78rem; background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; font-weight: 700;"><i class="fa-solid fa-ban"></i> Permanently Closed / Inactive</span>'
              : '<span class="badge" style="font-size: 0.78rem; background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Active School</span>'}
            ${secondStageRequired.startsWith('Yes') ? `<span class="badge-exam" style="font-size: 0.76rem; background: #fef3c7; color: #92400e; border: 1px solid #fde68a;"><i class="fa-solid fa-award"></i> 2-Stage Selective Exam</span>` : ''}

            <!-- Admin Quick Toggles (Admin Only) -->
            ${currentPermissions.includes('admin:edit') ? `
              <button type="button" class="btn" id="toggle-active-btn" style="border:none; cursor:pointer; padding:0;" title="Click to toggle Active/Closed status">
                <span style="font-size:0.72rem; padding:0.18rem 0.45rem; border-radius:999px; background:${school.active === false ? '#fee2e2' : '#f0fdf4'}; color:${school.active === false ? '#991b1b' : '#166534'}; border:1px solid ${school.active === false ? '#fca5a5' : '#bbf7d0'};"><i class="fa-solid ${school.active === false ? 'fa-ban' : 'fa-circle-check'}"></i> ${school.active === false ? 'Status: Closed' : 'Status: Active'} ✏️</span>
              </button>
              <button type="button" class="btn" id="toggle-hot-btn" style="border:none; cursor:pointer; padding:0;" title="Click to toggle Hot status">
                <span style="font-size:0.72rem; padding:0.18rem 0.45rem; border-radius:999px; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;"><i class="fa-solid fa-fire"></i> ${school.hot ? 'Hot (Active)' : 'Mark Hot'} ✏️</span>
              </button>
              <button type="button" class="btn" id="toggle-official-btn" style="border:none; cursor:pointer; padding:0;" title="Click to toggle Official status">
                <span style="font-size:0.72rem; padding:0.18rem 0.45rem; border-radius:999px; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;"><i class="fa-solid fa-circle-check"></i> ${school.official ? 'Official DfE' : 'Unofficial'} ✏️</span>
              </button>
            ` : ''}
          </div>
        </div>

        <p style="margin-bottom: 1.25rem; color: #334155; font-size: 0.92rem; line-height: 1.5; background: #f8fafc; padding: 0.85rem 1rem; border-radius: 8px; border: 1px solid #e2e8f0;">
          ${school.description || 'Comprehensive admissions and curriculum profile verified across UK official educational registers and examination guides.'}
        </p>

        <div class="detail-sections-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.1rem;">
          ${admissionsUnifiedHtml}
          ${financialsHtml}
          ${academicMetricsHtml}
          ${policyHtml}
          ${adminQualityHtml}
          ${contactHtml}
        </div>

        <div style="margin-top: 1.5rem; display: flex; gap: 0.65rem; flex-wrap:wrap; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 1.25rem;">
          <button type="button" class="btn ${userSelectedSchools.some(u => u.id === school.id) ? 'btn-primary' : 'btn-outline'}" id="detail-shortlist-btn" style="${userSelectedSchools.some(u => u.id === school.id) ? 'background:#059669; border-color:#059669;' : 'color:#059669; border-color:#6ee7b7;'}">
            <i class="fa-solid ${userSelectedSchools.some(u => u.id === school.id) ? 'fa-check' : 'fa-plus'}"></i> ${userSelectedSchools.some(u => u.id === school.id) ? 'Shortlisted' : 'Add to Shortlist'}
          </button>

          ${school.website ? `<a href="${school.website}" target="_blank" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-globe"></i> Official Website</a>` : ''}
          ${school.compareSchoolPerformanceUrl ? `<a href="${school.compareSchoolPerformanceUrl}" target="_blank" class="btn btn-outline" style="color:#059669; border-color:#6ee7b7; display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-chart-bar"></i> Compare Performance</a>` : ''}
          ${school.phone ? `<a href="tel:${school.phone}" class="btn btn-outline" style="display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-phone"></i> ${school.phone}</a>` : ''}
          ${school.email ? `<a href="mailto:${school.email}" class="btn btn-outline" style="display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-envelope"></i> Email School</a>` : ''}

          ${isAdminUser ? `
            <button type="button" class="btn btn-outline" id="detail-edit-specs-btn" style="color:#0284c7; border-color:#bae6fd; margin-left:auto; display: inline-flex; align-items: center; gap: 0.35rem;">
              <i class="fa-solid fa-pen-to-square"></i> Edit Specs
            </button>
            <button type="button" class="btn btn-outline" id="detail-version-history-btn" style="color:#4f46e5; border-color:#c7d2fe; display: inline-flex; align-items: center; gap: 0.35rem;">
              <i class="fa-solid fa-clock-rotate-left"></i> Version History
            </button>
            <button type="button" class="btn btn-primary" id="detail-merge-btn" style="background:#7c3aed; border-color:#7c3aed; display: inline-flex; align-items: center; gap: 0.35rem;">
              <i class="fa-solid fa-code-merge"></i> Merge Record
            </button>
          ` : ''}
        </div>
      `;
    }

    // Wire view toggle buttons
    detailContent.querySelectorAll('.btn-toggle-view').forEach(btn => {
      btn.addEventListener('click', (e) => {
        currentDetailViewVersion = e.currentTarget.dataset.version || 'v2';
        localStorage.setItem('schooldb_detail_view_version', currentDetailViewVersion);
        openSchoolDetail(school.id);
      });
    });

    // Wire Shortlist button listener
    const detailShortlistBtn = document.getElementById('detail-shortlist-btn');
    if (detailShortlistBtn) {
      detailShortlistBtn.addEventListener('click', (e) => {
        e.preventDefault();
        addUserSchool(school);
        openSchoolDetail(school.id);
      });
    }

    // Wire Edit Specs button listener for admin
    const detailEditSpecsBtn = document.getElementById('detail-edit-specs-btn');
    if (detailEditSpecsBtn && currentPermissions.includes('admin:edit')) {
      detailEditSpecsBtn.addEventListener('click', () => {
        document.getElementById('detail-modal').style.display = 'none';
        if (typeof openEditModal === 'function') {
          openEditModal(school.id);
        }
      });
    }

    // Wire Version History button listener for admin:portal permission
    const detailHistoryBtn = document.getElementById('detail-version-history-btn');
    if (detailHistoryBtn && currentPermissions.includes('admin:portal')) {
      detailHistoryBtn.addEventListener('click', () => {
        if (typeof openSchoolVersionHistoryModal === 'function') {
          openSchoolVersionHistoryModal(school.id, school.name);
        }
      });
    }

    // Wire merge listener for admin:portal permission
    const detailMergeBtn = document.getElementById('detail-merge-btn');
    if (detailMergeBtn && currentPermissions.includes('admin:portal')) {
      detailMergeBtn.addEventListener('click', () => {
        document.getElementById('detail-modal').style.display = 'none';
        switchTab('admin');
        preselectMergeSchoolA(school);
        const card = document.getElementById('merge-dedup-card');
        if (card) card.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Wire toggle listeners for admin:edit permission
    const activeBtn = document.getElementById('toggle-active-btn');
    if (activeBtn && currentPermissions.includes('admin:edit')) {
      activeBtn.addEventListener('click', async () => {
        const currentAct = (school.active !== false && school.active !== 0 && school.active !== 'false');
        const newActive = !currentAct;
        await updateSchoolPill(school.id, { active: newActive });
        showToast(`School status updated: ${newActive ? 'Marked as Active (Open) ✓' : 'Marked as Inactive / Closed ⚠️'}`);
        openSchoolDetail(school.id);
        await loadSchools();
      });
    }

    const hotBtn = document.getElementById('toggle-hot-btn');
    if (hotBtn && currentPermissions.includes('admin:edit')) {
      hotBtn.addEventListener('click', async () => {
        const newHot = !school.hot;
        await updateSchoolPill(school.id, { hot: newHot });
        showToast(`School status updated: ${newHot ? 'Marked as Hot 🔥' : 'Removed Hot status'}`);
        openSchoolDetail(school.id);
        await loadSchools();
      });
    }

    const officialBtn = document.getElementById('toggle-official-btn');
    if (officialBtn && currentPermissions.includes('admin:edit')) {
      officialBtn.addEventListener('click', async () => {
        const newOfficial = !school.official;
        await updateSchoolPill(school.id, { official: newOfficial });
        showToast(`School status updated: ${newOfficial ? 'Marked as Official DfE ✓' : 'Marked as Unofficial'}`);
        openSchoolDetail(school.id);
        await loadSchools();
      });
    }

    // Wire Field Rating & Custom Override buttons
    detailContent.querySelectorAll('.btn-thumb-up').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const sId = btn.getAttribute('data-school-id');
        const fName = btn.getAttribute('data-field-name');
        const origVal = btn.getAttribute('data-orig');
        try {
          await fetch('/api/user-reports', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
            },
            body: JSON.stringify({ schoolId: sId, fieldName: fName, status: 'up', originalValue: origVal })
          });
          showToast(`Marked ${btn.getAttribute('data-label')} as accurate 👍`, 'success');
          openSchoolDetail(sId);
        } catch (err) {
          showToast('Failed to save field rating', 'error');
        }
      });
    });

    detailContent.querySelectorAll('.btn-thumb-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sId = btn.getAttribute('data-school-id');
        const fName = btn.getAttribute('data-field-name');
        const fLabel = btn.getAttribute('data-label');
        const origVal = btn.getAttribute('data-orig');
        const existingCustom = btn.getAttribute('data-custom');

        document.getElementById('override-school-id').value = sId;
        document.getElementById('override-field-name').value = fName;
        document.getElementById('override-original-val').value = origVal;
        document.getElementById('override-field-display-name').innerText = fLabel;
        document.getElementById('override-field-display-orig').innerText = origVal || 'N/A';
        document.getElementById('override-custom-value-input').value = existingCustom || '';

        const modal = document.getElementById('field-override-modal');
        if (modal) {
          modal.style.display = 'flex';
          modal.style.zIndex = '25000';
          setTimeout(() => {
            const input = document.getElementById('override-custom-value-input');
            if (input) {
              input.focus();
              input.select();
            }
          }, 50);
        }
      });
    });

    detailContent.querySelectorAll('.btn-reset-field-report').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const sId = btn.getAttribute('data-school-id');
        const fName = btn.getAttribute('data-field-name');
        try {
          await fetch('/api/user-reports', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
            },
            body: JSON.stringify({ schoolId: sId, fieldName: fName })
          });
          showToast('Reset custom value to master record', 'info');
          openSchoolDetail(sId);
        } catch (err) {
          showToast('Failed to reset field value', 'error');
        }
      });
    });

    // Wire Modal Distance Calculator
    const calcBtn = document.getElementById('modal-btn-calc-distance');
    const pcInput = document.getElementById('modal-user-postcode-input');
    const valSpan = document.getElementById('modal-distance-value');
    const notesDiv = document.getElementById('modal-distance-notes');
    const mapsLink = document.getElementById('modal-maps-link');

    const runDistanceCalc = async () => {
      const userPc = pcInput ? pcInput.value.trim() : '';
      const schoolPc = school.postcode || '';

      if (!userPc) {
        if (notesDiv) notesDiv.textContent = 'Please enter your UK postcode.';
        return;
      }
      if (!schoolPc) {
        if (notesDiv) notesDiv.textContent = 'School does not have a recorded postcode.';
        return;
      }

      if (valSpan) valSpan.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Calculating...';
      if (notesDiv) notesDiv.textContent = '';

      try {
        const res = await fetch(`/api/distance?from=${encodeURIComponent(userPc)}&to=${encodeURIComponent(schoolPc)}`);
        const data = await res.json();

        if (res.ok && data.success) {
          if (valSpan) valSpan.textContent = `${data.distanceMiles} mi (${data.distanceKm} km)`;
          if (notesDiv) {
            notesDiv.textContent = `${data.accuracyDescription} • Straight-line distance from ${data.from}`;
          }
          if (mapsLink) {
            mapsLink.href = data.googleMapsDirectionsUrl;
            mapsLink.style.display = 'inline-flex';
          }
          // Store user postcode persistently
          try {
            localStorage.setItem('user_home_postcode', data.from);
            const mainPcInput = document.getElementById('filter-user-postcode');
            if (mainPcInput && !mainPcInput.value) mainPcInput.value = data.from;
          } catch (e) {}
        } else {
          if (valSpan) valSpan.textContent = 'Unavailable';
          if (notesDiv) notesDiv.textContent = data.error || 'Could not calculate distance.';
          if (mapsLink) mapsLink.style.display = 'none';
        }
      } catch (e) {
        if (valSpan) valSpan.textContent = 'Error';
        if (notesDiv) notesDiv.textContent = 'Connection error calculating distance.';
      }
    };

    if (calcBtn) {
      calcBtn.addEventListener('click', runDistanceCalc);
    }
    if (pcInput) {
      pcInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          runDistanceCalc();
        }
      });
      // Pre-fill from localStorage or filter
      const storedPc = localStorage.getItem('user_home_postcode') || (document.getElementById('filter-user-postcode') ? document.getElementById('filter-user-postcode').value.trim() : '');
      if (storedPc && school.postcode) {
        pcInput.value = storedPc;
        runDistanceCalc();
      }
    }

    bindConfidenceVoteEvents();
    const detailModal = document.getElementById('detail-modal');
    if (detailModal) {
      detailModal.style.display = 'flex';
      detailModal.style.zIndex = '15000';
    }

  } catch (err) {
    console.error('Error loading school details:', err);
  }
}

// Toggle Compare Selection
function toggleCompare(id) {
  const school = currentSchools.find(s => s.id === id);
  if (!school) return;

  const index = compareList.findIndex(s => s.id === id);
  if (index >= 0) {
    compareList.splice(index, 1);
  } else {
    if (compareList.length >= 3) {
      alert('You can compare a maximum of 3 high schools side-by-side.');
      return;
    }
    compareList.push(school);
  }

  const compareBtn = document.getElementById('compare-bar-btn');
  document.getElementById('compare-count').textContent = compareList.length;
  compareBtn.style.display = compareList.length > 0 ? 'inline-flex' : 'none';

  renderSchools();
}

// Render Compare Modal Matrix
function openCompareModal() {
  if (compareList.length === 0) return;

  const container = document.getElementById('compare-table-container');

  let tableHtml = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>Metric / Attribute</th>
          ${compareList.map(s => `<th>${s.name}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>Data Source</th>
          ${compareList.map(s => `<td>${s.official
            ? `<span class="badge-official"><i class="fa-solid fa-circle-check"></i> Official DfE${s.compareSchoolPerformanceUrl ? ` &nbsp;<a href="${s.compareSchoolPerformanceUrl}" target="_blank" style="color:inherit; text-decoration:underline;">View ↗</a>` : ''}</span>`
            : '<span style="color:#94a3b8; font-size:0.8rem;">Unofficial</span>'}</td>`).join('')}
        </tr>
        <tr>
          <th>Local Authority</th>
          ${compareList.map(s => `<td>${s.la} (${s.postcode || ''})</td>`).join('')}
        </tr>
        <tr>
          <th>School Type</th>
          ${compareList.map(s => `<td>${s.schoolType} (${s.gender})</td>`).join('')}
        </tr>
        <tr>
          <th>Ofsted Rating</th>
          ${compareList.map(s => `<td><span class="badge-ofsted">${formatOfsted(s.ofstedRating)}</span></td>`).join('')}
        </tr>
        <tr>
          <th>Pupil Count</th>
          ${compareList.map(s => `<td>${s.pupilCount ? s.pupilCount.toLocaleString() : 'N/A'}</td>`).join('')}
        </tr>
        <tr>
          <th>Entrance Exam Type</th>
          ${compareList.map(s => `<td><strong>${s.entranceExamType}</strong></td>`).join('')}
        </tr>
        <tr>
          <th>Exam Sittings Date</th>
          ${compareList.map(s => `<td>${(s.entranceExamDates && s.entranceExamDates.examDate) || 'N/A'}</td>`).join('')}
        </tr>
        <tr>
          <th>GCSE Attainment 8</th>
          ${compareList.map(s => `<td><strong>${s.gcseAttainment8 !== null && s.gcseAttainment8 !== undefined ? s.gcseAttainment8 : 'N/A'}</strong></td>`).join('')}
        </tr>
        <tr>
          <th>GCSE Progress 8</th>
          ${compareList.map(s => `<td>${s.gcseProgress8 !== null && s.gcseProgress8 !== undefined ? s.gcseProgress8 : 'N/A'}</td>`).join('')}
        </tr>
        <tr>
          <th>Top GCSE Subjects</th>
          ${compareList.map(s => `<td>${s.gcseSubjects ? s.gcseSubjects.slice(0, 6).join(', ') + '...' : 'N/A'}</td>`).join('')}
        </tr>
      </tbody>
    </table>
  `;

  container.innerHTML = tableHtml;
  document.getElementById('compare-modal').style.display = 'flex';
}

// Helper to update pill flags (hot, official/verified) for a school
async function updateSchoolPill(id, fields) {
  try {
    const res = await fetch(`/api/schools/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Update failed');
    }
    return await res.json();
  } catch (err) {
    console.error('Error updating school pill:', err);
    showToast('Failed to update school status', 'error');
  }
}

// =============================================================
// ADMIN BULK EDIT CONTROLLER & BATCH MODIFIER
// =============================================================

let bulkSelectedSchoolIds = new Set();
let bulkFilteredSchools = [];

async function renderBulkEditTable() {
  const tableBody = document.getElementById('bulk-schools-table-body');
  if (!tableBody) return;

  const allSchoolsList = await getAllSchoolsList();

  const searchKeyword = (document.getElementById('bulk-search-input')?.value || '').toLowerCase().trim();
  const laFilter = document.getElementById('bulk-la-filter')?.value || '';
  const typeFilter = document.getElementById('bulk-type-filter')?.value || '';
  const ofstedFilter = document.getElementById('bulk-ofsted-filter')?.value || '';

  // Populate bulk LA filter if not populated
  const bulkLaSelect = document.getElementById('bulk-la-filter');
  if (bulkLaSelect && bulkLaSelect.options.length <= 1) {
    const las = Array.from(new Set(allSchoolsList.map(s => s.la).filter(Boolean))).sort();
    las.forEach(la => {
      const opt = document.createElement('option');
      opt.value = la;
      opt.textContent = la;
      bulkLaSelect.appendChild(opt);
    });
  }

  bulkFilteredSchools = allSchoolsList.filter(school => {
    if (searchKeyword) {
      const nameMatch = (school.name || '').toLowerCase().includes(searchKeyword);
      const urnMatch = (school.urn || '').toString().includes(searchKeyword);
      const laMatch = (school.la || '').toLowerCase().includes(searchKeyword);
      if (!nameMatch && !urnMatch && !laMatch) return false;
    }
    if (laFilter && school.la !== laFilter) return false;
    if (typeFilter && !(school.schoolType || '').includes(typeFilter)) return false;
    if (ofstedFilter && !(school.ofstedRating || '').includes(ofstedFilter)) return false;
    return true;
  });

  const filteredCountEl = document.getElementById('bulk-filtered-count');
  if (filteredCountEl) filteredCountEl.textContent = bulkFilteredSchools.length;

  tableBody.innerHTML = '';

  if (bulkFilteredSchools.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 2rem; color: #94a3b8;">
          No matching schools found for bulk editing.
        </td>
      </tr>
    `;
    updateBulkSelectionUI();
    return;
  }

  // Render top 250 rows for snappy performance
  const displaySchools = bulkFilteredSchools.slice(0, 250);

  displaySchools.forEach(school => {
    const isSelected = bulkSelectedSchoolIds.has(school.id);
    const tr = document.createElement('tr');
    tr.className = isSelected ? 'bulk-row-selected' : '';
    tr.setAttribute('data-school-id', school.id);

    tr.innerHTML = `
      <td style="text-align: center;" onclick="event.stopPropagation();">
        <input type="checkbox" class="bulk-row-checkbox" data-id="${school.id}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;">
      </td>
      <td>
        <strong style="color: #1e293b; display: block;">${school.name}</strong>
        <span style="font-size: 0.75rem; color: #64748b;">${school.address || school.postcode || ''}</span>
      </td>
      <td><code style="font-size: 0.78rem;">${school.urn || '—'}</code></td>
      <td>${school.la || '—'}</td>
      <td><span class="school-type-pill ${school.schoolType?.includes('Grammar') ? 'pill-grammar' : school.schoolType?.includes('Independent') ? 'pill-independent' : 'pill-comprehensive'}">${school.schoolType || '—'}</span></td>
      <td>${school.gender || 'Mixed'}</td>
      <td><span class="badge-ofsted"><i class="fa-solid fa-star"></i> ${formatOfsted(school.ofstedRating)}</span></td>
      <td><span class="badge-exam">${formatExam(school.entranceExamType)}</span></td>
      <td>
        <div style="display: flex; gap: 0.25rem; flex-wrap: wrap;">
          ${school.hot ? '<span class="badge-hot" style="font-size:0.7rem; padding: 0.1rem 0.35rem;"><i class="fa-solid fa-fire"></i> Hot</span>' : ''}
          ${school.official ? '<span class="badge-official" style="font-size:0.7rem; padding: 0.1rem 0.35rem;"><i class="fa-solid fa-circle-check"></i> DfE</span>' : ''}
        </div>
      </td>
      <td><strong>${school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined ? school.gcseAttainment8 : '—'}</strong></td>
    `;

    // Row click toggles selection
    tr.addEventListener('click', (e) => {
      if (e.target.tagName.toLowerCase() === 'input') return;
      const checkbox = tr.querySelector('.bulk-row-checkbox');
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        toggleBulkSchoolSelection(school.id, checkbox.checked);
      }
    });

    const checkbox = tr.querySelector('.bulk-row-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        toggleBulkSchoolSelection(school.id, e.target.checked);
      });
    }

    tableBody.appendChild(tr);
  });

  if (bulkFilteredSchools.length > 250) {
    const footerTr = document.createElement('tr');
    footerTr.innerHTML = `
      <td colspan="10" style="text-align: center; background: #f8fafc; color: #64748b; font-size: 0.8rem; padding: 0.6rem;">
        Showing top 250 of ${bulkFilteredSchools.length} matching schools. Use the search filters above to narrow your list.
      </td>
    `;
    tableBody.appendChild(footerTr);
  }

  updateBulkSelectionUI();
}

function toggleBulkSchoolSelection(schoolId, isSelected) {
  if (isSelected) {
    bulkSelectedSchoolIds.add(schoolId);
  } else {
    bulkSelectedSchoolIds.delete(schoolId);
  }
  updateBulkSelectionUI();
}

function updateBulkSelectionUI() {
  const count = bulkSelectedSchoolIds.size;
  const countBadge = document.getElementById('bulk-selected-count');
  if (countBadge) countBadge.textContent = count;

  const btnCount = document.getElementById('bulk-apply-btn-count');
  if (btnCount) btnCount.textContent = count;

  const applyBtn = document.getElementById('btn-apply-bulk-edit');
  const fieldSelect = document.getElementById('bulk-field-select');
  if (applyBtn) {
    applyBtn.disabled = count === 0 || !fieldSelect?.value;
  }

  // Update row highlights
  document.querySelectorAll('#bulk-schools-table tbody tr[data-school-id]').forEach(tr => {
    const sId = tr.getAttribute('data-school-id');
    if (bulkSelectedSchoolIds.has(sId)) {
      tr.classList.add('bulk-row-selected');
    } else {
      tr.classList.remove('bulk-row-selected');
    }
  });

  // Master checkbox state
  const masterCheck = document.getElementById('bulk-master-checkbox');
  if (masterCheck && bulkFilteredSchools.length > 0) {
    const visible = bulkFilteredSchools.slice(0, 250);
    const allVisibleSelected = visible.length > 0 && visible.every(s => bulkSelectedSchoolIds.has(s.id));
    masterCheck.checked = allVisibleSelected;
  }
}

function updateBulkValueInput(fieldName) {
  const container = document.getElementById('bulk-value-input-container');
  if (!container) return;

  const applyBtn = document.getElementById('btn-apply-bulk-edit');
  if (applyBtn) {
    applyBtn.disabled = bulkSelectedSchoolIds.size === 0 || !fieldName;
  }

  if (!fieldName) {
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-pen"></i> New Value
      </label>
      <input type="text" id="bulk-val-input" placeholder="Select a field first..." disabled style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; background: #f1f5f9;">
    `;
    return;
  }

  if (fieldName === 'ofstedRating') {
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-star" style="color: #eab308;"></i> New Ofsted Rating
      </label>
      <select id="bulk-val-input" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; background: white;">
        <option value="Outstanding">Outstanding</option>
        <option value="Good">Good</option>
        <option value="Requires Improvement">Requires Improvement</option>
        <option value="Independent (ISI Excellent)">Independent (ISI Excellent)</option>
      </select>
    `;
  } else if (fieldName === 'schoolType') {
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-school" style="color: #2563eb;"></i> New School Type
      </label>
      <select id="bulk-val-input" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; background: white;">
        <option value="Grammar">Grammar</option>
        <option value="Independent">Independent</option>
        <option value="Comprehensive">Comprehensive</option>
      </select>
    `;
  } else if (fieldName === 'gender') {
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-users" style="color: #7c3aed;"></i> New Gender
      </label>
      <select id="bulk-val-input" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; background: white;">
        <option value="Girls">Girls Only</option>
        <option value="Boys">Boys Only</option>
        <option value="Mixed">Mixed</option>
      </select>
    `;
  } else if (fieldName === 'entranceExamType') {
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-pen-nib" style="color: #d97706;"></i> New Entrance Exam Type
      </label>
      <select id="bulk-val-input" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; background: white;">
        <option value="11+ GL Assessment">11+ GL Assessment</option>
        <option value="Sutton SET">Sutton Selective Eligibility Test (SET)</option>
        <option value="Two-Stage 11+">Two-Stage 11+</option>
        <option value="ISEB Pre-test">ISEB Pre-test / Common Entrance</option>
        <option value="Non-selective">Non-selective (Comprehensive)</option>
        <option value="Banding Assessment">Banding Assessment</option>
      </select>
    `;
  } else if (fieldName === 'hot') {
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-fire" style="color: #ef4444;"></i> Hot School Status
      </label>
      <select id="bulk-val-input" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; background: white;">
        <option value="true">🔥 Mark as Hot School</option>
        <option value="false">Remove Hot Badge</option>
      </select>
    `;
  } else if (fieldName === 'official') {
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-circle-check" style="color: #0284c7;"></i> Official DfE Status
      </label>
      <select id="bulk-val-input" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; background: white;">
        <option value="true">✓ Mark as Official DfE Data</option>
        <option value="false">Remove Official Badge</option>
      </select>
    `;
  } else if (fieldName === 'la') {
    const list = window._allSchoolsList || [];
    const las = Array.from(new Set(list.map(s => s.la).filter(Boolean))).sort();
    const optionsHtml = las.map(l => `<option value="${l}">${l}</option>`).join('');
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-map-location-dot" style="color: #059669;"></i> New Borough / LA
      </label>
      <select id="bulk-val-input" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; background: white;">
        ${optionsHtml}
      </select>
    `;
  } else if (fieldName === 'gcseAttainment8') {
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-chart-line" style="color: #059669;"></i> Attainment 8 Score
      </label>
      <input type="number" step="0.1" id="bulk-val-input" placeholder="e.g. 72.5" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
    `;
  } else if (fieldName === 'gcseProgress8') {
    container.innerHTML = `
      <label style="font-size: 0.8rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.3rem;">
        <i class="fa-solid fa-chart-line" style="color: #059669;"></i> Progress 8 Score
      </label>
      <input type="number" step="0.01" id="bulk-val-input" placeholder="e.g. 0.85" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
    `;
  }
}

async function executeBulkUpdate() {
  if (bulkSelectedSchoolIds.size === 0) {
    showToast('Please select at least one school to update.', 'warn');
    return;
  }

  const fieldSelect = document.getElementById('bulk-field-select');
  const fieldName = fieldSelect ? fieldSelect.value : '';
  if (!fieldName) {
    showToast('Please choose a property to modify.', 'warn');
    return;
  }

  const valInput = document.getElementById('bulk-val-input');
  if (!valInput) {
    showToast('Please enter a new value for the property.', 'warn');
    return;
  }

  let updateVal = valInput.value;
  if (fieldName === 'hot' || fieldName === 'official') {
    updateVal = (updateVal === 'true');
  } else if (fieldName === 'gcseAttainment8' || fieldName === 'gcseProgress8') {
    updateVal = parseFloat(updateVal);
    if (isNaN(updateVal)) {
      showToast('Please enter a valid numeric score.', 'warn');
      return;
    }
  }

  const count = bulkSelectedSchoolIds.size;
  if (!confirm(`Apply update [${fieldName} = ${updateVal}] to ${count} selected school record${count > 1 ? 's' : ''}?`)) {
    return;
  }

  try {
    const payload = {
      schoolIds: Array.from(bulkSelectedSchoolIds),
      updates: { [fieldName]: updateVal }
    };

    const res = await fetch('/api/admin/bulk-edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      showToast(`Batch update applied successfully to ${data.updatedCount || count} schools!`, 'success');
      
      // Invalidate school cache and reload
      window._allSchoolsList = null;
      await loadSchools();
      await renderBulkEditTable();
      bulkSelectedSchoolIds.clear();
      updateBulkSelectionUI();
    } else {
      const err = await res.json();
      showToast(`Bulk update failed: ${err.error || 'Server error'}`, 'error');
    }
  } catch (err) {
    console.error('Bulk update error:', err);
    showToast('Failed to execute bulk update request', 'error');
  }
}

// -------------------------------------------------------------
// SMART RECOMMENDATIONS ENGINE FRONTEND LOGIC
// -------------------------------------------------------------

// Load saved weights in admin form
async function loadRecWeights() {
  try {
    const res = await fetch('/api/recommendation-settings');
    const data = await res.json();
    const w = data.weights || { location: 35, examType: 25, academicPerformance: 20, ofstedRating: 10, schoolType: 10 };

    const loc = w.location ?? 35;
    const exam = w.examType ?? 25;
    const acad = w.academicPerformance ?? 20;
    const ofst = w.ofstedRating ?? 10;
    const type = w.schoolType ?? 10;

    if (document.getElementById('weight-location')) document.getElementById('weight-location').value = loc;
    if (document.getElementById('weight-exam')) document.getElementById('weight-exam').value = exam;
    if (document.getElementById('weight-academic')) document.getElementById('weight-academic').value = acad;
    if (document.getElementById('weight-ofsted')) document.getElementById('weight-ofsted').value = ofst;
    if (document.getElementById('weight-type')) document.getElementById('weight-type').value = type;

    if (document.getElementById('weight-val-location')) document.getElementById('weight-val-location').textContent = `${loc}%`;
    if (document.getElementById('weight-val-exam')) document.getElementById('weight-val-exam').textContent = `${exam}%`;
    if (document.getElementById('weight-val-academic')) document.getElementById('weight-val-academic').textContent = `${acad}%`;
    if (document.getElementById('weight-val-ofsted')) document.getElementById('weight-val-ofsted').textContent = `${ofst}%`;
    if (document.getElementById('weight-val-type')) document.getElementById('weight-val-type').textContent = `${type}%`;

    const recLimit = typeof data.recommendationLimit === 'number' ? data.recommendationLimit : 10;
    if (document.getElementById('setting-rec-limit')) document.getElementById('setting-rec-limit').value = recLimit;
    if (document.getElementById('weight-val-limit')) document.getElementById('weight-val-limit').textContent = `${recLimit} schools`;

    updateTotalWeightsPill();
  } catch (err) {
    console.error('Failed to load recommendation weights:', err);
  }
}

function updateTotalWeightsPill() {
  const loc = parseInt(document.getElementById('weight-location')?.value) || 0;
  const exam = parseInt(document.getElementById('weight-exam')?.value) || 0;
  const acad = parseInt(document.getElementById('weight-academic')?.value) || 0;
  const ofst = parseInt(document.getElementById('weight-ofsted')?.value) || 0;
  const type = parseInt(document.getElementById('weight-type')?.value) || 0;
  const total = loc + exam + acad + ofst + type;

  const pill = document.getElementById('weights-total-pill');
  if (pill) {
    pill.textContent = `Total: ${total}%`;
    if (total === 100) {
      pill.style.background = '#dcfce7';
      pill.style.color = '#166534';
    } else {
      pill.style.background = '#fef3c7';
      pill.style.color = '#92400e';
    }
  }
}

// Save weights from admin form
async function saveRecWeights(e) {
  e.preventDefault();
  const weights = {
    location: parseInt(document.getElementById('weight-location').value) || 0,
    examType: parseInt(document.getElementById('weight-exam').value) || 0,
    academicPerformance: parseInt(document.getElementById('weight-academic').value) || 0,
    ofstedRating: parseInt(document.getElementById('weight-ofsted').value) || 0,
    schoolType: parseInt(document.getElementById('weight-type').value) || 0
  };
  const recLimit = parseInt(document.getElementById('setting-rec-limit')?.value || '10', 10);
  const finalLimit = isNaN(recLimit) ? 10 : Math.max(1, Math.min(100, recLimit));

  try {
    const res = await fetch('/api/recommendation-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weights, limit: finalLimit })
    });
    if (res.ok) {
      showToast('Algorithm weights and limit updated successfully!', 'success');
      fetchRecommendations();
    } else {
      showToast('Failed to save algorithm weights', 'error');
    }
  } catch (err) {
    console.error('Error saving recommendation weights:', err);
    showToast('Error saving algorithm weights', 'error');
  }
}

// Load Admin Portal Settings (Rec weights & System Feature toggles & DB Instance & LLM Settings)
async function loadAdminSettings() {
  await loadRecWeights();
  await loadSystemSettings();
  await loadDatabaseInstanceSettings();
  await loadLlmSettings();
}

async function loadSystemSettings() {
  await fetchSystemSettings();
  await loadLlmSettings();
}

// ----------------------------------------------------
// LLM AI Automated School Intelligence & Engine Settings
// ----------------------------------------------------
let cachedDefaultLlmPrompt = '';
let pendingClearedKeys = { gemini: false, openai: false };
let isSettingsDirty = false;

function setAdminSettingsDirty(dirty = true) {
  isSettingsDirty = dirty;
  const dirtyBadges = document.querySelectorAll('.settings-dirty-indicator');
  dirtyBadges.forEach(b => {
    if (dirty) {
      b.style.display = 'inline-flex';
      b.innerHTML = '<i class="fa-solid fa-circle" style="font-size:0.5rem; color:#f59e0b;"></i> Unsaved Changes';
      b.style.background = '#fef3c7';
      b.style.color = '#92400e';
      b.style.borderColor = '#fde68a';
    } else {
      b.style.display = 'inline-flex';
      b.innerHTML = '<i class="fa-solid fa-check" style="color:#059669;"></i> Saved';
      b.style.background = '#dcfce7';
      b.style.color = '#166534';
      b.style.borderColor = '#bbf7d0';
    }
  });
}

async function loadLlmSettings() {
  try {
    const res = await fetch('/api/admin/settings', {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (!res.ok) return;

    const data = await res.json();
    const settings = data.settings || {};
    cachedDefaultLlmPrompt = settings.defaultPromptTemplate || data.defaultPromptTemplate || '';

    const provider = settings.llmProvider || 'gemini';
    const geminiModel = settings.geminiModel || 'gemini-3.6-flash';
    const openaiModel = settings.openaiModel || 'gpt-4o-mini';
    const skipDays = typeof settings.scannerSkipDays === 'number' ? settings.scannerSkipDays : 10;

    // Header Quick Stats
    const statProvider = document.getElementById('stat-active-provider');
    const statModel = document.getElementById('stat-active-model');
    const statKey = document.getElementById('stat-api-key-status');
    const statSkip = document.getElementById('stat-skip-days');

    if (statProvider) statProvider.textContent = provider === 'chatgpt' ? 'OpenAI ChatGPT' : 'Google Gemini';
    if (statModel) statModel.textContent = provider === 'chatgpt' ? openaiModel : geminiModel;
    if (statKey) {
      const activeHasKey = provider === 'chatgpt' ? settings.hasOpenaiKey : settings.hasGeminiKey;
      const activeMaskedKey = provider === 'chatgpt' ? settings.openaiKeyMasked : settings.geminiKeyMasked;
      statKey.textContent = activeHasKey ? `Saved (${activeMaskedKey || '••••'})` : 'Key Missing';
      statKey.style.color = activeHasKey ? '#6ee7b7' : '#fca5a5';
    }
    if (statSkip) statSkip.textContent = skipDays === 0 ? 'Disabled (0d)' : `${skipDays} Days`;

    // Provider Selector & Radio Cards
    const providerSelect = document.getElementById('setting-llm-provider');
    if (providerSelect) providerSelect.value = provider;

    const cardGemini = document.getElementById('provider-card-gemini');
    const cardChatgpt = document.getElementById('provider-card-chatgpt');
    const rGemini = document.querySelector('input[name="llm-provider-radio"][value="gemini"]');
    const rChatgpt = document.querySelector('input[name="llm-provider-radio"][value="chatgpt"]');

    if (provider === 'gemini') {
      if (cardGemini) cardGemini.classList.add('active');
      if (cardChatgpt) cardChatgpt.classList.remove('active');
      if (rGemini) rGemini.checked = true;
      if (rChatgpt) rChatgpt.checked = false;
    } else {
      if (cardChatgpt) cardChatgpt.classList.add('active');
      if (cardGemini) cardGemini.classList.remove('active');
      if (rChatgpt) rChatgpt.checked = true;
      if (rGemini) rGemini.checked = false;
    }

    const badge = document.getElementById('active-llm-provider-badge');
    if (badge) {
      if (provider === 'gemini') {
        badge.innerHTML = `<i class="fa-brands fa-google"></i> Active: Google Gemini (${geminiModel})`;
        badge.style.color = '#6d28d9';
        badge.style.background = '#f5f3ff';
        badge.style.borderColor = '#ddd6fe';
      } else {
        badge.innerHTML = `<i class="fa-solid fa-bolt"></i> Active: OpenAI ChatGPT (${openaiModel})`;
        badge.style.color = '#0369a1';
        badge.style.background = '#f0f9ff';
        badge.style.borderColor = '#bae6fd';
      }
    }

    // Model Dropdowns
    const geminiGroup = document.getElementById('llm-model-gemini-group');
    const chatgptGroup = document.getElementById('llm-model-chatgpt-group');
    const geminiModelSelect = document.getElementById('setting-gemini-model');
    const openaiModelSelect = document.getElementById('setting-openai-model');

    if (geminiGroup) geminiGroup.style.display = provider === 'gemini' ? 'block' : 'none';
    if (chatgptGroup) chatgptGroup.style.display = provider === 'chatgpt' ? 'block' : 'none';
    if (geminiModelSelect && settings.geminiModel) geminiModelSelect.value = settings.geminiModel;
    if (openaiModelSelect && settings.openaiModel) openaiModelSelect.value = settings.openaiModel;

    // API Key Credentials
    const geminiKeyInput = document.getElementById('setting-gemini-api-key');
    const openaiKeyInput = document.getElementById('setting-openai-api-key');
    const badgeGeminiKey = document.getElementById('badge-gemini-key-status');
    const badgeOpenaiKey = document.getElementById('badge-openai-key-status');

    if (badgeGeminiKey) {
      if (settings.hasGeminiKey) {
        badgeGeminiKey.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#059669;"></i> Saved (${settings.geminiKeyMasked || '••••'})`;
        badgeGeminiKey.style.color = '#059669';
        badgeGeminiKey.style.background = '#dcfce7';
      } else {
        badgeGeminiKey.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#dc2626;"></i> Not Configured`;
        badgeGeminiKey.style.color = '#dc2626';
        badgeGeminiKey.style.background = '#fee2e2';
      }
    }

    if (badgeOpenaiKey) {
      if (settings.hasOpenaiKey) {
        badgeOpenaiKey.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#059669;"></i> Saved (${settings.openaiKeyMasked || '••••'})`;
        badgeOpenaiKey.style.color = '#059669';
        badgeOpenaiKey.style.background = '#dcfce7';
      } else {
        badgeOpenaiKey.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#dc2626;"></i> Not Configured`;
        badgeOpenaiKey.style.color = '#dc2626';
        badgeOpenaiKey.style.background = '#fee2e2';
      }
    }

    if (geminiKeyInput) {
      geminiKeyInput.value = '';
      geminiKeyInput.placeholder = settings.hasGeminiKey ? `Saved: ${settings.geminiKeyMasked} (Enter new key to replace)` : 'Enter Gemini API key (e.g. AIzaSy... or AQ.Ab8R...)';
    }
    if (openaiKeyInput) {
      openaiKeyInput.value = '';
      openaiKeyInput.placeholder = settings.hasOpenaiKey ? `Saved: ${settings.openaiKeyMasked} (Enter new key to replace)` : 'Enter OpenAI API key (e.g. sk-proj-...)';
    }

    // Skip Days & Sleep Delay
    const skipInput = document.getElementById('setting-scanner-skip-days');
    if (skipInput) skipInput.value = skipDays;

    const delayInput = document.getElementById('setting-scanner-delay-seconds');
    if (delayInput) delayInput.value = typeof settings.scannerDelaySeconds === 'number' ? settings.scannerDelaySeconds : 20;

    // Prompt Template Editor
    const promptTextarea = document.getElementById('setting-llm-prompt-template');
    if (promptTextarea) {
      promptTextarea.value = settings.llmPromptTemplate || cachedDefaultLlmPrompt;
    }

    // Recommendation Weights
    if (settings.recWeights) {
      const w = settings.recWeights;
      if (document.getElementById('weight-location')) document.getElementById('weight-location').value = w.location ?? 35;
      if (document.getElementById('weight-exam')) document.getElementById('weight-exam').value = w.examType ?? 25;
      if (document.getElementById('weight-academic')) document.getElementById('weight-academic').value = w.academicPerformance ?? 20;
      if (document.getElementById('weight-ofsted')) document.getElementById('weight-ofsted').value = w.ofstedRating ?? 10;
      if (document.getElementById('weight-type')) document.getElementById('weight-type').value = w.schoolType ?? 10;

      if (document.getElementById('weight-val-location')) document.getElementById('weight-val-location').textContent = `${w.location ?? 35}%`;
      if (document.getElementById('weight-val-exam')) document.getElementById('weight-val-exam').textContent = `${w.examType ?? 25}%`;
      if (document.getElementById('weight-val-academic')) document.getElementById('weight-val-academic').textContent = `${w.academicPerformance ?? 20}%`;
      if (document.getElementById('weight-val-ofsted')) document.getElementById('weight-val-ofsted').textContent = `${w.ofstedRating ?? 10}%`;
      if (document.getElementById('weight-val-type')) document.getElementById('weight-val-type').textContent = `${w.schoolType ?? 10}%`;
      updateTotalWeightsPill();
    }

    // Recommendation Limit (range: 1 - 100, default: 10)
    const recLimit = typeof settings.recommendationLimit === 'number' ? settings.recommendationLimit : 10;
    const recLimitInput = document.getElementById('setting-rec-limit');
    if (recLimitInput) recLimitInput.value = recLimit;
    const recLimitVal = document.getElementById('weight-val-limit');
    if (recLimitVal) recLimitVal.textContent = `${recLimit} schools`;

    // Completeness Weights
    if (settings.completenessWeights) {
      const cw = settings.completenessWeights;
      const compFields = ['website', 'examDates', 'examFormat', 'schoolClassification', 'academicOfsted', 'contactChannels', 'addressGeography', 'leadershipCapacity'];
      compFields.forEach(f => {
        const el = document.getElementById(`cweight-${f}`);
        if (el && typeof cw[f] !== 'undefined') {
          el.value = cw[f];
        }
      });
      updateCompletenessTotalPill();
    }
    loadCompletenessStatus();
    loadTop100RankingsStatus();

    pendingClearedKeys = { gemini: false, openai: false };
    setAdminSettingsDirty(false);

    // Attach Interactive Settings Event Listeners
    initSettingsStudioListeners();
  } catch (err) {
    console.error('Error loading LLM settings:', err);
  }
}

let settingsListenersInitialized = false;
function initSettingsStudioListeners() {
  if (settingsListenersInitialized) return;
  settingsListenersInitialized = true;

  // Provider Card Radios
  const cardGemini = document.getElementById('provider-card-gemini');
  const cardChatgpt = document.getElementById('provider-card-chatgpt');
  const providerSelect = document.getElementById('setting-llm-provider');
  const geminiGroup = document.getElementById('llm-model-gemini-group');
  const chatgptGroup = document.getElementById('llm-model-chatgpt-group');
  const badge = document.getElementById('active-llm-provider-badge');

  function switchProvider(newProvider) {
    if (providerSelect) providerSelect.value = newProvider;

    const rGemini = document.querySelector('input[name="llm-provider-radio"][value="gemini"]');
    const rChatgpt = document.querySelector('input[name="llm-provider-radio"][value="chatgpt"]');

    if (newProvider === 'gemini') {
      if (cardGemini) cardGemini.classList.add('active');
      if (cardChatgpt) cardChatgpt.classList.remove('active');
      if (rGemini) rGemini.checked = true;
      if (rChatgpt) rChatgpt.checked = false;
    } else {
      if (cardChatgpt) cardChatgpt.classList.add('active');
      if (cardGemini) cardGemini.classList.remove('active');
      if (rChatgpt) rChatgpt.checked = true;
      if (rGemini) rGemini.checked = false;
    }

    if (geminiGroup) geminiGroup.style.display = newProvider === 'gemini' ? 'block' : 'none';
    if (chatgptGroup) chatgptGroup.style.display = newProvider === 'chatgpt' ? 'block' : 'none';

    const statProvider = document.getElementById('stat-active-provider');
    const statModel = document.getElementById('stat-active-model');
    const geminiModel = document.getElementById('setting-gemini-model')?.value || 'gemini-3.6-flash';
    const openaiModel = document.getElementById('setting-openai-model')?.value || 'gpt-4o-mini';

    if (statProvider) statProvider.textContent = newProvider === 'chatgpt' ? 'OpenAI ChatGPT' : 'Google Gemini';
    if (statModel) statModel.textContent = newProvider === 'chatgpt' ? openaiModel : geminiModel;

    if (badge) {
      if (newProvider === 'gemini') {
        badge.innerHTML = `<i class="fa-brands fa-google"></i> Active: Google Gemini (${geminiModel})`;
        badge.style.color = '#6d28d9';
        badge.style.background = '#f5f3ff';
        badge.style.borderColor = '#ddd6fe';
      } else {
        badge.innerHTML = `<i class="fa-solid fa-bolt"></i> Active: OpenAI ChatGPT (${openaiModel})`;
        badge.style.color = '#0369a1';
        badge.style.background = '#f0f9ff';
        badge.style.borderColor = '#bae6fd';
      }
    }
    setAdminSettingsDirty(true);
  }

  if (cardGemini) {
    cardGemini.addEventListener('click', (e) => {
      switchProvider('gemini');
    });
  }
  if (cardChatgpt) {
    cardChatgpt.addEventListener('click', (e) => {
      switchProvider('chatgpt');
    });
  }

  document.querySelectorAll('input[name="llm-provider-radio"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        switchProvider(e.target.value);
      }
    });
  });

  // Model selection changes
  const geminiModelSelect = document.getElementById('setting-gemini-model');
  if (geminiModelSelect) {
    geminiModelSelect.addEventListener('change', () => {
      const activeProvider = document.querySelector('input[name="llm-provider-radio"]:checked')?.value || providerSelect?.value || 'gemini';
      const statModel = document.getElementById('stat-active-model');
      if (activeProvider === 'gemini') {
        if (statModel) statModel.textContent = geminiModelSelect.value;
        if (badge) {
          badge.innerHTML = `<i class="fa-brands fa-google"></i> Active: Google Gemini (${geminiModelSelect.value})`;
        }
      }
      setAdminSettingsDirty(true);
    });
  }

  const openaiModelSelect = document.getElementById('setting-openai-model');
  if (openaiModelSelect) {
    openaiModelSelect.addEventListener('change', () => {
      const activeProvider = document.querySelector('input[name="llm-provider-radio"]:checked')?.value || providerSelect?.value || 'gemini';
      const statModel = document.getElementById('stat-active-model');
      if (activeProvider === 'chatgpt') {
        if (statModel) statModel.textContent = openaiModelSelect.value;
        if (badge) {
          badge.innerHTML = `<i class="fa-solid fa-bolt"></i> Active: OpenAI ChatGPT (${openaiModelSelect.value})`;
        }
      }
      setAdminSettingsDirty(true);
    });
  }

  // Key inputs dirty tracking
  const gKeyInput = document.getElementById('setting-gemini-api-key');
  if (gKeyInput) {
    gKeyInput.addEventListener('input', () => {
      setAdminSettingsDirty(true);
    });
  }
  const oKeyInput = document.getElementById('setting-openai-api-key');
  if (oKeyInput) {
    oKeyInput.addEventListener('input', () => {
      setAdminSettingsDirty(true);
    });
  }

  // Template editor dirty tracking
  const tplInput = document.getElementById('setting-llm-prompt-template');
  if (tplInput) {
    tplInput.addEventListener('input', () => {
      setAdminSettingsDirty(true);
    });
  }

  // Skip days & sleep delay dirty tracking
  const skipDaysInput = document.getElementById('setting-scanner-skip-days');
  if (skipDaysInput) {
    skipDaysInput.addEventListener('input', () => {
      setAdminSettingsDirty(true);
    });
  }
  const delaySecInput = document.getElementById('setting-scanner-delay-seconds');
  if (delaySecInput) {
    delaySecInput.addEventListener('input', () => {
      setAdminSettingsDirty(true);
    });
  }

  // Recommendation sliders dirty tracking
  ['weight-location', 'weight-exam', 'weight-academic', 'weight-ofsted', 'weight-type'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        setAdminSettingsDirty(true);
      });
    }
  });

  const recLimitInput = document.getElementById('setting-rec-limit');
  if (recLimitInput) {
    recLimitInput.addEventListener('input', () => {
      const val = parseInt(recLimitInput.value, 10);
      const recLimitVal = document.getElementById('weight-val-limit');
      if (recLimitVal && !isNaN(val)) {
        recLimitVal.textContent = `${val} schools`;
      }
      setAdminSettingsDirty(true);
    });
  }

  // Completeness sliders dirty tracking & live point updates
  const compFields = ['website', 'examDates', 'examFormat', 'schoolClassification', 'academicOfsted', 'contactChannels', 'addressGeography', 'leadershipCapacity'];
  compFields.forEach(f => {
    const el = document.getElementById(`cweight-${f}`);
    if (el) {
      el.addEventListener('input', () => {
        updateCompletenessTotalPill();
        setAdminSettingsDirty(true);
      });
    }
  });

  // Reset completeness weights button
  const btnResetComp = document.getElementById('btn-reset-completeness-weights');
  if (btnResetComp) {
    btnResetComp.addEventListener('click', () => {
      const defaults = { website: 20, examDates: 25, examFormat: 15, schoolClassification: 10, academicOfsted: 10, contactChannels: 8, addressGeography: 6, leadershipCapacity: 6 };
      Object.entries(defaults).forEach(([k, v]) => {
        const el = document.getElementById(`cweight-${k}`);
        if (el) el.value = v;
      });
      updateCompletenessTotalPill();
      setAdminSettingsDirty(true);
      showToast('Reset completeness weights to recommended defaults. Click Save & Recalculate to apply.', 'info');
    });
  }

  // Recalculate completeness button
  const btnSaveRecalcComp = document.getElementById('btn-save-recalc-completeness');
  if (btnSaveRecalcComp) {
    btnSaveRecalcComp.addEventListener('click', recalculateCompletenessScoresHandler);
  }

  // Top 500 Rankings sync button
  const btnSyncRankings = document.getElementById('btn-sync-top-rankings');
  if (btnSyncRankings) {
    btnSyncRankings.addEventListener('click', syncTopRankingsHandler);
  }

  // Toggle Password Key Visibility
  document.querySelectorAll('.btn-toggle-key-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.innerHTML = isPassword ? `<i class="fa-solid fa-eye-slash"></i>` : `<i class="fa-solid fa-eye"></i>`;
    });
  });

  // Clear Key Buttons
  document.querySelectorAll('.btn-clear-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      input.value = '';
      input.placeholder = 'Key cleared. Click Save to confirm removal.';
      if (targetId.includes('gemini')) pendingClearedKeys.gemini = true;
      if (targetId.includes('openai')) pendingClearedKeys.openai = true;
      setAdminSettingsDirty(true);
      showToast('API Key marked for removal. Click Save All Settings to persist.', 'info');
    });
  });

  // Placeholder Chip Insertion
  document.querySelectorAll('.btn-insert-placeholder').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag');
      const textarea = document.getElementById('setting-llm-prompt-template');
      if (!textarea || !tag) return;

      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const text = textarea.value;
      textarea.value = text.substring(0, start) + tag + text.substring(end);
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + tag.length;
      setAdminSettingsDirty(true);
      showToast(`Inserted ${tag} into template`, 'info');
    });
  });

  // Reset Template
  const btnReset = document.getElementById('btn-reset-llm-prompt');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      const textarea = document.getElementById('setting-llm-prompt-template');
      if (textarea && cachedDefaultLlmPrompt) {
        textarea.value = cachedDefaultLlmPrompt;
        setAdminSettingsDirty(true);
        showToast('Admissions Intelligence prompt template restored to default schema!', 'success');
      }
    });
  }

  // Validate Template Schema
  const btnValidate = document.getElementById('btn-validate-llm-prompt');
  if (btnValidate) {
    btnValidate.addEventListener('click', () => {
      const textarea = document.getElementById('setting-llm-prompt-template');
      const val = textarea ? textarea.value : '';
      const requiredTags = ['{{school_name}}', 'admissionsOverview', 'entranceExamDates', 'feesTermly', 'confidenceScore'];
      const missing = requiredTags.filter(t => !val.includes(t));
      if (missing.length === 0) {
        showToast('✅ Template Schema Valid: All key parameter placeholders and JSON response fields found!', 'success');
      } else {
        showToast(`⚠️ Missing recommended schema tags: ${missing.join(', ')}`, 'warning');
      }
    });
  }

  // Live Connection Test
  const btnTestConn = document.getElementById('btn-test-llm-connection');
  if (btnTestConn) {
    btnTestConn.addEventListener('click', testLlmConnectionHandler);
  }

  // Save Settings
  const btnSaveAll = document.getElementById('btn-save-all-settings');
  const btnSaveLlm = document.getElementById('btn-save-llm-settings');
  if (btnSaveAll) btnSaveAll.addEventListener('click', saveLlmSettingsHandler);
  if (btnSaveLlm) btnSaveLlm.addEventListener('click', saveLlmSettingsHandler);
}

async function testLlmConnectionHandler() {
  const btnTest = document.getElementById('btn-test-llm-connection');
  const resultSpan = document.getElementById('test-connection-result');
  const provider = document.querySelector('input[name="llm-provider-radio"]:checked')?.value || document.getElementById('setting-llm-provider')?.value || 'gemini';
  const geminiModel = document.getElementById('setting-gemini-model')?.value || 'gemini-3.6-flash';
  const openaiModel = document.getElementById('setting-openai-model')?.value || 'gpt-4o-mini';
  const geminiApiKey = document.getElementById('setting-gemini-api-key')?.value || '';
  const openaiApiKey = document.getElementById('setting-openai-api-key')?.value || '';

  const model = provider === 'chatgpt' ? openaiModel : geminiModel;
  const apiKey = provider === 'chatgpt' ? openaiApiKey : geminiApiKey;

  if (btnTest) {
    btnTest.disabled = true;
    btnTest.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Testing ${provider.toUpperCase()} Connection...`;
  }
  if (resultSpan) {
    resultSpan.textContent = 'Pinging provider API...';
    resultSpan.style.color = '#64748b';
  }

  try {
    const res = await fetch('/api/admin/llm-test-connection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({
        provider,
        model,
        apiKey: apiKey.trim() || undefined
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (resultSpan) {
        resultSpan.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #059669;"></i> <strong>Verified!</strong> HTTP ${data.status} (${data.latencyMs}ms)`;
        resultSpan.style.color = '#059669';
      }
      showToast(`Connection to ${provider.toUpperCase()} (${model}) succeeded in ${data.latencyMs}ms!`, 'success');
      await loadLlmSettings();
    } else {
      if (resultSpan) {
        resultSpan.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color: #dc2626;"></i> <strong>Failed:</strong> ${data.error || 'Connection error'}`;
        resultSpan.style.color = '#dc2626';
      }
      showToast(`Connection failed: ${data.error || 'Check API credentials'}`, 'error');
    }
  } catch (err) {
    if (resultSpan) {
      resultSpan.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color: #dc2626;"></i> Network Error`;
      resultSpan.style.color = '#dc2626';
    }
    showToast('Failed to reach server for connection test', 'error');
  } finally {
    if (btnTest) {
      btnTest.disabled = false;
      btnTest.innerHTML = `<i class="fa-solid fa-satellite-dish"></i> Test Active LLM Connection Live`;
    }
  }
}

function updateCompletenessTotalPill() {
  const fields = ['website', 'examDates', 'examFormat', 'schoolClassification', 'academicOfsted', 'contactChannels', 'addressGeography', 'leadershipCapacity'];
  let total = 0;
  fields.forEach(f => {
    const el = document.getElementById(`cweight-${f}`);
    const valSpan = document.getElementById(`cweight-val-${f}`);
    const val = parseInt(el?.value || '0', 10);
    total += val;
    if (valSpan) valSpan.textContent = `${val} Pts`;
  });
  const pill = document.getElementById('completeness-weights-total-pill');
  if (pill) {
    pill.textContent = `Total: ${total} Points`;
    if (total === 100) {
      pill.style.background = '#dcfce7';
      pill.style.color = '#166534';
      pill.style.borderColor = '#bbf7d0';
    } else {
      pill.style.background = '#fef3c7';
      pill.style.color = '#92400e';
      pill.style.borderColor = '#fde68a';
    }
  }
}

async function loadCompletenessStatus() {
  try {
    const res = await fetch('/api/admin/quality/completeness/status', {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success) {
      const avgEl = document.getElementById('completeness-metric-avg');
      const excEl = document.getElementById('completeness-metric-excellent');
      const goodEl = document.getElementById('completeness-metric-good');
      const fairEl = document.getElementById('completeness-metric-fair');
      const poorEl = document.getElementById('completeness-metric-poor');

      if (avgEl) avgEl.textContent = `${data.avgScore}%`;
      if (excEl) excEl.textContent = Number(data.distribution?.excellent || 0).toLocaleString();
      if (goodEl) goodEl.textContent = Number(data.distribution?.good || 0).toLocaleString();
      if (fairEl) fairEl.textContent = Number(data.distribution?.fair || 0).toLocaleString();
      if (poorEl) poorEl.textContent = Number(data.distribution?.poor || 0).toLocaleString();
    }
  } catch (e) {
    console.warn('Error loading completeness metrics:', e);
  }
}

async function recalculateCompletenessScoresHandler() {
  const btn = document.getElementById('btn-save-recalc-completeness');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Recalculating Completeness Scores...`;
  }

  const weights = {
    website: parseInt(document.getElementById('cweight-website')?.value || '20', 10),
    examDates: parseInt(document.getElementById('cweight-examDates')?.value || '25', 10),
    examFormat: parseInt(document.getElementById('cweight-examFormat')?.value || '15', 10),
    schoolClassification: parseInt(document.getElementById('cweight-schoolClassification')?.value || '10', 10),
    academicOfsted: parseInt(document.getElementById('cweight-academicOfsted')?.value || '10', 10),
    contactChannels: parseInt(document.getElementById('cweight-contactChannels')?.value || '8', 10),
    addressGeography: parseInt(document.getElementById('cweight-addressGeography')?.value || '6', 10),
    leadershipCapacity: parseInt(document.getElementById('cweight-leadershipCapacity')?.value || '6', 10)
  };

  try {
    const res = await fetch('/api/admin/quality/completeness/recalculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ completenessWeights: weights })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Completeness scores updated across all schools!', 'success');
      await loadCompletenessStatus();
      if (typeof loadSchools === 'function') loadSchools();
    } else {
      showToast(`Recalculation failed: ${data.error || 'Server error'}`, 'error');
    }
  } catch (err) {
    showToast('Failed to connect to completeness calculation API', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Save Weights & Recalculate Master Scores`;
    }
  }
}

async function loadTop100RankingsStatus() {
  try {
    const res = await fetch('/api/admin/rankings/status', {
      headers: {
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.success) {
      const gcseEl = document.getElementById('rankings-metric-gcse');
      const alevelEl = document.getElementById('rankings-metric-alevel');
      const nationalEl = document.getElementById('rankings-metric-national');
      if (gcseEl) gcseEl.textContent = data.totalGcseRanked ?? '--';
      if (alevelEl) alevelEl.textContent = data.totalALevelRanked ?? '--';
      if (nationalEl) nationalEl.textContent = data.totalNationalRanked ?? '--';
    }
  } catch (e) {
    console.warn('Error loading rankings status:', e);
  }
}

async function syncTopRankingsHandler() {
  const btn = document.getElementById('btn-sync-top-rankings');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Syncing UK Top 500 Rankings...`;
  }

  try {
    const res = await fetch('/api/admin/rankings/update-top-500', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      }
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Successfully updated Top 500 rankings in database!', 'success');
      await loadTop100RankingsStatus();
      if (typeof loadSchools === 'function') loadSchools();
    } else {
      showToast(`Rankings sync failed: ${data.error || 'Server error'}`, 'error');
    }
  } catch (err) {
    showToast('Failed to connect to rankings update API', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Sync Top 500 National Rankings`;
    }
  }
}

async function saveLlmSettingsHandler() {
  const provider = document.querySelector('input[name="llm-provider-radio"]:checked')?.value || document.getElementById('setting-llm-provider')?.value || 'gemini';
  const geminiModel = document.getElementById('setting-gemini-model')?.value || 'gemini-3.6-flash';
  const openaiModel = document.getElementById('setting-openai-model')?.value || 'gpt-4o-mini';
  const geminiApiKey = document.getElementById('setting-gemini-api-key')?.value || '';
  const openaiApiKey = document.getElementById('setting-openai-api-key')?.value || '';
  const promptTemplate = document.getElementById('setting-llm-prompt-template')?.value || '';
  const skipDays = parseInt(document.getElementById('setting-scanner-skip-days')?.value || '10', 10);
  const delaySec = parseInt(document.getElementById('setting-scanner-delay-seconds')?.value || '20', 10);

  const recWeights = {
    location: parseInt(document.getElementById('weight-location')?.value, 10) || 0,
    examType: parseInt(document.getElementById('weight-exam')?.value, 10) || 0,
    academicPerformance: parseInt(document.getElementById('weight-academic')?.value, 10) || 0,
    ofstedRating: parseInt(document.getElementById('weight-ofsted')?.value, 10) || 0,
    schoolType: parseInt(document.getElementById('weight-type')?.value, 10) || 0
  };

  const completenessWeights = {
    website: parseInt(document.getElementById('cweight-website')?.value || '20', 10),
    examDates: parseInt(document.getElementById('cweight-examDates')?.value || '25', 10),
    examFormat: parseInt(document.getElementById('cweight-examFormat')?.value || '15', 10),
    schoolClassification: parseInt(document.getElementById('cweight-schoolClassification')?.value || '10', 10),
    academicOfsted: parseInt(document.getElementById('cweight-academicOfsted')?.value || '10', 10),
    contactChannels: parseInt(document.getElementById('cweight-contactChannels')?.value || '8', 10),
    addressGeography: parseInt(document.getElementById('cweight-addressGeography')?.value || '6', 10),
    leadershipCapacity: parseInt(document.getElementById('cweight-leadershipCapacity')?.value || '6', 10)
  };

  const recLimit = parseInt(document.getElementById('setting-rec-limit')?.value || '10', 10);
  const finalRecLimit = isNaN(recLimit) ? 10 : Math.max(1, Math.min(100, recLimit));

  const payload = {
    llmProvider: provider,
    geminiModel,
    openaiModel,
    scannerSkipDays: isNaN(skipDays) ? 10 : Math.max(0, Math.min(100, skipDays)),
    scannerDelaySeconds: isNaN(delaySec) ? 20 : Math.max(0, Math.min(300, delaySec)),
    llmPromptTemplate: promptTemplate,
    recWeights,
    recommendationLimit: finalRecLimit,
    completenessWeights
  };

  if (pendingClearedKeys.gemini) {
    payload.clearGeminiKey = true;
  } else if (geminiApiKey.trim() && !geminiApiKey.includes('••••')) {
    payload.geminiApiKey = geminiApiKey.trim();
  }

  if (pendingClearedKeys.openai) {
    payload.clearOpenaiKey = true;
  } else if (openaiApiKey.trim() && !openaiApiKey.includes('••••')) {
    payload.openaiApiKey = openaiApiKey.trim();
  }

  const saveBtns = [document.getElementById('btn-save-llm-settings'), document.getElementById('btn-save-all-settings')].filter(Boolean);
  saveBtns.forEach(btn => {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  });

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      pendingClearedKeys = { gemini: false, openai: false };
      showToast('All Admin Settings & AI Engine configuration saved successfully!', 'success');
      await loadLlmSettings();
    } else {
      showToast(`Failed to save settings: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showToast('Error saving settings', 'error');
  } finally {
    saveBtns.forEach(btn => {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save All Settings`;
    });
  }
}

async function previewLlmPromptHandler() {
  const promptTemplate = document.getElementById('setting-llm-prompt-template')?.value || '';
  const schoolId = document.getElementById('llm-test-school-picker')?.value;
  const provider = document.querySelector('input[name="llm-provider-radio"]:checked')?.value || document.getElementById('setting-llm-provider')?.value || 'gemini';

  try {
    const res = await fetch('/api/admin/llm-render-prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ promptTemplate, schoolId, provider })
    });

    if (res.ok) {
      const data = await res.json();
      const resultBox = document.getElementById('llm-test-result-box');
      const resultPre = document.getElementById('llm-test-result-json');
      if (resultBox && resultPre) {
        resultBox.style.display = 'block';
        resultPre.textContent = `=== PROMPT PREVIEW FOR: ${data.schoolName} ===\n\n${data.renderedPrompt}`;
      }
      if (data.queryUrls?.active) {
        updatePublicSearchUrlUI(provider, data.queryUrls.active);
      }
      showToast(`Rendered prompt preview for ${data.schoolName}!`, 'info');
    }
  } catch (err) {
    showToast('Error rendering prompt preview', 'error');
  }
}

async function testLlmCrawlSingleHandler() {
  const schoolId = document.getElementById('llm-test-school-picker')?.value;
  if (!schoolId) {
    showToast('Please select a school to test AI crawl', 'warning');
    return;
  }

  const provider = document.querySelector('input[name="llm-provider-radio"]:checked')?.value || document.getElementById('setting-llm-provider')?.value || 'gemini';
  const geminiModel = document.getElementById('setting-gemini-model')?.value || 'gemini-3.6-flash';
  const openaiModel = document.getElementById('setting-openai-model')?.value || 'gpt-4o-mini';
  const geminiApiKey = document.getElementById('setting-gemini-api-key')?.value || '';
  const openaiApiKey = document.getElementById('setting-openai-api-key')?.value || '';
  const promptTemplate = document.getElementById('setting-llm-prompt-template')?.value || '';

  const testBtn = document.getElementById('btn-test-llm-crawl-single');
  const resultBox = document.getElementById('llm-test-result-box');
  const resultPre = document.getElementById('llm-test-result-json');

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Querying ${provider.toUpperCase()} AI...`;
  }

  try {
    const res = await fetch('/api/admin/llm-crawl-single', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({
        schoolId,
        provider,
        model: provider === 'chatgpt' ? openaiModel : geminiModel,
        apiKey: provider === 'chatgpt' ? (openaiApiKey || undefined) : (geminiApiKey || undefined),
        promptTemplate
      })
    });

    const data = await res.json();
    if (res.ok) {
      if (resultBox && resultPre) {
        resultBox.style.display = 'block';
        resultPre.textContent = JSON.stringify(data.crawlResult?.data || data.updatedSchool, null, 2);
      }
      showToast(data.message || 'AI crawl completed and record updated successfully!', 'success');
      await loadSchools();
          } else {
      if (resultBox && resultPre) {
        resultBox.style.display = 'block';
        resultPre.textContent = `Error: ${data.error || 'Failed'}\nMessage: ${data.message || 'LLM crawl failed'}`;
      }
      showToast(data.message || 'AI crawl failed', 'error');
    }
  } catch (err) {
    showToast('Error connecting to AI crawl service', 'error');
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Test Live AI Crawl on School`;
    }
  }
}

// ----------------------------------------------------
// Type a School & Live Search LLM Handlers
// ----------------------------------------------------
let lastLiveSearchResult = null;

async function runLiveLlmSearchHandler() {
  const queryInput = document.getElementById('llm-live-school-query');
  const schoolName = queryInput ? queryInput.value.trim() : '';
  if (!schoolName) {
    showToast('Please type a school name or postcode to live search', 'warning');
    if (queryInput) queryInput.focus();
    return;
  }

  const provider = document.querySelector('input[name="llm-provider-radio"]:checked')?.value || document.getElementById('setting-llm-provider')?.value || 'gemini';
  const geminiModel = document.getElementById('setting-gemini-model')?.value || 'gemini-3.6-flash';
  const openaiModel = document.getElementById('setting-openai-model')?.value || 'gpt-4o-mini';
  const geminiApiKey = document.getElementById('setting-gemini-api-key')?.value || '';
  const openaiApiKey = document.getElementById('setting-openai-api-key')?.value || '';
  const promptTemplate = document.getElementById('setting-llm-prompt-template')?.value || '';

  const searchBtn = document.getElementById('btn-run-live-llm-search');
  const loadingBox = document.getElementById('llm-live-search-loading');
  const loadingText = document.getElementById('llm-live-search-loading-text');
  const resultsCard = document.getElementById('llm-live-search-results');

  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Live Querying...`;
  }
  if (loadingBox) {
    loadingBox.style.display = 'block';
    if (loadingText) {
      loadingText.textContent = `Live querying ${provider === 'chatgpt' ? 'OpenAI ChatGPT' : 'Google Gemini'} for "${schoolName}"...`;
    }
  }
  if (resultsCard) {
    resultsCard.style.display = 'none';
  }

  try {
    const res = await fetch('/api/admin/llm-live-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({
        schoolName,
        provider,
        model: provider === 'chatgpt' ? openaiModel : geminiModel,
        apiKey: provider === 'chatgpt' ? (openaiApiKey || undefined) : (geminiApiKey || undefined),
        promptTemplate
      })
    });

    const data = await res.json();
    if (loadingBox) loadingBox.style.display = 'none';

    lastLiveSearchResult = data;
    renderLiveLlmSearchResult(data);

    if (res.ok && data.success && data.data) {
      showToast(`Live AI search retrieved verified data for ${data.data.name || schoolName}!`, 'success');
    } else {
      showToast(data.message || data.error || 'Live search error received from LLM API.', 'warning');
    }
  } catch (err) {
    if (loadingBox) loadingBox.style.display = 'none';
    showToast('Error connecting to live AI search service', 'error');
  } finally {
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Live Search LLM`;
    }
  }
}

function renderLiveLlmSearchResult(result) {
  const container = document.getElementById('llm-live-search-results');
  if (!container || !result) return;

  const data = result.data || {};
  const school = result.querySchool || {};
  const isGemini = (result.provider || 'gemini') === 'gemini';
  const isSuccess = result.success && result.data;

  // School name & confidence badge
  const nameEl = document.getElementById('llm-result-school-name');
  if (nameEl) nameEl.textContent = data.name || school.name || 'Target School';

  const confBadge = document.getElementById('llm-result-confidence-badge');
  if (confBadge) {
    if (isSuccess) {
      const score = data.confidenceScore || 95;
      confBadge.textContent = `${score}% Confidence Score`;
      confBadge.style.background = score >= 90 ? '#dcfce7' : (score >= 70 ? '#fef3c7' : '#fee2e2');
      confBadge.style.color = score >= 90 ? '#166534' : (score >= 70 ? '#92400e' : '#991b1b');
      confBadge.style.display = 'inline-block';
    } else {
      confBadge.textContent = `API Error / Action Required`;
      confBadge.style.background = '#fee2e2';
      confBadge.style.color = '#991b1b';
      confBadge.style.display = 'inline-block';
    }
  }

  const provBadge = document.getElementById('llm-result-provider-badge');
  if (provBadge) {
    provBadge.textContent = isGemini ? `Google Gemini (${result.model || 'API'})` : `OpenAI ChatGPT (${result.model || 'API'})`;
    provBadge.style.background = isGemini ? '#f5f3ff' : '#f0f9ff';
    provBadge.style.color = isGemini ? '#6d28d9' : '#0369a1';
  }

  const exactReq = result.exactRequest || result.crawlResult?.exactRequest || {};
  const exactResp = result.exactResponse || result.crawlResult?.exactResponse || {};

  const regionVal = exactReq.schoolInput?.region || school.region || school.la || 'Greater London / UK';
  const webVal = exactReq.schoolInput?.website || data.website || school.website || 'Not available';

  const metaSubtitle = document.getElementById('llm-result-meta-subtitle');
  if (metaSubtitle) {
    metaSubtitle.textContent = `Region: ${regionVal} • Website: ${webVal}`;
  }

  const sourceLink = document.getElementById('llm-result-source-link');
  if (sourceLink) {
    const targetUrl = data.sourceUrl || data.website || (isGemini ? 'https://gemini.google.com/app' : 'https://chatgpt.com/');
    sourceLink.href = targetUrl;
  }

  // Milestones Grid
  const milestonesGrid = document.getElementById('llm-result-milestones-grid');
  if (milestonesGrid) {
    milestonesGrid.innerHTML = '';
    const dates = data.entranceExamDates || {};
    const milestoneLabels = [
      { key: 'registrationOpen', label: 'Registration Open', icon: 'fa-door-open', color: '#2563eb' },
      { key: 'registrationDeadline', label: 'Registration Deadline', icon: 'fa-calendar-xmark', color: '#dc2626' },
      { key: 'examDate', label: '11+ Exam Date', icon: 'fa-file-pen', color: '#d97706' },
      { key: 'examDate2', label: 'Stage 2 Exam', icon: 'fa-file-signature', color: '#7c3aed' },
      { key: 'resultDate', label: 'Results Date', icon: 'fa-square-poll-vertical', color: '#0284c7' },
      { key: 'interviewDates', label: 'Interview Window', icon: 'fa-comments', color: '#4f46e5' },
      { key: 'offerDate', label: 'Offers Sent', icon: 'fa-envelope-open-text', color: '#059669' },
      { key: 'acceptanceDeadline', label: 'Acceptance Deadline', icon: 'fa-circle-check', color: '#166534' }
    ];

    let count = 0;
    milestoneLabels.forEach(m => {
      const val = dates[m.key];
      if (val && val !== 'null' && val !== 'N/A') {
        count++;
        const card = document.createElement('div');
        card.style.cssText = 'background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.65rem 0.75rem;';
        card.innerHTML = `
          <div style="font-size: 0.74rem; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 0.35rem;">
            <i class="fa-solid ${m.icon}" style="color: ${m.color};"></i> ${m.label}
          </div>
          <div style="font-size: 0.88rem; font-weight: 800; color: #1e293b;">${val}</div>
        `;
        milestonesGrid.appendChild(card);
      }
    });

    if (count === 0) {
      milestonesGrid.innerHTML = `<div style="color: #64748b; font-size: 0.82rem; grid-column: 1 / -1;">No specific 11+ milestone dates were returned by the LLM.</div>`;
    }
  }

  // Metadata Grid
  const detailsGrid = document.getElementById('llm-result-details-grid');
  if (detailsGrid) {
    detailsGrid.innerHTML = '';
    const items = [
      { label: 'Entrance Exam Board', val: data.entranceExamType, icon: 'fa-award', color: '#4f46e5' },
      { label: 'Gender Policy', val: data.gender, icon: 'fa-venus-mars', color: '#0284c7' },
      { label: 'Termly Tuition Fees', val: data.feesTermly, icon: 'fa-sterling-sign', color: '#059669' },
      { label: 'Admissions Email', val: data.email, icon: 'fa-envelope', color: '#d97706' },
      { label: 'Telephone', val: data.phone, icon: 'fa-phone', color: '#64748b' },
      { label: 'Address & Postcode', val: `${data.address || ''} ${data.postcode ? `(${data.postcode})` : ''}`.trim(), icon: 'fa-location-dot', color: '#dc2626' },
      { label: 'Official Website', val: data.website, icon: 'fa-globe', color: '#2563eb', isLink: true }
    ];

    items.forEach(it => {
      if (it.val && it.val !== 'null' && it.val !== 'N/A') {
        const box = document.createElement('div');
        box.style.cssText = 'background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.65rem 0.75rem;';
        box.innerHTML = `
          <div style="font-size: 0.74rem; font-weight: 700; color: #64748b; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 0.35rem;">
            <i class="fa-solid ${it.icon}" style="color: ${it.color};"></i> ${it.label}
          </div>
          <div style="font-size: 0.85rem; font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis;">
            ${it.isLink ? `<a href="${it.val}" target="_blank" style="color: #2563eb; text-decoration: underline;">${it.val}</a>` : it.val}
          </div>
        `;
        detailsGrid.appendChild(box);
      }
    });
  }

  // Determine Exact Prompt Text with 100% Reliability
  let promptText = exactReq.promptText || exactReq.prompt || result.crawlResult?.exactRequest?.promptText;
  if (!promptText && exactReq.payload?.contents?.[0]?.parts?.[0]?.text) {
    promptText = exactReq.payload.contents[0].parts[0].text;
  }
  if (!promptText && exactReq.payload?.messages) {
    const userMsg = exactReq.payload.messages.find(m => m.role === 'user');
    if (userMsg) promptText = userMsg.content;
  }
  if (!promptText) {
    const promptTpl = document.getElementById('setting-llm-prompt-template')?.value || cachedDefaultLlmPrompt;
    const targetSchoolName = exactReq.schoolInput?.schoolName || school.name || data.name || 'Target School';
    const targetRegion = regionVal;
    const targetWebsite = webVal;
    
    promptText = (promptTpl || cachedDefaultLlmPrompt || '')
      .replace(/\{\{school_name\}\}/g, targetSchoolName)
      .replace(/\{\{region\}\}/g, targetRegion)
      .replace(/\{\{website\}\}/g, targetWebsite)
      .replace(/\{\{urn\}\}/g, school.urn && school.urn !== 'N/A' ? school.urn : 'N/A')
      .replace(/\{\{postcode\}\}/g, school.postcode || data.postcode || '')
      .replace(/\{\{school_type\}\}/g, school.schoolType || data.schoolType || 'Independent');
  }

  // Populate PANE 2: Exact Request Sent
  const reqSchoolEl = document.getElementById('llm-req-school-name');
  if (reqSchoolEl) reqSchoolEl.textContent = exactReq.schoolInput?.schoolName || school.name || data.name || '-';

  const reqRegionEl = document.getElementById('llm-req-region');
  if (reqRegionEl) reqRegionEl.textContent = regionVal;

  const reqWebsiteEl = document.getElementById('llm-req-website');
  if (reqWebsiteEl) reqWebsiteEl.textContent = webVal;

  const reqEndpointEl = document.getElementById('llm-req-endpoint');
  if (reqEndpointEl) reqEndpointEl.textContent = `${exactReq.method || 'GET'} → ${exactReq.endpoint || result.publicSearchUrl || '-'}`;

  const reqPromptEl = document.getElementById('llm-exact-request-prompt');
  if (reqPromptEl) {
    reqPromptEl.textContent = promptText;
  }

  const reqFullJsonEl = document.getElementById('llm-exact-request-full-json');
  if (reqFullJsonEl) {
    const displayReqObj = {
      ...exactReq,
      promptText: promptText
    };
    reqFullJsonEl.textContent = JSON.stringify(displayReqObj, null, 2);
  }

  // Populate PANE 3: Exact Response Received
  const respStatusEl = document.getElementById('llm-resp-status');
  if (respStatusEl) respStatusEl.textContent = `${exactResp.status || 200} OK`;

  const respProvEl = document.getElementById('llm-resp-provider');
  if (respProvEl) respProvEl.textContent = isGemini ? `Google Gemini (${result.model || 'API'})` : `OpenAI ChatGPT (${result.model || 'API'})`;

  const respSourceLink = document.getElementById('llm-resp-source-url');
  if (respSourceLink) {
    const targetSource = exactResp.sourceUrl || data.sourceUrl || data.website || (isGemini ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com');
    respSourceLink.href = targetSource;
    respSourceLink.textContent = targetSource;
  }

  const respRawEl = document.getElementById('llm-exact-response-raw');
  if (respRawEl) {
    respRawEl.textContent = exactResp.rawText || JSON.stringify(exactResp.parsedJson || data, null, 2);
  }

  // Apply button
  const applyBtn = document.getElementById('btn-apply-live-search-school');
  if (applyBtn) {
    if (isSuccess && result.matchedDbSchool?.id) {
      applyBtn.style.display = 'inline-flex';
      applyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Apply to "${result.matchedDbSchool.name}"`;
    } else {
      applyBtn.style.display = 'none';
    }
  }

  // If success, default to tab 1 (Extracted). If error, default to tab 3 (Raw API Response)
  const targetPane = isSuccess ? 'pane-llm-extracted' : 'pane-llm-response';
  const defaultTabBtn = document.querySelector(`.btn-llm-tab[data-target="${targetPane}"]`);
  if (defaultTabBtn) defaultTabBtn.click();

  container.style.display = 'block';
}

async function applyLiveSearchResultHandler() {
  if (!lastLiveSearchResult || !lastLiveSearchResult.matchedDbSchool?.id) {
    showToast('No matched school record to update in database', 'warning');
    return;
  }

  const schoolId = lastLiveSearchResult.matchedDbSchool.id;
  const applyBtn = document.getElementById('btn-apply-live-search-school');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Applying...`;
  }

  try {
    const res = await fetch('/api/admin/llm-crawl-single', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({
        schoolId,
        provider: lastLiveSearchResult.provider,
        model: lastLiveSearchResult.model,
        mockResponse: lastLiveSearchResult.data
      })
    });

    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'School record successfully updated with verified live AI intelligence!', 'success');
      await loadSchools();
            if (applyBtn) {
        applyBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Applied Successfully`;
        applyBtn.style.background = '#047857';
      }
    } else {
      showToast(data.message || data.error || 'Failed to apply verified data', 'error');
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Retry Apply`;
      }
    }
  } catch (err) {
    showToast('Error applying verified data to database', 'error');
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Retry Apply`;
    }
  }
}

// Database Environment & Instance Management (Production vs Test Sandbox)
let currentDbMeta = null;

async function loadDatabaseInstanceSettings() {
  try {
    const res = await fetch('/api/admin/database-instance', {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (res.ok) {
      currentDbMeta = await res.json();
      updateDatabaseInstanceUI(currentDbMeta);
    }
  } catch (err) {
    console.error('Error fetching database instance metadata:', err);
  }
}

function updateDatabaseInstanceUI(meta) {
  if (!meta) return;
  const isProd = meta.activeInstance === 'production';
  
  // Update sticky top banner
  const banner = document.getElementById('test-env-banner');
  if (banner) {
    banner.style.display = isProd ? 'none' : 'flex';
  }

  // Update Settings Subpane Pills & Cards
  const activePill = document.getElementById('db-instance-active-pill');
  if (activePill) {
    if (isProd) {
      activePill.className = 'badge-env-pill badge-env-prod';
      activePill.innerHTML = '<i class="fa-solid fa-circle-check"></i> PRODUCTION (schooldb.sqlite)';
    } else {
      activePill.className = 'badge-env-pill badge-env-test';
      activePill.innerHTML = '<i class="fa-solid fa-flask-vial"></i> TEST ENVIRONMENT (schooldb_test.sqlite)';
    }
  }

  const prodCard = document.getElementById('db-card-prod');
  const testCard = document.getElementById('db-card-test');
  const btnProd = document.getElementById('btn-select-prod-db');
  const btnTest = document.getElementById('btn-select-test-db');

  if (prodCard) {
    prodCard.className = `db-env-card ${isProd ? 'active-prod' : ''}`;
  }
  if (testCard) {
    testCard.className = `db-env-card ${!isProd ? 'active-test' : ''}`;
  }

  if (btnProd) {
    if (isProd) {
      btnProd.className = 'btn btn-primary';
      btnProd.innerHTML = '<i class="fa-solid fa-check"></i> Active (Production)';
      btnProd.disabled = true;
    } else {
      btnProd.className = 'btn btn-outline';
      btnProd.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Switch to Production';
      btnProd.disabled = false;
    }
  }

  if (btnTest) {
    if (!isProd) {
      btnTest.className = 'btn btn-primary';
      btnTest.style.background = '#d97706';
      btnTest.style.borderColor = '#d97706';
      btnTest.innerHTML = '<i class="fa-solid fa-check"></i> Active (Test Sandbox)';
      btnTest.disabled = true;
    } else {
      btnTest.className = 'btn btn-outline';
      btnTest.style.background = '';
      btnTest.style.borderColor = '';
      btnTest.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Switch to Test DB';
      btnTest.disabled = false;
    }
  }

  // Update Meta labels
  if (meta.instances) {
    const prodSchools = document.getElementById('db-prod-meta-schools');
    const prodMtime = document.getElementById('db-prod-meta-mtime');
    const testSchools = document.getElementById('db-test-meta-schools');
    const testMtime = document.getElementById('db-test-meta-mtime');

    if (prodSchools && meta.instances.production) {
      prodSchools.innerHTML = `<strong>Schools:</strong> ${(meta.instances.production.totalSchools || 0).toLocaleString()} records`;
    }
    if (prodMtime && meta.instances.production && meta.instances.production.lastModified) {
      prodMtime.innerHTML = `<strong>Last Modified:</strong> ${new Date(meta.instances.production.lastModified).toLocaleDateString()} ${new Date(meta.instances.production.lastModified).toLocaleTimeString()}`;
    }
    if (testSchools && meta.instances.test) {
      testSchools.innerHTML = `<strong>Schools:</strong> ${(meta.instances.test.totalSchools || 0).toLocaleString()} records`;
    }
    if (testMtime && meta.instances.test && meta.instances.test.lastModified) {
      testMtime.innerHTML = `<strong>Last Modified:</strong> ${new Date(meta.instances.test.lastModified).toLocaleDateString()} ${new Date(meta.instances.test.lastModified).toLocaleTimeString()}`;
    }
  }
}

async function switchDatabaseInstance(targetInstance) {
  const norm = (targetInstance || '').toLowerCase() === 'test' ? 'test' : 'production';
  const confirmMsg = norm === 'test'
    ? 'Switch active database to the TEST environment (schooldb_test.sqlite)? Changes made while in test mode will not affect production.'
    : 'Switch active database back to the PRODUCTION environment (schooldb.sqlite)?';

  if (!confirm(confirmMsg)) return;

  try {
    showToast(`Switching active database to ${norm.toUpperCase()}...`, 'info');
    const res = await fetch('/api/admin/database-instance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ instance: norm })
    });

    if (res.ok) {
      const data = await res.json();
      showToast(`Switched to ${norm.toUpperCase()} database (${data.totalSchools} schools).`, 'success');
      await loadDatabaseInstanceSettings();
      if (typeof loadSchools === 'function') await loadSchools();
      if (typeof loadAdminSchools === 'function') await loadAdminSchools();
      if (typeof loadAdminAuditData === 'function') await loadAdminAuditData();
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to switch database', 'error');
    }
  } catch (err) {
    console.error('Error switching database instance:', err);
    showToast('Failed to switch database instance', 'error');
  }
}

async function resetTestDbConfirmation() {
  if (!confirm('Are you sure you want to reset the Test Database? This will overwrite schooldb_test.sqlite with the latest clean copy of the Production Database.')) {
    return;
  }

  try {
    showToast('Cloning fresh copy from Production Database...', 'info');
    const res = await fetch('/api/admin/reset-test-database', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      }
    });

    if (res.ok) {
      const data = await res.json();
      showToast(data.message || 'Test database reset successfully!', 'success');
      await loadDatabaseInstanceSettings();
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to reset test database', 'error');
    }
  } catch (err) {
    console.error('Error resetting test database:', err);
    showToast('Failed to reset test database', 'error');
  }
}

// Fetch recommendations based on userSelectedSchools, location, and absolute gender filter
// Load Parent Recommendation Profile & Preferences
async function loadUserRecProfile() {
  try {
    const res = await fetch('/api/user-recommendations/preferences', {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (!res.ok) return;
    const prefs = await res.json();

    const childAbility = prefs.childAbilityLevel || 'NA';
    const binary = prefs.binaryFilters || {};
    const gender = binary.gender || 'NA';
    const ofstedFloor = binary.ofstedFloor || 'NA';
    const locations = binary.locations || prefs.targetPostcode || prefs.targetBorough || '';
    const qual = prefs.qualitativeWeights || {};
    const proximity = qual.proximity || 'NA';
    const academicExcellence = qual.academicExcellence || 'NA';
    const pupilProgress = qual.pupilProgress || 'NA';
    const reqTypes = Array.isArray(binary.schoolTypes) ? binary.schoolTypes : ['NA'];

    // Populate Classic Portal Matchmaker Elements
    const childAbilityEl = document.getElementById('rec-child-ability');
    if (childAbilityEl) childAbilityEl.value = childAbility;

    const locInput = document.getElementById('rec-target-locations');
    if (locInput) locInput.value = locations;

    const proxSlider = document.getElementById('rec-qual-prox-slider');
    if (proxSlider) proxSlider.value = getSliderStepFromValue(proximity) ?? 1;
    const acadSlider = document.getElementById('rec-qual-acad-slider');
    if (acadSlider) acadSlider.value = getSliderStepFromValue(academicExcellence) ?? 2;
    const progSlider = document.getElementById('rec-qual-prog-slider');
    if (progSlider) progSlider.value = getSliderStepFromValue(pupilProgress) ?? 2;

    const reqGenders = Array.isArray(gender) ? gender : [gender];
    document.querySelectorAll('.rec-gender-chk').forEach(chk => {
      chk.checked = reqGenders.includes(chk.value);
    });

    document.querySelectorAll('.rec-school-type-chk').forEach(chk => {
      chk.checked = reqTypes.includes(chk.value);
    });

    updatePrioritySlidersUI();
    updateSchoolTypeDropdownLabel();
    updateGenderDropdownLabel();
  } catch (err) {
    console.error('Error loading parent recommendation profile:', err);
  }
}

const SLIDER_STEPS = ['NA', 'not_important', 'somewhat', 'very', 'top_priority'];
const SLIDER_LABELS = ['Off', 'Low', 'Mid', 'High', 'Top Priority'];

function getSliderStepFromValue(val) {
  if (val === 'NA' || val === 'off') return 0;
  if (val === 'not_important' || val === 'low') return 1;
  if (val === 'somewhat' || val === 'mid' || val === 'medium') return 2;
  if (val === 'very' || val === 'high') return 3;
  if (val === 'top_priority' || val === 'top') return 4;
  return null;
}

// Update the dynamic fine-tune priority slider badges and button label
function updatePrioritySlidersUI() {
  const proxStep = parseInt(document.getElementById('rec-qual-prox-slider')?.value || '1', 10);
  const acadStep = parseInt(document.getElementById('rec-qual-acad-slider')?.value || '2', 10);
  const progStep = parseInt(document.getElementById('rec-qual-prog-slider')?.value || '2', 10);

  const proxValEl = document.getElementById('rec-val-prox');
  if (proxValEl) {
    proxValEl.textContent = SLIDER_LABELS[proxStep] || 'Off';
    proxValEl.style.color = proxStep === 0 ? '#64748b' : '#4f46e5';
    proxValEl.style.background = proxStep === 0 ? '#f1f5f9' : '#e0e7ff';
  }

  const acadValEl = document.getElementById('rec-val-acad');
  if (acadValEl) {
    acadValEl.textContent = SLIDER_LABELS[acadStep] || 'Off';
    acadValEl.style.color = acadStep === 0 ? '#64748b' : '#4f46e5';
    acadValEl.style.background = acadStep === 0 ? '#f1f5f9' : '#e0e7ff';
  }

  const progValEl = document.getElementById('rec-val-prog');
  if (progValEl) {
    progValEl.textContent = SLIDER_LABELS[progStep] || 'Off';
    progValEl.style.color = progStep === 0 ? '#64748b' : '#4f46e5';
    progValEl.style.background = progStep === 0 ? '#f1f5f9' : '#e0e7ff';
  }

  const labelEl = document.getElementById('rec-priorities-btn-label');
  if (labelEl) {
    const proxLabel = SLIDER_LABELS[proxStep] || 'Off';
    const acadLabel = SLIDER_LABELS[acadStep] || 'Off';
    const progLabel = SLIDER_LABELS[progStep] || 'Off';
    labelEl.textContent = `Prox: ${proxLabel} | GCSE: ${acadLabel} | Prog: ${progLabel}`;
  }
}

// Auto-recommend debounce timer
let autoRecDebounceTimer = null;
function triggerAutoRecommend(delay = 150) {
  clearTimeout(autoRecDebounceTimer);
  if (delay === 0) {
    fetchRecommendations();
    saveUserRecProfile();
  } else {
    autoRecDebounceTimer = setTimeout(() => {
      fetchRecommendations();
      saveUserRecProfile();
    }, delay);
  }
}

// Update Target School Types multi-select dropdown button label
function updateSchoolTypeDropdownLabel() {
  const labelEl = document.getElementById('rec-school-type-btn-label');
  if (!labelEl) return;

  const checked = Array.from(document.querySelectorAll('.rec-school-type-chk:checked')).map(c => c.value);
  if (checked.length === 0 || checked.includes('NA') || checked.length === 3) {
    labelEl.textContent = 'Any Types';
  } else {
    const formatted = checked.map(v => {
      if (v === 'Independent') return 'Private';
      if (v === 'Comprehensive') return 'State Comp';
      return v;
    });
    labelEl.textContent = formatted.join(', ');
  }
}

// Update Gender multi-select dropdown button label
function updateGenderDropdownLabel() {
  const labelEl = document.getElementById('rec-gender-btn-label');
  if (!labelEl) return;

  const checked = Array.from(document.querySelectorAll('.rec-gender-chk:checked')).map(c => c.value);
  if (checked.length === 0 || checked.includes('NA') || checked.length === 3) {
    labelEl.textContent = 'All Genders';
  } else {
    const formatted = checked.map(v => {
      if (v === 'boys') return 'Boys';
      if (v === 'girls') return 'Girls';
      if (v === 'mixed') return 'Mixed';
      return v;
    });
    labelEl.textContent = formatted.join(', ');
  }
}

// Save Parent Recommendation Profile & Preferences (Classic Matchmaker Wizard)
async function saveUserRecProfile() {
  updatePrioritySlidersUI();
  updateSchoolTypeDropdownLabel();
  updateGenderDropdownLabel();
  const childAbilityLevel = document.getElementById('rec-child-ability') ? document.getElementById('rec-child-ability').value : (document.getElementById('p2-select-ability')?.value || 'NA');
  
  let selectedGenders = Array.from(document.querySelectorAll('.rec-gender-chk:checked')).map(c => c.value);
  const gender = selectedGenders.length > 0 ? (selectedGenders.includes('NA') ? 'NA' : selectedGenders) : (document.getElementById('p2-select-gender')?.value || 'NA');
  
  const locations = document.getElementById('rec-target-locations') ? document.getElementById('rec-target-locations').value.trim() : (document.getElementById('p2-input-postcode')?.value.trim() || '');

  let selectedTypes = Array.from(document.querySelectorAll('.rec-school-type-chk:checked')).map(c => c.value);
  if (selectedTypes.length === 0) {
    selectedTypes = Array.from(document.querySelectorAll('.p2-type-chk:checked')).map(c => c.value);
  }

  const proxStep = parseInt(document.getElementById('rec-qual-prox-slider')?.value || '0', 10);
  const acadStep = parseInt(document.getElementById('rec-qual-acad-slider')?.value || '0', 10);
  const progStep = parseInt(document.getElementById('rec-qual-prog-slider')?.value || '0', 10);

  const proximity = SLIDER_STEPS[proxStep] || 'NA';
  const academicExcellence = SLIDER_STEPS[acadStep] || 'NA';
  const pupilProgress = SLIDER_STEPS[progStep] || 'NA';
  const ofstedFloor = document.getElementById('rec-ofsted-floor')?.value || document.getElementById('p2-pref-ofsted')?.value || 'NA';

  // Synchronize Parent 2.0 inputs
  const p2PostcodeInput = document.getElementById('p2-input-postcode');
  if (p2PostcodeInput) p2PostcodeInput.value = locations;
  const p2GenderSelect = document.getElementById('p2-select-gender');
  if (p2GenderSelect) p2GenderSelect.value = gender;
  const p2AbilitySelect = document.getElementById('p2-select-ability');
  if (p2AbilitySelect) p2AbilitySelect.value = childAbilityLevel;
  const p2CommuteSelect = document.getElementById('p2-pref-commute');
  if (p2CommuteSelect) p2CommuteSelect.value = proximity;
  const p2AttainSelect = document.getElementById('p2-pref-attainment');
  if (p2AttainSelect) p2AttainSelect.value = academicExcellence;
  const p2ProgSelect = document.getElementById('p2-pref-progress');
  if (p2ProgSelect) p2ProgSelect.value = pupilProgress;
  const p2OfstedSelect = document.getElementById('p2-pref-ofsted');
  if (p2OfstedSelect) p2OfstedSelect.value = ofstedFloor;

  const payload = {
    targetBorough: locations,
    targetPostcode: locations,
    childAbilityLevel,
    binaryFilters: {
      locations,
      gender,
      ofstedFloor,
      examFormats: ['NA'],
      schoolTypes: selectedTypes.length > 0 ? selectedTypes : ['NA']
    },
    qualitativeWeights: {
      proximity,
      academicExcellence,
      pupilProgress
    }
  };

  try {
    const res = await fetch('/api/user-recommendations/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      await saveUserPortfolio(true);
    }
  } catch (err) {
    console.error('Failed to save recommendation profile:', err);
  }
  await fetchRecommendations();
}

// Fetch recommendations based on userSelectedSchools, target locations, and qualitative profile
async function fetchRecommendations() {
  const container = document.getElementById('rec-cards-container');
  const p2Container = document.getElementById('p2-recs-container');
  if (!container && !p2Container) return;

  const locations = document.getElementById('rec-target-locations')?.value.trim() || document.getElementById('p2-input-postcode')?.value.trim() || '';
  const childAbilityLevel = document.getElementById('rec-child-ability')?.value || document.getElementById('p2-select-ability')?.value || 'NA';
  
  let selectedGenders = Array.from(document.querySelectorAll('.rec-gender-chk:checked')).map(c => c.value);
  const gender = selectedGenders.length > 0 ? (selectedGenders.includes('NA') ? 'NA' : selectedGenders) : (document.getElementById('p2-select-gender')?.value || 'NA');
  
  const ofstedFloor = document.getElementById('rec-ofsted-floor')?.value || document.getElementById('p2-pref-ofsted')?.value || 'NA';

  let selectedTypes = Array.from(document.querySelectorAll('.rec-school-type-chk:checked')).map(c => c.value);
  if (selectedTypes.length === 0) {
    selectedTypes = Array.from(document.querySelectorAll('.p2-type-chk:checked')).map(c => c.value);
  }

  const proxStep = parseInt(document.getElementById('rec-qual-prox-slider')?.value || '0', 10);
  const acadStep = parseInt(document.getElementById('rec-qual-acad-slider')?.value || '0', 10);
  const progStep = parseInt(document.getElementById('rec-qual-prog-slider')?.value || '0', 10);

  const proximity = SLIDER_STEPS[proxStep] || 'NA';
  const academicExcellence = SLIDER_STEPS[acadStep] || 'NA';
  const pupilProgress = SLIDER_STEPS[progStep] || 'NA';

  const preferencesOverride = {
    targetBorough: locations,
    targetPostcode: locations,
    childAbilityLevel,
    binaryFilters: {
      locations,
      gender,
      ofstedFloor,
      examFormats: ['NA'],
      schoolTypes: selectedTypes.length > 0 ? selectedTypes : ['NA']
    },
    qualitativeWeights: {
      proximity,
      academicExcellence,
      pupilProgress
    }
  };

  try {
    const res = await fetch('/api/recommendations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({
        userSchools: userSelectedSchools,
        targetLocation: locations,
        removedSchoolIds: userRemovedSchoolIds,
        preferencesOverride
      })
    });

    const data = await res.json();
    const items = data.recommendations || [];
    renderRecommendations(items);
    renderParent2RecommendationsList(items);
  } catch (err) {
    console.error('Failed to fetch recommendations:', err);
  }
}

// Render Single-Line List Layout for Recommendations
function renderRecommendations(items) {
  const container = document.getElementById('rec-cards-container');
  if (!container) return;

  container.innerHTML = '';

  if (!currentUserAccount) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1.5rem; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1;">
        <i class="fa-solid fa-lock" style="font-size: 2.5rem; color: #4f46e5; margin-bottom: 0.8rem;"></i>
        <h4 style="font-size: 1.15rem; color: #1e293b; margin-bottom: 0.4rem;">Please Sign In to Access Recommendations</h4>
        <p style="color: #64748b; font-size: 0.88rem; max-width: 520px; margin: 0 auto 1.25rem; line-height: 1.4;">
          Sign in with your Google Account or profile to view personalized school recommendations, qualitative matching, and build your target shortlist.
        </p>
        <button id="btn-rec-sign-in" class="btn btn-primary" style="background: linear-gradient(135deg, #4285F4 0%, #1a73e8 100%); border: none; font-size: 0.9rem; padding: 0.6rem 1.2rem; font-weight: 700;">
          <i class="fa-brands fa-google"></i> Sign In with Google Account
        </button>
      </div>
    `;

    const recSignInBtn = document.getElementById('btn-rec-sign-in');
    if (recSignInBtn) {
      recSignInBtn.onclick = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        triggerGoogleSignInWorkflow();
      };
    }
    return;
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: #64748b; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1;">
        <i class="fa-solid fa-compass" style="font-size: 2rem; color: #94a3b8; margin-bottom: 0.75rem;"></i>
        <h4 style="margin: 0; color: #334155; font-size: 1.05rem;">No matching recommendations found</h4>
        <p style="margin: 0.35rem 0 0 0; font-size: 0.85rem;">Try adjusting your hard requirements or location filters to view more school suggestions.</p>
      </div>
    `;
    return;
  }

  items.forEach(item => {
    const s = item.school;
    const score = item.matchScore;
    const reasons = item.reasons || [];

    let matchBg = '#ecfdf5';
    let matchColor = '#059669';
    let matchLabel = 'High Match';
    if (score < 70) { matchBg = '#eff6ff'; matchColor = '#2563eb'; matchLabel = 'Good Match'; }
    if (score < 50) { matchBg = '#fffbeb'; matchColor = '#d97706'; matchLabel = 'Moderate Fit'; }

    const isIndependent = (s.schoolType === 'Independent');
    const isAlreadyAdded = userSelectedSchools.some(x => x.id === s.id);
    const dates = s.entranceExamDates || {};

    let genderTag = `<span style="font-size:0.75rem; color:#475569;"><i class="fa-solid fa-users" style="color:#8b5cf6;"></i> ${s.gender}</span>`;
    if ((s.gender || '').toLowerCase().includes('girl')) {
      genderTag = `<span style="font-size:0.75rem; color:#ec4899; font-weight:600;"><i class="fa-solid fa-venus"></i> Girls</span>`;
    } else if ((s.gender || '').toLowerCase().includes('boy')) {
      genderTag = `<span style="font-size:0.75rem; color:#2563eb; font-weight:600;"><i class="fa-solid fa-mars"></i> Boys</span>`;
    }

    // Plain English Insights (Shortened for 2-Row Compact Layout)
    const insights = [];
    if (s.gcseProgress8 !== null && s.gcseProgress8 !== undefined) {
      if (s.gcseProgress8 >= 0.5) {
        insights.push(`<span class="parent-insight-tag insight-growth-top" title="Top 5% student growth (+${s.gcseProgress8})"><i class="fa-solid fa-arrow-trend-up"></i> Top 5% Growth (+${s.gcseProgress8})</span>`);
      } else if (s.gcseProgress8 > 0) {
        insights.push(`<span class="parent-insight-tag insight-growth-top" title="Above average pupil progress (+${s.gcseProgress8})"><i class="fa-solid fa-arrow-trend-up"></i> Progress +${s.gcseProgress8}</span>`);
      }
    }

    if (s.gcseAttainment8 !== null && s.gcseAttainment8 !== undefined) {
      if (s.gcseAttainment8 >= 65) {
        insights.push(`<span class="parent-insight-tag insight-academic-top" title="Outstanding GCSE Attainment 8: ${s.gcseAttainment8}"><i class="fa-solid fa-trophy"></i> GCSE ${s.gcseAttainment8}</span>`);
      } else if (s.gcseAttainment8 >= 50) {
        insights.push(`<span class="parent-insight-tag insight-academic-top" title="Strong GCSE Attainment 8: ${s.gcseAttainment8}"><i class="fa-solid fa-award"></i> GCSE ${s.gcseAttainment8}</span>`);
      }
    }

    if (s.entranceExamType && s.entranceExamType !== 'Standard' && s.entranceExamType !== 'Non-selective') {
      insights.push(`<span class="parent-insight-tag insight-exam-selective"><i class="fa-solid fa-pen-nib"></i> ${s.entranceExamType}</span>`);
    }

    if (dates.examDate) {
      insights.push(`<span class="parent-insight-tag" style="background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5;"><i class="fa-solid fa-calendar"></i> Exam: ${dates.examDate}</span>`);
    }

    const card = document.createElement('div');
    card.className = 'school-row-item';
    card.style.background = 'white';
    card.style.border = '1px solid #e2e8f0';
    card.style.borderLeft = `5px solid ${matchColor}`;
    card.style.borderRadius = '10px';
    card.style.padding = '0.65rem 1rem';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '0.35rem';
    card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)';

    card.innerHTML = `
      <!-- Row 1: Match Score, School Name, Type Badge, Gender, Location & Right-Aligned Actions -->
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; width: 100%;">
        <div style="display: flex; align-items: center; gap: 0.5rem; min-width: 0; flex: 1; flex-wrap: nowrap; overflow: hidden;">
          <span style="font-weight: 800; font-size: 0.76rem; color: ${matchColor}; background: ${matchBg}; padding: 0.15rem 0.55rem; border-radius: 999px; border: 1px solid ${matchColor}44; white-space: nowrap; flex-shrink: 0;">
            <i class="fa-solid fa-sparkles"></i> ${score}% Match
          </span>
          <h4 style="font-size: 0.96rem; font-weight: 800; color: #1e293b; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">
            <a href="#" onclick="openSchoolDetail('${s.id}'); return false;" style="color: #1e293b; text-decoration: none;" title="${s.name}">${s.name}</a>
          </h4>
          <span style="font-size: 0.72rem; font-weight: 700; color: ${isIndependent ? '#7c3aed' : '#2563eb'}; background: ${isIndependent ? '#f3e8ff' : '#eff6ff'}; padding: 0.12rem 0.45rem; border-radius: 6px; white-space: nowrap; flex-shrink: 0;">
            ${s.schoolType}
          </span>
          ${s.hot ? '<span class="badge-hot" style="font-size:0.65rem; padding:0.08rem 0.3rem; flex-shrink: 0;">🔥 Hot</span>' : ''}
          <span style="flex-shrink: 0;">${genderTag}</span>
          <span style="font-size: 0.75rem; color: #64748b; white-space: nowrap; flex-shrink: 0;"><i class="fa-solid fa-location-dot" style="color: #ef4444;"></i> <strong>${s.la}</strong> (${s.postcode || 'N/A'})</span>
        </div>

        <div style="display: flex; align-items: center; gap: 0.4rem; margin-left: auto; flex-shrink: 0;">
          <button class="btn btn-outline" onclick="openSchoolDetail('${s.id}')" style="font-size: 0.74rem; padding: 0.28rem 0.6rem; white-space: nowrap;">
            <i class="fa-solid fa-eye"></i> Details
          </button>
          <button class="btn ${isAlreadyAdded ? 'btn-secondary' : 'btn-primary'} btn-add-rec" data-id="${s.id}" style="font-size: 0.74rem; padding: 0.28rem 0.75rem; white-space: nowrap; ${isAlreadyAdded ? 'background:#e2e8f0; color:#475569; border:none;' : ''}">
            <i class="fa-solid ${isAlreadyAdded ? 'fa-check' : 'fa-plus'}"></i> ${isAlreadyAdded ? 'Shortlisted' : 'Add to Shortlist'}
          </button>
          <button class="btn-text btn-remove-rec" data-id="${s.id}" style="color: #94a3b8; font-size: 0.75rem; cursor: pointer; padding: 0.2rem 0.35rem;" title="Remove from suggestions">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <!-- Row 2: Plain-English Insights & Right-Aligned Match Reason -->
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; border-top: 1px dashed #f1f5f9; padding-top: 0.35rem; width: 100%;">
        <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: nowrap; overflow: hidden; min-width: 0;">
          ${insights.join(' ')}
        </div>
        <span style="font-size: 0.74rem; color: #475569; margin-left: auto; background: #f8fafc; padding: 0.12rem 0.5rem; border-radius: 6px; border: 1px solid #e2e8f0; white-space: nowrap; flex-shrink: 0; text-overflow: ellipsis; overflow: hidden; max-width: 380px;" title="${reasons[0] || 'Fits parent profile'}">
          <strong>Match:</strong> ${reasons[0] || 'Fits parent profile'}
        </span>
      </div>
    `;

    container.appendChild(card);
  });

  // Attach event listeners for Add to Shortlist & Remove from suggestions
  container.querySelectorAll('.btn-add-rec').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const targetSchool = items.find(item => item.school.id === id)?.school;
      if (targetSchool) {
        await addUserSchool(targetSchool);
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Shortlisted';
        btn.className = 'btn btn-secondary btn-add-rec';
        btn.style.background = '#e2e8f0';
        btn.style.color = '#475569';
        btn.style.border = 'none';
      }
    });
  });

  container.querySelectorAll('.btn-remove-rec').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      removeRecommendation(id);
    });
  });
}


// Render User Selected School Chips & Synchronize Dashboard Table
function updateUserSchoolsUI() {
  const container = document.getElementById('user-schools-chips');
  const countEl = document.getElementById('user-schools-count');
  const countTopEl = document.getElementById('user-schools-count-top');
  const classicBadgeEl = document.getElementById('classic-shortlist-badge-count');

  if (countEl) countEl.textContent = userSelectedSchools.length;
  if (countTopEl) countTopEl.textContent = userSelectedSchools.length;
  if (classicBadgeEl) classicBadgeEl.textContent = userSelectedSchools.length;

  renderUserDashboard();

  if (!container) return;

  if (userSelectedSchools.length === 0) {
    container.innerHTML = '<span style="color: #94a3b8; font-size: 0.85rem; font-style: italic;">No schools added yet. Search above to add your first school!</span>';
    return;
  }

  container.innerHTML = userSelectedSchools.map(s => `
    <span style="display: inline-flex; align-items: center; gap: 0.4rem; background: #e0e7ff; color: #3730a3; padding: 0.3rem 0.75rem; border-radius: 999px; font-size: 0.85rem; font-weight: 500; border: 1px solid #c7d2fe;">
      <i class="fa-solid fa-graduation-cap"></i> ${s.name} (${s.la})
      <i class="fa-solid fa-xmark btn-remove-user-chip" data-id="${s.id}" style="cursor: pointer; color: #4338ca; margin-left: 0.2rem;" title="Remove school"></i>
    </span>
  `).join('');

  container.querySelectorAll('.btn-remove-user-chip').forEach(icon => {
    icon.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      removeUserSchool(id);
    });
  });
}

// Setup Autocomplete search for Step 1 input
function setupRecAutocomplete() {
  const searchInput = document.getElementById('rec-school-search');
  const suggestionsBox = document.getElementById('rec-school-suggestions');
  if (!searchInput || !suggestionsBox) return;

  searchInput.addEventListener('input', async (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 2) {
      suggestionsBox.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`/api/schools?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      const matches = data.schools || [];

      if (matches.length === 0) {
        suggestionsBox.innerHTML = '<div style="padding: 0.6rem 0.9rem; color: #94a3b8; font-size: 0.85rem;">No matching schools found</div>';
      } else {
        suggestionsBox.innerHTML = matches.slice(0, 10).map(s => `
          <div class="rec-suggestion-item" data-id="${s.id}" style="padding: 0.6rem 0.9rem; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 0.88rem;">
            <strong>${s.name}</strong> <span style="color:#64748b; font-size:0.8rem;">(${s.la} - ${s.entranceExamType})</span>
          </div>
        `).join('');

        suggestionsBox.querySelectorAll('.rec-suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            const id = item.getAttribute('data-id');
            const school = matches.find(m => m.id === id);
            if (school) {
              addUserSchool(school);
              searchInput.value = '';
              suggestionsBox.style.display = 'none';
            }
          });
        });
      }

      suggestionsBox.style.display = 'block';
    } catch (err) {
      console.error('Error fetching search suggestions:', err);
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.style.display = 'none';
    }
  });
}

// -------------------------------------------------------------
// USER SELECTED TARGET SCHOOLS DASHBOARD RENDERER
// -------------------------------------------------------------

// -------------------------------------------------------------
// USER SELECTED TARGET SCHOOLS DASHBOARD & CALENDAR RENDERER
// -------------------------------------------------------------

function renderUserDashboard() {
  const tableBody = document.getElementById('dashboard-schools-table-body');
  const countEl = document.getElementById('dash-list-count');
  const calendarContainer = document.getElementById('calendar-view-container');

  if (countEl) countEl.textContent = userSelectedSchools.length;

  if (!tableBody || !calendarContainer) return;

  // 1. RENDER CLEAN SHORTLISTED SCHOOLS TABLE LIST
  if (userSelectedSchools.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 2.5rem; color: #94a3b8;">
          <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; color: #cbd5e1;"></i>
          No target schools shortlisted yet. Use the Parent Portal recommendations widget to add schools!
        </td>
      </tr>
    `;
    calendarContainer.innerHTML = `
      <div style="text-align: center; padding: 3rem; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1; color: #64748b;">
        <i class="fa-solid fa-calendar-xmark" style="font-size: 2.5rem; color: #94a3b8; margin-bottom: 0.75rem;"></i>
        <h4>No upcoming dates to display</h4>
        <p style="font-size: 0.85rem; color: #94a3b8;">Shortlist target schools to automatically populate your color-coded admissions calendar.</p>
      </div>
    `;
    return;
  }

  tableBody.innerHTML = userSelectedSchools.map(s => {
    let pillClass = 'pill-comprehensive';
    if (s.schoolType && s.schoolType.includes('Grammar')) pillClass = 'pill-grammar';
    if (s.schoolType && s.schoolType.includes('Independent')) pillClass = 'pill-independent';

    return `
      <tr>
        <td class="nowrap-cell">
          <strong style="color: #1e293b; font-size: 0.92rem;">${s.name}</strong>
          ${s.hot ? `<span class="badge-hot" style="margin-left: 0.4rem;"><i class="fa-solid fa-fire"></i> Hot</span>` : ''}
        </td>
        <td><i class="fa-solid fa-location-dot" style="color: #ef4444; font-size: 0.8rem;"></i> ${s.la} (${s.postcode || ''})</td>
        <td style="text-align: center;"><span class="school-type-pill ${pillClass}">${s.schoolType}</span></td>
        <td style="text-align: center; font-size: 0.85rem; font-weight: 600; color: #475569;">${s.gender}</td>
        <td><span class="badge-ofsted"><i class="fa-solid fa-star"></i> ${formatOfsted(s.ofstedRating)}</span></td>
        <td><span class="badge-exam" title="${(s.entranceExamType || '').replace(/"/g, '&quot;')}">${formatExam(s.entranceExamType)}</span></td>
        <td style="font-weight: 700; color: #0f172a;">${s.gcseAttainment8 !== null && s.gcseAttainment8 !== undefined ? s.gcseAttainment8 : 'N/A'}</td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 0.35rem; justify-content: center;">
            <button class="btn btn-outline btn-dash-detail" data-id="${s.id}" style="padding: 0.3rem 0.6rem; font-size: 0.78rem;">
              <i class="fa-solid fa-circle-info"></i> Details
            </button>
            <button class="btn btn-outline btn-dash-remove" data-id="${s.id}" style="padding: 0.3rem 0.5rem; font-size: 0.78rem; color: #ef4444; border-color: #fca5a5;" title="Remove from shortlist">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tableBody.querySelectorAll('.btn-dash-detail').forEach(btn => {
    btn.addEventListener('click', () => openSchoolDetail(btn.getAttribute('data-id')));
  });

  tableBody.querySelectorAll('.btn-dash-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      removeUserSchool(id);
      renderUserDashboard();
    });
  });

  // 2. RENDER STAR INTERACTIVE ADMISSIONS & EXAM CALENDAR
  renderAdmissionsCalendar(calendarContainer);
}

// Render Star Admissions Calendar
function renderAdmissionsCalendar(container) {
  // Aggregate all events from shortlisted user selected schools
  const events = [];

  userSelectedSchools.forEach(s => {
    const dates = s.entranceExamDates || {};
    const schoolName = s.name;

    if (dates.registrationOpen) {
      events.push({ schoolName, type: 'registration', label: 'Registration Opens', dateStr: dates.registrationOpen, color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', icon: 'fa-door-open' });
    }
    if (dates.registrationDeadline || dates.registrationCloseDate || dates.registrationCloses) {
      const d = dates.registrationDeadline || dates.registrationCloseDate || dates.registrationCloses;
      events.push({ schoolName, type: 'registration', label: 'Registration Deadline', dateStr: d, color: '#1d4ed8', bg: '#dbeafe', border: '#93c5fd', icon: 'fa-clock' });
    }
    if (dates.examDate || dates.firstExamDate) {
      const d = dates.examDate || dates.firstExamDate;
      events.push({ schoolName, type: 'exam', label: `1st Exam Sitting (${dates.firstExamSubjects || s.entranceExamType})`, dateStr: d, color: '#ea580c', bg: '#fff7ed', border: '#ffedd5', icon: 'fa-pen-to-square' });
    }
    if (dates.secondExamDate || dates.secondStageExamDate) {
      const d = dates.secondExamDate || dates.secondStageExamDate;
      events.push({ schoolName, type: 'exam', label: '2nd Stage Exam', dateStr: d, color: '#c2410c', bg: '#ffedd5', border: '#fed7aa', icon: 'fa-pen-clip' });
    }
    if (dates.interview || dates.interviewsDate) {
      const d = dates.interview || dates.interviewsDate;
      events.push({ schoolName, type: 'interview', label: 'Interview Sittings', dateStr: d, color: '#7e22ce', bg: '#fcf4ff', border: '#f5d0fe', icon: 'fa-comments' });
    }
    if (dates.resultsDate || dates.offerDate) {
      const d = dates.resultsDate || dates.offerDate;
      events.push({ schoolName, type: 'offer', label: 'Offers Released', dateStr: d, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: 'fa-envelope-open-text' });
    }
    if (dates.offersAcceptance || dates.offerAcceptByDate) {
      const d = dates.offersAcceptance || dates.offerAcceptByDate;
      events.push({ schoolName, type: 'offer', label: 'Offer Acceptance Deadline', dateStr: d, color: '#15803d', bg: '#dcfce7', border: '#86efac', icon: 'fa-circle-check' });
    }
  });

  // Group events into 4 key key academic timeline blocks (Autumn 2025 -> Spring 2026)
  const timelineMonths = [
    { name: 'May - October 2025', phase: 'Registration Phase', bgHeader: '#3b82f6', filterMonth: ['may', 'june', 'july', 'august', 'september', 'october'] },
    { name: 'November - December 2025', phase: 'Stage 1 Examinations', bgHeader: '#f97316', filterMonth: ['november', 'december'] },
    { name: 'January 2026', phase: 'Stage 2 Exams & Interviews', bgHeader: '#a855f7', filterMonth: ['january'] },
    { name: 'February - March 2026', phase: 'Offers & Final Decision', bgHeader: '#22c55e', filterMonth: ['february', 'march', 'april'] }
  ];

  let calendarHtml = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.25rem;">
  `;

  timelineMonths.forEach(m => {
    // Find matching events for this month block
    const monthEvents = events.filter(e => {
      const dLower = (e.dateStr || '').toLowerCase();
      return m.filterMonth.some(fm => dLower.includes(fm));
    });

    calendarHtml += `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column;">
        <div style="background: ${m.bgHeader}; color: white; padding: 0.75rem 1rem; font-weight: 700; font-size: 0.9rem; display: flex; justify-content: space-between; align-items: center;">
          <span><i class="fa-solid fa-calendar-day"></i> ${m.name}</span>
          <span style="font-size: 0.75rem; background: rgba(255,255,255,0.25); padding: 0.15rem 0.5rem; border-radius: 999px;">${monthEvents.length} Events</span>
        </div>
        <div style="padding: 0.6rem; font-size: 0.75rem; font-weight: 700; color: #64748b; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; text-transform: uppercase;">
          ${m.phase}
        </div>

        <div style="padding: 0.8rem; flex: 1; display: flex; flex-direction: column; gap: 0.6rem; max-height: 340px; overflow-y: auto;">
          ${monthEvents.length === 0 ? `
            <div style="color: #94a3b8; font-size: 0.82rem; font-style: italic; text-align: center; padding: 1.5rem 0;">
              No key sittings scheduled for this phase.
            </div>
          ` : monthEvents.map(ev => `
            <div style="background: ${ev.bg}; border: 1px solid ${ev.border}; border-radius: 8px; padding: 0.65rem 0.8rem; transition: transform 0.15s ease;" title="${ev.schoolName} - ${ev.label}">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.2rem;">
                <strong style="font-size: 0.85rem; color: #0f172a; line-height: 1.2;">${ev.schoolName}</strong>
                <span style="font-size: 0.72rem; font-weight: 700; color: ${ev.color}; white-space: nowrap; background: white; padding: 0.1rem 0.4rem; border-radius: 4px; border: 1px solid ${ev.border};">
                  <i class="fa-solid ${ev.icon}"></i> ${ev.dateStr}
                </span>
              </div>
              <div style="font-size: 0.78rem; font-weight: 600; color: ${ev.color};">
                ${ev.label}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  calendarHtml += `</div>`;
  container.innerHTML = calendarHtml;
}


// Admin Error Audit Panel: Load User-Reported Data Inaccuracies
async function loadAdminFieldReports() {
  const container = document.getElementById('admin-field-reports-container');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/field-reports', {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });

    if (!res.ok) {
      container.innerHTML = `<div style="color: #ef4444; padding: 1rem;">Failed to load reported errors.</div>`;
      return;
    }

    const schoolsList = await res.json();

    // Update corrections badge count on side tab
    const badge = document.getElementById('corrections-badge-count');
    if (badge) {
      const totalReports = Array.isArray(schoolsList) ? schoolsList.reduce((acc, s) => acc + (s.totalErrorCount || 0), 0) : 0;
      if (totalReports > 0) {
        badge.textContent = totalReports;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    if (!Array.isArray(schoolsList) || schoolsList.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; background: #f0fdf4; border-radius: 10px; border: 1px solid #bbf7d0;">
          <i class="fa-solid fa-circle-check" style="font-size:2.2rem; color:#22c55e; display:block; margin-bottom:0.5rem;"></i>
          <strong style="color: #166534; font-size: 1rem;">No User-Reported Data Inaccuracies</strong>
          <p style="color: #4ade80; font-size: 0.85rem; margin-top: 0.2rem;">All school records are currently rated accurate by parents.</p>
        </div>
      `;
      return;
    }

    let html = `<div style="display: flex; flex-direction: column; gap: 1rem;">`;

    for (const schoolObj of schoolsList) {
      html += `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.6rem; margin-bottom: 0.8rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <strong style="font-size: 1.05rem; color: #1e293b;"><i class="fa-solid fa-school" style="color: #4f46e5;"></i> ${schoolObj.schoolName}</strong>
              <span style="font-size: 0.8rem; color: #64748b; margin-left: 0.5rem;">URN: ${schoolObj.schoolUrn}</span>
            </div>
            <span style="background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5; font-size: 0.8rem; font-weight: 700; padding: 0.25rem 0.65rem; border-radius: 999px;">
              <i class="fa-solid fa-thumbs-down"></i> ${schoolObj.totalErrorCount} Reported Error${schoolObj.totalErrorCount > 1 ? 's' : ''}
            </span>
          </div>

          <table class="data-table" style="width: 100%; font-size: 0.85rem;">
            <thead>
              <tr style="background: #f8fafc;">
                <th>Reported Field</th>
                <th>Reports Count</th>
                <th>Master Original Value</th>
                <th>User Proposed Custom Values</th>
                ${currentPermissions.includes('admin:edit') ? '<th>Admin Action</th>' : ''}
              </tr>
            </thead>
            <tbody>
      `;

      for (const fieldObj of schoolObj.fields) {
        const userValsList = fieldObj.reports.map(r => `
          <div style="margin-bottom: 0.3rem;">
            <strong style="color: #ea580c;">"${r.customValue || '(No value specified)'}"</strong>
            <span style="font-size: 0.75rem; color: #64748b;">by ${r.userName} (${r.userEmail})</span>
          </div>
        `).join('');

        const latestCustomVal = fieldObj.reports.find(r => r.customValue)?.customValue || '';

        html += `
          <tr>
            <td><strong style="color: #334155;">${fieldObj.fieldName}</strong></td>
            <td><span class="badge-hot" style="background:#fee2e2; color:#b91c1c; font-size:0.78rem; font-weight:700;">${fieldObj.fieldErrorCount} Downvote${fieldObj.fieldErrorCount > 1 ? 's' : ''}</span></td>
            <td><code style="background: #f1f5f9; padding: 0.15rem 0.4rem; border-radius: 4px;">${fieldObj.reports[0]?.originalValue || 'N/A'}</code></td>
            <td>${userValsList}</td>
            ${currentPermissions.includes('admin:edit') ? `
              <td>
                ${latestCustomVal ? `
                  <button type="button" class="btn btn-primary btn-apply-master-report" data-school-id="${schoolObj.schoolId}" data-field-name="${fieldObj.fieldName}" data-custom-val="${latestCustomVal}" style="padding: 0.3rem 0.65rem; font-size: 0.78rem; background: #059669; border-color: #047857;">
                    <i class="fa-solid fa-check-double"></i> Apply "${latestCustomVal}" to Master
                  </button>
                ` : '<span style="color:#94a3b8; font-size:0.75rem;">No custom value proposed</span>'}
              </td>
            ` : ''}
          </tr>
        `;
      }

      html += `
            </tbody>
          </table>
        </div>
      `;
    }

    html += `</div>`;
    container.innerHTML = html;

    // Attach Apply to Master button listeners
    container.querySelectorAll('.btn-apply-master-report').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const sId = btn.getAttribute('data-school-id');
        const fName = btn.getAttribute('data-field-name');
        const cVal = btn.getAttribute('data-custom-val');

        if (!confirm(`Are you sure you want to update the master database for field '${fName}' to "${cVal}"?`)) return;

        try {
          const res = await fetch('/api/admin/apply-field-report', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
            },
            body: JSON.stringify({ schoolId: sId, fieldName: fName, customValue: cVal })
          });

          if (res.ok) {
            showToast(`Updated master school record for '${fName}'!`, 'success');
            await loadSchools();
            await loadAdminFieldReports();
          } else {
            showToast('Failed to update master record.', 'error');
          }
        } catch (err) {
          showToast('Error promoting custom value to master.', 'error');
        }
      });
    });

  } catch (err) {
    console.error('Error loading admin field reports:', err);
  }

  // Also load system-detected data conflicts queue
  await loadSystemCorrectionsQueue();
}

// Quick Access Investigation Links (Website, DfE GIAS, and Google Search in new tab)
function renderQuickAccessInvestigationLinks(school) {
  if (!school) return '';
  const name = school.name || '';
  const postcode = school.postcode || '';
  const urn = (school.urn || '').toString().trim();
  const website = (school.website || '').toString().trim();

  const googleQuery = encodeURIComponent(`${name} ${postcode} school`);
  const googleSearchUrl = `https://www.google.com/search?q=${googleQuery}`;
  
  const dfeUrl = urn && /^\d+$/.test(urn)
    ? `https://www.get-information-schools.service.gov.uk/Establishments/Establishment/Details/${urn}`
    : `https://www.get-information-schools.service.gov.uk/Search?SelectedTab=Establishments&SearchType=ByLocalAuthority&SearchLocation=${encodeURIComponent(name)}`;

  return `
    <div class="investigation-quick-links" style="display: flex; gap: 0.35rem; margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed #e2e8f0; flex-wrap: wrap; align-items: center;">
      ${website ? `
        <a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.72rem; padding: 0.2rem 0.5rem; color: #2563eb; border-color: #bfdbfe; background: #eff6ff; text-decoration: none; border-radius: 5px; font-weight: 600;" title="Open Official School Website in new tab">
          <i class="fa-solid fa-globe"></i> Website <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.62rem; margin-left: 0.15rem;"></i>
        </a>
      ` : `
        <span style="font-size: 0.72rem; color: #94a3b8; padding: 0.2rem 0.45rem; background: #f1f5f9; border-radius: 5px; border: 1px solid #e2e8f0;" title="No official website registered">
          <i class="fa-solid fa-globe"></i> No Web
        </span>
      `}
      <a href="${escapeHtml(dfeUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.72rem; padding: 0.2rem 0.5rem; color: #0891b2; border-color: #a5f3fc; background: #ecfeff; text-decoration: none; border-radius: 5px; font-weight: 600;" title="View official government record on DfE GIAS">
        <i class="fa-solid fa-landmark-dome"></i> DfE GIAS ${urn ? `(${escapeHtml(urn)})` : ''} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.62rem; margin-left: 0.15rem;"></i>
      </a>
      <a href="${escapeHtml(googleSearchUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.72rem; padding: 0.2rem 0.5rem; color: #374151; border-color: #e5e7eb; background: #f9fafb; text-decoration: none; border-radius: 5px; font-weight: 600;" title="Google Search school name & postcode in new tab">
        <i class="fa-brands fa-google" style="color: #ea4335;"></i> Google <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.62rem; margin-left: 0.15rem;"></i>
      </a>
    </div>
  `;
}

// System-Detected Data Conflicts & Corrections Queue Controller
async function loadSystemCorrectionsQueue(forceScan = false) {
  const container = document.getElementById('admin-system-corrections-container');
  if (!container) return;

  const refreshBtn = document.getElementById('refresh-system-corrections-btn');
  const statusLabel = document.getElementById('system-corrections-scan-status');
  if (refreshBtn && !refreshBtn._bound) {
    refreshBtn._bound = true;
    refreshBtn.addEventListener('click', () => loadSystemCorrectionsQueue(true));
  }

  if (forceScan) {
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning 6,489 Schools...';
    }
    container.innerHTML = '<div style="text-align: center; color: #ea580c; padding: 1.5rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Running multi-attribute overlap algorithm across database...</div>';
  } else {
    container.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 1.5rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading persisted conflict records...</div>';
  }

  try {
    const url = forceScan ? '/api/admin/quality/corrections/scan' : '/api/admin/quality/corrections/queue';
    const res = await fetch(url, {
      method: forceScan ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      }
    });

    if (!res.ok) {
      container.innerHTML = '<div style="color: #ef4444; padding: 1rem;">Failed to load system data conflicts queue.</div>';
      return;
    }

    const data = await res.json();
    const queue = data.correctionsQueue || [];
    window._qualityCorrectionsQueue = queue;

    if (statusLabel) {
      if (data.scannedAt) {
        statusLabel.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Last Scanned: <strong>${new Date(data.scannedAt).toLocaleString()}</strong> (${data.totalSchools || 6489} schools checked)`;
      } else {
        statusLabel.innerHTML = `<i class="fa-solid fa-info-circle"></i> No scan executed yet. Click "Run Conflict & Overlap Scan" to analyze.`;
      }
    }

    // Update corrections badge count on side tab if needed
    const badge = document.getElementById('corrections-badge-count');
    if (badge) {
      badge.textContent = queue.length;
      badge.style.display = queue.length > 0 ? 'inline-block' : 'none';
    }

    if (data.hasScanned === false && queue.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; background: #fff7ed; border-radius: 10px; border: 1px solid #fed7aa;">
          <i class="fa-solid fa-shield-halved" style="font-size:2.2rem; color:#ea580c; display:block; margin-bottom:0.6rem;"></i>
          <strong style="color: #9a3412; font-size: 1rem;">Multi-Attribute Conflict Scan Not Executed Yet</strong>
          <p style="color: #c2410c; font-size: 0.85rem; margin-top: 0.35rem; max-width: 520px; margin-left: auto; margin-right: auto;">
            Click <strong>"Run Conflict &amp; Overlap Scan"</strong> above to cross-reference all 6,489 schools for identifier discrepancies, shared URN anomalies, and duplicate listings.
          </p>
          <button type="button" class="btn btn-primary" onclick="loadSystemCorrectionsQueue(true)" style="background: #ea580c; border-color: #ea580c; margin-top: 0.5rem; font-size: 0.85rem; padding: 0.45rem 1.1rem;">
            <i class="fa-solid fa-play"></i> Run Conflict &amp; Overlap Scan Now
          </button>
        </div>
      `;
      return;
    }

    if (queue.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; background: #f0fdf4; border-radius: 10px; border: 1px solid #bbf7d0;">
          <i class="fa-solid fa-circle-check" style="font-size:2rem; color:#22c55e; display:block; margin-bottom:0.4rem;"></i>
          <strong style="color: #166534; font-size: 0.95rem;">No System-Detected Data Conflicts</strong>
          <p style="color: #15803d; font-size: 0.85rem; margin-top: 0.2rem;">All school profiles and DfE URN identifiers are fully consistent in persisted scan.</p>
        </div>
      `;
      return;
    }

    let html = `
      <div style="margin-bottom: 0.75rem; font-size: 0.85rem; color: #64748b; display: flex; justify-content: space-between; align-items: center;">
        <span>Found <strong>${queue.length}</strong> conflicting records requiring admin resolution:</span>
        <span style="background: #fff7ed; color: #c2410c; padding: 0.2rem 0.5rem; border-radius: 6px; font-weight: 700; font-size: 0.75rem;">
          <i class="fa-solid fa-flag"></i> Action Required
        </span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 1rem;">
    `;

    queue.forEach((c, idx) => {
      const isUrnConflict = (c.schoolA.urn && c.schoolB.urn && c.schoolA.urn === c.schoolB.urn);
      html += `
        <div style="background: #ffffff; border: 1px solid #fed7aa; border-radius: 10px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
            <span style="font-weight: 700; color: #ea580c; font-size: 0.85rem;">
              <i class="fa-solid fa-triangle-exclamation"></i> Conflict #${idx + 1}: ${escapeHtml(c.reason)}
            </span>
            <div style="display: flex; gap: 0.4rem; align-items: center;">
              <button class="btn btn-outline" onclick="openSchoolDetail('${c.schoolA.id}')" style="font-size: 0.75rem; padding: 0.25rem 0.55rem;">
                <i class="fa-solid fa-eye"></i> Inspect A
              </button>
              <button class="btn btn-outline" onclick="openSchoolDetail('${c.schoolB.id}')" style="font-size: 0.75rem; padding: 0.25rem 0.55rem;">
                <i class="fa-solid fa-eye"></i> Inspect B
              </button>
              <button class="btn btn-outline" onclick="markPairAsReviewed('${c.schoolA.id}', '${c.schoolB.id}')" style="font-size: 0.75rem; padding: 0.25rem 0.55rem; color: #059669; border-color: #a7f3d0;" title="Dismiss conflict & mark as reviewed distinct schools">
                <i class="fa-solid fa-shield-check"></i> Not Duplicate
              </button>
              ${isUrnConflict ? `
                <button class="btn btn-primary" onclick="clearConflictingUrn('${c.schoolB.id}')" style="background: #ea580c; border-color: #ea580c; font-size: 0.75rem; padding: 0.25rem 0.55rem;">
                  <i class="fa-solid fa-eraser"></i> Clear URN on B
                </button>
              ` : ''}
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="font-size: 0.72rem; font-weight: 700; color: #2563eb; margin-bottom: 0.25rem;">RECORD A</div>
                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(c.schoolA.name)}</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">
                  Postcode: <strong>${escapeHtml(c.schoolA.postcode || 'N/A')}</strong> | URN: <strong>${escapeHtml(c.schoolA.urn || 'N/A')}</strong> | Type: <strong>${escapeHtml(c.schoolA.schoolType || 'N/A')}</strong>
                </div>
              </div>
              ${renderQuickAccessInvestigationLinks(c.schoolA)}
            </div>
            <div style="background: #fff7ed; border: 1px solid #ffedd5; border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="font-size: 0.72rem; font-weight: 700; color: #ea580c; margin-bottom: 0.25rem;">RECORD B</div>
                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(c.schoolB.name)}</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">
                  Postcode: <strong>${escapeHtml(c.schoolB.postcode || 'N/A')}</strong> | URN: <strong>${escapeHtml(c.schoolB.urn || 'N/A')}</strong> | Type: <strong>${escapeHtml(c.schoolB.schoolType || 'N/A')}</strong>
                </div>
              </div>
              ${renderQuickAccessInvestigationLinks(c.schoolB)}
            </div>
          </div>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
    if (forceScan) {
      showToast(data.message || 'Conflict scan completed and persisted.', 'success');
    }
  } catch (err) {
    console.error('Error loading system corrections queue:', err);
    container.innerHTML = '<div style="color: #ef4444; padding: 1rem;">Error connecting to corrections queue.</div>';
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Run Conflict &amp; Overlap Scan';
    }
  }
}

async function clearConflictingUrn(schoolId, schoolName = '') {
  let displayName = schoolName;
  if (!displayName && Array.isArray(window._qualityCorrectionsQueue)) {
    const item = window._qualityCorrectionsQueue.find(c => c.schoolB?.id === schoolId || c.schoolA?.id === schoolId);
    if (item) displayName = item.schoolB?.id === schoolId ? item.schoolB?.name : item.schoolA?.name;
  }
  if (!confirm(`Clear conflicting DfE URN for ${displayName || schoolId}? The record will be preserved and flagged for official GIAS re-scan.`)) return;

  try {
    const res = await fetch('/api/admin/quality/corrections/clear-urn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ schoolId })
    });

    if (res.ok) {
      const data = await res.json();
      showToast(data.message, 'success');
      await loadSystemCorrectionsQueue();
      await loadSchools();
    } else {
      showToast('Failed to clear conflicting URN.', 'error');
    }
  } catch (err) {
    console.error('Clear URN error:', err);
    showToast('Exception clearing URN.', 'error');
  }
}

// Utility debounce
function debounce(func, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}


/* ============================================================= */
/* PARENT PORTAL 2.0 CONTROLLER & DUAL-TRACK ADMISSIONS ENGINE   */
/* ============================================================= */

function setupParent2EventListeners() {
  // 1. Sub-navigation buttons
  document.querySelectorAll('.parent2-subnav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-p2-view');
      if (view) switchParent2SubView(view);
    });
  });

  // 2. Wizard Action Buttons
  const applyWizardBtn = document.getElementById('p2-btn-apply-wizard');
  if (applyWizardBtn) {
    applyWizardBtn.addEventListener('click', saveParent2WizardProfile);
  }

  const resetWizardBtn = document.getElementById('p2-btn-reset-wizard');
  if (resetWizardBtn) {
    resetWizardBtn.addEventListener('click', () => {
      const postcodeInput = document.getElementById('p2-input-postcode');
      if (postcodeInput) postcodeInput.value = '';
      const genderSelect = document.getElementById('p2-select-gender');
      if (genderSelect) genderSelect.value = 'NA';
      const abilitySelect = document.getElementById('p2-select-ability');
      if (abilitySelect) abilitySelect.value = 'NA';
      document.querySelectorAll('.p2-type-chk').forEach(c => c.checked = (c.value === 'NA'));
      saveParent2WizardProfile();
    });
  }

  // 3. Refresh Recs Button
  const refreshRecsBtn = document.getElementById('p2-btn-refresh-recs');
  if (refreshRecsBtn) {
    refreshRecsBtn.addEventListener('click', () => {
      fetchRecommendations();
      showToast('Refreshed school recommendations!', 'info');
    });
  }

  // 4. Calendar Export (.ics)
  const exportIcsBtn = document.getElementById('p2-btn-export-ics');
  if (exportIcsBtn) {
    exportIcsBtn.addEventListener('click', exportCalendarIcs);
  }

  // 5. Dual-Track Quick Search Typeaheads
  setupParent2Typeaheads();
}

function switchParent2SubView(subViewName) {
  parent2State.activeSubView = subViewName;
  
  document.querySelectorAll('.parent2-subnav-btn').forEach(btn => {
    if (btn.getAttribute('data-p2-view') === subViewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.parent2-view-section').forEach(sec => {
    if (sec.id === `p2-view-${subViewName}`) {
      sec.style.display = 'block';
      sec.classList.add('active');
    } else {
      sec.style.display = 'none';
      sec.classList.remove('active');
    }
  });

  renderParent2Views();
}

function renderParent2Views() {
  renderParent2HeaderStats();
  if (parent2State.activeSubView === 'matchmaker') {
    fetchRecommendations();
  } else if (parent2State.activeSubView === 'matrix') {
    renderDecisionMatrix();
  } else if (parent2State.activeSubView === 'calendar') {
    renderParent2Timeline();
  }
}

function renderParent2HeaderStats() {
  const locEl = document.getElementById('p2-stat-location');
  const cafEl = document.getElementById('p2-stat-caf');
  const indepEl = document.getElementById('p2-stat-indep');

  const locVal = document.getElementById('p2-input-postcode')?.value || 'Greater London';
  if (locEl) locEl.textContent = `Target: ${locVal}`;

  const cafCount = parent2State.cafList.length;
  if (cafEl) {
    cafEl.innerHTML = `State CAF: <strong>${cafCount} / 6</strong> Choices`;
  }

  const indepCount = parent2State.independentList.length;
  if (indepEl) {
    indepEl.innerHTML = `Independent: <strong>${indepCount}</strong> Tracked`;
  }
}

async function saveParent2WizardProfile() {
  const location = document.getElementById('p2-input-postcode')?.value.trim() || '';
  const gender = document.getElementById('p2-select-gender')?.value || 'NA';
  const childAbilityLevel = document.getElementById('p2-select-ability')?.value || 'NA';
  
  const selectedTypes = Array.from(document.querySelectorAll('.p2-type-chk:checked')).map(c => c.value);
  const proximity = document.getElementById('p2-pref-commute')?.value || 'somewhat';
  const academicExcellence = document.getElementById('p2-pref-attainment')?.value || 'very';
  const pupilProgress = document.getElementById('p2-pref-progress')?.value || 'somewhat';
  const ofstedFloor = document.getElementById('p2-pref-ofsted')?.value || 'NA';

  const preferencesOverride = {
    targetBorough: location,
    targetPostcode: location,
    childAbilityLevel,
    binaryFilters: {
      locations: location,
      gender,
      ofstedFloor,
      schoolTypes: selectedTypes.length > 0 ? selectedTypes : ['NA'],
      examFormats: ['NA']
    },
    qualitativeWeights: {
      proximity,
      academicExcellence,
      pupilProgress
    }
  };

  try {
    const res = await fetch('/api/user-recommendations/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify(preferencesOverride)
    });

    if (res.ok) {
      showToast('Matchmaker preferences updated!', 'success');
      await saveUserPortfolio(true);
      await fetchRecommendations();
    }
  } catch (err) {
    console.error('Error saving wizard preferences:', err);
  }
}

// Render Recommendations in Parent Portal 2.0 Feed with Plain-English Insights
function renderParent2RecommendationsList(items) {
  const container = document.getElementById('p2-recs-container');
  if (!container) return;

  renderParent2HeaderStats();

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: #64748b; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1;">
        <i class="fa-solid fa-compass" style="font-size: 2rem; color: #94a3b8; margin-bottom: 0.75rem;"></i>
        <h4 style="margin: 0; color: #334155; font-size: 1.05rem;">No matching recommendations found</h4>
        <p style="margin: 0.35rem 0 0 0; font-size: 0.85rem;">Try adjusting your home postcode or school type preferences in the wizard above.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  items.slice(0, 15).forEach((item, idx) => {
    const s = item.school;
    const score = item.matchScore;
    const reasons = item.reasons || [];

    let matchBg = '#ecfdf5';
    let matchColor = '#059669';
    let matchLabel = 'High Match';
    if (score < 70) { matchBg = '#eff6ff'; matchColor = '#2563eb'; matchLabel = 'Good Match'; }
    if (score < 50) { matchBg = '#fffbeb'; matchColor = '#d97706'; matchLabel = 'Moderate Fit'; }

    const isIndependent = (s.schoolType === 'Independent');
    const isInCaf = parent2State.cafList.some(x => x.id === s.id);
    const cafRank = parent2State.cafList.findIndex(x => x.id === s.id) + 1;
    const isInIndep = parent2State.independentList.some(x => x.id === s.id);

    // Plain English Insights
    // Plain English Insights (Shortened for 2-Row Compact Layout)
    const insights = [];
    if (s.gcseProgress8 !== null && s.gcseProgress8 !== undefined) {
      if (s.gcseProgress8 >= 0.5) {
        insights.push(`<span class="parent-insight-tag insight-growth-top" title="Top 5% student growth (+${s.gcseProgress8})"><i class="fa-solid fa-arrow-trend-up"></i> Top 5% Growth (+${s.gcseProgress8})</span>`);
      } else if (s.gcseProgress8 > 0) {
        insights.push(`<span class="parent-insight-tag insight-growth-top" title="Above average pupil progress (+${s.gcseProgress8})"><i class="fa-solid fa-arrow-trend-up"></i> Progress +${s.gcseProgress8}</span>`);
      }
    }

    if (s.gcseAttainment8 !== null && s.gcseAttainment8 !== undefined) {
      if (s.gcseAttainment8 >= 65) {
        insights.push(`<span class="parent-insight-tag insight-academic-top" title="Outstanding GCSE Attainment 8: ${s.gcseAttainment8}"><i class="fa-solid fa-trophy"></i> GCSE ${s.gcseAttainment8}</span>`);
      } else if (s.gcseAttainment8 >= 50) {
        insights.push(`<span class="parent-insight-tag insight-academic-top" title="Strong GCSE Attainment 8: ${s.gcseAttainment8}"><i class="fa-solid fa-award"></i> GCSE ${s.gcseAttainment8}</span>`);
      }
    }

    if (s.entranceExamType && s.entranceExamType !== 'Standard' && s.entranceExamType !== 'Non-selective') {
      insights.push(`<span class="parent-insight-tag insight-exam-selective"><i class="fa-solid fa-pen-nib"></i> ${s.entranceExamType}</span>`);
    }

    if (dates.examDate) {
      insights.push(`<span class="parent-insight-tag" style="background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5;"><i class="fa-solid fa-calendar"></i> Exam: ${dates.examDate}</span>`);
    }

    // Contextual Action Button
    let actionBtnHtml = '';
    if (isIndependent) {
      if (isInIndep) {
        actionBtnHtml = `<button class="btn btn-secondary" style="font-size: 0.74rem; padding: 0.28rem 0.75rem; background: #f3e8ff; color: #7c3aed; border: 1px solid #e9d5ff; white-space: nowrap;" disabled><i class="fa-solid fa-check"></i> Private</button>`;
      } else {
        actionBtnHtml = `<button class="btn btn-primary btn-p2-add-indep" data-id="${s.id}" style="font-size: 0.74rem; padding: 0.28rem 0.75rem; background: #7c3aed; border-color: #6d28d9; white-space: nowrap;"><i class="fa-solid fa-plus"></i> Track Private</button>`;
      }
    } else {
      if (isInCaf) {
        actionBtnHtml = `<button class="btn btn-secondary" style="font-size: 0.74rem; padding: 0.28rem 0.75rem; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; white-space: nowrap;" disabled><i class="fa-solid fa-check"></i> CAF (#${cafRank})</button>`;
      } else {
        const quotaFull = parent2State.cafList.length >= 6;
        actionBtnHtml = `<button class="btn btn-primary btn-p2-add-caf" data-id="${s.id}" style="font-size: 0.74rem; padding: 0.28rem 0.75rem; background: ${quotaFull ? '#ea580c' : '#2563eb'}; border-color: ${quotaFull ? '#c2410c' : '#1d4ed8'}; white-space: nowrap;"><i class="fa-solid ${quotaFull ? 'fa-arrows-rotate' : 'fa-plus'}"></i> ${quotaFull ? 'Swap CAF' : `Add CAF (${parent2State.cafList.length}/6)`}</button>`;
      }
    }

    const card = document.createElement('div');
    card.className = 'school-row-item';
    card.style.background = 'white';
    card.style.border = '1px solid #e2e8f0';
    card.style.borderLeft = `5px solid ${matchColor}`;
    card.style.borderRadius = '10px';
    card.style.padding = '0.65rem 1rem';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '0.35rem';
    card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)';

    card.innerHTML = `
      <!-- Row 1: Match Score, School Name, Type Badge, Location & Right-Aligned Actions -->
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; width: 100%;">
        <div style="display: flex; align-items: center; gap: 0.5rem; min-width: 0; flex: 1; flex-wrap: nowrap; overflow: hidden;">
          <span style="font-weight: 800; font-size: 0.76rem; color: ${matchColor}; background: ${matchBg}; padding: 0.15rem 0.55rem; border-radius: 999px; border: 1px solid ${matchColor}44; white-space: nowrap; flex-shrink: 0;">
            <i class="fa-solid fa-sparkles"></i> ${score}% ${matchLabel}
          </span>
          <h4 style="font-size: 0.96rem; font-weight: 800; color: #1e293b; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">
            <a href="#" onclick="openSchoolDetail('${s.id}'); return false;" style="color: #1e293b; text-decoration: none;" title="${s.name}">${s.name}</a>
          </h4>
          <span style="font-size: 0.72rem; font-weight: 700; color: ${isIndependent ? '#7c3aed' : '#2563eb'}; background: ${isIndependent ? '#f3e8ff' : '#eff6ff'}; padding: 0.12rem 0.45rem; border-radius: 6px; white-space: nowrap; flex-shrink: 0;">
            ${s.schoolType}
          </span>
          <span style="font-size: 0.75rem; color: #64748b; white-space: nowrap; flex-shrink: 0;"><i class="fa-solid fa-location-dot" style="color: #ef4444;"></i> <strong>${s.la}</strong> (${s.postcode || 'N/A'})</span>
        </div>

        <div style="display: flex; align-items: center; gap: 0.4rem; margin-left: auto; flex-shrink: 0;">
          <button class="btn btn-outline" onclick="openSchoolDetail('${s.id}')" style="font-size: 0.74rem; padding: 0.28rem 0.6rem; white-space: nowrap;">
            <i class="fa-solid fa-eye"></i> Details
          </button>
          ${actionBtnHtml}
          <button class="btn-text btn-remove-rec" data-id="${s.id}" style="color: #94a3b8; font-size: 0.75rem; cursor: pointer; padding: 0.2rem 0.35rem;" title="Not interested">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <!-- Row 2: Plain-English Insights & Right-Aligned Match Reason -->
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; border-top: 1px dashed #f1f5f9; padding-top: 0.35rem; width: 100%;">
        <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: nowrap; overflow: hidden; min-width: 0;">
          ${insights.join(' ')}
        </div>
        <span style="font-size: 0.74rem; color: #475569; margin-left: auto; background: #f8fafc; padding: 0.12rem 0.5rem; border-radius: 6px; border: 1px solid #e2e8f0; white-space: nowrap; flex-shrink: 0; text-overflow: ellipsis; overflow: hidden; max-width: 380px;" title="${reasons[0] || 'Matches child profile and location targets'}">
          <strong>Why this matches:</strong> ${reasons[0] || 'Matches child profile and location targets'}
        </span>
      </div>
    `;

    container.appendChild(card);
  });

  // Attach Add to State CAF Listeners
  container.querySelectorAll('.btn-p2-add-caf').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const school = items.find(x => x.school.id === id)?.school;
      if (school) await addSchoolToStateCaf(school);
    });
  });

  // Attach Add to Independent Listeners
  container.querySelectorAll('.btn-p2-add-indep').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const school = items.find(x => x.school.id === id)?.school;
      if (school) await addSchoolToIndependent(school);
    });
  });

  // Attach Remove listener
  container.querySelectorAll('.btn-remove-rec').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      removeRecommendation(id);
    });
  });
}

// Add School to State CAF Track (Max 6 Choices)
async function addSchoolToStateCaf(school) {
  if (!school || !school.id) return;

  if (parent2State.cafList.some(s => s.id === school.id)) {
    showToast(`${school.name} is already in your State CAF preferences list!`, 'info');
    return;
  }

  if (parent2State.cafList.length >= 6) {
    if (confirm(`You have reached the 6-school State CAF limit!\n\nWould you like to open the Dual-Track Admissions Hub to swap an existing choice for ${school.name}?`)) {
      switchPrimaryTab('recommend');
      switchClassicSubTab('dualtrack');
    }
    return;
  }

  parent2State.cafList.push(school);
  userSelectedSchools = [...parent2State.cafList, ...parent2State.independentList];
  updateUserSchoolsUI();
  fetchRecommendations();
  await saveUserPortfolio(true);
  showToast(`Added ${school.name} as State CAF Preference #${parent2State.cafList.length}!`, 'success');
  renderParent2Views();
}

// Remove School from State CAF Track
async function removeSchoolFromStateCaf(schoolId) {
  parent2State.cafList = parent2State.cafList.filter(s => s.id !== schoolId);
  userSelectedSchools = [...parent2State.cafList, ...parent2State.independentList];
  updateUserSchoolsUI();
  fetchRecommendations();
  await saveUserPortfolio(true);
  showToast('Removed choice from State CAF list.', 'info');
  renderParent2Views();
}

// Move CAF Choice Rank (Reordering 1st to 6th)
async function moveCafRank(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= parent2State.cafList.length) return;

  const item = parent2State.cafList.splice(index, 1)[0];
  parent2State.cafList.splice(newIndex, 0, item);

  await saveUserPortfolio(true);
  showToast(`Updated State CAF preference order.`, 'success');
  renderDualTrackHub();
}

// Add School to Independent Direct Track (Unlimited)
async function addSchoolToIndependent(school) {
  if (!school || !school.id) return;

  if (parent2State.independentList.some(s => s.id === school.id)) {
    showToast(`${school.name} is already in your Independent tracked list!`, 'info');
    return;
  }

  parent2State.independentList.push(school);
  userSelectedSchools = [...parent2State.cafList, ...parent2State.independentList];
  updateUserSchoolsUI();
  fetchRecommendations();
  await saveUserPortfolio(true);
  showToast(`Added ${school.name} to Independent Direct admissions list!`, 'success');
  renderParent2Views();
}

// Remove School from Independent Direct Track
async function removeSchoolFromIndependent(schoolId) {
  parent2State.independentList = parent2State.independentList.filter(s => s.id !== schoolId);
  userSelectedSchools = [...parent2State.cafList, ...parent2State.independentList];
  updateUserSchoolsUI();
  fetchRecommendations();
  await saveUserPortfolio(true);
  showToast('Removed school from Independent tracked list.', 'info');
  renderParent2Views();
}

// Calculate State CAF Strategy Health (Reach vs Target vs Catchment Safety)
function calculateCafStrategy(cafList) {
  let reachCount = 0;
  let targetCount = 0;
  let safetyCount = 0;

  cafList.forEach(s => {
    const isGrammar = (s.schoolType === 'Grammar');
    const att8 = s.gcseAttainment8 || 0;
    const prog8 = s.gcseProgress8 || 0;

    if (isGrammar || att8 >= 70) {
      reachCount++;
    } else if (att8 >= 55 || prog8 >= 0.3) {
      targetCount++;
    } else {
      safetyCount++;
    }
  });

  let title = 'CAF Strategy Health Check';
  let desc = 'Add Grammar and Comprehensive schools to build a balanced mix of Reach, Target, and Safety preferences.';
  let tag = 'Building List';

  if (cafList.length === 0) {
    tag = 'Empty (0/6)';
    desc = 'Select up to 6 State/Grammar schools to rank for your local council Common Application Form.';
  } else if (reachCount === cafList.length && cafList.length >= 3) {
    tag = '⚠️ High-Risk Reach Only';
    desc = 'All your choices are highly selective Reach schools. We strongly recommend adding 1–2 Catchment Safety schools so your child is guaranteed a place on March 1!';
  } else if (safetyCount > 0 && (reachCount > 0 || targetCount > 0)) {
    tag = '✅ Well Balanced Portfolio';
    desc = 'Excellent strategy! You have a healthy blend of ambitious academic targets backed by high-probability catchment safety options.';
  } else if (cafList.length >= 4) {
    tag = '⚖️ Moderate Balance';
    desc = 'Good selection. Ensure your final 1–2 preferences are within your guaranteed local catchment radius.';
  }

  return { reachCount, targetCount, safetyCount, title, desc, tag };
}

// Render Dual-Track Admissions Hub
function renderDualTrackHub() {
  renderParent2HeaderStats();

  const cafContainer = document.getElementById('p2-caf-slots-list');
  const indepContainer = document.getElementById('p2-indep-list-container');
  const quotaBadge = document.getElementById('p2-caf-quota-badge');
  const usedCountEl = document.getElementById('p2-caf-used-count');
  const indepCountEl = document.getElementById('p2-indep-count');

  const cafCount = parent2State.cafList.length;
  if (usedCountEl) usedCountEl.textContent = cafCount;
  if (indepCountEl) indepCountEl.textContent = parent2State.independentList.length;

  if (quotaBadge) {
    quotaBadge.className = `track-badge-quota ${cafCount >= 6 ? 'quota-full' : 'quota-ok'}`;
    quotaBadge.innerHTML = `<span>${cafCount}</span> / 6 Preferences`;
  }

  // Update Strategy Health Banner
  const strat = calculateCafStrategy(parent2State.cafList);
  const stratTitle = document.getElementById('p2-strategy-health-title');
  const stratTag = document.getElementById('p2-strategy-status-tag');
  const stratDesc = document.getElementById('p2-strategy-health-desc');
  const reachEl = document.getElementById('p2-count-reach');
  const targetEl = document.getElementById('p2-count-target');
  const safetyEl = document.getElementById('p2-count-safety');

  if (stratTitle) stratTitle.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${strat.title}`;
  if (stratTag) stratTag.textContent = strat.tag;
  if (stratDesc) stratDesc.textContent = strat.desc;
  if (reachEl) reachEl.textContent = strat.reachCount;
  if (targetEl) targetEl.textContent = strat.targetCount;
  if (safetyEl) safetyEl.textContent = strat.safetyCount;

  // Render 6 State CAF Slots
  if (cafContainer) {
    cafContainer.innerHTML = '';
    for (let slot = 1; slot <= 6; slot++) {
      const school = parent2State.cafList[slot - 1];
      const slotCard = document.createElement('div');

      if (school) {
        slotCard.className = 'caf-slot-card';
        const isGrammar = (school.schoolType === 'Grammar');
        const stratBadge = isGrammar ? '<span class="caf-strategy-pill strategy-reach">🎯 Reach</span>' : (school.gcseAttainment8 >= 55 ? '<span class="caf-strategy-pill strategy-target">⚖️ Target</span>' : '<span class="caf-strategy-pill strategy-safety">🛡️ Safety</span>');

        slotCard.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 0;">
            <div class="caf-rank-badge">${slot}</div>
            <div style="min-width: 0;">
              <h5 style="margin: 0; font-size: 0.92rem; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                <a href="#" onclick="openSchoolDetail('${school.id}'); return false;" style="color: #1e293b; text-decoration: none;">${school.name}</a>
              </h5>
              <div style="font-size: 0.76rem; color: #64748b; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.15rem;">
                <span>${school.schoolType}</span>
                <span>•</span>
                <span>${school.la}</span>
                <span>•</span>
                <span>Ofsted: <strong>${formatOfsted(school.ofstedRating)}</strong></span>
                ${stratBadge}
              </div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0;">
            <button class="btn-text btn-caf-up" data-idx="${slot - 1}" style="padding: 0.25rem 0.45rem; color: #475569; cursor: pointer;" ${slot === 1 ? 'disabled style="opacity:0.3;"' : ''} title="Move Up in Rank">
              <i class="fa-solid fa-arrow-up"></i>
            </button>
            <button class="btn-text btn-caf-down" data-idx="${slot - 1}" style="padding: 0.25rem 0.45rem; color: #475569; cursor: pointer;" ${slot === cafCount ? 'disabled style="opacity:0.3;"' : ''} title="Move Down in Rank">
              <i class="fa-solid fa-arrow-down"></i>
            </button>
            <button class="btn-text btn-caf-remove" data-id="${school.id}" style="padding: 0.25rem 0.45rem; color: #ef4444; cursor: pointer;" title="Remove from CAF list">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        `;
      } else {
        slotCard.className = 'caf-slot-card';
        slotCard.style.border = '1px dashed #cbd5e1';
        slotCard.style.background = '#f8fafc';
        slotCard.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.75rem; color: #94a3b8;">
            <div class="caf-rank-badge" style="background: #e2e8f0; color: #64748b;">${slot}</div>
            <span style="font-size: 0.85rem; font-style: italic;">Preference Slot #${slot} (Available - search above to add)</span>
          </div>
        `;
      }

      cafContainer.appendChild(slotCard);
    }

    // Attach CAF slot actions
    cafContainer.querySelectorAll('.btn-caf-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        moveCafRank(idx, -1);
      });
    });

    cafContainer.querySelectorAll('.btn-caf-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        moveCafRank(idx, 1);
      });
    });

    cafContainer.querySelectorAll('.btn-caf-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        removeSchoolFromStateCaf(id);
      });
    });
  }

  // Render Independent Schools List
  if (indepContainer) {
    indepContainer.innerHTML = '';
    if (parent2State.independentList.length === 0) {
      indepContainer.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: #94a3b8; background: #f8fafc; border-radius: 10px; border: 1px dashed #cbd5e1; font-size: 0.85rem;">
          <i class="fa-solid fa-graduation-cap" style="font-size: 1.8rem; color: #cbd5e1; margin-bottom: 0.5rem;"></i>
          <div>No independent schools tracked yet.</div>
          <div style="font-size: 0.78rem; color: #64748b; margin-top: 0.2rem;">Search above to track unlimited fee-paying / bursary schools.</div>
        </div>
      `;
    } else {
      parent2State.independentList.forEach(school => {
        const indepCard = document.createElement('div');
        indepCard.className = 'caf-slot-card';
        indepCard.style.borderLeft = '4px solid #7c3aed';

        const note = parent2State.parentNotes[school.id]?.note || '';

        indepCard.innerHTML = `
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <h5 style="margin: 0; font-size: 0.92rem; font-weight: 700; color: #1e293b;">
                <a href="#" onclick="openSchoolDetail('${school.id}'); return false;" style="color: #1e293b; text-decoration: none;">${school.name}</a>
              </h5>
              <span style="font-size: 0.72rem; background: #f3e8ff; color: #7c3aed; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 700;">Direct Entry</span>
            </div>
            <div style="font-size: 0.76rem; color: #64748b; margin-top: 0.2rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <span>${school.la}</span>
              <span>•</span>
              <span>Exam: <strong>${school.entranceExamType || 'ISEB / Bespoke'}</strong></span>
            </div>
            ${note ? `<div style="margin-top: 0.35rem; font-size: 0.76rem; color: #334155; background: #faf5ff; padding: 0.25rem 0.5rem; border-radius: 6px; border: 1px solid #f3e8ff;"><i class="fa-solid fa-note-sticky" style="color: #7c3aed;"></i> ${note}</div>` : ''}
          </div>

          <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
            <button class="btn btn-outline btn-indep-note" data-id="${school.id}" style="font-size: 0.72rem; padding: 0.25rem 0.55rem;" title="Add/Edit Note">
              <i class="fa-solid fa-pen"></i> Note
            </button>
            <button class="btn-text btn-indep-remove" data-id="${school.id}" style="padding: 0.25rem 0.45rem; color: #ef4444; cursor: pointer;" title="Remove from tracking">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        `;
        indepContainer.appendChild(indepCard);
      });

      indepContainer.querySelectorAll('.btn-indep-note').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          promptParentNote(id);
        });
      });

      indepContainer.querySelectorAll('.btn-indep-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          removeSchoolFromIndependent(id);
        });
      });
    }
  }
}

// Side-by-Side Shortlist Decision Matrix
function renderDecisionMatrix() {
  const table = document.getElementById('p2-matrix-table');
  if (!table) return;

  const allSelected = [...parent2State.cafList, ...parent2State.independentList];
  if (allSelected.length === 0) {
    table.innerHTML = `
      <tr>
        <td style="text-align: center; padding: 3rem 1rem; color: #94a3b8;">
          <i class="fa-solid fa-table-columns" style="font-size: 2rem; color: #cbd5e1; margin-bottom: 0.5rem;"></i>
          <div>No schools in your shortlist to compare.</div>
          <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">Add schools to your State CAF or Independent list to generate a side-by-side decision matrix.</div>
        </td>
      </tr>
    `;
    return;
  }

  // Calculate highest attainment and progress for green highlighting
  let maxAttain = -1;
  let maxProg = -999;
  allSelected.forEach(s => {
    if (s.gcseAttainment8 > maxAttain) maxAttain = s.gcseAttainment8;
    if (s.gcseProgress8 > maxProg) maxProg = s.gcseProgress8;
  });

  let html = `
    <thead>
      <tr style="background: #f8fafc;">
        <th style="width: 180px; padding: 0.75rem 1rem; font-size: 0.85rem; font-weight: 700; color: #475569;">Comparison Factor</th>
        ${allSelected.map((s, idx) => `
          <th style="padding: 0.75rem 1rem; font-size: 0.88rem; font-weight: 800; color: #1e293b; border-left: 1px solid #e2e8f0; min-width: 200px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>${s.name}</span>
              <span style="font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.35rem; border-radius: 4px; ${s.schoolType === 'Independent' ? 'background:#f3e8ff; color:#7c3aed;' : 'background:#eff6ff; color:#2563eb;'}">
                ${s.schoolType === 'Independent' ? 'Direct' : `CAF #${idx + 1}`}
              </span>
            </div>
          </th>
        `).join('')}
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="font-weight: 700; color: #334155; padding: 0.65rem 1rem;"><i class="fa-solid fa-building-columns" style="color:#6366f1;"></i> School Type</td>
        ${allSelected.map(s => `<td style="padding: 0.65rem 1rem; border-left: 1px solid #f1f5f9;">${s.schoolType}</td>`).join('')}
      </tr>
      <tr>
        <td style="font-weight: 700; color: #334155; padding: 0.65rem 1rem;"><i class="fa-solid fa-location-dot" style="color:#ef4444;"></i> Borough &amp; Postcode</td>
        ${allSelected.map(s => `<td style="padding: 0.65rem 1rem; border-left: 1px solid #f1f5f9;">${s.la} (${s.postcode || 'N/A'})</td>`).join('')}
      </tr>
      <tr>
        <td style="font-weight: 700; color: #334155; padding: 0.65rem 1rem;"><i class="fa-solid fa-star" style="color:#eab308;"></i> Ofsted Rating</td>
        ${allSelected.map(s => {
          const rating = formatOfsted(s.ofstedRating);
          const isOut = rating === 'Outstanding';
          return `<td style="padding: 0.65rem 1rem; border-left: 1px solid #f1f5f9;"><span class="${isOut ? 'matrix-winner' : ''}">${rating}</span></td>`;
        }).join('')}
      </tr>
      <tr>
        <td style="font-weight: 700; color: #334155; padding: 0.65rem 1rem;"><i class="fa-solid fa-trophy" style="color:#eab308;"></i> GCSE Attainment 8</td>
        ${allSelected.map(s => {
          const val = s.gcseAttainment8 !== null && s.gcseAttainment8 !== undefined ? s.gcseAttainment8 : 'N/A';
          const isBest = val === maxAttain && maxAttain > 0;
          return `<td style="padding: 0.65rem 1rem; border-left: 1px solid #f1f5f9;"><span class="${isBest ? 'matrix-winner' : ''}">${val}${isBest ? ' 🏆 Best' : ''}</span></td>`;
        }).join('')}
      </tr>
      <tr>
        <td style="font-weight: 700; color: #334155; padding: 0.65rem 1rem;"><i class="fa-solid fa-arrow-trend-up" style="color:#059669;"></i> Progress 8 (Growth)</td>
        ${allSelected.map(s => {
          const val = s.gcseProgress8 !== null && s.gcseProgress8 !== undefined ? `+${s.gcseProgress8}` : 'N/A';
          const isBest = s.gcseProgress8 === maxProg && maxProg > -900;
          return `<td style="padding: 0.65rem 1rem; border-left: 1px solid #f1f5f9;"><span class="${isBest ? 'matrix-winner' : ''}">${val}${isBest ? ' 🚀 Top Growth' : ''}</span></td>`;
        }).join('')}
      </tr>
      <tr>
        <td style="font-weight: 700; color: #334155; padding: 0.65rem 1rem;"><i class="fa-solid fa-pen-nib" style="color:#4338ca;"></i> Entrance Exam</td>
        ${allSelected.map(s => `<td style="padding: 0.65rem 1rem; border-left: 1px solid #f1f5f9;"><strong>${s.entranceExamType || 'Standard'}</strong></td>`).join('')}
      </tr>
      <tr>
        <td style="font-weight: 700; color: #334155; padding: 0.65rem 1rem;"><i class="fa-solid fa-users" style="color:#8b5cf6;"></i> Gender &amp; Capacity</td>
        ${allSelected.map(s => `<td style="padding: 0.65rem 1rem; border-left: 1px solid #f1f5f9;">${s.gender} (${s.numberOfPupils || 'N/A'} pupils)</td>`).join('')}
      </tr>
      <tr>
        <td style="font-weight: 700; color: #334155; padding: 0.65rem 1rem;"><i class="fa-solid fa-note-sticky" style="color:#f59e0b;"></i> Parent Notes</td>
        ${allSelected.map(s => {
          const note = parent2State.parentNotes[s.id]?.note || '';
          return `<td style="padding: 0.65rem 1rem; border-left: 1px solid #f1f5f9; font-size: 0.8rem; color: #475569;">${note || '<em style="color:#94a3b8;">No notes saved</em>'}</td>`;
        }).join('')}
      </tr>
    </tbody>
  `;

  table.innerHTML = html;
}

// Unified Admissions Timeline & Calendar
function renderParent2Timeline() {
  const container = document.getElementById('p2-calendar-timeline-container');
  if (!container) return;

  const allSelected = [...parent2State.cafList, ...parent2State.independentList];

  const timelineEvents = [
    {
      month: 'May – June 2026',
      title: '11+ & Entrance Exam Registrations Open',
      desc: 'Sutton SET, CSSE Essex, Kent 11+, and Independent ISEB registrations open.',
      track: 'state'
    },
    {
      month: 'September 2026',
      title: 'Grammar Stage 1 Sittings & Open Evenings',
      desc: 'Stage 1 tests (e.g. Sutton SET, Kent Test) and school open day visits.',
      track: 'state'
    },
    {
      month: 'October 31, 2026',
      title: '🏛️ National State Secondary CAF Deadline (Strict)',
      desc: 'Submission deadline for your Local Authority Common Application Form (ranking up to 6 State/Grammar preferences).',
      track: 'state',
      critical: true
    },
    {
      month: 'November – December 2026',
      title: 'Independent Registration & Bursary Deadlines',
      desc: 'Closing dates for direct fee-paying applications and means-tested bursary paperwork.',
      track: 'independent'
    },
    {
      month: 'January 2027',
      title: 'Independent Bespoke Exams & Interviews',
      desc: 'Direct entrance exams and interview callback windows for private schools.',
      track: 'independent'
    },
    {
      month: 'March 1, 2027',
      title: '🎉 National Offer Day (State Secondary Schools)',
      desc: 'Councils release official Year 7 state school offers via eAdmissions.',
      track: 'state',
      critical: true
    }
  ];

  let html = `<div style="display: flex; flex-direction: column; gap: 1rem;">`;

  timelineEvents.forEach(evt => {
    const isState = (evt.track === 'state');
    const borderColor = evt.critical ? '#ef4444' : (isState ? '#2563eb' : '#7c3aed');
    const bgBadge = evt.critical ? '#fef2f2' : (isState ? '#eff6ff' : '#faf5ff');
    const colorBadge = evt.critical ? '#b91c1c' : (isState ? '#1d4ed8' : '#7c3aed');

    html += `
      <div style="background: white; border: 1px solid #e2e8f0; border-left: 5px solid ${borderColor}; border-radius: 10px; padding: 1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
        <div>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span style="background: ${bgBadge}; color: ${colorBadge}; font-weight: 800; font-size: 0.76rem; padding: 0.2rem 0.55rem; border-radius: 6px;">
              ${evt.month}
            </span>
            <h5 style="margin: 0; font-size: 0.98rem; font-weight: 700; color: #1e293b;">
              ${evt.title}
            </h5>
          </div>
          <p style="margin: 0.35rem 0 0 0; font-size: 0.83rem; color: #64748b;">${evt.desc}</p>
        </div>

        <button class="btn btn-outline" onclick="exportCalendarIcs()" style="font-size: 0.76rem; padding: 0.35rem 0.65rem;">
          <i class="fa-solid fa-calendar-plus"></i> Add to Calendar
        </button>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

// 1-Click iCalendar (.ics) Generator and Downloader
function exportCalendarIcs() {
  const events = [
    { summary: 'Secondary CAF Council Submission Deadline', dtstart: '20261031T235900Z', dtend: '20261031T235959Z', desc: 'Deadline to submit your 6 State CAF preferences to your Local Authority portal (eAdmissions).' },
    { summary: 'National Offer Day (Year 7 Admissions)', dtstart: '20270301T090000Z', dtend: '20270301T170000Z', desc: 'Official outcome emails released by council for secondary school offers.' },
    { summary: 'Sutton 11+ Selective Eligibility Test (SET)', dtstart: '20260915T083000Z', dtend: '20260915T123000Z', desc: 'Stage 1 11+ Selective Entrance Exam sitting.' }
  ];

  let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//EduLondon DB//Admissions Calendar//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n`;

  events.forEach(evt => {
    ics += `BEGIN:VEVENT\r\nUID:${Date.now()}-${Math.random().toString(36).substr(2, 9)}@edulondon.sch.uk\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z\r\nDTSTART:${evt.dtstart}\r\nDTEND:${evt.dtend}\r\nSUMMARY:${evt.summary}\r\nDESCRIPTION:${evt.desc}\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\n`;
  });

  ics += `END:VCALENDAR\r\n`;

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', 'EduLondon_Admissions_Calendar.ics');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Downloaded admissions calendar (.ics) file! Open to sync with Google Calendar or Apple iCal.', 'success');
}

// Prompt Parent for Personal School Note
function promptParentNote(schoolId) {
  const current = parent2State.parentNotes[schoolId]?.note || '';
  const note = prompt('Enter your private notes for this school (e.g. Open Day impressions, commute feedback, staff contact):', current);
  if (note !== null) {
    if (!parent2State.parentNotes[schoolId]) parent2State.parentNotes[schoolId] = {};
    parent2State.parentNotes[schoolId].note = note.trim();
    saveUserPortfolio(true);
    showToast('Saved your private school note!', 'success');
    renderDualTrackHub();
  }
}

// Setup Dual-Track Typeahead Searches
function setupParent2Typeaheads() {
  const cafInput = document.getElementById('p2-caf-add-search');
  const cafBox = document.getElementById('p2-caf-add-suggestions');
  const indepInput = document.getElementById('p2-indep-add-search');
  const indepBox = document.getElementById('p2-indep-add-suggestions');

  if (cafInput && cafBox) {
    cafInput.addEventListener('input', async (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (q.length < 2) {
        cafBox.style.display = 'none';
        return;
      }
      try {
        const res = await fetch(`/api/schools?search=${encodeURIComponent(q)}`);
        const data = await res.json();
        const matches = (data.schools || []).filter(s => s.schoolType !== 'Independent');

        if (matches.length === 0) {
          cafBox.innerHTML = '<div style="padding: 0.6rem 0.9rem; color: #94a3b8; font-size: 0.85rem;">No state/grammar schools found</div>';
        } else {
          cafBox.innerHTML = matches.slice(0, 8).map(s => `
            <div class="p2-sug-item" data-id="${s.id}" style="padding: 0.6rem 0.9rem; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 0.85rem;">
              <strong>${s.name}</strong> <span style="color:#64748b;">(${s.schoolType} - ${s.la})</span>
            </div>
          `).join('');

          cafBox.querySelectorAll('.p2-sug-item').forEach(item => {
            item.addEventListener('click', async () => {
              const id = item.getAttribute('data-id');
              const sch = matches.find(m => m.id === id);
              if (sch) await addSchoolToStateCaf(sch);
              cafInput.value = '';
              cafBox.style.display = 'none';
            });
          });
        }
        cafBox.style.display = 'block';
      } catch (err) {
        cafBox.style.display = 'none';
      }
    });

    document.addEventListener('click', (e) => {
      if (!cafInput.contains(e.target) && !cafBox.contains(e.target)) cafBox.style.display = 'none';
    });
  }

  if (indepInput && indepBox) {
    indepInput.addEventListener('input', async (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (q.length < 2) {
        indepBox.style.display = 'none';
        return;
      }
      try {
        const matches = (window._allSchoolsList || []).filter(s =>
          (s.schoolType === 'Independent' || s.schoolType === 'Independent / Public') &&
          ((s.name || '').toLowerCase().includes(q) || (s.la || '').toLowerCase().includes(q))
        );
        if (matches.length === 0) {
          indepBox.innerHTML = '<div style="padding: 0.6rem 0.9rem; color: #94a3b8; font-size: 0.85rem;">No independent schools found</div>';
        } else {
          indepBox.innerHTML = matches.slice(0, 8).map(s => `
            <div class="p2-indep-sug-item" data-id="${s.id}" style="padding: 0.6rem 0.9rem; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 0.85rem;">
              <strong>${s.name}</strong> <span style="color:#7c3aed;">(Independent - ${s.la})</span>
            </div>
          `).join('');

          indepBox.querySelectorAll('.p2-indep-sug-item').forEach(item => {
            item.addEventListener('click', async () => {
              const id = item.getAttribute('data-id');
              const sch = matches.find(m => m.id === id);
              if (sch) await addSchoolToIndependent(sch);
              indepInput.value = '';
              indepBox.style.display = 'none';
            });
          });
        }
        indepBox.style.display = 'block';
      } catch (err) {
        indepBox.style.display = 'none';
      }
    });

    document.addEventListener('click', (e) => {
      if (!indepInput.contains(e.target) && !indepBox.contains(e.target)) indepBox.style.display = 'none';
    });
  }
}

let scannerPollInterval = null;

async function checkAndPollScannerStatus() {
  try {
    const res = await fetch('/api/admin/scanner/status', {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (res.ok) {
      const data = await res.json();
      const st = data.state;
      if (st) {
        if (st.isRunning) {
          startScannerPolling();
        } else if (st.recentResults && Array.isArray(st.recentResults) && st.recentResults.length > 0) {
          enrichmentFeedData = st.recentResults;
          renderEnrichmentFeed(enrichmentFeedData);
          if (st.latestRawInteraction) {
            updateRawLLMInspector(st.latestRawInteraction);
          }
        }
      }
    }
  } catch (e) {
    // Ignore polling error
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let enrichmentFeedData = [];
let enrichmentFeedFilterText = '';
let enrichmentFeedFilterStatus = 'ALL';
let lastFeedFingerprint = '';
let expandedFullDataSchoolIds = new Set();

function toggleSchoolFullData(schoolId) {
  const panel = document.getElementById(`full-data-${schoolId}`);
  const chevron = document.getElementById(`chevron-${schoolId}`);
  const btnText = document.getElementById(`btn-text-full-data-${schoolId}`);
  if (!panel) return;

  if (expandedFullDataSchoolIds.has(schoolId)) {
    expandedFullDataSchoolIds.delete(schoolId);
    panel.style.display = 'none';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    if (btnText) btnText.textContent = 'View All School Data';
  } else {
    expandedFullDataSchoolIds.add(schoolId);
    panel.style.display = 'block';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    if (btnText) btnText.textContent = 'Hide School Data';
  }
}

function renderSchoolFieldBox(fieldName, val, diff, isUrl = false) {
  const isChanged = Boolean(diff);
  let badgeHtml = '';
  let valHtml = '';

  if (isChanged) {
    const oldVal = diff.oldVal;
    const newVal = diff.newVal !== undefined ? diff.newVal : val;
    badgeHtml = `<span class="badge-field-changed"><i class="fa-solid fa-wand-magic-sparkles"></i> AI Updated</span>`;
    valHtml = `
      <div style="display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.35rem;">
        <span class="old-val-strikethrough">${oldVal ? escapeHtml(oldVal) : '<em style="color:#94a3b8;">Empty</em>'}</span>
        <i class="fa-solid fa-arrow-right-long" style="font-size: 0.68rem; color: #059669;"></i>
        <strong style="color: #065f46;">${newVal ? escapeHtml(newVal) : '<em style="color:#94a3b8;">Not set</em>'}</strong>
      </div>
    `;
  } else {
    badgeHtml = `<span class="badge-field-unchanged"><i class="fa-solid fa-check"></i> Unchanged</span>`;
    if (isUrl && val) {
      valHtml = `<a href="${escapeHtml(val)}" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; text-decoration: underline; font-weight: 600;">${escapeHtml(val)} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.68rem;"></i></a>`;
    } else {
      valHtml = val ? `<span style="color: #334155; font-weight: 500;">${escapeHtml(val)}</span>` : `<span style="color: #94a3b8; font-style: italic;">Not specified</span>`;
    }
  }

  return `
    <div class="school-data-field-box ${isChanged ? 'is-changed' : 'is-unchanged'}">
      <div class="school-data-field-header">
        <span class="school-data-field-name">${escapeHtml(fieldName)}</span>
        ${badgeHtml}
      </div>
      <div class="school-data-field-val">
        ${valHtml}
      </div>
    </div>
  `;
}

function renderInlineFullSchoolData(item) {
  const school = item.fullSchoolData || {};
  const diffs = item.diffs || [];

  // Parse 11+ dates
  let datesObj = {};
  if (school.entranceExamDates) {
    try {
      datesObj = typeof school.entranceExamDates === 'string' ? JSON.parse(school.entranceExamDates) : school.entranceExamDates;
    } catch (e) {}
  }

  const datesDiff = diffs.find(d => d.field === 'entranceExamDates');
  const findDateDiff = (key) => datesDiff?.changedDates?.find(c => c.key === key);
  const findFieldDiff = (field) => diffs.find(d => d.field === field);

  // Column 1: 11+ Admissions Timeline Milestones
  const dateMilestones = [
    { key: 'registrationOpen', aliases: ['registrationOpen'], label: 'Registration Opens' },
    { key: 'registrationDeadline', aliases: ['registrationDeadline'], label: 'Registration Deadline' },
    { key: 'stage_one_examDate', aliases: ['stage_one_examDate', 'examDate', 'stage1ExamDate'], label: 'Stage 1 Exam Date' },
    { key: 'stage_one_format_and_subjects', aliases: ['stage_one_format_and_subjects', 'stage1Format'], label: 'Stage 1 Format & Subjects' },
    { key: 'stage_one_resultDate', aliases: ['stage_one_resultDate', 'resultDate', 'stage1ResultDate'], label: 'Stage 1 Result Date' },
    { key: 'second_stage_exam_required', aliases: ['second_stage_exam_required', 'stage2Required'], label: '2nd Stage Required?' },
    { key: 'stage_two_examDate', aliases: ['stage_two_examDate', 'examDate2', 'secondExamDate'], label: 'Stage 2 Exam Date' },
    { key: 'stage_two_format_and_subjects', aliases: ['stage_two_format_and_subjects', 'stage2Format'], label: 'Stage 2 Format & Subjects' },
    { key: 'interviewDates', aliases: ['interviewDates', 'interviewDate'], label: 'Admissions Interviews' },
    { key: 'offerDate', aliases: ['offerDate', 'offersDate'], label: 'Offers Posted' },
    { key: 'acceptanceDeadline', aliases: ['acceptanceDeadline'], label: 'Acceptance Deadline' }
  ];

  let datesColHtml = '';
  for (const m of dateMilestones) {
    let dVal = null;
    for (const a of m.aliases) {
      if (datesObj[a]) { dVal = datesObj[a]; break; }
    }
    const dDiff = findDateDiff(m.key) || findDateDiff(m.aliases[1]) || findDateDiff(m.aliases[2]);
    datesColHtml += renderSchoolFieldBox(m.label, dVal, dDiff ? { oldVal: dDiff.oldVal, newVal: dDiff.newVal } : null);
  }

  // Column 2: Core Academic & School Profile
  const profileFields = [
    { field: 'schoolType', label: 'School Type' },
    { field: 'gender', label: 'Gender Policy' },
    { field: 'entranceExamType', label: 'Entrance Exam Board / Format' },
    { field: 'feesTermly', label: 'Termly Tuition Fees' },
    { field: 'website', label: 'Official Website', isUrl: true },
    { field: 'sourceUrl', label: 'Verified Intelligence Source', isUrl: true },
    { field: 'phase', label: 'Phase / Level' },
    { field: 'ageRange', label: 'Age Range' },
    { field: 'ofstedRating', label: 'Ofsted Rating' }
  ];

  let profileColHtml = '';
  for (const f of profileFields) {
    const fDiff = findFieldDiff(f.field);
    profileColHtml += renderSchoolFieldBox(f.label, school[f.field] || null, fDiff, f.isUrl);
  }

  // Column 3: Contact & Regional Location
  const contactFields = [
    { field: 'phone', label: 'Admissions Telephone' },
    { field: 'email', label: 'Admissions Email' },
    { field: 'la', label: 'Local Authority (LA)' },
    { field: 'region', label: 'Region / County' },
    { field: 'address', label: 'Street Address' },
    { field: 'postcode', label: 'Postcode' }
  ];

  let contactColHtml = '';
  for (const c of contactFields) {
    const cDiff = findFieldDiff(c.field);
    contactColHtml += renderSchoolFieldBox(c.label, school[c.field] || null, cDiff);
  }

  return `
    <div class="full-school-data-panel" id="full-data-${item.schoolId}" style="display: ${expandedFullDataSchoolIds.has(item.schoolId) ? 'block' : 'none'};">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; padding-bottom: 0.5rem; border-bottom: 1px solid #e2e8f0;">
        <div style="font-weight: 700; font-size: 0.88rem; color: #1e1b4b; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-database" style="color: #7c3aed;"></i>
          Full School Attribute Inspection &amp; AI Delta Visual Ledger
        </div>
        <div style="font-size: 0.74rem; color: #64748b; display: flex; gap: 0.75rem;">
          <span><span class="badge-field-changed" style="padding: 0.1rem 0.35rem;"><i class="fa-solid fa-sparkles"></i> AI Updated</span> = Modified in this scan</span>
          <span><span class="badge-field-unchanged" style="padding: 0.1rem 0.35rem;"><i class="fa-solid fa-check"></i> Unchanged</span> = Retained baseline</span>
        </div>
      </div>

      <div class="school-data-grid">
        <!-- 1. Admissions Milestones -->
        <div>
          <div class="school-data-col-title">
            <i class="fa-regular fa-calendar-check" style="color: #7c3aed;"></i> 11+ Admissions Timeline
          </div>
          ${datesColHtml}
        </div>

        <!-- 2. Profile & Format -->
        <div>
          <div class="school-data-col-title">
            <i class="fa-solid fa-graduation-cap" style="color: #4f46e5;"></i> Academic &amp; School Profile
          </div>
          ${profileColHtml}
        </div>

        <!-- 3. Contact & Location -->
        <div>
          <div class="school-data-col-title">
            <i class="fa-solid fa-location-dot" style="color: #059669;"></i> Contact &amp; Location
          </div>
          ${contactColHtml}
        </div>
      </div>
    </div>
  `;
}

function updateRawLLMInspector(interaction) {
  if (!interaction) return;
  const statusPill = document.getElementById('raw-llm-status-pill');
  const reqPre = document.getElementById('raw-llm-request-code');
  const resPre = document.getElementById('raw-llm-response-code');

  const schoolName = interaction.schoolName || 'School';
  const provider = (interaction.provider || 'gemini').toUpperCase();
  const model = interaction.model || 'gemini-3.6-flash';
  const timeStr = interaction.timestamp ? new Date(interaction.timestamp).toLocaleTimeString('en-GB') : 'Just now';
  const isGrounded = Boolean(interaction.groundingMetadata || interaction.exactResponse?.groundingMetadata || interaction.searchQueries || interaction.exactResponse?.searchQueries);

  if (statusPill) {
    statusPill.style.background = '#1e1b4b';
    statusPill.style.color = '#c7d2fe';
    statusPill.style.borderColor = '#6366f1';
    statusPill.innerHTML = `<i class="fa-solid fa-bolt" style="color:#a5b4fc;"></i> ${escapeHtml(schoolName)} • ${provider} (${model}) ${isGrounded ? '<span style="color:#38bdf8; font-weight:700;"><i class="fa-brands fa-google"></i> Search Grounded</span> ' : ''}• ${timeStr}`;
  }

  const googleBtn = document.getElementById('raw-llm-google-search-btn');
  if (googleBtn) {
    const searchUrl = interaction.googleSearchUrl || interaction.exactRequest?.googleSearchUrl || (schoolName ? `https://www.google.com/search?q=${encodeURIComponent('"' + schoolName + '" admissions "11+" entrance exam dates 2026')}` : 'https://www.google.com');
    googleBtn.href = searchUrl;
    googleBtn.title = `Compare live browser Google search results for "${schoolName}"`;
  }

  if (reqPre) {
    let reqText = '';
    const req = interaction.exactRequest || interaction.llmVerification?.exactRequest || interaction.payload;
    if (typeof req === 'string' && req.trim().length > 0) {
      reqText = req;
    } else if (req && typeof req === 'object') {
      if (req.payload) {
        reqText = typeof req.payload === 'string' ? req.payload : JSON.stringify(req.payload, null, 2);
      } else if (req.promptText) {
        reqText = req.promptText;
      } else if (req.rawRequestBody) {
        reqText = req.rawRequestBody;
      } else {
        reqText = JSON.stringify(req, null, 2);
      }
    } else {
      reqText = `// Outbound HTTP request payload for "${schoolName}"`;
    }
    reqPre.textContent = reqText;
  }

  if (resPre) {
    let resText = '';
    const res = interaction.exactResponse || interaction.llmVerification?.exactResponse;
    if (typeof res === 'string' && res.trim().length > 0) {
      resText = res;
    } else if (res && typeof res === 'object') {
      if (typeof res.rawText === 'string' && res.rawText.trim().length > 0) {
        resText = res.rawText;
      } else if (typeof res.candidateText === 'string' && res.candidateText.trim().length > 0) {
        resText = res.candidateText;
      } else if (typeof res.bodyText === 'string' && res.bodyText.trim().length > 0) {
        resText = res.bodyText;
      } else if (res.parsedJson) {
        resText = typeof res.parsedJson === 'string' ? res.parsedJson : JSON.stringify(res.parsedJson, null, 2);
      } else if (res.data) {
        resText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
      } else {
        resText = JSON.stringify(res, null, 2);
      }
    } else if (interaction.isFetching) {
      resText = `// Awaiting live HTTP response from external ${provider} API (${model}) for "${schoolName}"...`;
    } else {
      resText = `// No raw response received from external ${provider} API for "${schoolName}"`;
    }
    resPre.textContent = resText;
  }
}

window.copyRawLLMText = function(elementId, btn) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-check" style="color: #4ade80;"></i> Copied!`;
    setTimeout(() => {
      btn.innerHTML = orig;
    }, 2000);
  }).catch(() => {
    showToast('Could not copy text.', 'error');
  });
};

let typeaheadDebounceTimer = null;

function setupScannerSchoolTypeahead() {
  const modeSelect = document.getElementById('scanner-scan-mode');
  const batchOpts = document.getElementById('scanner-batch-options');
  const singleOpts = document.getElementById('scanner-single-options');
  const typeaheadInput = document.getElementById('scanner-school-typeahead-input');
  const dropdown = document.getElementById('scanner-school-typeahead-dropdown');
  const hiddenId = document.getElementById('scanner-selected-school-id');
  const clearBtn = document.getElementById('btn-clear-school-typeahead');
  const startBtn = document.getElementById('btn-start-web-scanner');

  if (modeSelect && !modeSelect._bound) {
    modeSelect._bound = true;
    modeSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      if (mode === 'SINGLE') {
        if (batchOpts) batchOpts.style.display = 'none';
        if (singleOpts) singleOpts.style.display = 'block';
        if (startBtn) startBtn.innerHTML = `<i class="fa-solid fa-bullseye"></i> Start AI Scan for Selected School`;
        if (typeaheadInput) typeaheadInput.focus();
      } else {
        if (batchOpts) batchOpts.style.display = 'flex';
        if (singleOpts) singleOpts.style.display = 'none';
        if (startBtn) startBtn.innerHTML = `<i class="fa-solid fa-play"></i> Start AI Verification Scan`;
      }
    });
  }

  if (typeaheadInput && !typeaheadInput._bound) {
    typeaheadInput._bound = true;

    typeaheadInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (hiddenId) hiddenId.value = '';
      if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

      if (typeaheadDebounceTimer) clearTimeout(typeaheadDebounceTimer);
      if (!query || query.length < 2) {
        if (dropdown) {
          dropdown.style.display = 'none';
          dropdown.innerHTML = '';
        }
        return;
      }

      typeaheadDebounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/schools?search=${encodeURIComponent(query)}&limit=12`, {
            headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
          });
          if (!res.ok) return;
          const data = await res.json();
          const list = data.schools || (Array.isArray(data) ? data : []);

          if (!dropdown) return;
          if (list.length === 0) {
            dropdown.innerHTML = `<div style="padding: 0.6rem 0.8rem; font-size: 0.78rem; color: #94a3b8;">No matching schools found</div>`;
            dropdown.style.display = 'block';
            return;
          }

          let itemsHtml = '';
          for (const s of list) {
            itemsHtml += `
              <div class="scanner-typeahead-row" onclick="selectScannerSchool('${escapeHtml(s.id)}', '${escapeHtml(s.name)}', '${escapeHtml(s.region || s.la || '')}')" style="padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; transition: background 0.15s ease;">
                <div>
                  <div style="font-weight: 600; font-size: 0.82rem; color: #1e293b;">${escapeHtml(s.name)}</div>
                  <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(s.schoolType || 'School')} • ${escapeHtml(s.region || s.la || s.postcode || '')}</div>
                </div>
                ${s.verification_status === 'llm_enriched' || s.verification_status === 'auto_verified' ? '<span style="font-size: 0.68rem; background: #f3e8ff; color: #7c3aed; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 600;">Enriched</span>' : ''}
              </div>
            `;
          }
          dropdown.innerHTML = itemsHtml;
          dropdown.style.display = 'block';
        } catch (e) {
          console.warn('Error fetching school typeahead suggestions:', e);
        }
      }, 250);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (dropdown && !dropdown.contains(e.target) && e.target !== typeaheadInput) {
        dropdown.style.display = 'none';
      }
    });
  }

  if (clearBtn && !clearBtn._bound) {
    clearBtn._bound = true;
    clearBtn.addEventListener('click', () => {
      if (typeaheadInput) typeaheadInput.value = '';
      if (hiddenId) hiddenId.value = '';
      if (dropdown) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
      }
      clearBtn.style.display = 'none';
      if (typeaheadInput) typeaheadInput.focus();
    });
  }
}

window.selectScannerSchool = function(id, name, region) {
  const typeaheadInput = document.getElementById('scanner-school-typeahead-input');
  const hiddenId = document.getElementById('scanner-selected-school-id');
  const dropdown = document.getElementById('scanner-school-typeahead-dropdown');
  const clearBtn = document.getElementById('btn-clear-school-typeahead');

  if (hiddenId) hiddenId.value = id;
  if (typeaheadInput) typeaheadInput.value = name;
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
  if (clearBtn) clearBtn.style.display = 'block';
};

async function initDataEnrichmentTab() {
  const startBtn = document.getElementById('btn-start-web-scanner');
  if (startBtn && !startBtn._enrichmentBound) {
    startBtn._enrichmentBound = true;
    startBtn.addEventListener('click', startWebVerificationScan);
  }

  const stopBtn = document.getElementById('btn-stop-web-scanner');
  if (stopBtn && !stopBtn._enrichmentBound) {
    stopBtn._enrichmentBound = true;
    stopBtn.addEventListener('click', stopWebVerificationScan);
  }

  const clearBtn = document.getElementById('btn-clear-enrichment-feed');
  if (clearBtn && !clearBtn._bound) {
    clearBtn._bound = true;
    clearBtn.addEventListener('click', clearEnrichmentFeed);
  }

  const refreshBtn = document.getElementById('btn-refresh-enrichment-feed');
  if (refreshBtn && !refreshBtn._bound) {
    refreshBtn._bound = true;
    refreshBtn.addEventListener('click', refreshEnrichmentStatus);
  }

  const filterInput = document.getElementById('filter-enrichment-feed');
  if (filterInput && !filterInput._bound) {
    filterInput._bound = true;
    filterInput.addEventListener('input', (e) => {
      enrichmentFeedFilterText = e.target.value.trim().toLowerCase();
      renderEnrichmentFeed(enrichmentFeedData, true);
    });
  }

  const filterStatus = document.getElementById('filter-enrichment-status');
  if (filterStatus && !filterStatus._bound) {
    filterStatus._bound = true;
    filterStatus.addEventListener('change', (e) => {
      enrichmentFeedFilterStatus = e.target.value;
      renderEnrichmentFeed(enrichmentFeedData, true);
    });
  }

  const modalCloseBtn = document.getElementById('modal-close-school-version-history');
  const modalCloseBtn2 = document.getElementById('btn-close-school-version-history');
  if (modalCloseBtn && !modalCloseBtn._bound) {
    modalCloseBtn._bound = true;
    modalCloseBtn.addEventListener('click', closeSchoolVersionHistoryModal);
  }
  if (modalCloseBtn2 && !modalCloseBtn2._bound) {
    modalCloseBtn2._bound = true;
    modalCloseBtn2.addEventListener('click', closeSchoolVersionHistoryModal);
  }

  const toggleRawBtn = document.getElementById('btn-toggle-raw-llm-panel');
  const rawBody = document.getElementById('raw-llm-panel-body');
  const toggleText = document.getElementById('btn-text-toggle-raw-llm');
  if (toggleRawBtn && rawBody && !toggleRawBtn._bound) {
    toggleRawBtn._bound = true;
    toggleRawBtn.addEventListener('click', () => {
      const isHidden = rawBody.style.display === 'none';
      rawBody.style.display = isHidden ? 'block' : 'none';
      if (toggleText) toggleText.textContent = isHidden ? 'Hide Raw Messages' : 'Show Raw Messages';
    });
  }

  setupScannerSchoolTypeahead();
  await loadEnrichmentCategoryStats();
  await refreshEnrichmentStatus();
}

// Navigate to Directory View with pre-configured filters
function navigateToFilteredDirectory(filters = {}) {
  // 1. Reset all filter selects in Directory View sidebar
  const filterInputs = [
    'search-input', 'tag-select', 'region-select', 'la-select', 'hot-select',
    'type-select', 'gender-select', 'ofsted-select', 'exam-select',
    'second-stage-select', 'confidence-select', 'fee-select'
  ];
  filterInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // 2. Apply requested filters
  let filterDesc = [];
  if (filters.tag) {
    const tagEl = document.getElementById('tag-select');
    if (tagEl) {
      tagEl.value = filters.tag;
      filterDesc.push(`Tag: ${filters.tag}`);
    }
  }
  if (filters.type) {
    const typeEl = document.getElementById('type-select');
    if (typeEl) {
      typeEl.value = filters.type;
      filterDesc.push(`Type: ${filters.type}`);
    }
  }
  if (filters.region) {
    const regEl = document.getElementById('region-select');
    if (regEl) {
      regEl.value = filters.region;
      filterDesc.push(`Region: ${filters.region}`);
    }
  }
  if (filters.secondStage) {
    const stageEl = document.getElementById('second-stage-select');
    if (stageEl) {
      stageEl.value = filters.secondStage;
      filterDesc.push(`2nd Stage: ${filters.secondStage}`);
    }
  }
  if (filters.fee) {
    const feeEl = document.getElementById('fee-select');
    if (feeEl) {
      feeEl.value = filters.fee;
      filterDesc.push(`Funding: ${filters.fee}`);
    }
  }
  if (filters.search) {
    const searchEl = document.getElementById('search-input');
    if (searchEl) {
      searchEl.value = filters.search;
      filterDesc.push(`"${filters.search}"`);
    }
  }

  // 3. Switch to directory subtab
  switchAdminSubTab('directory');

  // 4. Trigger school load with pre-filtered state
  loadSchools();

  if (typeof showToast === 'function') {
    showToast(`Filtering Directory by ${filterDesc.join(', ') || 'Selected Category'}`, 'info');
  }
}
window.navigateToFilteredDirectory = navigateToFilteredDirectory;

// Load and render Enrichment Coverage by Category
async function loadEnrichmentCategoryStats() {
  const cardsGrid = document.getElementById('enrichment-category-cards-grid');
  const attributeChips = document.getElementById('enrichment-attribute-chips');
  const overallPill = document.getElementById('enrichment-overall-progress-pill');
  const totalEnrichedBadge = document.getElementById('enrichment-total-enriched-badge');

  if (!cardsGrid) return;

  try {
    const res = await fetch('/api/admin/enrichment/category-stats', {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (!res.ok) return;
    const { stats } = await res.json();
    if (!stats) return;

    const total = stats.total || 0;
    const enrichedTotal = stats.enrichedTotal || 0;
    const unscannedTotal = stats.unscannedTotal || 0;
    const overallPct = total > 0 ? Math.round((enrichedTotal / total) * 100) : 0;

    if (overallPill) {
      overallPill.textContent = `Overall Coverage: ${overallPct}% (${enrichedTotal.toLocaleString()} / ${total.toLocaleString()})`;
    }
    if (totalEnrichedBadge) {
      totalEnrichedBadge.textContent = `${enrichedTotal.toLocaleString()} Enriched`;
    }

    // Categories definition
    const categories = [
      {
        id: 'grammar',
        title: 'Selective Grammar Schools',
        icon: 'fa-award',
        color: '#d97706',
        bg: '#fffbeb',
        border: '#fde68a',
        data: stats.byType?.Grammar || { total: 0, enriched: 0, unscanned: 0 },
        filterType: 'Grammar'
      },
      {
        id: 'independent',
        title: 'Independent / Fee-Paying',
        icon: 'fa-building-columns',
        color: '#7c3aed',
        bg: '#faf5ff',
        border: '#e9d5ff',
        data: stats.byType?.Independent || { total: 0, enriched: 0, unscanned: 0 },
        filterType: 'Independent'
      },
      {
        id: 'comprehensive',
        title: 'State Comprehensive Schools',
        icon: 'fa-school',
        color: '#2563eb',
        bg: '#eff6ff',
        border: '#bfdbfe',
        data: stats.byType?.Comprehensive || { total: 0, enriched: 0, unscanned: 0 },
        filterType: 'Comprehensive'
      },
      {
        id: 'london',
        title: 'Greater London Region',
        icon: 'fa-map-location-dot',
        color: '#059669',
        bg: '#ecfdf5',
        border: '#a7f3d0',
        data: stats.byRegion?.['Greater London'] || { total: 0, enriched: 0, unscanned: 0 },
        filterRegion: 'Greater London'
      }
    ];

    cardsGrid.innerHTML = categories.map(cat => {
      const cTotal = cat.data.total || 0;
      const cEnriched = cat.data.enriched || 0;
      const cUnscanned = cat.data.unscanned || 0;
      const cPct = cTotal > 0 ? Math.round((cEnriched / cTotal) * 100) : 0;

      const enrichedFilterJson = JSON.stringify(cat.filterType ? { type: cat.filterType, tag: 'auto_verified' } : { region: cat.filterRegion, tag: 'auto_verified' }).replace(/"/g, '&quot;');
      const unscannedFilterJson = JSON.stringify(cat.filterType ? { type: cat.filterType, tag: 'unscanned' } : { region: cat.filterRegion, tag: 'unscanned' }).replace(/"/g, '&quot;');
      const allFilterJson = JSON.stringify(cat.filterType ? { type: cat.filterType } : { region: cat.filterRegion }).replace(/"/g, '&quot;');

      return `
        <div class="category-coverage-card" style="background: ${cat.bg}; border: 1px solid ${cat.border}; border-radius: 10px; padding: 0.9rem 1rem; display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s ease;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div style="background: white; color: ${cat.color}; width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                  <i class="fa-solid ${cat.icon}"></i>
                </div>
                <strong style="font-size: 0.88rem; color: #1e293b; cursor: pointer;" onclick="navigateToFilteredDirectory(${allFilterJson})" title="Click to view all ${cat.title} in Directory">
                  ${cat.title}
                </strong>
              </div>
              <span style="font-size: 0.78rem; font-weight: 700; color: ${cat.color}; background: white; padding: 0.15rem 0.5rem; border-radius: 999px; border: 1px solid ${cat.border};">
                ${cPct}%
              </span>
            </div>

            <!-- Progress Bar -->
            <div style="background: rgba(0,0,0,0.06); height: 6px; border-radius: 999px; overflow: hidden; margin-bottom: 0.75rem;">
              <div style="background: ${cat.color}; height: 100%; width: ${cPct}%; border-radius: 999px; transition: width 0.4s ease;"></div>
            </div>
          </div>

          <!-- Interactive Click Badges -->
          <div style="display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline" onclick="navigateToFilteredDirectory(${enrichedFilterJson})" style="flex: 1; padding: 0.3rem 0.5rem; font-size: 0.76rem; font-weight: 700; color: #065f46; background: #ffffff; border-color: #a7f3d0; border-radius: 6px; display: flex; align-items: center; justify-content: center; gap: 0.3rem;" title="Click to view ${cEnriched} Enriched ${cat.title} in Directory">
              <i class="fa-solid fa-circle-check"></i> ${cEnriched.toLocaleString()} Enriched
            </button>
            <button type="button" class="btn btn-outline" onclick="navigateToFilteredDirectory(${unscannedFilterJson})" style="flex: 1; padding: 0.3rem 0.5rem; font-size: 0.76rem; font-weight: 700; color: #9a3412; background: #ffffff; border-color: #fed7aa; border-radius: 6px; display: flex; align-items: center; justify-content: center; gap: 0.3rem;" title="Click to view ${cUnscanned} Unscanned ${cat.title} in Directory">
              <i class="fa-solid fa-clock"></i> ${cUnscanned.toLocaleString()} Unscanned
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Quick Attribute Chips
    if (attributeChips) {
      const chips = [
        { label: `📝 2nd Stage Required (${stats.bySecondStage?.yes?.total || 0})`, filter: { secondStage: 'yes' } },
        { label: `📅 Verified Dates (${stats.datesVerifiedTotal || 0})`, filter: { tag: 'dates_verified' } },
        { label: `🤖 LLM Enriched (${stats.llmEnrichedTotal || 0})`, filter: { tag: 'llm_enriched' } },
        { label: `⚠️ Needs Review (${stats.anomaliesTotal || 0})`, filter: { tag: 'has_anomalies' } },
        { label: `💷 Fee-Paying (${stats.byFee?.independent?.total || 0})`, filter: { fee: 'independent' } },
        { label: `🏛️ State-Funded (${stats.byFee?.state?.total || 0})`, filter: { fee: 'state' } }
      ];

      attributeChips.innerHTML = chips.map(c => `
        <button type="button" class="btn btn-outline" onclick="navigateToFilteredDirectory(${JSON.stringify(c.filter).replace(/"/g, '&quot;')})" style="font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 999px; background: white; border-color: #cbd5e1; color: #334155; font-weight: 600; cursor: pointer;" title="Click to filter Directory">
          ${c.label}
        </button>
      `).join('');
    }
  } catch (err) {
    console.warn('Error loading enrichment category stats:', err);
  }
}
window.loadEnrichmentCategoryStats = loadEnrichmentCategoryStats;

async function refreshEnrichmentStatus() {
  try {
    const res = await fetch('/api/admin/scanner/status', {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (!res.ok) return;
    const data = await res.json();
    const st = data.state;
    if (!st) return;

    try {
      const settingsRes = await fetch('/api/admin/settings', {
        headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
      });
      if (settingsRes.ok) {
        const sdata = await settingsRes.json();
        const settings = sdata.settings || {};
        const provider = (settings.llmProvider || 'gemini').toUpperCase();
        const model = provider === 'CHATGPT' ? (settings.openaiModel || 'gpt-4o-mini') : (settings.geminiModel || 'gemini-3.6-flash');
        const badge = document.getElementById('enrichment-model-badge');
        if (badge) badge.textContent = `${provider} • ${model}`;
      }
    } catch (e) {}

    const totalBadge = document.getElementById('enrichment-total-enriched-badge');
    if (totalBadge) totalBadge.textContent = `${st.stats?.verifiedCount || 0} Enriched`;

    const activeCallout = document.getElementById('enrichment-active-school-callout');
    const activeName = document.getElementById('enrichment-active-school-name');
    if (st.isRunning && st.currentSchool) {
      if (activeCallout) activeCallout.style.display = 'flex';
      if (activeName) activeName.textContent = st.currentSchool;
    } else {
      if (activeCallout) activeCallout.style.display = 'none';
    }

    if (st.latestRawInteraction) {
      updateRawLLMInspector(st.latestRawInteraction);
    }

    if (st.recentResults && Array.isArray(st.recentResults)) {
      enrichmentFeedData = st.recentResults;
      renderEnrichmentFeed(enrichmentFeedData);
      if (enrichmentFeedData.length > 0 && !st.latestRawInteraction && (enrichmentFeedData[0].exactRequest || enrichmentFeedData[0].exactResponse)) {
        updateRawLLMInspector(enrichmentFeedData[0]);
      }
    }
  } catch (err) {
    console.warn('Error refreshing enrichment status:', err);
  }
}

async function clearEnrichmentFeed() {
  try {
    const res = await fetch('/api/admin/scanner/clear-feed', {
      method: 'POST',
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (res.ok) {
      enrichmentFeedData = [];
      lastFeedFingerprint = '';
      renderEnrichmentFeed([], true);
      showToast('Enrichment live feed cleared.', 'info');
    }
  } catch (e) {
    showToast('Failed to clear enrichment feed.', 'error');
  }
}

function renderEnrichmentFeed(items = [], forceRender = false) {
  const container = document.getElementById('enrichment-feed-list');
  const streamBadge = document.getElementById('enrichment-stream-badge');
  if (!container) return;

  if (!items || items.length === 0) {
    if (streamBadge) streamBadge.textContent = '0 items';
    if (lastFeedFingerprint !== 'EMPTY' || forceRender) {
      lastFeedFingerprint = 'EMPTY';
      container.innerHTML = `
        <div id="enrichment-feed-empty" style="text-align: center; padding: 3rem 1rem; color: #94a3b8;">
          <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 2.2rem; margin-bottom: 0.75rem; color: #cbd5e1;"></i>
          <div style="font-weight: 700; font-size: 0.95rem; color: #475569;">No active enrichment feed yet</div>
          <div style="font-size: 0.8rem; margin-top: 0.25rem;">Start an AI Verification Scan above to stream live LLM results, visual DB updates, and rollback controls.</div>
        </div>
      `;
    }
    return;
  }

  const filtered = items.filter(item => {
    if (enrichmentFeedFilterText) {
      const q = enrichmentFeedFilterText;
      const matchName = (item.schoolName || '').toLowerCase().includes(q);
      const matchRegion = (item.region || '').toLowerCase().includes(q);
      const matchStatus = (item.status || '').toLowerCase().includes(q);
      if (!matchName && !matchRegion && !matchStatus) return false;
    }

    if (enrichmentFeedFilterStatus === 'ENRICHED') {
      return item.status === 'llm_enriched' || item.status === 'auto_verified' || (item.tags && (item.tags.includes('llm_enriched') || item.tags.includes('auto_verified') || item.tags.includes('llm_verified'))) || (item.verifiedMatches && item.verifiedMatches.length > 0);
    } else if (enrichmentFeedFilterStatus === 'WITH_DIFFS') {
      return item.diffs && item.diffs.length > 0;
    } else if (enrichmentFeedFilterStatus === 'SKIPPED') {
      return item.skipped === true || (item.tags && item.tags.some(t => t.startsWith('skip_cache')));
    } else if (enrichmentFeedFilterStatus === 'ANOMALIES') {
      return item.anomaliesCount > 0 || item.status === 'has_anomalies';
    }
    return true;
  });

  if (streamBadge) streamBadge.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;

  // Check fingerprint to eliminate jumpy re-renders when data hasn't changed
  const currentFingerprint = `${enrichmentFeedFilterText}:${enrichmentFeedFilterStatus}:${filtered.map(i => `${i.schoolId}_${i.verifiedAt || ''}_${i.status || ''}_${(i.diffs || []).length}_${(i.verifiedMatches || []).length}`).join('|')}`;
  if (currentFingerprint === lastFeedFingerprint && !forceRender && container.children.length > 0) {
    return;
  }
  lastFeedFingerprint = currentFingerprint;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8;">
        <i class="fa-solid fa-filter" style="font-size: 1.8rem; margin-bottom: 0.5rem; color: #cbd5e1;"></i>
        <div style="font-weight: 600; font-size: 0.9rem; color: #475569;">No feed items match active filter</div>
      </div>
    `;
    return;
  }

  let html = '';
  for (const item of filtered) {
    const isEnriched = (item.status === 'llm_enriched' || (item.tags && item.tags.includes('llm_enriched'))) && item.status !== 'llm_error';
    const hasVerifiedMatches = item.verifiedMatches && item.verifiedMatches.length > 0;
    const isAutoVerified = item.status === 'auto_verified' || hasVerifiedMatches;
    const isSkipped = item.skipped === true || (item.tags && item.tags.some(t => t.startsWith('skip_cache')));
    const hasAnomalies = (item.anomaliesCount > 0) || item.status === 'has_anomalies';
    const isLlmError = item.status === 'llm_error' || (item.tags && item.tags.includes('llm_error'));

    let cardStatusClass = 'status-inspected';
    let statusPill = `<span style="background: #f1f5f9; color: #475569; font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid #cbd5e1;"><i class="fa-solid fa-clock"></i> Inspected</span>`;

    if (isLlmError) {
      cardStatusClass = 'status-has-anomalies';
      statusPill = `<span style="background: #fef2f2; color: #b91c1c; font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid #fecaca;"><i class="fa-solid fa-circle-xmark"></i> LLM Error</span>`;
    } else if (isSkipped) {
      cardStatusClass = 'status-skipped';
      statusPill = `<span style="background: #f1f5f9; color: #475569; font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid #cbd5e1;"><i class="fa-solid fa-forward-step"></i> Skipped</span>`;
    } else if (hasAnomalies) {
      cardStatusClass = 'status-has-anomalies';
      statusPill = `<span style="background: #fff7ed; color: #c2410c; font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid #fed7aa;"><i class="fa-solid fa-triangle-exclamation"></i> Flagged Anomaly</span>`;
    } else if (isEnriched) {
      cardStatusClass = 'status-llm-enriched';
      statusPill = `<span style="background: #f3e8ff; color: #7c3aed; font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid #d8b4fe;"><i class="fa-solid fa-wand-magic-sparkles"></i> llm_enriched</span>`;
    } else if (isAutoVerified) {
      cardStatusClass = 'status-auto-verified';
      statusPill = `<span style="background: #ecfdf5; color: #065f46; font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid #a7f3d0;"><i class="fa-solid fa-circle-check"></i> Verified Match</span>`;
    }

    const confScore = item.qualityScore || (isLlmError ? 30 : 95);
    const timeFormatted = item.verifiedAt ? new Date(item.verifiedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Just now';

    // Verified Matching Non-Null Fields Table
    let verifiedMatchesHtml = '';
    if (hasVerifiedMatches) {
      let vRows = '';
      for (const vm of item.verifiedMatches) {
        if (vm.type === 'dates' && vm.verifiedDates && vm.verifiedDates.length > 0) {
          for (const vd of vm.verifiedDates) {
            vRows += `
              <tr>
                <td style="font-weight: 600; color: #166534; width: 220px;">
                  <i class="fa-regular fa-calendar-check" style="color: #16a34a; margin-right: 0.3rem;"></i> ${escapeHtml(vd.label || vd.key)}
                </td>
                <td style="width: 45%;">
                  <span style="font-weight: 600; color: #0f172a;">${escapeHtml(vd.value)}</span>
                </td>
                <td>
                  <span class="badge" style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.7rem; font-weight: 700; padding: 0.12rem 0.45rem; border-radius: 999px;"><i class="fa-solid fa-circle-check"></i> Enriched / Verified</span>
                </td>
              </tr>
            `;
          }
        } else {
          vRows += `
            <tr>
              <td style="font-weight: 600; color: #166534; width: 220px;">
                <i class="fa-solid fa-circle-check" style="color: #16a34a; margin-right: 0.3rem;"></i> ${escapeHtml(vm.label || vm.field)}
              </td>
              <td style="width: 45%;">
                <span style="font-weight: 600; color: #0f172a;">${escapeHtml(vm.value)}</span>
              </td>
              <td>
                <span class="badge" style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.7rem; font-weight: 700; padding: 0.12rem 0.45rem; border-radius: 999px;"><i class="fa-solid fa-circle-check"></i> Enriched / Verified</span>
              </td>
            </tr>
          `;
        }
      }

      verifiedMatchesHtml = `
        <div style="margin-top: 0.75rem;">
          <div style="font-size: 0.76rem; font-weight: 700; color: #166534; display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem;">
            <i class="fa-solid fa-shield-check" style="color: #16a34a;"></i> Verified Matching Non-Null Fields (Query confirmed ${item.verifiedMatches.length} field groups):
          </div>
          <table class="delta-table" style="background: #f0fdf4; border: 1px solid #bbf7d0;">
            <thead>
              <tr style="background: #dcfce7;">
                <th style="color: #166534;">Verified Attribute</th>
                <th style="color: #166534;">Confirmed Matching Value</th>
                <th style="color: #166534;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${vRows}
            </tbody>
          </table>
        </div>
      `;
    }

    let deltaHtml = '';
    if (item.diffs && item.diffs.length > 0) {
      let rowsHtml = '';
      for (const diff of item.diffs) {
        if (diff.type === 'dates' && diff.changedDates && diff.changedDates.length > 0) {
          for (const cd of diff.changedDates) {
            rowsHtml += `
              <tr>
                <td style="font-weight: 600; color: #334155; width: 220px;">
                  <i class="fa-regular fa-calendar" style="color: #7c3aed; margin-right: 0.3rem;"></i> ${escapeHtml(cd.label || cd.key)}
                </td>
                <td style="width: 35%;">
                  ${cd.oldVal ? `<span class="delta-old-val">${escapeHtml(cd.oldVal)}</span>` : '<span style="color: #94a3b8; font-style: italic;">Not set</span>'}
                </td>
                <td>
                  <span class="delta-new-val" style="color: #065f46;">${escapeHtml(cd.newVal)}</span>
                  <span class="delta-badge-add" style="margin-left: 0.4rem;">${cd.oldVal ? 'Updated' : 'Added'}</span>
                </td>
              </tr>
            `;
          }
        } else {
          rowsHtml += `
            <tr>
              <td style="font-weight: 600; color: #334155; width: 220px;">
                <i class="fa-solid fa-pen-nib" style="color: #4f46e5; margin-right: 0.3rem;"></i> ${escapeHtml(diff.label || diff.field)}
              </td>
              <td style="width: 35%;">
                ${diff.oldVal ? `<span class="delta-old-val">${escapeHtml(diff.oldVal)}</span>` : '<span style="color: #94a3b8; font-style: italic;">Not set</span>'}
              </td>
              <td>
                <span class="delta-new-val" style="color: #065f46;">${escapeHtml(diff.newVal)}</span>
                <span class="delta-badge-add" style="margin-left: 0.4rem;">${diff.oldVal ? 'Updated' : 'Added'}</span>
              </td>
            </tr>
          `;
        }
      }

      deltaHtml = `
        <div style="margin-top: 0.75rem;">
          <div style="font-size: 0.76rem; font-weight: 700; color: #475569; display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem;">
            <i class="fa-solid fa-code-compare" style="color: #7c3aed;"></i> Database Updates Committed (${item.diffs.length} fields):
          </div>
          <table class="delta-table">
            <thead>
              <tr>
                <th>Field Attribute</th>
                <th>Previous DB Value</th>
                <th>New Verified AI Value</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
        ${verifiedMatchesHtml}
      `;
    } else if (isLlmError) {
      deltaHtml = `
        <div style="margin-top: 0.6rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.78rem; color: #991b1b; display: flex; align-items: center; gap: 0.5rem;">
          <i class="fa-solid fa-triangle-exclamation" style="color: #dc2626;"></i>
          <span><strong>LLM Query Notice:</strong> External LLM returned an error or unparseable response. Database record was preserved with no changes made.</span>
        </div>
      `;
    } else if (isSkipped) {
      deltaHtml = `
        <div style="margin-top: 0.6rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.78rem; color: #64748b; display: flex; align-items: center; gap: 0.5rem;">
          <i class="fa-solid fa-circle-info" style="color: #3b82f6;"></i>
          <span>${escapeHtml(item.skipReason || 'School scan skipped: verified clean within active cache window.')}</span>
        </div>
      `;
    } else if (hasVerifiedMatches) {
      deltaHtml = `
        <div style="margin-top: 0.6rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.78rem; color: #166534; display: flex; align-items: center; gap: 0.5rem;">
          <i class="fa-solid fa-circle-check" style="color: #16a34a; font-size: 1rem;"></i>
          <span><strong>Verified &amp; Confirmed:</strong> Query confirmed matching non-null values for ${item.verifiedMatches.length} field groups. All confirmed fields marked as verified.</span>
        </div>
        ${verifiedMatchesHtml}
      `;
    } else {
      deltaHtml = `
        <div style="margin-top: 0.6rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.78rem; color: #166534; display: flex; align-items: center; gap: 0.5rem;">
          <i class="fa-solid fa-circle-check" style="color: #16a34a;"></i>
          <span>Verified accurately against LLM intelligence. Record already aligned with no conflicting updates required.</span>
        </div>
      `;
    }

    const isExpanded = expandedFullDataSchoolIds.has(item.schoolId);
    const inlineFullDataHtml = renderInlineFullSchoolData(item);

    html += `
      <div class="enrichment-feed-item ${cardStatusClass}" id="feed-item-${item.schoolId}">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.75rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <h4 style="margin: 0; font-size: 1rem; font-weight: 700; color: #0f172a;">${escapeHtml(item.schoolName)}</h4>
              ${statusPill}
              <span style="font-size: 0.72rem; background: #f1f5f9; color: #475569; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 600;">${escapeHtml(item.schoolType || 'School')}</span>
              ${item.region ? `<span style="font-size: 0.72rem; color: #64748b;"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(item.region)}</span>` : ''}
            </div>
            <div style="font-size: 0.76rem; color: #64748b; margin-top: 0.25rem; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
              <span><i class="fa-solid fa-robot" style="color: #7c3aed;"></i> Model: <strong>${escapeHtml(item.model || 'gemini-3.6-flash')}</strong></span>
              <span><i class="fa-solid fa-gauge-high" style="color: #059669;"></i> Confidence: <strong>${confScore}%</strong></span>
              <span><i class="fa-regular fa-clock"></i> ${timeFormatted}</span>
            </div>
          </div>

          <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline" onclick="toggleSchoolFullData('${item.schoolId}')" style="font-size: 0.75rem; padding: 0.25rem 0.65rem; color: #4338ca; border-color: #c7d2fe; background: #eef2ff;" title="Toggle complete school data and visual diffs">
              <i class="fa-solid fa-table-list"></i> <span id="btn-text-full-data-${item.schoolId}">${isExpanded ? 'Hide School Data' : 'View All School Data'}</span>
              <i class="fa-solid fa-chevron-down toggle-chevron" id="chevron-${item.schoolId}" style="margin-left: 0.35rem; transition: transform 0.2s ease; transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'};"></i>
            </button>
            ${item.auditLogId ? `
              <button type="button" class="btn btn-outline" onclick="executeSchoolVersionRollback('${item.schoolId}', ${item.auditLogId})" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; color: #dc2626; border-color: #fca5a5; background: #fff5f5;" title="Revert database updates made in this audit step">
                <i class="fa-solid fa-rotate-left"></i> Rollback
              </button>
            ` : ''}
            <button type="button" class="btn btn-outline" onclick="openSchoolVersionHistoryModal('${item.schoolId}', '${escapeHtml(item.schoolName)}')" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; color: #4f46e5; border-color: #c7d2fe; background: white;" title="View complete version & audit history ledger">
              <i class="fa-solid fa-clock-rotate-left"></i> History
            </button>
          </div>
        </div>

        ${deltaHtml}
        ${inlineFullDataHtml}
      </div>
    `;
  }

  container.innerHTML = html;
}

// Modal: Open Complete Version History for a School
async function openSchoolVersionHistoryModal(schoolId, schoolName) {
  const modal = document.getElementById('modal-school-version-history');
  const titleName = document.getElementById('modal-history-school-name');
  const container = document.getElementById('school-version-history-container');
  if (!modal || !container) return;

  if (titleName) titleName.textContent = schoolName || 'School';
  container.innerHTML = `
    <div style="text-align: center; padding: 2rem; color: #64748b;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: #7c3aed;"></i>
      <div style="margin-top: 0.5rem; font-size: 0.85rem;">Retrieving complete version audit ledger...</div>
    </div>
  `;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/admin/enrichment/audit-history/${schoolId}`, {
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });

    if (!res.ok) {
      container.innerHTML = `<div style="color: #dc2626; padding: 1rem;">Failed to load audit history.</div>`;
      return;
    }

    const data = await res.json();
    const history = data.history || [];

    if (history.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8;">
          <i class="fa-solid fa-clipboard-check" style="font-size: 2rem; color: #cbd5e1; margin-bottom: 0.5rem;"></i>
          <div style="font-weight: 600; color: #475569;">No prior audit modification records for this school</div>
          <div style="font-size: 0.8rem; margin-top: 0.25rem;">Record is in its original baseline state.</div>
        </div>
      `;
      return;
    }

    let html = '';
    for (const log of history) {
      const isRolledBack = Boolean(log.rolledBackAt);
      const appliedDate = log.appliedAt ? new Date(log.appliedAt).toLocaleString('en-GB') : 'Unknown';
      const prev = log.previousState || {};

      let diffRows = '';
      if (prev.entranceExamDates) {
        let datesObj = typeof prev.entranceExamDates === 'string' ? JSON.parse(prev.entranceExamDates) : prev.entranceExamDates;
        diffRows += `<div><strong>11+ Dates:</strong> ${escapeHtml(JSON.stringify(datesObj))}</div>`;
      }
      if (prev.website) diffRows += `<div><strong>Website:</strong> ${escapeHtml(prev.website)}</div>`;
      if (prev.entranceExamType) diffRows += `<div><strong>Exam Type:</strong> ${escapeHtml(prev.entranceExamType)}</div>`;
      if (prev.gender) diffRows += `<div><strong>Gender:</strong> ${escapeHtml(prev.gender)}</div>`;
      if (prev.phone) diffRows += `<div><strong>Phone:</strong> ${escapeHtml(prev.phone)}</div>`;
      if (prev.email) diffRows += `<div><strong>Email:</strong> ${escapeHtml(prev.email)}</div>`;

      html += `
        <div style="background: white; border: 1px solid ${isRolledBack ? '#e2e8f0' : '#d8b4fe'}; border-radius: 8px; padding: 0.9rem 1.1rem; margin-bottom: 0.75rem; opacity: ${isRolledBack ? '0.65' : '1'};">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.4rem;">
            <div>
              <span style="font-weight: 700; font-size: 0.85rem; color: #1e1b4b;">Action: ${escapeHtml(log.actionType)}</span>
              <span style="font-size: 0.75rem; color: #64748b; margin-left: 0.5rem;"><i class="fa-regular fa-clock"></i> ${appliedDate} by <strong>${escapeHtml(log.appliedBy || 'Admin')}</strong></span>
              ${isRolledBack ? '<span style="background: #f1f5f9; color: #64748b; font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 4px; margin-left: 0.4rem;">[Rolled Back]</span>' : ''}
            </div>
            <div>
              ${!isRolledBack ? `
                <button type="button" class="btn btn-outline" onclick="executeSchoolVersionRollback('${schoolId}', ${log.id})" style="font-size: 0.75rem; padding: 0.2rem 0.6rem; color: #7c3aed; border-color: #d8b4fe; background: #faf5ff;">
                  <i class="fa-solid fa-rotate-left"></i> Restore this Version
                </button>
              ` : ''}
            </div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.78rem; line-height: 1.5; color: #334155;">
            <div style="font-weight: 600; color: #64748b; margin-bottom: 0.2rem;">Snapshot State to Restore:</div>
            ${diffRows || '<span style="color: #94a3b8;">Original attributes preserved</span>'}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color: #dc2626; padding: 1rem;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function closeSchoolVersionHistoryModal() {
  const modal = document.getElementById('modal-school-version-history');
  if (modal) modal.style.display = 'none';
}

// Execute Manual Rollback for a Specific School Version
async function executeSchoolVersionRollback(schoolId, auditLogId) {
  if (!confirm(`Are you sure you want to rollback this school record to version #${auditLogId}?`)) {
    return;
  }

  try {
    const res = await fetch('/api/admin/enrichment/rollback-school', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ schoolId, auditLogId })
    });

    if (res.ok) {
      const data = await res.json();
      showToast(data.message || 'School version successfully rolled back!', 'success');
      closeSchoolVersionHistoryModal();
      await refreshEnrichmentStatus();
          } else {
      const err = await res.json();
      showToast(err.error || 'Failed to rollback version.', 'error');
    }
  } catch (err) {
    showToast('Error connecting to rollback service.', 'error');
  }
}

function startScannerPolling() {
  if (scannerPollInterval) clearInterval(scannerPollInterval);

  const startBtn = document.getElementById('btn-start-web-scanner');
  const progressBox = document.getElementById('scanner-progress-box');
  const statusText = document.getElementById('scanner-status-text');
  const progressCount = document.getElementById('scanner-progress-count');
  const progressBar = document.getElementById('scanner-progress-bar');

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Crawling in background...`;
  }
  if (progressBox) progressBox.style.display = 'block';

  async function pollTick() {
    try {
      const res = await fetch('/api/admin/scanner/status', {
        headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
      });
      if (!res.ok) return;
      const data = await res.json();
      const st = data.state;
      if (!st) return;

      const total = st.totalQueued || 1;
      const current = st.scannedCount || 0;
      const pct = Math.min(100, Math.round((current / total) * 100));

      if (progressCount) progressCount.textContent = `${current} / ${total}`;
      if (progressBar) progressBar.style.width = `${pct}%`;

      const activeCallout = document.getElementById('enrichment-active-school-callout');
      const activeName = document.getElementById('enrichment-active-school-name');
      const totalEnrichedBadge = document.getElementById('enrichment-total-enriched-badge');
      if (totalEnrichedBadge) totalEnrichedBadge.textContent = `${st.stats?.verifiedCount || 0} Enriched`;

      if (st.isRunning) {
        if (activeCallout) activeCallout.style.display = 'flex';
        if (activeName) activeName.textContent = st.isDelaying ? `Pacing delay (${st.delayRemainingSeconds}s)...` : (st.currentSchool || 'Processing schools...');
        if (statusText) {
          if (st.isDelaying && st.delayRemainingSeconds > 0) {
            statusText.innerHTML = `
              <i class="fa-solid fa-hourglass-half fa-spin" style="color:#f59e0b;"></i> 
              Pacing API limit: Next query in <strong>${st.delayRemainingSeconds}s</strong> &bull; 
              <span style="color:#059669; font-weight:700;"><i class="fa-solid fa-circle-check"></i> ${st.stats?.verifiedCount || 0} enriched</span>, 
              <span style="color:#dc2626; font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> ${st.stats?.anomaliesCount || 0} anomalies</span>
            `;
          } else {
            statusText.innerHTML = `
              <i class="fa-solid fa-spider fa-bounce" style="color:#7c3aed;"></i> 
              Auditing <strong>${st.currentSchool || 'schools'}</strong> (${pct}%) &bull; 
              <span style="color:#059669; font-weight:700;"><i class="fa-solid fa-circle-check"></i> ${st.stats?.verifiedCount || 0} clean/enriched</span>, 
              <span style="color:#dc2626; font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> ${st.stats?.anomaliesCount || 0} anomalies</span>
            `;
          }
        }
      } else {
        clearInterval(scannerPollInterval);
        scannerPollInterval = null;

        if (activeCallout) activeCallout.style.display = 'none';

        if (startBtn) {
          const scanMode = document.getElementById('scanner-scan-mode')?.value || 'BATCH';
          startBtn.disabled = false;
          startBtn.innerHTML = scanMode === 'SINGLE' 
            ? `<i class="fa-solid fa-bullseye"></i> Start AI Scan for Selected School`
            : `<i class="fa-solid fa-play"></i> Start AI Verification Scan`;
        }

        if (progressBar) progressBar.style.width = '100%';
        if (st.rateLimited || (st.error && (st.error.includes('429') || st.error.includes('Rate limit') || st.error.includes('Too Many Requests')))) {
          if (statusText) {
            statusText.innerHTML = `
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 0.5rem 0.75rem; color: #991b1b; font-size: 0.85rem;">
                <i class="fa-solid fa-hand fa-beat" style="color: #dc2626; margin-right: 0.35rem;"></i>
                <strong>Crawling Stopped:</strong> HTTP 429 Rate Limit encountered. The background crawler was halted immediately to protect API quotas.
              </div>
            `;
          }
          showToast(st.error || 'Crawling stopped: HTTP 429 Rate Limit encountered.', 'error', 7000);
        } else if (st.completedAt) {
          if (statusText) {
            statusText.innerHTML = `
              <i class="fa-solid fa-circle-check" style="color:#059669;"></i> 
              Completed web audit across <strong>${st.scannedCount}</strong> schools 
              (${st.stats?.verifiedCount || 0} auto-verified / enriched, ${st.stats?.anomaliesCount || 0} anomalies, ${st.stats?.missingWebsitesCount || 0} missing websites, ${st.stats?.dataMissingCount || 0} data missing).
            `;
          }
          showToast(`AI Enrichment scan complete: ${st.scannedCount} schools audited (${st.stats?.verifiedCount || 0} enriched)!`, 'success');
        }
      }

      if (st.latestRawInteraction) {
        updateRawLLMInspector(st.latestRawInteraction);
      }

      if (st.recentResults && Array.isArray(st.recentResults)) {
        enrichmentFeedData = st.recentResults;
        renderEnrichmentFeed(enrichmentFeedData);
        if (enrichmentFeedData.length > 0 && !st.latestRawInteraction && (enrichmentFeedData[0].exactRequest || enrichmentFeedData[0].exactResponse)) {
          updateRawLLMInspector(enrichmentFeedData[0]);
        }
      }
    } catch (pollErr) {
      console.warn('Error polling scanner status:', pollErr);
    }
  }

  pollTick();
  scannerPollInterval = setInterval(pollTick, 800);
}

async function startWebVerificationScan() {
  const scanMode = document.getElementById('scanner-scan-mode')?.value || 'BATCH';
  const forceRerun = document.getElementById('scanner-force-rerun')?.checked || false;
  const startBtn = document.getElementById('btn-start-web-scanner');
  const progressBox = document.getElementById('scanner-progress-box');
  const statusText = document.getElementById('scanner-status-text');
  const progressCount = document.getElementById('scanner-progress-count');
  const progressBar = document.getElementById('scanner-progress-bar');

  let postBody = {};

  if (scanMode === 'SINGLE') {
    const schoolId = document.getElementById('scanner-selected-school-id')?.value;
    const schoolName = document.getElementById('scanner-school-typeahead-input')?.value || 'Selected School';

    if (!schoolId) {
      showToast('Please type and select a specific school from the dropdown suggestions first.', 'warning');
      const input = document.getElementById('scanner-school-typeahead-input');
      if (input) input.focus();
      return;
    }

    postBody = {
      schoolId,
      concurrency: 1,
      forceRerun,
      force: forceRerun
    };

    if (startBtn) {
      startBtn.disabled = true;
      startBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Auditing ${escapeHtml(schoolName)}...`;
    }
    if (progressBox) progressBox.style.display = 'block';
    if (statusText) statusText.innerHTML = `<i class="fa-solid fa-bullseye fa-bounce" style="color:#7c3aed;"></i> Querying LLM intelligence for <strong>${escapeHtml(schoolName)}</strong>...`;
    if (progressCount) progressCount.textContent = `0 / 1`;
    if (progressBar) progressBar.style.width = '20%';
  } else {
    let priorityCategory = document.getElementById('scanner-priority-category')?.value || 'LONDON_INDEPENDENT';
    if (priorityCategory === 'CURRENT_TAB') {
      priorityCategory = 'LONDON_INDEPENDENT';
    }

    const limit = parseInt(document.getElementById('scanner-batch-limit')?.value || '25', 10);
    postBody = {
      priorityCategory,
      limit,
      concurrency: 1,
      forceRerun,
      force: forceRerun
    };

    if (startBtn) {
      startBtn.disabled = true;
      startBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Launching background scan...`;
    }
    if (progressBox) progressBox.style.display = 'block';
    if (statusText) statusText.innerHTML = `<i class="fa-solid fa-spider fa-bounce" style="color:#7c3aed;"></i> Initializing background AI verification for ${limit} schools (${priorityCategory})...`;
    if (progressCount) progressCount.textContent = `0 / ${limit}`;
    if (progressBar) progressBar.style.width = '5%';
  }

  try {
    const res = await fetch('/api/admin/scanner/start-batch-scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify(postBody)
    });

    if (res.ok) {
      const data = await res.json();
      if (data.started === false) {
        showToast(data.message || 'All schools in this category have already been enriched.', 'info');
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.innerHTML = scanMode === 'SINGLE'
            ? `<i class="fa-solid fa-bullseye"></i> Start AI Scan for Selected School`
            : `<i class="fa-solid fa-play"></i> Start AI Verification Scan`;
        }
        if (progressBox) progressBox.style.display = 'none';
        return;
      }
      showToast(data.message || 'AI verification scan started!', 'info');
      startScannerPolling();
    } else {
      showToast('Failed to start scanner.', 'error');
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = scanMode === 'SINGLE'
          ? `<i class="fa-solid fa-bullseye"></i> Start AI Scan for Selected School`
          : `<i class="fa-solid fa-play"></i> Start AI Verification Scan`;
      }
    }
  } catch (err) {
    showToast('Error connecting to scanner service.', 'error');
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.innerHTML = scanMode === 'SINGLE'
        ? `<i class="fa-solid fa-bullseye"></i> Start AI Scan for Selected School`
        : `<i class="fa-solid fa-play"></i> Start AI Verification Scan`;
    }
  }
}

async function stopWebVerificationScan() {
  try {
    const res = await fetch('/api/admin/scanner/stop', {
      method: 'POST',
      headers: currentSessionId ? { 'x-session-id': currentSessionId } : {}
    });
    if (res.ok) {
      showToast('Background crawler stopped.', 'info');
      if (scannerPollInterval) {
        clearInterval(scannerPollInterval);
        scannerPollInterval = null;
      }
      const startBtn = document.getElementById('btn-start-web-scanner');
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = `<i class="fa-solid fa-play"></i> Start AI Verification Scan`;
      }
      const statusText = document.getElementById('scanner-status-text');
      if (statusText) statusText.innerHTML = `<span style="color:#d97706;"><i class="fa-solid fa-circle-pause"></i> Background crawler was stopped by admin.</span>`;
          }
  } catch (e) {
    showToast('Failed to stop scanner.', 'error');
  }
}

function renderFieldRecommendationChips(containerId, inputId, options) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;

  const validOptions = [];
  const seen = new Set();

  for (const opt of options) {
    if (!opt || !opt.value) continue;
    const val = String(opt.value).trim();
    if (!val || val === 'N/A' || val.toLowerCase() === 'none' || seen.has(val)) continue;
    seen.add(val);
    validOptions.push({
      label: opt.label,
      type: opt.type, // 'proposed', 'crawler', 'user', 'current'
      value: val
    });
  }

  if (validOptions.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  for (const opt of validOptions) {
    let badgeStyle = 'background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;';
    let icon = 'fa-tag';
    if (opt.type === 'proposed') {
      badgeStyle = 'background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0;';
      icon = 'fa-wand-magic-sparkles';
    } else if (opt.type === 'crawler') {
      badgeStyle = 'background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;';
      icon = 'fa-globe';
    } else if (opt.type === 'user') {
      badgeStyle = 'background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa;';
      icon = 'fa-users';
    }

    const isCurrentVal = (input.value || '').trim() === opt.value;
    if (isCurrentVal) {
      badgeStyle += ' font-weight: 700; outline: 2px solid #4f46e5; outline-offset: 1px;';
    }

    const escapedVal = opt.value.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    html += `
      <button type="button" class="rec-chip-btn" onclick="selectFixModalChip('${inputId}', '${escapedVal}', this)" style="${badgeStyle} cursor: pointer; border-radius: 6px; font-size: 0.73rem; padding: 0.22rem 0.55rem; display: inline-flex; align-items: center; gap: 0.35rem; transition: all 0.15s ease;" title="Adopt ${opt.label}">
        <i class="fa-solid ${icon}" style="font-size: 0.7rem;"></i>
        <span><strong>${opt.label}:</strong> ${opt.value}</span>
      </button>
    `;
  }

  container.innerHTML = html;
}

window.selectFixModalChip = function(inputId, val, btnEl) {
  const input = document.getElementById(inputId);
  if (input) {
    input.value = val;
    input.dispatchEvent(new Event('input'));
  }
  if (btnEl && btnEl.parentElement) {
    btnEl.parentElement.querySelectorAll('.rec-chip-btn').forEach(b => {
      b.style.outline = 'none';
      b.style.fontWeight = 'normal';
    });
    btnEl.style.outline = '2px solid #4f46e5';
    btnEl.style.outlineOffset = '1px';
    btnEl.style.fontWeight = '700';
  }
};

function openApplyVerifiedFixModal(item) {
  const modal = document.getElementById('apply-verified-fix-modal');
  if (!modal || !item) return;

  const titleEl = document.getElementById('apply-fix-modal-title');
  const subtitleEl = document.getElementById('apply-fix-modal-subtitle');
  const schoolIdInput = document.getElementById('fix-modal-school-id');

  if (titleEl) {
    titleEl.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #059669;"></i> Review &amp; Apply Verified Fixes — ${item.schoolName}`;
  }
  if (subtitleEl) {
    subtitleEl.textContent = `${item.schoolType || 'School'} • ${item.la || item.region || ''} (Click any recommended data correction chip to adopt)`;
  }
  if (schoolIdInput) {
    schoolIdInput.value = item.schoolId;
  }

  const p = item.proposedDates || {};
  const c = item.currentDates || {};
  const vr = item.verificationReport || {};
  const vd = vr.details || {};
  const uc = item.userCorrections || {};

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };

  // 1. Set initial default values
  setVal('fix-modal-reg-open', p.registrationOpen || c.registrationOpen || '');
  setVal('fix-modal-reg-close', p.registrationDeadline || c.registrationDeadline || '');
  setVal('fix-modal-exam1', p.examDate || c.examDate || '');
  setVal('fix-modal-results1', p.resultsDate || c.resultsDate || '');
  setVal('fix-modal-exam2', p.secondExamDate || c.secondExamDate || '');
  setVal('fix-modal-interview', p.interviewInfo || c.interviewInfo || '');
  setVal('fix-modal-offers', p.offersAcceptance || c.offersAcceptance || '');

  setVal('fix-modal-exam-type', item.entranceExamType || 'Standard / Non-Selective');
  setVal('fix-modal-gender', item.gender || 'Mixed');
  setVal('fix-modal-phone', item.phone || '');
  setVal('fix-modal-email', item.email || '');
  setVal('fix-modal-website', item.website || '');
  setVal('fix-modal-postcode', item.postcode || '');
  setVal('fix-modal-address', item.address || '');

  // 2. Render Recommended Options & Data Corrections Chips for Each Field
  const dateMilestones = vd.datesCheck?.detectedMilestones || {};
  const webExam = vd.examTypeCheck?.detectedValue || vd.examTypeCheck?.detectedType;
  const webGender = vd.genderCheck?.detectedValue || vd.genderCheck?.detectedGender;
  const webPhones = vd.contactCheck?.webValues || vr.extracted?.phones || [];
  const webEmails = vd.contactCheck?.webValues || vr.extracted?.emails || [];
  const webPostcodes = vd.contactCheck?.webValues || vr.extracted?.postcodes || [];

  renderFieldRecommendationChips('chips-fix-modal-reg-open', 'fix-modal-reg-open', [
    { label: 'Proposed 2026/27', value: p.registrationOpen, type: 'proposed' },
    { label: 'Web Detected', value: dateMilestones.registrationOpen, type: 'crawler' },
    ...(uc.registrationOpen || []).map(v => ({ label: 'Community Report', value: v, type: 'user' })),
    { label: 'Current DB', value: c.registrationOpen, type: 'current' }
  ]);

  renderFieldRecommendationChips('chips-fix-modal-reg-close', 'fix-modal-reg-close', [
    { label: 'Proposed 2026/27', value: p.registrationDeadline, type: 'proposed' },
    { label: 'Web Detected', value: dateMilestones.registrationDeadline, type: 'crawler' },
    ...(uc.registrationDeadline || []).map(v => ({ label: 'Community Report', value: v, type: 'user' })),
    { label: 'Current DB', value: c.registrationDeadline, type: 'current' }
  ]);

  renderFieldRecommendationChips('chips-fix-modal-exam1', 'fix-modal-exam1', [
    { label: 'Proposed 2026/27', value: p.examDate, type: 'proposed' },
    { label: 'Web Detected', value: dateMilestones.examDate, type: 'crawler' },
    ...(uc.examDate || []).map(v => ({ label: 'Community Report', value: v, type: 'user' })),
    { label: 'Current DB', value: c.examDate, type: 'current' }
  ]);

  renderFieldRecommendationChips('chips-fix-modal-results1', 'fix-modal-results1', [
    { label: 'Proposed 2026/27', value: p.resultsDate, type: 'proposed' },
    { label: 'Web Detected', value: dateMilestones.resultsDate, type: 'crawler' },
    ...(uc.resultsDate || []).map(v => ({ label: 'Community Report', value: v, type: 'user' })),
    { label: 'Current DB', value: c.resultsDate, type: 'current' }
  ]);

  renderFieldRecommendationChips('chips-fix-modal-exam2', 'fix-modal-exam2', [
    { label: 'Proposed 2026/27', value: p.secondExamDate, type: 'proposed' },
    { label: 'Web Detected', value: dateMilestones.secondExamDate, type: 'crawler' },
    { label: 'Current DB', value: c.secondExamDate, type: 'current' }
  ]);

  renderFieldRecommendationChips('chips-fix-modal-interview', 'fix-modal-interview', [
    { label: 'Proposed 2026/27', value: p.interviewInfo, type: 'proposed' },
    { label: 'Web Detected', value: dateMilestones.interviewInfo, type: 'crawler' },
    { label: 'Current DB', value: c.interviewInfo, type: 'current' }
  ]);

  renderFieldRecommendationChips('chips-fix-modal-offers', 'fix-modal-offers', [
    { label: 'Proposed 2026/27', value: p.offersAcceptance, type: 'proposed' },
    { label: 'Web Detected', value: dateMilestones.offersAcceptance, type: 'crawler' },
    { label: 'Current DB', value: c.offersAcceptance, type: 'current' }
  ]);

  renderFieldRecommendationChips('chips-fix-modal-exam-type', 'fix-modal-exam-type', [
    { label: 'Web Policy', value: webExam, type: 'crawler' },
    ...(uc.entranceExamType || []).map(v => ({ label: 'Community Report', value: v, type: 'user' })),
    { label: 'Current DB', value: item.entranceExamType, type: 'current' },
    { label: 'Standard', value: 'GL Assessment', type: 'proposed' },
    { label: 'Independent Pre-Test', value: 'ISEB Common Pre-Test', type: 'proposed' },
    { label: 'Consortium', value: 'London 11+ Consortium', type: 'proposed' },
    { label: 'Comprehensive', value: 'Non-Selective / Banding', type: 'proposed' }
  ]);

  renderFieldRecommendationChips('chips-fix-modal-gender', 'fix-modal-gender', [
    { label: 'Web Verified', value: webGender, type: 'crawler' },
    ...(uc.gender || []).map(v => ({ label: 'Community Report', value: v, type: 'user' })),
    { label: 'Current DB', value: item.gender, type: 'current' },
    { label: 'Co-ed Option', value: 'Mixed', type: 'proposed' },
    { label: 'Girls Option', value: 'Girls', type: 'proposed' },
    { label: 'Boys Option', value: 'Boys', type: 'proposed' }
  ]);

  const phoneOpts = [];
  if (Array.isArray(webPhones)) {
    for (const ph of webPhones) phoneOpts.push({ label: 'Web Crawled', value: ph, type: 'crawler' });
  } else if (typeof webPhones === 'string') {
    phoneOpts.push({ label: 'Web Crawled', value: webPhones, type: 'crawler' });
  }
  for (const ph of (uc.phone || [])) phoneOpts.push({ label: 'Community Report', value: ph, type: 'user' });
  phoneOpts.push({ label: 'Current DB', value: item.phone, type: 'current' });
  renderFieldRecommendationChips('chips-fix-modal-phone', 'fix-modal-phone', phoneOpts);

  const emailOpts = [];
  if (Array.isArray(webEmails)) {
    for (const em of webEmails) emailOpts.push({ label: 'Web Crawled', value: em, type: 'crawler' });
  } else if (typeof webEmails === 'string') {
    emailOpts.push({ label: 'Web Crawled', value: webEmails, type: 'crawler' });
  }
  for (const em of (uc.email || [])) emailOpts.push({ label: 'Community Report', value: em, type: 'user' });
  emailOpts.push({ label: 'Current DB', value: item.email, type: 'current' });
  renderFieldRecommendationChips('chips-fix-modal-email', 'fix-modal-email', emailOpts);

  renderFieldRecommendationChips('chips-fix-modal-website', 'fix-modal-website', [
    { label: 'Web Verified', value: vd.domainCheck?.finalUrl, type: 'crawler' },
    ...(uc.website || []).map(v => ({ label: 'Community Report', value: v, type: 'user' })),
    { label: 'Current DB', value: item.website, type: 'current' }
  ]);

  const pcOpts = [];
  if (Array.isArray(webPostcodes)) {
    for (const pc of webPostcodes) pcOpts.push({ label: 'Web Detected', value: pc, type: 'crawler' });
  } else if (typeof webPostcodes === 'string') {
    pcOpts.push({ label: 'Web Detected', value: webPostcodes, type: 'crawler' });
  }
  for (const pc of (uc.postcode || [])) pcOpts.push({ label: 'Community Report', value: pc, type: 'user' });
  pcOpts.push({ label: 'Current DB', value: item.postcode, type: 'current' });
  renderFieldRecommendationChips('chips-fix-modal-postcode', 'fix-modal-postcode', pcOpts);

  renderFieldRecommendationChips('chips-fix-modal-address', 'fix-modal-address', [
    ...(uc.address || []).map(v => ({ label: 'Community Report', value: v, type: 'user' })),
    { label: 'Current DB', value: item.address, type: 'current' }
  ]);

  // 3. Show / Hide Corrections Banner
  const banner = document.getElementById('fix-modal-corrections-banner');
  const bannerText = document.getElementById('fix-modal-corrections-text');
  const userReportsCount = Object.values(uc).reduce((acc, arr) => acc + arr.length, 0);

  if (banner) {
    if (userReportsCount > 0 || (webPhones.length > 0) || webExam || webGender) {
      banner.style.display = 'flex';
      if (bannerText) {
        bannerText.innerHTML = `
          <strong>${userReportsCount > 0 ? `${userReportsCount} Community Data Correction(s)` : 'Web Crawler Discoveries'} available:</strong>
          Select any highlighted recommendation badge below to adopt that value.
        `;
      }
    } else {
      banner.style.display = 'none';
    }
  }

  // 4. Wire "Use All Recommended Values" button
  const btnApplyAllChips = document.getElementById('btn-apply-all-rec-chips');
  if (btnApplyAllChips) {
    btnApplyAllChips.onclick = () => {
      // Pick first proposed / crawler / user chip in each container
      modal.querySelectorAll('.rec-chips-container').forEach(container => {
        const firstChip = container.querySelector('.rec-chip-btn');
        if (firstChip) firstChip.click();
      });
      showToast('Adopted all recommended verified data values!', 'info');
    };
  }

  modal.style.display = 'flex';
}

function closeApplyVerifiedFixModal() {
  const modal = document.getElementById('apply-verified-fix-modal');
  if (modal) modal.style.display = 'none';
}

async function handleConfirmApplyVerifiedFix() {
  const sId = document.getElementById('fix-modal-school-id')?.value;
  if (!sId) return;

  const btn = document.getElementById('btn-confirm-apply-fix');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Applying Fixes...`;
  }

  const getVal = (id) => (document.getElementById(id)?.value || '').trim();

  const proposedDates = {
    registrationOpen: getVal('fix-modal-reg-open'),
    registrationDeadline: getVal('fix-modal-reg-close'),
    examDate: getVal('fix-modal-exam1'),
    resultsDate: getVal('fix-modal-results1'),
    secondExamDate: getVal('fix-modal-exam2') || null,
    interviewInfo: getVal('fix-modal-interview') || null,
    offersAcceptance: getVal('fix-modal-offers')
  };

  const fixes = {
    entranceExamDates: proposedDates,
    entranceExamType: getVal('fix-modal-exam-type'),
    gender: getVal('fix-modal-gender'),
    phone: getVal('fix-modal-phone'),
    email: getVal('fix-modal-email'),
    website: getVal('fix-modal-website'),
    postcode: getVal('fix-modal-postcode'),
    address: getVal('fix-modal-address')
  };

  try {
    const res = await fetch('/api/admin/apply-date-fix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ schoolId: sId, proposedDates, fixes })
    });

    if (res.ok) {
      const data = await res.json();
      showToast(data.message || 'Verified details applied successfully!', 'success');
      closeApplyVerifiedFixModal();
      await loadSchools();
          } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to apply verified fixes', 'error');
    }
  } catch (e) {
    console.error('Error applying verified fix:', e);
    showToast('Error applying verified fixes', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Confirm &amp; Apply Verified Fixes`;
    }
  }
}

// ====================================================
// Automated Enrichment Dry-Run & Review Controller
// ====================================================

let cachedEnrichmentPreviewData = null;
let selectedEnrichmentIds = new Set();

async function openEnrichmentPreviewModal() {
  const modal = document.getElementById('admin-enrichment-preview-modal');
  const container = document.getElementById('admin-enrichment-preview-cards');
  if (!modal || !container) return;

  modal.style.display = 'flex';
  container.innerHTML = `
    <div style="text-align: center; padding: 3rem 1.5rem; color: #64748b;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 2.2rem; color: #4f46e5; margin-bottom: 0.75rem; display: block;"></i>
      <strong style="font-size: 1.05rem; color: #1e293b;">Analyzing database and generating dry-run preview...</strong>
      <p style="font-size: 0.85rem; color: #64748b; margin-top: 0.3rem;">Evaluating statutory DfE records, consortium schedules, and admissions lifecycles across 6,497 schools...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/admin/preview-enrichment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({})
    });

    if (!res.ok) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1.5rem; background: white; border-radius: 12px; border: 1px solid #fee2e2;">
          <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; color: #ef4444; margin-bottom: 0.75rem; display: block;"></i>
          <h4 style="color: #991b1b; font-size: 1.1rem; margin-bottom: 0.35rem;">Failed to Generate Enrichment Preview (HTTP ${res.status})</h4>
          <p style="color: #64748b; font-size: 0.85rem; max-width: 560px; margin: 0 auto 1.25rem auto; line-height: 1.5;">
            ${res.status === 404 ? 'Your Node server process is running an in-memory instance from before the new preview route was added. Please <strong>restart your Node server</strong> (stop the process in your terminal and run <code>npm start</code> or <code>node server.js</code>) and click Retry below.' : 'An error occurred while generating the enrichment preview.'}
          </p>
          <button type="button" class="btn btn-primary" onclick="openEnrichmentPreviewModal()" style="font-size: 0.85rem; padding: 0.45rem 1rem;">
            <i class="fa-solid fa-rotate"></i> Retry
          </button>
        </div>
      `;
      return;
    }

    cachedEnrichmentPreviewData = await res.json();
    const changes = cachedEnrichmentPreviewData.proposedChanges || [];
    const stats = cachedEnrichmentPreviewData.stats || {};

    // Update Summary Badges
    const badgeTotal = document.getElementById('preview-total-changes-badge');
    if (badgeTotal) badgeTotal.textContent = `${changes.length} Schools with Changes`;

    const badgeType = document.getElementById('preview-type-changes-badge');
    if (badgeType) badgeType.textContent = `${stats.typeChangesCount || 0} Type Updates`;

    const badgeExam = document.getElementById('preview-exam-changes-badge');
    if (badgeExam) badgeExam.textContent = `${stats.examTypeChangesCount || 0} Exam Type Updates`;

    const badgeDate = document.getElementById('preview-date-changes-badge');
    if (badgeDate) badgeDate.textContent = `${stats.dateChangesCount || 0} Date Updates`;

    const btnCount = document.getElementById('preview-total-count-btn');
    if (btnCount) btnCount.textContent = changes.length;

    // Default select all proposed changes
    selectedEnrichmentIds = new Set(changes.map(c => c.schoolId));
    updateSelectedEnrichmentCount();

    renderEnrichmentPreviewCards();
  } catch (err) {
    console.error('Error opening enrichment preview:', err);
    container.innerHTML = `<div style="color: #ef4444; padding: 2rem; text-align: center;">Error connecting to preview service.</div>`;
  }
}

function closeEnrichmentPreviewModal() {
  const modal = document.getElementById('admin-enrichment-preview-modal');
  if (modal) modal.style.display = 'none';
}

function updateSelectedEnrichmentCount() {
  const countEl = document.getElementById('selected-changes-count');
  if (countEl) countEl.textContent = selectedEnrichmentIds.size;
}

function renderEnrichmentPreviewCards() {
  const container = document.getElementById('admin-enrichment-preview-cards');
  if (!container || !cachedEnrichmentPreviewData) return;

  const searchVal = (document.getElementById('filter-preview-search')?.value || '').trim().toLowerCase();
  const categoryFilter = document.getElementById('filter-preview-category')?.value || 'ALL';

  let items = cachedEnrichmentPreviewData.proposedChanges || [];

  // Filter by category
  if (categoryFilter !== 'ALL') {
    items = items.filter(c => c.changedFields && c.changedFields.includes(categoryFilter));
  }

  // Filter by search query
  if (searchVal) {
    items = items.filter(c =>
      (c.schoolName || '').toLowerCase().includes(searchVal) ||
      (c.la || '').toLowerCase().includes(searchVal) ||
      (c.schoolUrn || '').toLowerCase().includes(searchVal) ||
      (c.region || '').toLowerCase().includes(searchVal)
    );
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3.5rem 1.5rem; background: white; border-radius: 12px; border: 1px solid #e2e8f0;">
        <i class="fa-solid fa-circle-check" style="font-size: 2.5rem; color: #22c55e; margin-bottom: 0.75rem; display: block;"></i>
        <h4 style="color: #166534; font-size: 1.15rem; margin-bottom: 0.35rem;">No Pending Proposed Changes</h4>
        <p style="color: #15803d; font-size: 0.88rem; max-width: 550px; margin: 0 auto;">
          ${(cachedEnrichmentPreviewData.proposedChanges || []).length === 0 ? 'All 6,497 schools are already fully enriched and up to date with the master standard.' : 'No proposed changes match your current search/filter.'}
        </p>
      </div>
    `;
    return;
  }

  let html = '';

  for (const item of items) {
    const isSelected = selectedEnrichmentIds.has(item.schoolId);
    const cur = item.current || {};
    const prop = item.proposed || {};

    let curDatesObj = null;
    let propDatesObj = null;
    try { if (cur.entranceExamDates) curDatesObj = JSON.parse(cur.entranceExamDates); } catch (e) {}
    try { if (prop.entranceExamDates) propDatesObj = JSON.parse(prop.entranceExamDates); } catch (e) {}

    html += `
      <div class="date-anomaly-card" style="background: white; border: 1px solid ${isSelected ? '#818cf8' : '#e2e8f0'}; border-radius: 12px; padding: 1.2rem; box-shadow: 0 2px 4px rgba(0,0,0,0.03);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.75rem; margin-bottom: 0.85rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
            <input type="checkbox" class="preview-school-checkbox" data-school-id="${item.schoolId}" ${isSelected ? 'checked' : ''} style="margin-top: 0.3rem; transform: scale(1.2); cursor: pointer;">
            <div>
              <strong style="font-size: 1.05rem; color: #0f172a; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <i class="fa-solid fa-school" style="color: #4f46e5;"></i> ${item.schoolName}
                <span style="font-size: 0.8rem; font-weight: normal; color: #64748b;">(URN: ${item.schoolUrn || 'N/A'} — ${item.la})</span>
              </strong>
              <div style="display: flex; gap: 0.4rem; margin-top: 0.35rem; flex-wrap: wrap;">
                ${item.changedFields.map(f => `<span class="anomaly-tag-pill" style="background: #f5f3ff; color: #6d28d9; border: 1px solid #ddd6fe; font-size: 0.72rem;">${f}</span>`).join('')}
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <button type="button" class="btn btn-primary btn-accept-single-preview" data-school-id="${item.schoolId}" style="background: #059669; border-color: #059669; font-size: 0.78rem; padding: 0.35rem 0.75rem;">
              <i class="fa-solid fa-check"></i> Accept This
            </button>
            <button type="button" class="btn btn-outline btn-skip-single-preview" data-school-id="${item.schoolId}" style="font-size: 0.78rem; padding: 0.35rem 0.65rem; color: #64748b;">
              <i class="fa-solid fa-xmark"></i> Skip
            </button>
          </div>
        </div>

        <!-- Diff Table -->
        <table class="data-table" style="width: 100%; font-size: 0.82rem; border-collapse: collapse;">
          <thead>
            <tr style="background: #f8fafc;">
              <th style="width: 22%; padding: 0.45rem 0.6rem;">Field</th>
              <th style="width: 39%; padding: 0.45rem 0.6rem; color: #991b1b;"><i class="fa-solid fa-clock-rotate-left"></i> Current Value</th>
              <th style="width: 39%; padding: 0.45rem 0.6rem; color: #166534;"><i class="fa-solid fa-sparkles"></i> Proposed Enriched Value</th>
            </tr>
          </thead>
          <tbody>
            ${item.changedFields.includes('schoolType') || item.changedFields.includes('rawSchoolType') ? `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 0.45rem 0.6rem;"><strong>School Type</strong></td>
                <td style="padding: 0.45rem 0.6rem; color: #dc2626; background: #fef2f2;">${cur.schoolType || 'N/A'} <span style="font-size:0.75rem; color:#64748b;">(${cur.rawSchoolType || ''})</span></td>
                <td style="padding: 0.45rem 0.6rem; color: #059669; background: #f0fdf4; font-weight: 700;">${prop.schoolType || 'N/A'} <span style="font-size:0.75rem; color:#047857; font-weight:normal;">(${prop.rawSchoolType || ''})</span></td>
              </tr>
            ` : ''}
            ${item.changedFields.includes('entranceExamType') ? `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 0.45rem 0.6rem;"><strong>Entrance Exam Type</strong></td>
                <td style="padding: 0.45rem 0.6rem; color: #dc2626; background: #fef2f2;">${cur.entranceExamType || '<em style="color:#94a3b8;">(Blank / Unset)</em>'}</td>
                <td style="padding: 0.45rem 0.6rem; color: #059669; background: #f0fdf4; font-weight: 700;">${prop.entranceExamType}</td>
              </tr>
            ` : ''}
            ${item.changedFields.includes('entranceExamDates') && propDatesObj ? `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 0.45rem 0.6rem;"><strong>Admissions Timeline</strong></td>
                <td style="padding: 0.45rem 0.6rem; color: #64748b; background: #fef2f2; font-size: 0.78rem;">
                  ${curDatesObj ? `
                    <div><strong>Reg Deadline:</strong> ${curDatesObj.registrationDeadline || 'N/A'}</div>
                    <div><strong>1st Exam:</strong> ${curDatesObj.examDate || 'N/A'}</div>
                    <div><strong>Results:</strong> ${curDatesObj.resultsDate || 'N/A'}</div>
                  ` : '<em style="color:#94a3b8;">(No structured dates)</em>'}
                </td>
                <td style="padding: 0.45rem 0.6rem; color: #047857; background: #f0fdf4; font-size: 0.78rem;">
                  <div><strong>Reg:</strong> ${propDatesObj.registrationOpen || 'N/A'} — ${propDatesObj.registrationDeadline || 'N/A'}</div>
                  <div><strong>Exam:</strong> ${propDatesObj.examDate || 'N/A'}</div>
                  <div><strong>Outcome:</strong> ${propDatesObj.resultsDate || propDatesObj.offersAcceptance || 'N/A'}</div>
                </td>
              </tr>
            ` : ''}
          </tbody>
        </table>

        <!-- Source Evidence & Policy Provenance Links -->
        ${item.sources && item.sources.length > 0 ? `
          <div style="margin-top: 0.85rem; padding: 0.6rem 0.85rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.78rem;">
            <div style="font-weight: 700; color: #475569; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.4rem;">
              <i class="fa-solid fa-link" style="color: #4f46e5;"></i> Source Evidence &amp; Policy Provenance:
            </div>
            <div style="display: flex; gap: 0.45rem; flex-wrap: wrap;">
              ${item.sources.map(src => {
                let icon = 'fa-arrow-up-right-from-square';
                let badgeStyle = 'background: white; border: 1px solid #cbd5e1; color: #3730a3;';
                if (src.type === 'dfe') {
                  icon = 'fa-building-columns';
                  badgeStyle = 'background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8;';
                } else if (src.type === 'consortium') {
                  icon = 'fa-certificate';
                  badgeStyle = 'background: #faf5ff; border: 1px solid #e9d5ff; color: #7e22ce;';
                } else if (src.type === 'school') {
                  icon = 'fa-globe';
                  badgeStyle = 'background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d;';
                }
                return `
                  <a href="${src.url}" target="_blank" rel="noopener noreferrer" style="${badgeStyle} text-decoration: none; padding: 0.25rem 0.55rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; font-weight: 500; transition: transform 0.1s ease, box-shadow 0.1s ease;" onmouseover="this.style.boxShadow='0 2px 4px rgba(0,0,0,0.08)';" onmouseout="this.style.boxShadow='none';">
                    <i class="fa-solid ${icon}" style="font-size: 0.7rem;"></i> ${src.title}
                  </a>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

      </div>
    `;
  }

  container.innerHTML = html;

  // Bind checkbox events
  container.querySelectorAll('.preview-school-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const sId = e.target.getAttribute('data-school-id');
      if (e.target.checked) selectedEnrichmentIds.add(sId);
      else selectedEnrichmentIds.delete(sId);
      updateSelectedEnrichmentCount();
    });
  });

  // Bind single accept buttons
  container.querySelectorAll('.btn-accept-single-preview').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sId = btn.getAttribute('data-school-id');
      const item = (cachedEnrichmentPreviewData.proposedChanges || []).find(c => c.schoolId === sId);
      if (item) {
        await commitSelectedEnrichment([item]);
      }
    });
  });

  // Bind single skip buttons
  container.querySelectorAll('.btn-skip-single-preview').forEach(btn => {
    btn.addEventListener('click', () => {
      const sId = btn.getAttribute('data-school-id');
      cachedEnrichmentPreviewData.proposedChanges = (cachedEnrichmentPreviewData.proposedChanges || []).filter(c => c.schoolId !== sId);
      selectedEnrichmentIds.delete(sId);
      updateSelectedEnrichmentCount();
      renderEnrichmentPreviewCards();
    });
  });
}

async function acceptAllEnrichmentChanges() {
  if (!cachedEnrichmentPreviewData || !cachedEnrichmentPreviewData.proposedChanges || cachedEnrichmentPreviewData.proposedChanges.length === 0) {
    showToast('No proposed changes to accept.', 'info');
    return;
  }
  const count = cachedEnrichmentPreviewData.proposedChanges.length;
  if (!confirm(`Accept all proposed changes across ${count} schools and commit to master database?`)) return;

  await commitSelectedEnrichment(cachedEnrichmentPreviewData.proposedChanges);
}

async function commitSelectedEnrichmentChanges() {
  if (selectedEnrichmentIds.size === 0) {
    showToast('No schools selected to accept.', 'warning');
    return;
  }

  const items = (cachedEnrichmentPreviewData.proposedChanges || []).filter(c => selectedEnrichmentIds.has(c.schoolId));
  if (items.length === 0) return;

  if (!confirm(`Commit accepted changes for ${items.length} selected schools?`)) return;

  await commitSelectedEnrichment(items);
}

async function commitSelectedEnrichment(itemsToCommit) {
  if (!itemsToCommit || itemsToCommit.length === 0) return;

  try {
    const res = await fetch('/api/admin/commit-enrichment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ acceptedChanges: itemsToCommit })
    });

    if (res.ok) {
      const result = await res.json();
      showToast(`Successfully committed enriched data for ${result.count} schools!`, 'success');

      // Remove committed from preview
      const committedSet = new Set(itemsToCommit.map(i => i.schoolId));
      cachedEnrichmentPreviewData.proposedChanges = (cachedEnrichmentPreviewData.proposedChanges || []).filter(c => !committedSet.has(c.schoolId));
      for (const sId of committedSet) selectedEnrichmentIds.delete(sId);

      updateSelectedEnrichmentCount();
      renderEnrichmentPreviewCards();

      await loadSchools();
      
      if ((cachedEnrichmentPreviewData.proposedChanges || []).length === 0) {
        closeEnrichmentPreviewModal();
      }
    } else {
      showToast('Failed to commit enrichment changes.', 'error');
    }
  } catch (err) {
    console.error('Error committing enrichment:', err);
    showToast('Error committing enrichment changes.', 'error');
  }
}

async function runAdminFullEnrichment() {
  await openEnrichmentPreviewModal();
}

// =========================================================================
// DATA QUALITY SUITE CLIENT CONTROLLERS (Pillars 2, 3, 4, 5)
// =========================================================================

// --- 1. DfE GIAS Backfill & Direct URN Ingestion Controller ---
const GIAS_IMPORT_FIELDS = [
  { key: 'name', label: 'School Name' },
  { key: 'urn', label: 'DfE URN' },
  { key: 'schoolType', label: 'School Type' },
  { key: 'rawSchoolType', label: 'Raw DfE Type' },
  { key: 'gender', label: 'Gender Policy' },
  { key: 'ageRange', label: 'Age Range' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'address', label: 'Postal Address', isTextarea: true },
  { key: 'la', label: 'Local Authority' },
  { key: 'region', label: 'Region' },
  { key: 'ofstedRating', label: 'Ofsted Rating' },
  { key: 'website', label: 'Official Website' },
  { key: 'phone', label: 'Phone Number' },
  { key: 'email', label: 'Email Address' },
  { key: 'admissionsPolicy', label: 'Admissions Policy' },
  { key: 'active', label: 'Operating Status (Active / Open)', isBool: true },
  { key: 'official', label: 'Official DfE Record', isBool: true }
];

let giasActiveLookupData = null;

async function initGiasBackfillTab() {
  const triggerBtn = document.getElementById('trigger-gias-backfill-btn');
  if (triggerBtn && !triggerBtn._bound) {
    triggerBtn._bound = true;
    triggerBtn.addEventListener('click', runGiasBackfillTrigger);
  }

  // Bind single URN lookup button & Enter key
  const lookupBtn = document.getElementById('gias-lookup-urn-btn');
  const lookupInput = document.getElementById('gias-lookup-urn-input');
  if (lookupBtn && !lookupBtn._bound) {
    lookupBtn._bound = true;
    lookupBtn.addEventListener('click', runGiasUrnLookup);
  }
  if (lookupInput && !lookupInput._bound) {
    lookupInput._bound = true;
    lookupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runGiasUrnLookup();
      }
    });
  }

  // Bind modal buttons
  const closeBtn = document.getElementById('modal-close-gias-import');
  if (closeBtn && !closeBtn._bound) {
    closeBtn._bound = true;
    closeBtn.addEventListener('click', closeGiasUrnImportModal);
  }
  const cancelBtn = document.getElementById('modal-cancel-gias-import');
  if (cancelBtn && !cancelBtn._bound) {
    cancelBtn._bound = true;
    cancelBtn.addEventListener('click', closeGiasUrnImportModal);
  }
  const confirmBtn = document.getElementById('modal-confirm-gias-import');
  if (confirmBtn && !confirmBtn._bound) {
    confirmBtn._bound = true;
    confirmBtn.addEventListener('click', confirmGiasUrnImport);
  }

  await loadGiasStatus();
}

async function loadGiasStatus() {
  try {
    const res = await fetch('/api/admin/quality/gias/status', {
      headers: { ...(currentSessionId ? { 'x-session-id': currentSessionId } : {}) }
    });
    if (res.ok) {
      const data = await res.json();
      if (document.getElementById('gias-stat-total')) document.getElementById('gias-stat-total').textContent = data.totalSchools.toLocaleString();
      if (document.getElementById('gias-stat-ofsted')) document.getElementById('gias-stat-ofsted').textContent = data.missingOfsted.toLocaleString();
      if (document.getElementById('gias-stat-websites')) document.getElementById('gias-stat-websites').textContent = data.missingWeb.toLocaleString();
      if (document.getElementById('gias-stat-urns')) document.getElementById('gias-stat-urns').textContent = data.missingUrn.toLocaleString();
    }
  } catch (err) {
    console.error('Failed to load GIAS status:', err);
  }
}

async function runGiasUrnLookup() {
  const input = document.getElementById('gias-lookup-urn-input');
  const btn = document.getElementById('gias-lookup-urn-btn');
  const errDiv = document.getElementById('gias-lookup-error');
  if (!input) return;

  const urn = input.value.trim();
  if (!urn || !/^\d+$/.test(urn)) {
    if (errDiv) {
      errDiv.textContent = 'Please enter a valid numeric 6-digit DfE URN.';
      errDiv.style.display = 'block';
    }
    input.focus();
    return;
  }

  if (errDiv) errDiv.style.display = 'none';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Querying DfE GIAS...';
  }

  try {
    const res = await fetch(`/api/admin/quality/gias/lookup/${encodeURIComponent(urn)}`, {
      headers: { ...(currentSessionId ? { 'x-session-id': currentSessionId } : {}) }
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      giasActiveLookupData = data;
      openGiasUrnImportModal();
    } else {
      const errMsg = data.error || (res.status === 404 ? `No establishment found for URN ${urn} on DfE GIAS.` : `Failed to lookup URN (HTTP ${res.status}). If the server was running before recent changes, please restart it.`);
      if (errDiv) {
        errDiv.textContent = errMsg;
        errDiv.style.display = 'block';
      }
      showToast(errMsg, 'error');
    }
  } catch (err) {
    console.error('GIAS URN lookup error:', err);
    if (errDiv) {
      errDiv.textContent = 'Error connecting to DfE GIAS service: ' + err.message;
      errDiv.style.display = 'block';
    }
    showToast('Failed to lookup URN: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Fetch &amp; Ingest DfE Details';
    }
  }
}

function openGiasUrnImportModal() {
  if (!giasActiveLookupData) return;
  const { urn, dfeSchool: dfe, existingSchool: curr, isNew } = giasActiveLookupData;

  const urnBadge = document.getElementById('gias-modal-urn-badge');
  if (urnBadge) urnBadge.textContent = urn;

  let matchCount = 0;
  let changedCount = 0;
  let rowsHtml = '';

  GIAS_IMPORT_FIELDS.forEach(f => {
    const dfeVal = dfe[f.key] ?? '';
    const currVal = curr ? (curr[f.key] ?? '') : '';
    const strDfe = String(dfeVal).trim();
    const strCurr = String(currVal).trim();

    const isMatch = !isNew && strDfe.toLowerCase() === strCurr.toLowerCase();
    const isChanged = isNew || !isMatch;
    const isMissingInCurr = !isNew && !strCurr && !!strDfe;

    if (isMatch) matchCount++;
    else changedCount++;

    const isCheckedByDefault = isNew || isChanged || isMissingInCurr;
    const initialVal = isCheckedByDefault ? strDfe : strCurr;

    let inputHtml = '';
    if (f.isTextarea) {
      inputHtml = `<textarea id="gias_val_${f.key}" class="form-control" rows="2" style="font-size:0.82rem; width:100%; resize:vertical; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid #cbd5e1;">${escapeHtml(initialVal)}</textarea>`;
    } else if (f.isBool) {
      const isTrue = initialVal === 'true' || initialVal === '1' || initialVal === true || initialVal === 1;
      inputHtml = `
        <select id="gias_val_${f.key}" class="form-control" style="font-size:0.82rem; width:100%; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid #cbd5e1;">
          <option value="true" ${isTrue ? 'selected' : ''}>Yes / Active (Official)</option>
          <option value="false" ${!isTrue ? 'selected' : ''}>No / Inactive</option>
        </select>
      `;
    } else {
      inputHtml = `<input type="text" id="gias_val_${f.key}" class="form-control" value="${escapeHtml(initialVal)}" style="font-size:0.82rem; width:100%; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid #cbd5e1;">`;
    }

    rowsHtml += `
      <tr class="${isChanged ? 'quality-dedup-row-diff' : ''}" id="gias_row_${f.key}">
        <td style="width: 22%; padding: 0.5rem 0.75rem; vertical-align: middle;">
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; margin: 0; font-weight: 600; color: #1e293b;">
            <input type="checkbox" id="gias_chk_${f.key}" ${isCheckedByDefault ? 'checked' : ''} onchange="onGiasFieldCheckboxToggle('${f.key}')" style="accent-color: #0284c7; width: 1.05rem; height: 1.05rem;">
            <span>${escapeHtml(f.label)}</span>
          </label>
          <div style="margin-left: 1.55rem; margin-top: 0.15rem;">
            ${isNew
              ? '<span style="background: #e0f2fe; color: #0369a1; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">New Attribute</span>'
              : (isMatch
                ? '<span class="status-badge-match" style="font-size: 0.68rem;"><i class="fa-solid fa-check"></i> Matches DB</span>'
                : (isMissingInCurr
                  ? '<span style="background: #dbeafe; color: #1e40af; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.68rem; font-weight: 700;"><i class="fa-solid fa-plus"></i> Fills Missing</span>'
                  : '<span class="status-badge-diff" style="font-size: 0.68rem;"><i class="fa-solid fa-code-compare"></i> Differs</span>'))}
          </div>
        </td>
        <td style="width: 24%; padding: 0.5rem 0.75rem; font-size: 0.82rem; color: #475569; background: #f8fafc; border-radius: 4px;">
          ${isNew ? '<em style="color: #94a3b8;">(New School - No DB record)</em>' : (escapeHtml(strCurr) || '<em style="color: #94a3b8;">(Empty / Blank)</em>')}
        </td>
        <td style="width: 27%; padding: 0.5rem 0.75rem; font-size: 0.82rem; color: #0369a1; background: #f0f9ff; font-weight: 500; border-left: 3px solid #0284c7;">
          ${escapeHtml(strDfe) || '<em style="color: #94a3b8;">(Not provided by DfE)</em>'}
        </td>
        <td style="width: 27%; padding: 0.5rem 0.75rem;">
          ${inputHtml}
        </td>
      </tr>
    `;
  });

  const contentDiv = document.getElementById('gias-urn-import-modal-content');
  if (!contentDiv) return;

  const dfeUrl = `https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/${urn}`;
  const perfUrl = `https://www.compare-school-performance.service.gov.uk/school/${urn}`;

  contentDiv.innerHTML = `
    <!-- Top Information Banner -->
    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <span style="background: ${isNew ? '#dcfce7' : '#e0f2fe'}; color: ${isNew ? '#15803d' : '#0369a1'}; padding: 0.25rem 0.6rem; border-radius: 9999px; font-size: 0.78rem; font-weight: 700;">
            <i class="fa-solid ${isNew ? 'fa-plus' : 'fa-arrows-rotate'}"></i> ${isNew ? 'New School Ingestion' : 'Updating Existing Database Record'}
          </span>
          <span style="font-weight: 700; color: #0c4a6e; font-size: 0.95rem;">
            ${escapeHtml(dfe.name)}
          </span>
        </div>
        <div style="display: flex; gap: 0.4rem; align-items: center;">
          <a href="${escapeHtml(dfeUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.2rem 0.5rem; color: #0284c7; border-color: #bae6fd; background: #ffffff;">
            <i class="fa-solid fa-landmark-dome"></i> Open DfE GIAS <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.65rem;"></i>
          </a>
          <a href="${escapeHtml(perfUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.2rem 0.5rem; color: #059669; border-color: #a7f3d0; background: #ffffff;">
            <i class="fa-solid fa-chart-line"></i> DfE Performance Table <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.65rem;"></i>
          </a>
          ${dfe.website ? `
            <a href="${escapeHtml(dfe.website)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.2rem 0.5rem; color: #2563eb; border-color: #bfdbfe; background: #ffffff;">
              <i class="fa-solid fa-globe"></i> Website <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.65rem;"></i>
            </a>
          ` : ''}
        </div>
      </div>
      ${curr ? `
        <div style="font-size: 0.8rem; color: #475569; margin-top: 0.4rem;">
          Matches existing database school ID: <code>${curr.id}</code> | Current Name: <strong>${escapeHtml(curr.name)}</strong> | Postcode: <strong>${escapeHtml(curr.postcode || 'N/A')}</strong>
        </div>
      ` : ''}
    </div>

    <!-- Batch Selection Toolbar -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
      <div style="font-size: 0.82rem; color: #64748b;">
        <i class="fa-solid fa-check-double"></i> Check fields to import from DfE, or directly edit the <strong>Final Value to Save</strong>:
      </div>
      <div style="display: flex; gap: 0.4rem;">
        <button type="button" class="btn btn-outline" onclick="setGiasFieldSelection('all')" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; color: #0369a1; border-color: #bae6fd; background: #f0f9ff;">
          <i class="fa-solid fa-check-square"></i> Select All DfE Fields
        </button>
        <button type="button" class="btn btn-outline" onclick="setGiasFieldSelection('diff')" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; color: #b45309; border-color: #fef08a; background: #fefce8;">
          <i class="fa-solid fa-code-compare"></i> Select Changed / Missing Only
        </button>
        <button type="button" class="btn btn-outline" onclick="setGiasFieldSelection('none')" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; color: #475569; border-color: #cbd5e1; background: #ffffff;">
          <i class="fa-regular fa-square"></i> Deselect All
        </button>
      </div>
    </div>

    <!-- Comparison and Editable Table -->
    <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
      <table class="quality-dedup-table">
        <thead>
          <tr>
            <th style="width: 22%;">Field (Check to Import)</th>
            <th style="width: 24%; color: #475569;"><i class="fa-solid fa-database"></i> Current Database Value</th>
            <th style="width: 27%; color: #0284c7;"><i class="fa-solid fa-landmark-dome"></i> Official DfE GIAS Fetched</th>
            <th style="width: 27%; color: #0f172a; background: #f1f5f9;"><i class="fa-solid fa-pen-to-square"></i> Final Value to Save (Editable)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('gias-urn-import-modal').style.display = 'flex';
}

function onGiasFieldCheckboxToggle(fieldKey) {
  if (!giasActiveLookupData) return;
  const { dfeSchool: dfe, existingSchool: curr } = giasActiveLookupData;
  const chk = document.getElementById(`gias_chk_${fieldKey}`);
  const inputEl = document.getElementById(`gias_val_${fieldKey}`);
  if (!chk || !inputEl) return;

  const fDef = GIAS_IMPORT_FIELDS.find(f => f.key === fieldKey);
  const targetVal = chk.checked ? (dfe[fieldKey] ?? '') : (curr ? (curr[fieldKey] ?? '') : '');

  if (fDef && fDef.isBool) {
    const isTrue = targetVal === true || targetVal === 'true' || targetVal === 1 || targetVal === '1';
    inputEl.value = isTrue ? 'true' : 'false';
  } else {
    inputEl.value = targetVal;
  }
}

function setGiasFieldSelection(mode) {
  if (!giasActiveLookupData) return;
  const { dfeSchool: dfe, existingSchool: curr, isNew } = giasActiveLookupData;

  GIAS_IMPORT_FIELDS.forEach(f => {
    const chk = document.getElementById(`gias_chk_${f.key}`);
    if (!chk) return;

    if (mode === 'all') {
      chk.checked = true;
    } else if (mode === 'none') {
      chk.checked = false;
    } else if (mode === 'diff') {
      const dfeVal = String(dfe[f.key] ?? '').trim().toLowerCase();
      const currVal = String(curr ? (curr[f.key] ?? '') : '').trim().toLowerCase();
      chk.checked = isNew || dfeVal !== currVal;
    }
    onGiasFieldCheckboxToggle(f.key);
  });
}

function closeGiasUrnImportModal() {
  const modal = document.getElementById('gias-urn-import-modal');
  if (modal) modal.style.display = 'none';
  giasActiveLookupData = null;
}

async function confirmGiasUrnImport() {
  if (!giasActiveLookupData) {
    showToast('No active GIAS URN lookup context.', 'error');
    return;
  }

  const { urn, existingSchool: curr } = giasActiveLookupData;
  const customData = {};

  GIAS_IMPORT_FIELDS.forEach(f => {
    const inputEl = document.getElementById(`gias_val_${f.key}`);
    const chk = document.getElementById(`gias_chk_${f.key}`);
    if (!inputEl) return;

    if (chk && chk.checked) {
      if (f.isBool) {
        customData[f.key] = inputEl.value === 'true';
      } else {
        customData[f.key] = inputEl.value.trim();
      }
    } else if (curr && curr[f.key] !== undefined) {
      customData[f.key] = curr[f.key];
    }
  });

  const confirmBtn = document.getElementById('modal-confirm-gias-import');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving to Database...';
  }

  try {
    const res = await fetch('/api/admin/quality/gias/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({
        urn,
        schoolId: curr?.id || null,
        customData
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'School record successfully saved!', 'success');
      closeGiasUrnImportModal();
      const input = document.getElementById('gias-lookup-urn-input');
      if (input) input.value = '';
      await loadGiasStatus();
      if (typeof loadSchools === 'function') await loadSchools();
    } else {
      showToast(data.error || 'Failed to save GIAS school record.', 'error');
    }
  } catch (err) {
    console.error('Error saving GIAS school record:', err);
    showToast('Exception saving GIAS school record.', 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Save &amp; Apply to Database';
    }
  }
}

async function runGiasBackfillTrigger() {
  const btn = document.getElementById('trigger-gias-backfill-btn');
  const log = document.getElementById('gias-output-log');
  const badge = document.getElementById('gias-activity-badge');
  if (btn) btn.disabled = true;
  if (badge) { badge.textContent = 'Running Backfill...'; badge.style.background = '#fef08a'; badge.style.color = '#854d0e'; }
  if (log) log.innerHTML = '⚡ Initiating DfE GIAS Master Registry ingestion & matching...\n';

  try {
    const res = await fetch('/api/admin/quality/gias/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      }
    });

    if (res.ok) {
      const data = await res.json();
      let logText = `✓ ${data.message}\n\nEnriched Schools Detail:\n`;
      (data.updatedSchools || []).forEach(s => {
        logText += `• ${s.name} (${s.id}) -> Updates: ${Object.keys(s.updates).join(', ')}\n`;
      });
      if (log) log.textContent = logText;
      if (badge) { badge.textContent = 'Completed'; badge.style.background = '#dcfce7'; badge.style.color = '#166534'; }
      showToast(`DfE GIAS Backfill enriched ${data.updatedCount} schools!`, 'success');
      await loadGiasStatus();
      await loadSchools();
    } else {
      if (log) log.textContent += '❌ Error executing DfE GIAS Backfill.';
      if (badge) { badge.textContent = 'Error'; badge.style.background = '#fee2e2'; badge.style.color = '#991b1b'; }
      showToast('Failed to run GIAS backfill.', 'error');
    }
  } catch (err) {
    console.error('GIAS backfill error:', err);
    if (log) log.textContent += `\n❌ Request exception: ${err.message}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- 2. Admissions Guardrails Controller ---
async function initAdmissionsGuardrailsTab() {
  const triggerBtn = document.getElementById('trigger-guardrails-audit-btn');
  if (triggerBtn && !triggerBtn._bound) {
    triggerBtn._bound = true;
    triggerBtn.addEventListener('click', runAdmissionsGuardrailsTrigger);
  }
  await loadGuardrailsStatus();
}

async function loadGuardrailsStatus() {
  try {
    const res = await fetch('/api/admin/quality/guardrails/status', {
      headers: { ...(currentSessionId ? { 'x-session-id': currentSessionId } : {}) }
    });
    if (res.ok) {
      const data = await res.json();
      if (document.getElementById('guardrails-stat-verified')) document.getElementById('guardrails-stat-verified').textContent = (data.totalSchools - data.staleCount).toLocaleString();
      if (document.getElementById('guardrails-stat-stale')) document.getElementById('guardrails-stat-stale').textContent = data.staleCount.toLocaleString();
      if (document.getElementById('guardrails-flagged-count')) document.getElementById('guardrails-flagged-count').textContent = `${data.staleCount} Flagged`;

      renderFlaggedGuardrailSchools(data.flaggedSchools || []);
    }
  } catch (err) {
    console.error('Failed to load guardrails status:', err);
  }
}

function renderFlaggedGuardrailSchools(flagged) {
  const container = document.getElementById('guardrails-flagged-table-container');
  if (!container) return;

  if (flagged.length === 0) {
    container.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: #166534; background: #f0fdf4;">✓ No stale dates or timeline inversions found. Database is 100% compliant with 2026/2027 cycle.</div>';
    return;
  }

  let html = `
    <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
      <thead>
        <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 600;">
          <th style="padding: 0.6rem 0.8rem;">School Name</th>
          <th style="padding: 0.6rem 0.8rem;">Type</th>
          <th style="padding: 0.6rem 0.8rem;">Region</th>
          <th style="padding: 0.6rem 0.8rem;">Flag Reason</th>
          <th style="padding: 0.6rem 0.8rem; text-align: right;">Action</th>
        </tr>
      </thead>
      <tbody>
  `;

  flagged.forEach(s => {
    html += `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 0.6rem 0.8rem; font-weight: 600; color: #1e293b;">${escapeHtml(s.name)}</td>
        <td style="padding: 0.6rem 0.8rem; color: #64748b;">${escapeHtml(s.schoolType || 'N/A')}</td>
        <td style="padding: 0.6rem 0.8rem; color: #64748b;">${escapeHtml(s.region || 'N/A')}</td>
        <td style="padding: 0.6rem 0.8rem;">
          <span class="badge" style="background: #fee2e2; color: #991b1b; font-size: 0.75rem;">📅 Stale 2023/24 Dates (Queued for 2026/27)</span>
        </td>
        <td style="padding: 0.6rem 0.8rem; text-align: right;">
          <button class="btn btn-outline" onclick="openSchoolDetail('${s.id}')" style="font-size: 0.75rem; padding: 0.25rem 0.55rem;">
            Inspect
          </button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

async function runAdmissionsGuardrailsTrigger() {
  const btn = document.getElementById('trigger-guardrails-audit-btn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/admin/quality/guardrails/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      }
    });

    if (res.ok) {
      const data = await res.json();
      showToast(data.message, 'success');
      await loadGuardrailsStatus();
      await loadSchools();
    } else {
      showToast('Failed to run admissions guardrails audit.', 'error');
    }
  } catch (err) {
    console.error('Guardrails trigger error:', err);
    showToast('Exception running guardrails audit.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- 3. Website Health Controller ---
let websiteHealthLastResults = [];
let websiteHealthFilterText = '';
let websiteHealthStatusFilter = 'ALL';
let currentWebHealthCategorySchools = [];
let webHealthModalSearchText = '';

async function initWebsiteHealthTab() {
  const triggerBtn = document.getElementById('trigger-website-health-btn');
  if (triggerBtn && !triggerBtn._bound) {
    triggerBtn._bound = true;
    triggerBtn.addEventListener('click', runWebsiteHealthTrigger);
  }

  const filterInput = document.getElementById('webhealth-filter-input');
  if (filterInput && !filterInput._bound) {
    filterInput._bound = true;
    filterInput.addEventListener('input', (e) => {
      websiteHealthFilterText = e.target.value.trim().toLowerCase();
      renderWebsiteHealthResultsTable();
    });
  }

  const statusFilter = document.getElementById('webhealth-status-filter');
  if (statusFilter && !statusFilter._bound) {
    statusFilter._bound = true;
    statusFilter.addEventListener('change', (e) => {
      websiteHealthStatusFilter = e.target.value;
      renderWebsiteHealthResultsTable();
    });
  }

  // Clickable Stat Cards for Drill-down
  const statCards = document.querySelectorAll('.webhealth-clickable-card');
  statCards.forEach(card => {
    if (!card._bound) {
      card._bound = true;
      card.addEventListener('click', () => {
        const cat = card.getAttribute('data-category') || 'registered';
        openWebsiteHealthCategoryModal(cat);
      });
    }
  });

  // Modal Close Handlers
  const modalCloseBtn = document.getElementById('modal-close-website-health-details');
  const modalCloseBtn2 = document.getElementById('btn-close-website-health-details');
  const modalOverlay = document.getElementById('modal-website-health-details');
  if (modalCloseBtn && !modalCloseBtn._bound) {
    modalCloseBtn._bound = true;
    modalCloseBtn.addEventListener('click', closeWebsiteHealthCategoryModal);
  }
  if (modalCloseBtn2 && !modalCloseBtn2._bound) {
    modalCloseBtn2._bound = true;
    modalCloseBtn2.addEventListener('click', closeWebsiteHealthCategoryModal);
  }
  if (modalOverlay && !modalOverlay._bound) {
    modalOverlay._bound = true;
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeWebsiteHealthCategoryModal();
    });
  }

  // Modal Live Search
  const modalSearch = document.getElementById('webhealth-modal-search');
  if (modalSearch && !modalSearch._bound) {
    modalSearch._bound = true;
    modalSearch.addEventListener('input', (e) => {
      webHealthModalSearchText = e.target.value.trim().toLowerCase();
      renderWebsiteHealthCategoryTable();
    });
  }

  await loadWebsiteHealthStatus();
}

async function loadWebsiteHealthStatus() {
  try {
    const res = await fetch('/api/admin/quality/website-health/status', {
      headers: { ...(currentSessionId ? { 'x-session-id': currentSessionId } : {}) }
    });
    if (res.ok) {
      const data = await res.json();
      if (document.getElementById('webhealth-stat-total')) document.getElementById('webhealth-stat-total').textContent = (data.registeredWebsites || 0).toLocaleString();
      if (document.getElementById('webhealth-stat-unscanned')) document.getElementById('webhealth-stat-unscanned').textContent = (data.unscannedWebsitesCount || 0).toLocaleString();
      if (document.getElementById('webhealth-stat-https')) document.getElementById('webhealth-stat-https').textContent = (data.httpsWebsitesCount || data.healthyWebsitesCount || 0).toLocaleString();
      if (document.getElementById('webhealth-stat-dead')) document.getElementById('webhealth-stat-dead').textContent = (data.deadWebsitesCount || 0).toLocaleString();
    }
  } catch (err) {
    console.error('Failed to load website health status:', err);
  }
}

let webHealthModalRenderLimit = 60;

async function openWebsiteHealthCategoryModal(category) {
  const modal = document.getElementById('modal-website-health-details');
  const titleEl = document.getElementById('webhealth-modal-title');
  const subEl = document.getElementById('webhealth-modal-subtitle');
  const countEl = document.getElementById('webhealth-modal-count');
  const tableBody = document.getElementById('webhealth-modal-table-body');
  const searchInput = document.getElementById('webhealth-modal-search');
  const loadMoreBox = document.getElementById('webhealth-modal-load-more');

  if (!modal) return;
  if (searchInput) searchInput.value = '';
  webHealthModalSearchText = '';
  webHealthModalRenderLimit = 60;

  modal.style.display = 'flex';
  modal.style.zIndex = '20000';
  modal.classList.add('active');

  if (loadMoreBox) loadMoreBox.style.display = 'none';

  if (tableBody) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 2.5rem; color: #64748b;">
          <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.4rem; color: #ec4899; margin-bottom: 0.5rem; display: block;"></i>
          Loading school records for category <strong>${escapeHtml(category)}</strong>...
        </td>
      </tr>
    `;
  }

  try {
    const token = currentSessionId || localStorage.getItem('school_db_session_id');
    const headers = {};
    if (token) {
      headers['x-session-id'] = token;
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`/api/admin/quality/website-health/category-schools?category=${encodeURIComponent(category)}`, {
      headers
    });
    if (res.ok) {
      const data = await res.json();
      currentWebHealthCategorySchools = data.schools || [];
      if (titleEl) titleEl.textContent = data.title || 'Website Health Breakdown';
      if (subEl) subEl.textContent = `Showing all ${currentWebHealthCategorySchools.length.toLocaleString()} schools matching category "${category}".`;
      renderWebsiteHealthCategoryTable();
    } else {
      if (tableBody) tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #dc2626; padding: 1.5rem;">Failed to load schools for this category (${res.status} ${res.statusText}).</td></tr>`;
    }
  } catch (err) {
    console.error('Error opening category modal:', err);
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #dc2626; padding: 1.5rem;">Error: ${err.message}</td></tr>`;
  }
}

function closeWebsiteHealthCategoryModal() {
  const modal = document.getElementById('modal-website-health-details');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

function loadMoreWebHealthModalRows() {
  webHealthModalRenderLimit += 60;
  renderWebsiteHealthCategoryTable();
}

window.openWebsiteHealthCategoryModal = openWebsiteHealthCategoryModal;
window.closeWebsiteHealthCategoryModal = closeWebsiteHealthCategoryModal;
window.loadMoreWebHealthModalRows = loadMoreWebHealthModalRows;

function renderWebsiteHealthCategoryTable() {
  const tableBody = document.getElementById('webhealth-modal-table-body');
  const countEl = document.getElementById('webhealth-modal-count');
  const loadMoreBox = document.getElementById('webhealth-modal-load-more');
  if (!tableBody) return;

  const filtered = currentWebHealthCategorySchools.filter(s => {
    if (!webHealthModalSearchText) return true;
    const q = webHealthModalSearchText;
    const matchName = (s.name || '').toLowerCase().includes(q);
    const matchWeb = (s.website || '').toLowerCase().includes(q);
    const matchPost = (s.postcode || '').toLowerCase().includes(q);
    const matchLa = (s.la || '').toLowerCase().includes(q);
    return matchName || matchWeb || matchPost || matchLa;
  });

  if (countEl) countEl.textContent = `${filtered.length.toLocaleString()} of ${currentWebHealthCategorySchools.length.toLocaleString()}`;

  if (filtered.length === 0) {
    if (loadMoreBox) loadMoreBox.style.display = 'none';
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 1.5rem; color: #64748b; font-style: italic;">
          No schools found matching "${escapeHtml(webHealthModalSearchText)}".
        </td>
      </tr>
    `;
    return;
  }

  const displaySlice = filtered.slice(0, webHealthModalRenderLimit);
  if (loadMoreBox) {
    loadMoreBox.style.display = filtered.length > webHealthModalRenderLimit ? 'block' : 'none';
  }

  tableBody.innerHTML = displaySlice.map(s => {
    let statusPill = '';
    if (s.isDead) {
      statusPill = `<span class="badge" style="background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px;"><i class="fa-solid fa-link-slash"></i> Dead Domain</span>`;
    } else if (s.isHttps) {
      statusPill = `<span class="badge" style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px;"><i class="fa-solid fa-shield-check"></i> Standard HTTPS</span>`;
    } else {
      statusPill = `<span class="badge" style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px;"><i class="fa-solid fa-triangle-exclamation"></i> Insecure HTTP</span>`;
    }

    const auditedBadge = s.isAudited
      ? `<span style="color: #166534; font-size: 0.75rem; font-weight: 600;"><i class="fa-solid fa-check"></i> Audited</span>`
      : `<span style="color: #854d0e; font-size: 0.75rem; font-weight: 600; background: #fef9c3; padding: 0.1rem 0.4rem; border-radius: 4px;"><i class="fa-solid fa-clock"></i> Unscanned</span>`;

    return `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 0.6rem 0.75rem;">
          <strong style="color: #1e293b; cursor: pointer;" onclick="openSchoolModal('${s.id}')" title="Inspect school details">${escapeHtml(s.name)}</strong>
          <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(s.la || '')} ${s.postcode ? `&bull; ${escapeHtml(s.postcode)}` : ''}</div>
        </td>
        <td style="padding: 0.6rem 0.75rem; max-width: 250px;">
          <a href="${escapeHtml(s.website)}" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; text-decoration: underline; word-break: break-all;" title="Open website in new tab">
            ${escapeHtml(s.website)} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.7rem; margin-left: 0.2rem;"></i>
          </a>
        </td>
        <td style="padding: 0.6rem 0.75rem; text-align: center;">
          ${statusPill}
        </td>
        <td style="padding: 0.6rem 0.75rem; text-align: center;">
          ${auditedBadge}
        </td>
        <td style="padding: 0.6rem 0.75rem; text-align: center;">
          <button type="button" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.74rem;" onclick="openSchoolModal('${s.id}')" title="Edit School Details">
            <i class="fa-solid fa-pen-to-square"></i> Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderWebsiteHealthResultsTable() {
  const tableWrapper = document.getElementById('website-health-table-wrapper');
  const tableBody = document.getElementById('website-health-table-body');
  const countEl = document.getElementById('webhealth-table-count');
  if (!tableWrapper || !tableBody) return;

  if (!websiteHealthLastResults || websiteHealthLastResults.length === 0) {
    tableWrapper.style.display = 'none';
    return;
  }

  tableWrapper.style.display = 'block';

  const filtered = websiteHealthLastResults.filter(item => {
    if (websiteHealthFilterText) {
      const q = websiteHealthFilterText.toLowerCase();
      const matchName = (item.schoolName || '').toLowerCase().includes(q);
      const matchUrl = (item.originalUrl || '').toLowerCase().includes(q) || (item.finalUrl || '').toLowerCase().includes(q);
      if (!matchName && !matchUrl) return false;
    }

    if (websiteHealthStatusFilter === 'DEAD') {
      return !item.isAlive || item.status === 'not_found' || item.status === 'error' || item.status === 'timeout';
    } else if (websiteHealthStatusFilter === 'UPGRADED') {
      return item.status === 'redirect' || (item.actionTaken && item.actionTaken.includes('Upgraded'));
    } else if (websiteHealthStatusFilter === 'HEALTHY') {
      return item.isAlive && item.status !== 'redirect';
    }
    return true;
  });

  if (countEl) countEl.textContent = `${filtered.length} of ${websiteHealthLastResults.length}`;

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 1.5rem; color: #64748b; font-style: italic;">
          No domain scan results match the selected filter.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(item => {
    let statusPill = '';
    if (item.statusCode >= 200 && item.statusCode < 300) {
      statusPill = `<span class="badge" style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px;"><i class="fa-solid fa-circle-check"></i> ${item.statusLabel || item.statusCode}</span>`;
    } else if (item.statusCode >= 300 && item.statusCode < 400) {
      statusPill = `<span class="badge" style="background: #e0f2fe; color: #075985; border: 1px solid #bae6fd; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px;"><i class="fa-solid fa-arrow-right-arrow-left"></i> ${item.statusLabel || item.statusCode}</span>`;
    } else if (item.status === 'not_found' || item.statusCode === 404) {
      statusPill = `<span class="badge" style="background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px;"><i class="fa-solid fa-circle-xmark"></i> ${item.statusLabel || '404 Broken'}</span>`;
    } else if (item.status === 'timeout') {
      statusPill = `<span class="badge" style="background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px;"><i class="fa-solid fa-clock"></i> Timeout</span>`;
    } else {
      statusPill = `<span class="badge" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px;"><i class="fa-solid fa-triangle-exclamation"></i> ${item.statusLabel || 'Error'}</span>`;
    }

    let actionPill = '';
    if (item.actionTaken === 'Auto-Upgraded to HTTPS') {
      actionPill = `<span style="color: #0369a1; font-weight: 700; font-size: 0.75rem; background: #f0f9ff; padding: 0.2rem 0.5rem; border-radius: 6px; border: 1px solid #e0f2fe;"><i class="fa-solid fa-shield-check"></i> Auto-Upgraded to HTTPS</span>`;
    } else if (item.actionTaken === 'Tagged dead_website') {
      actionPill = `<span style="color: #b91c1c; font-weight: 700; font-size: 0.75rem; background: #fef2f2; padding: 0.2rem 0.5rem; border-radius: 6px; border: 1px solid #fee2e2;"><i class="fa-solid fa-link-slash"></i> Tagged dead_website</span>`;
    } else {
      actionPill = `<span style="color: #166534; font-weight: 600; font-size: 0.75rem; background: #f0fdf4; padding: 0.2rem 0.5rem; border-radius: 6px; border: 1px solid #dcfce7;"><i class="fa-solid fa-check"></i> Verified Clean</span>`;
    }

    const latencyText = item.responseTimeMs !== undefined ? `${item.responseTimeMs}ms` : '—';

    return `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 0.6rem 0.75rem;">
          <strong style="color: #1e293b; cursor: pointer;" onclick="openSchoolModal('${item.schoolId}')" title="Click to view school details">${escapeHtml(item.schoolName)}</strong>
          ${item.postcode ? `<div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(item.postcode)}</div>` : ''}
        </td>
        <td style="padding: 0.6rem 0.75rem; max-width: 250px;">
          <a href="${escapeHtml(item.finalUrl || item.originalUrl)}" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; text-decoration: underline; word-break: break-all;" title="Open URL in new window">
            ${escapeHtml(item.finalUrl || item.originalUrl)} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.7rem; margin-left: 0.2rem;"></i>
          </a>
          ${item.finalUrl && item.finalUrl !== item.originalUrl ? `<div style="font-size: 0.72rem; color: #94a3b8; text-decoration: line-through;">${escapeHtml(item.originalUrl)}</div>` : ''}
        </td>
        <td style="padding: 0.6rem 0.75rem; text-align: center;">
          ${statusPill}
        </td>
        <td style="padding: 0.6rem 0.75rem; text-align: center; font-family: monospace; color: #64748b; font-size: 0.78rem;">
          ${latencyText}
        </td>
        <td style="padding: 0.6rem 0.75rem;">
          ${actionPill}
        </td>
        <td style="padding: 0.6rem 0.75rem; text-align: center;">
          <button type="button" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.74rem;" onclick="openSchoolModal('${item.schoolId}')" title="Inspect School Details">
            <i class="fa-solid fa-pen-to-square"></i> Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function runWebsiteHealthTrigger() {
  const btn = document.getElementById('trigger-website-health-btn');
  const limitSelect = document.getElementById('website-health-limit');
  const log = document.getElementById('website-health-output-log');
  const badge = document.getElementById('webhealth-status-badge');
  const limit = limitSelect ? parseInt(limitSelect.value, 10) : 50;

  if (btn) btn.disabled = true;
  if (badge) { badge.textContent = 'Auditing Links...'; badge.style.background = '#fef08a'; badge.style.color = '#854d0e'; }
  if (log) log.textContent = `⚡ Probing HTTP reachability and following redirects across ${limit} domains...\n`;

  try {
    const res = await fetch('/api/admin/quality/website-health/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ limit })
    });

    if (res.ok) {
      const data = await res.json();
      let logText = `✓ ${data.message}\n\n`;
      logText += `• Checked Domains: ${data.checkedCount}\n`;
      logText += `• Healthy Verified: ${data.healthyCount}\n`;
      logText += `• Upgraded to HTTPS: ${data.upgradedCount}\n`;
      logText += `• Dead / Unreachable: ${data.deadCount}\n`;
      if (log) log.textContent = logText;
      if (badge) { badge.textContent = 'Audit Complete'; badge.style.background = '#dcfce7'; badge.style.color = '#166534'; }
      
      websiteHealthLastResults = data.results || [];
      renderWebsiteHealthResultsTable();

      showToast(`Website Health Audit verified ${data.checkedCount} domains!`, 'success');
      await loadWebsiteHealthStatus();
    } else {
      showToast('Failed to run website health check.', 'error');
    }
  } catch (err) {
    console.error('Website health error:', err);
    if (log) log.textContent += `\n❌ Exception: ${err.message}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- 4. Deduplication & Linkage Controller ---
const QUALITY_DEDUP_MERGE_FIELDS = [
  { key: 'name', label: 'School Name' },
  { key: 'urn', label: 'DfE URN' },
  { key: 'schoolType', label: 'School Type' },
  { key: 'gender', label: 'Gender' },
  { key: 'ageRange', label: 'Age Range' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'address', label: 'Address' },
  { key: 'la', label: 'Local Authority' },
  { key: 'region', label: 'Region' },
  { key: 'ofstedRating', label: 'Ofsted Rating' },
  { key: 'entranceExamType', label: 'Entrance Exam Type' },
  { key: 'second_stage_exam_required', label: 'Stage 2 Exam Required', isBool: true },
  { key: 'website', label: 'Official Website' },
  { key: 'phone', label: 'Phone Number' },
  { key: 'email', label: 'Email' },
  { key: 'pupilCount', label: 'Pupil Count', isNumber: true },
  { key: 'gcseProgress8', label: 'Progress 8 Score', isNumber: true },
  { key: 'gcseAttainment8', label: 'Attainment 8 Score', isNumber: true },
  { key: 'feesTermly', label: 'Termly Fees (£)' },
  { key: 'admissionsPolicy', label: 'Admissions Policy' },
  { key: 'description', label: 'Description', isTextarea: true },
  { key: 'active', label: 'Operating Status (Active vs Closed)', isBool: true },
  { key: 'hot', label: 'Hot School Status', isBool: true },
  { key: 'official', label: 'Official DfE GIAS Record', isBool: true }
];

let qualityDedupActivePair = null;

async function initDeduplicationTab() {
  const triggerBtn = document.getElementById('run-quality-dedup-scan-btn');
  if (triggerBtn && !triggerBtn._bound) {
    triggerBtn._bound = true;
    triggerBtn.addEventListener('click', () => runDeduplicationCandidatesScan(true));
  }

  // Bind modal buttons
  const closeBtn = document.getElementById('modal-close-quality-dedup-merge');
  if (closeBtn && !closeBtn._bound) {
    closeBtn._bound = true;
    closeBtn.addEventListener('click', closeQualityDedupMergeModal);
  }
  const cancelBtn = document.getElementById('modal-cancel-quality-dedup-merge');
  if (cancelBtn && !cancelBtn._bound) {
    cancelBtn._bound = true;
    cancelBtn.addEventListener('click', closeQualityDedupMergeModal);
  }
  const confirmBtn = document.getElementById('modal-confirm-quality-dedup-merge');
  if (confirmBtn && !confirmBtn._bound) {
    confirmBtn._bound = true;
    confirmBtn.addEventListener('click', confirmQualityDedupMerge);
  }

  // Bind toggle reviewed pairs button
  const toggleReviewedBtn = document.getElementById('toggle-reviewed-pairs-btn');
  if (toggleReviewedBtn && !toggleReviewedBtn._bound) {
    toggleReviewedBtn._bound = true;
    toggleReviewedBtn.addEventListener('click', () => {
      const container = document.getElementById('reviewed-pairs-container');
      if (!container) return;
      const isHidden = container.style.display === 'none';
      container.style.display = isHidden ? 'block' : 'none';
      toggleReviewedBtn.innerHTML = isHidden
        ? '<i class="fa-solid fa-chevron-up"></i> Hide Dismissed Pairs'
        : '<i class="fa-solid fa-chevron-down"></i> Show Dismissed Pairs';
      if (isHidden) loadReviewedPairsList();
    });
  }

  loadReviewedPairsList();
  await runDeduplicationCandidatesScan(false);
}

async function runDeduplicationCandidatesScan(forceScan = false) {
  const container = document.getElementById('quality-dedup-pairs-container');
  if (container) {
    container.innerHTML = forceScan
      ? '<div style="text-align: center; color: #8b5cf6; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.8rem;"></i><p style="margin-top: 0.5rem;">Running deduplication scan across 6,489 schools...</p></div>'
      : '<div style="text-align: center; color: #94a3b8; padding: 2rem;"><i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.8rem;"></i><p style="margin-top: 0.5rem;">Loading persisted duplicate candidates...</p></div>';
  }

  try {
    const url = forceScan ? '/api/admin/quality/deduplication/scan' : '/api/admin/quality/deduplication/candidates';
    const res = await fetch(url, {
      method: forceScan ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      }
    });

    if (res.ok) {
      const data = await res.json();
      window._qualityDedupPairs = data.candidatePairs || [];
      renderDeduplicationCandidatePairs(window._qualityDedupPairs, data.correctionsQueueCount || 0, data.enrichmentQueueCount || 0, data.scannedAt, data.hasScanned);
      if (forceScan) {
        showToast(data.message || 'Deduplication scan completed.', 'success');
      }
    } else {
      if (container) container.innerHTML = '<div style="color: #ef4444; padding: 1.5rem;">Failed to fetch duplicate candidates.</div>';
    }
  } catch (err) {
    console.error('Failed to scan duplicate candidates:', err);
  }
}

function renderDeduplicationCandidatePairs(pairs, correctionsCount = 0, enrichmentCount = 0, scannedAt = null, hasScanned = true) {
  const container = document.getElementById('quality-dedup-pairs-container');
  if (!container) return;

  let queueSummaryHtml = '';
  if (correctionsCount > 0 || enrichmentCount > 0 || scannedAt) {
    queueSummaryHtml = `
      <div style="display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center;">
        ${scannedAt ? `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.45rem 0.75rem; font-size: 0.78rem; color: #475569;"><i class="fa-solid fa-clock-rotate-left"></i> Last Scanned: <strong>${new Date(scannedAt).toLocaleString()}</strong></div>` : ''}
        ${correctionsCount > 0 ? `<div style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 0.45rem 0.75rem; font-size: 0.78rem; color: #991b1b; display: flex; align-items: center; gap: 0.4rem;"><i class="fa-solid fa-triangle-exclamation"></i> <span><strong>${correctionsCount}</strong> conflicting matches in <strong>Corrections Queue</strong></span></div>` : ''}
        ${enrichmentCount > 0 ? `<div style="background: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 0.45rem 0.75rem; font-size: 0.78rem; color: #1e40af; display: flex; align-items: center; gap: 0.4rem;"><i class="fa-solid fa-cloud-arrow-down"></i> <span><strong>${enrichmentCount}</strong> sparse records in <strong>Enrichment Queue</strong></span></div>` : ''}
      </div>
    `;
  }

  if (hasScanned === false && pairs.length === 0) {
    container.innerHTML = `
      <div style="padding: 2.5rem 1rem; text-align: center; color: #6d28d9; background: #faf5ff; border-radius: 10px; border: 1px solid #e9d5ff;">
        <i class="fa-solid fa-clone" style="font-size: 2.2rem; margin-bottom: 0.6rem; color: #7c3aed;"></i>
        <div style="font-weight: 700; font-size: 1rem; color: #581c87;">Duplicate Detection Scan Not Run Yet</div>
        <div style="font-size: 0.85rem; color: #7e22ce; margin-top: 0.35rem; max-width: 520px; margin-left: auto; margin-right: auto;">
          Click the scan button to cross-check all 6,489 schools for duplicate profile pairs using multi-attribute overlap.
        </div>
        <button type="button" class="btn btn-primary" onclick="runDeduplicationCandidatesScan(true)" style="background: #7c3aed; border-color: #7c3aed; margin-top: 0.6rem; font-size: 0.85rem; padding: 0.45rem 1.1rem;">
          <i class="fa-solid fa-play"></i> Run Deduplication Scan Now
        </button>
      </div>
    `;
    return;
  }

  if (pairs.length === 0) {
    container.innerHTML = `
      ${queueSummaryHtml}
      <div style="padding: 2rem; text-align: center; color: #166534; background: #f0fdf4; border-radius: 8px; border: 1px solid #dcfce7;">
        <i class="fa-solid fa-circle-check" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
        <div style="font-weight: 600;">No genuine duplicate profiles found.</div>
        <div style="font-size: 0.85rem; color: #15803d; margin-top: 0.25rem;">All active school records meet multi-attribute uniqueness standards. Partial matches have been safely routed to corrections and enrichment queues.</div>
      </div>
    `;
    return;
  }

  let html = `
    ${queueSummaryHtml}
    <div style="font-size: 0.9rem; color: #64748b; margin-bottom: 0.75rem;">
      Found <strong>${pairs.length}</strong> genuine duplicate candidate pairs with significant multi-attribute overlap:
    </div>
    <div style="display: flex; flex-direction: column; gap: 1rem;">
  `;

  pairs.forEach((p, idx) => {
    const score = p.compositeScore || Math.round((p.similarity || 0.9) * 100);
    html += `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-weight: 700; color: #8b5cf6; font-size: 0.85rem;">
              <i class="fa-solid fa-clone"></i> Pair #${idx + 1}
            </span>
            <span style="background: #ede9fe; color: #6d28d9; padding: 0.2rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700;">
              ${score}% Match Overlap
            </span>
          </div>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <button class="btn btn-outline" onclick="markPairAsReviewed('${p.schoolA.id}', '${p.schoolB.id}')" style="font-size: 0.78rem; padding: 0.3rem 0.65rem; color: #059669; border-color: #a7f3d0;" title="Mark this pair as reviewed distinct schools so it will not be detected in future scans">
              <i class="fa-solid fa-shield-check"></i> Not a Duplicate
            </button>
            <button class="btn btn-primary" onclick="openQualityDedupMergeModal(${idx})" style="background: #8b5cf6; border-color: #8b5cf6; font-size: 0.78rem; padding: 0.3rem 0.7rem;">
              <i class="fa-solid fa-code-merge"></i> Review &amp; Merge
            </button>
          </div>
        </div>
        <div style="font-size: 0.8rem; color: #64748b; margin-bottom: 0.6rem;">${escapeHtml(p.reason)}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="font-size: 0.75rem; font-weight: 700; color: #2563eb; margin-bottom: 0.25rem;">PRIMARY (A)</div>
              <div style="font-weight: 600; color: #1e293b;">${escapeHtml(p.schoolA.name)}</div>
              <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">
                Postcode: <strong>${escapeHtml(p.schoolA.postcode || 'N/A')}</strong> | URN: <strong>${escapeHtml(p.schoolA.urn || 'N/A')}</strong> | Gender: <strong>${escapeHtml(p.schoolA.gender || 'N/A')}</strong>
              </div>
            </div>
            ${renderQuickAccessInvestigationLinks(p.schoolA)}
          </div>
          <div style="background: #faf5ff; border: 1px solid #f3e8ff; border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="font-size: 0.75rem; font-weight: 700; color: #8b5cf6; margin-bottom: 0.25rem;">CANDIDATE (B)</div>
              <div style="font-weight: 600; color: #1e293b;">${escapeHtml(p.schoolB.name)}</div>
              <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">
                Postcode: <strong>${escapeHtml(p.schoolB.postcode || 'N/A')}</strong> | URN: <strong>${escapeHtml(p.schoolB.urn || 'N/A')}</strong> | Gender: <strong>${escapeHtml(p.schoolB.gender || 'N/A')}</strong>
              </div>
            </div>
            ${renderQuickAccessInvestigationLinks(p.schoolB)}
          </div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

function openQualityDedupMergeModal(pairIdx) {
  const pair = (window._qualityDedupPairs || [])[pairIdx];
  if (!pair) {
    showToast('Duplicate pair data not found.', 'error');
    return;
  }

  const { schoolA: recA, schoolB: recB } = pair;
  qualityDedupActivePair = { pairIdx, schoolA: recA, schoolB: recB };

  const score = pair.compositeScore || Math.round((pair.similarity || 0.9) * 100);

  let matchCount = 0;
  let diffCount = 0;
  let enrichedCount = 0;

  let rowsHtml = '';
  QUALITY_DEDUP_MERGE_FIELDS.forEach(f => {
    const rawA = recA[f.key] ?? '';
    const rawB = recB[f.key] ?? '';
    const strA = String(rawA).trim();
    const strB = String(rawB).trim();

    const isMatch = strA.toLowerCase() === strB.toLowerCase();
    const isEnriched = !strA && !!strB;

    if (isMatch) matchCount++;
    else diffCount++;
    if (isEnriched) enrichedCount++;

    const defaultSource = (!strA && !!strB) ? 'b' : 'a';
    const defaultVal = defaultSource === 'b' ? rawB : rawA;

    const cellClassA = isMatch ? 'quality-dedup-cell-match' : (!strA ? '' : 'quality-dedup-cell-diff');
    const cellClassB = isMatch ? 'quality-dedup-cell-match' : (isEnriched ? 'quality-dedup-cell-enriched' : 'quality-dedup-cell-diff');

    let inputHtml = '';
    if (f.isTextarea) {
      inputHtml = `<textarea id="qdedup_val_${f.key}" class="form-control" rows="2" style="font-size:0.82rem; width:100%; resize:vertical; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid #cbd5e1;">${escapeHtml(String(defaultVal || ''))}</textarea>`;
    } else if (f.isBool) {
      const isChecked = defaultVal === true || defaultVal === 1 || defaultVal === '1' || defaultVal === 'true';
      inputHtml = `
        <select id="qdedup_val_${f.key}" class="form-control" style="font-size:0.82rem; width:100%; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid #cbd5e1;">
          <option value="true" ${isChecked ? 'selected' : ''}>Yes / Active</option>
          <option value="false" ${!isChecked ? 'selected' : ''}>No / Standard</option>
        </select>
      `;
    } else {
      inputHtml = `<input type="${f.isNumber ? 'number' : 'text'}" ${f.isNumber ? 'step="any"' : ''} id="qdedup_val_${f.key}" class="form-control" value="${escapeHtml(String(defaultVal ?? ''))}" style="font-size:0.82rem; width:100%; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid #cbd5e1;">`;
    }

    rowsHtml += `
      <tr class="${!isMatch ? 'quality-dedup-row-diff' : ''}" id="qdedup_row_${f.key}">
        <td style="font-weight:600; width:18%; color:#1e293b;">
          <div>${escapeHtml(f.label)}</div>
          <div style="margin-top:0.2rem;">
            ${isMatch
              ? '<span class="status-badge-match" style="font-size:0.7rem;"><i class="fa-solid fa-check"></i> Match</span>'
              : (isEnriched
                ? '<span style="background:#dbeafe; color:#1e40af; padding:0.15rem 0.4rem; border-radius:4px; font-size:0.7rem; font-weight:700;"><i class="fa-solid fa-plus"></i> Enriched from B</span>'
                : '<span class="status-badge-diff" style="font-size:0.7rem;"><i class="fa-solid fa-code-compare"></i> Conflict</span>')}
          </div>
        </td>
        <td class="${cellClassA}" style="width:27%; border-radius:6px; padding:0.5rem;">
          <label style="display:flex; align-items:flex-start; gap:0.5rem; cursor:pointer; font-size:0.82rem; margin:0;">
            <input type="radio" name="qdedup_radio_${f.key}" value="a" ${defaultSource === 'a' ? 'checked' : ''} onchange="onQualityDedupRadioChange('${f.key}', 'a')" style="accent-color:#2563eb; margin-top:0.2rem;">
            <span style="word-break:break-word; color:#334155;">${escapeHtml(strA) || '<em style="color:#94a3b8;">(Empty)</em>'}</span>
          </label>
        </td>
        <td class="${cellClassB}" style="width:27%; border-radius:6px; padding:0.5rem;">
          <label style="display:flex; align-items:flex-start; gap:0.5rem; cursor:pointer; font-size:0.82rem; margin:0;">
            <input type="radio" name="qdedup_radio_${f.key}" value="b" ${defaultSource === 'b' ? 'checked' : ''} onchange="onQualityDedupRadioChange('${f.key}', 'b')" style="accent-color:#8b5cf6; margin-top:0.2rem;">
            <span style="word-break:break-word; color:#334155;">${escapeHtml(strB) || '<em style="color:#94a3b8;">(Empty)</em>'}</span>
          </label>
        </td>
        <td style="width:28%; padding:0.5rem;">
          ${inputHtml}
        </td>
      </tr>
    `;
  });

  const contentDiv = document.getElementById('quality-dedup-merge-modal-content');
  if (!contentDiv) return;

  contentDiv.innerHTML = `
    <!-- Comparison Header Banner -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.6rem;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <span style="background: #ede9fe; color: #6d28d9; padding: 0.25rem 0.6rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 700;">
            <i class="fa-solid fa-code-merge"></i> ${score}% Match Overlap
          </span>
          <span style="font-size: 0.82rem; color: #475569;">
            ${escapeHtml(pair.reason || 'Candidate duplicate pair identified by multi-attribute link analyzer.')}
          </span>
        </div>
        <div style="display: flex; gap: 0.4rem; font-size: 0.75rem;">
          <span style="background: #dcfce7; color: #15803d; padding: 0.2rem 0.5rem; border-radius: 6px; font-weight: 600;">
            ${matchCount} Matching
          </span>
          <span style="background: #fef3c7; color: #b45309; padding: 0.2rem 0.5rem; border-radius: 6px; font-weight: 600;">
            ${diffCount} Conflicting
          </span>
          ${enrichedCount > 0 ? `<span style="background: #dbeafe; color: #1e40af; padding: 0.2rem 0.5rem; border-radius: 6px; font-weight: 600;">${enrichedCount} Enriched</span>` : ''}
        </div>
      </div>

      <!-- Side-by-Side School Headers with Links -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 0.6rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem;">
            <span style="font-weight: 700; color: #1d4ed8; font-size: 0.8rem;"><i class="fa-solid fa-a"></i> PRIMARY RECORD (A)</span>
            <code style="background: #ffffff; color: #1e40af; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.72rem;">ID: ${recA.id}</code>
          </div>
          <div style="font-weight: 600; color: #1e293b; font-size: 0.88rem;">${escapeHtml(recA.name)}</div>
          ${renderQuickAccessInvestigationLinks(recA)}
        </div>
        <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 6px; padding: 0.6rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem;">
            <span style="font-weight: 700; color: #7e22ce; font-size: 0.8rem;"><i class="fa-solid fa-b"></i> CANDIDATE RECORD (B)</span>
            <code style="background: #ffffff; color: #6b21a8; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.72rem;">ID: ${recB.id}</code>
          </div>
          <div style="font-weight: 600; color: #1e293b; font-size: 0.88rem;">${escapeHtml(recB.name)}</div>
          ${renderQuickAccessInvestigationLinks(recB)}
        </div>
      </div>
    </div>

    <!-- Quick Batch Selection Toolbar -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
      <div style="font-size: 0.82rem; color: #64748b;">
        <i class="fa-solid fa-hand-pointer"></i> Select radio options to pick field values, or directly type/edit the <strong>Final Merged Value</strong>:
      </div>
      <div style="display: flex; gap: 0.4rem;">
        <button type="button" class="btn btn-outline" onclick="setQualityDedupAll('a')" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; color: #1d4ed8; border-color: #bfdbfe; background: #eff6ff;">
          <i class="fa-solid fa-a"></i> Use All Primary (A)
        </button>
        <button type="button" class="btn btn-outline" onclick="setQualityDedupAll('b')" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; color: #7e22ce; border-color: #e9d5ff; background: #faf5ff;">
          <i class="fa-solid fa-b"></i> Use All Candidate (B)
        </button>
        <button type="button" class="btn btn-outline" onclick="setQualityDedupSmartFill()" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; color: #059669; border-color: #a7f3d0; background: #ecfdf5;">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Smart Fill (Keep Non-Empty)
        </button>
      </div>
    </div>

    <!-- Comparison & Interactive Edit Table -->
    <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
      <table class="quality-dedup-table">
        <thead>
          <tr>
            <th style="width: 18%;">Field</th>
            <th style="width: 27%; color: #1d4ed8;"><i class="fa-solid fa-a"></i> Source A (Primary)</th>
            <th style="width: 27%; color: #7e22ce;"><i class="fa-solid fa-b"></i> Source B (Candidate)</th>
            <th style="width: 28%; color: #0f172a; background: #f1f5f9;"><i class="fa-solid fa-pen-to-square"></i> Final Merged Value (Editable)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('quality-dedup-merge-modal').style.display = 'flex';
}

function onQualityDedupRadioChange(fieldKey, source) {
  if (!qualityDedupActivePair) return;
  const { schoolA, schoolB } = qualityDedupActivePair;
  const targetSchool = source === 'b' ? schoolB : schoolA;
  const inputEl = document.getElementById(`qdedup_val_${fieldKey}`);
  if (!inputEl) return;

  const fDef = QUALITY_DEDUP_MERGE_FIELDS.find(f => f.key === fieldKey);
  const rawVal = targetSchool[fieldKey] ?? '';

  if (fDef && fDef.isBool) {
    const isTrue = rawVal === true || rawVal === 1 || rawVal === '1' || rawVal === 'true';
    inputEl.value = isTrue ? 'true' : 'false';
  } else {
    inputEl.value = rawVal;
  }
}

function setQualityDedupAll(source) {
  if (!qualityDedupActivePair) return;
  QUALITY_DEDUP_MERGE_FIELDS.forEach(f => {
    const radio = document.querySelector(`input[name="qdedup_radio_${f.key}"][value="${source}"]`);
    if (radio) {
      radio.checked = true;
      onQualityDedupRadioChange(f.key, source);
    }
  });
}

function setQualityDedupSmartFill() {
  if (!qualityDedupActivePair) return;
  const { schoolA, schoolB } = qualityDedupActivePair;

  QUALITY_DEDUP_MERGE_FIELDS.forEach(f => {
    const rawA = schoolA[f.key] ?? '';
    const rawB = schoolB[f.key] ?? '';
    const strA = String(rawA).trim();
    const strB = String(rawB).trim();

    const choice = (!strA && !!strB) ? 'b' : 'a';
    const radio = document.querySelector(`input[name="qdedup_radio_${f.key}"][value="${choice}"]`);
    if (radio) {
      radio.checked = true;
      onQualityDedupRadioChange(f.key, choice);
    }
  });
}

function closeQualityDedupMergeModal() {
  const modal = document.getElementById('quality-dedup-merge-modal');
  if (modal) modal.style.display = 'none';
  qualityDedupActivePair = null;
}

async function confirmQualityDedupMerge() {
  if (!qualityDedupActivePair) {
    showToast('No active deduplication pair selected.', 'error');
    return;
  }

  const { schoolA, schoolB } = qualityDedupActivePair;
  const mergedRecord = {};

  QUALITY_DEDUP_MERGE_FIELDS.forEach(f => {
    const inputEl = document.getElementById(`qdedup_val_${f.key}`);
    if (!inputEl) return;

    if (f.isBool) {
      mergedRecord[f.key] = inputEl.value === 'true';
    } else if (f.isNumber) {
      const valStr = inputEl.value.trim();
      mergedRecord[f.key] = valStr === '' ? null : (isNaN(Number(valStr)) ? valStr : Number(valStr));
    } else {
      mergedRecord[f.key] = inputEl.value;
    }
  });

  await executeAtomicMerge(schoolA.id, schoolB.id, mergedRecord);
}

async function executeAtomicMerge(primaryId, secondaryId, mergedRecord = null) {
  if (!mergedRecord) {
    if (!confirm(`Are you sure you want to merge these two records? Primary will absorb missing details and secondary will be safely removed.`)) return;
  }

  const confirmBtn = document.getElementById('modal-confirm-quality-dedup-merge');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Merging Records...';
  }

  try {
    const res = await fetch('/api/admin/quality/deduplication/merge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ primaryId, secondaryId, mergedRecord })
    });

    if (res.ok) {
      const data = await res.json();
      showToast(data.message || 'Records merged successfully!', 'success');
      closeQualityDedupMergeModal();
      await runDeduplicationCandidatesScan();
      if (typeof loadSchools === 'function') await loadSchools();
    } else {
      const errData = await res.json().catch(() => ({}));
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Confirm &amp; Merge Records';
      }
    }
  } catch (err) {
    console.error('Merge error:', err);
    showToast('Exception executing merge operation.', 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Confirm &amp; Merge Records';
    }
  }
}

async function markPairAsReviewed(schoolAId, schoolBId, schoolAName = '', schoolBName = '') {
  // Resolve names from active candidate/conflict caches if not passed
  let nameA = schoolAName;
  let nameB = schoolBName;
  if (!nameA || !nameB) {
    if (Array.isArray(window._qualityDedupPairs)) {
      const pair = window._qualityDedupPairs.find(p =>
        (p.schoolA?.id === schoolAId && p.schoolB?.id === schoolBId) ||
        (p.schoolA?.id === schoolBId && p.schoolB?.id === schoolAId)
      );
      if (pair) {
        nameA = nameA || pair.schoolA?.name;
        nameB = nameB || pair.schoolB?.name;
      }
    }
    if ((!nameA || !nameB) && Array.isArray(window._qualityCorrectionsQueue)) {
      const pair = window._qualityCorrectionsQueue.find(p =>
        (p.schoolA?.id === schoolAId && p.schoolB?.id === schoolBId) ||
        (p.schoolA?.id === schoolBId && p.schoolB?.id === schoolAId)
      );
      if (pair) {
        nameA = nameA || pair.schoolA?.name;
        nameB = nameB || pair.schoolB?.name;
      }
    }
  }

  const displayNameA = nameA || schoolAId;
  const displayNameB = nameB || schoolBId;

  if (!confirm(`Mark "${displayNameA}" and "${displayNameB}" as reviewed distinct schools?\n\nThis will remove them from the duplicate/conflict queue and permanently prevent future candidate alerts.`)) {
    return;
  }

  try {
    const res = await fetch('/api/admin/quality/deduplication/mark-reviewed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({
        schoolAId,
        schoolBId,
        schoolAName: nameA,
        schoolBName: nameB,
        decision: 'not_duplicate',
        reason: 'Confirmed distinct schools by admin review.'
      })
    });

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new Error('API route not found (404). Please restart the server ("npm start" in your terminal) to load the new route.');
      } else {
        throw new Error(`Server returned HTTP ${res.status}: ${text.slice(0, 100)}`);
      }
    }

    if (res.ok && data && data.success) {
      showToast(data.message || 'Marked pair as reviewed.', 'success');
      try {
        if (typeof runDeduplicationCandidatesScan === 'function') await runDeduplicationCandidatesScan(false);
      } catch (e) { console.warn(e); }
      try {
        if (typeof loadSystemCorrectionsQueue === 'function') await loadSystemCorrectionsQueue(false);
      } catch (e) { console.warn(e); }
      try {
        await loadReviewedPairsList();
      } catch (e) { console.warn(e); }
    } else {
      showToast((data && data.error) ? data.error : 'Failed to mark pair as reviewed.', 'error');
    }
  } catch (err) {
    console.error('Error marking pair as reviewed:', err);
    showToast(err.message || 'Exception marking pair as reviewed.', 'error');
  }
}

async function loadReviewedPairsList() {
  const container = document.getElementById('reviewed-pairs-container');
  const countPill = document.getElementById('reviewed-pairs-count-pill');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/quality/deduplication/reviewed-pairs', {
      headers: { ...(currentSessionId ? { 'x-session-id': currentSessionId } : {}) }
    });

    if (!res.ok) {
      if (countPill) countPill.textContent = '0 pairs';
      return;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (countPill) countPill.textContent = '0 pairs';
      return;
    }

    const data = await res.json();
    const pairs = data.reviewedPairs || [];

    if (countPill) {
      countPill.textContent = `${pairs.length} ${pairs.length === 1 ? 'pair' : 'pairs'}`;
    }

    if (pairs.length === 0) {
      container.innerHTML = `
        <div style="padding: 1.5rem; text-align: center; color: #64748b; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 0.85rem;">
          <i class="fa-solid fa-clipboard-check" style="font-size: 1.3rem; color: #94a3b8; display: block; margin-bottom: 0.35rem;"></i>
          No candidate pairs have been marked as reviewed yet.
        </div>
      `;
      return;
    }

    let html = `
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
    `;

    pairs.forEach((p, idx) => {
      html += `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.45rem; margin-bottom: 0.25rem;">
              <span style="font-weight: 700; color: #0f172a; font-size: 0.88rem;">
                ${escapeHtml(p.school_a_name || p.school_a_id)} <span style="color:#94a3b8; font-weight:400;">vs</span> ${escapeHtml(p.school_b_name || p.school_b_id)}
              </span>
              <span style="font-size: 0.7rem; font-weight: 700; background: #dcfce7; color: #166534; padding: 0.12rem 0.45rem; border-radius: 4px;">
                <i class="fa-solid fa-check"></i> Not Duplicate
              </span>
            </div>
            <div style="font-size: 0.75rem; color: #64748b;">
              Reviewed by <strong>${escapeHtml(p.reviewed_by || 'admin')}</strong> on ${new Date(p.reviewed_at).toLocaleDateString()} • Reason: <em>${escapeHtml(p.reason || 'Distinct schools')}</em>
            </div>
          </div>
          <button type="button" class="btn btn-outline" onclick="unmarkReviewedPair('${p.pair_id}')" style="font-size: 0.76rem; padding: 0.3rem 0.65rem; color: #dc2626; border-color: #fca5a5;">
            <i class="fa-solid fa-rotate-left"></i> Unmark / Re-evaluate
          </button>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    console.error('Error loading reviewed pairs:', err);
  }
}

async function unmarkReviewedPair(pairId) {
  if (!confirm('Remove this pair from the reviewed list? It will be re-evaluated on the next deduplication scan.')) return;

  try {
    const res = await fetch('/api/admin/quality/deduplication/unmark-reviewed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentSessionId ? { 'x-session-id': currentSessionId } : {})
      },
      body: JSON.stringify({ pairId })
    });

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text().catch(() => '');
      throw new Error(`Server returned HTTP ${res.status}: ${text.slice(0, 100)}`);
    }

    if (res.ok && data && data.success) {
      showToast(data.message || 'Pair un-marked.', 'success');
      await loadReviewedPairsList();
    } else {
      showToast((data && data.error) ? data.error : 'Failed to unmark pair.', 'error');
    }
  } catch (err) {
    console.error('Error unmarking pair:', err);
    showToast(err.message || 'Exception unmarking pair.', 'error');
  }
}
