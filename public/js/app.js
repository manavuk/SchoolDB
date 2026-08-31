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
  } else {
    showGatekeeperLoginScreen();
  }

  // 3. Register DOM event listeners
  setupEventListeners();

  // 4. Fetch initial school catalog, stats & system settings before UI permission routing
  await fetchSystemSettings();
  await fetchStats();
  await loadSchools();
  loadAdminSettings();
  populateManualMergeDropdowns();

  // 5. Fetch user portfolio & load application data
  if (authenticated) {
    await loadUserPortfolio(currentUserAccount);
    await loadUserRecProfile();
    applyPermissionsUI();
  }

  // 6. Always fetch & render recommendations on load so landing page is populated with top schools immediately
  await fetchRecommendations();
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

// Trigger Google Sign-In Workflow across application
function triggerGoogleSignInWorkflow(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }

  const overlay = document.getElementById('auth-gatekeeper-overlay');
  if (overlay) overlay.style.display = 'none';

  // Direct redirect to Google OAuth 2.0 Protocol for Google Verification
  window.location.href = '/api/auth/google';
}

// Show full-screen unauthenticated login screen
function showGatekeeperLoginScreen() {
  document.documentElement.classList.remove('session-pending');
  const overlay = document.getElementById('auth-gatekeeper-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
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
  if (overlay) overlay.style.display = 'none';
  const loginModal = document.getElementById('auth-login-modal');
  if (loginModal) loginModal.style.display = 'none';
  const signupModal = document.getElementById('auth-signup-modal');
  if (signupModal) signupModal.style.display = 'none';
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
  // 1. Admin lands on Admin Portal
  // 2. If Parent Portal 2.0 is enabled and user is logged in, land on Parent Portal 2.0
  // 3. Otherwise land on Classic Portal (recommend)
  if (canViewAdmin) {
    switchTab('admin');
  } else if (isP2Enabled && currentUserAccount) {
    switchTab('parent2');
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

  renderActiveFilterChips();

  const queryParams = new URLSearchParams();
  if (search) queryParams.append('search', search);
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
          ${school.hot ? `<span class="badge-hot"><i class="fa-solid fa-fire"></i> Hot</span>` : ''}
        </div>
        <h3 class="school-name">${school.name}</h3>
        <div class="school-location">
          <i class="fa-solid fa-location-dot"></i> ${school.la}, ${school.postcode || ''}
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
          ${school.hot ? `<span class="badge-hot" style="font-size:0.68rem; padding:0.1rem 0.4rem; margin-left:0.4rem; display:inline-flex;"><i class="fa-solid fa-fire"></i>&nbsp;Hot</span>` : ''}
        </div>
        ${tagBadgesHtml ? `<div style="display:flex; gap:0.25rem; flex-wrap:wrap; margin-top:0.25rem;">${tagBadgesHtml}</div>` : ''}
      </td>

      <td class="nowrap-cell" title="${fullLA.replace(/"/g, '&quot;')}">${displayLA}</td>

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
      triggerGoogleSignInWorkflow();
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
    'second-stage-select', 'confidence-select', 'fee-select'
  ];
  filterInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadSchools);
  });

  const searchInputEl = document.getElementById('search-input');
  if (searchInputEl) {
    searchInputEl.addEventListener('input', debounce(loadSchools, 300));
  }

  // Reset Filters
  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
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
  { key: 'gender',                      label: 'Gender Intake' },
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
            <th>Field</th>
            <th><span style="color:#2563eb;"><i class="fa-solid fa-a"></i></span> Record A — Primary (${recA.id})</th>
            <th><span style="color:#7c3aed;"><i class="fa-solid fa-b"></i></span> Record B — Candidate (${recB.id})</th>
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
    { key: 'gender', label: 'Gender Intake' },
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


// Render subtle field-level data confidence status icon indicator
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
  let iconHtml = '<i class="fa-solid fa-exclamation" style="color: #f59e0b; font-weight: 800;"></i>';
  let iconClass = 'icon-medium';
  let tooltipText = `${stat.score}% Confidence (${stat.upvotes} confirm, ${stat.downvotes} report)`;

  if (isAdmin) {
    iconHtml = '<i class="fa-solid fa-check-double" style="color: #10b981; font-weight: 800;"></i>';
    iconClass = 'icon-admin';
    tooltipText = 'Admin Verified (100% Data Accuracy)';
  } else if (stat.level === 'High') {
    iconHtml = '<i class="fa-solid fa-check" style="color: #22c55e; font-weight: 800;"></i>';
    iconClass = 'icon-high';
    tooltipText = `${stat.score}% High Confidence (${stat.upvotes} confirm, ${stat.downvotes} report)`;
  } else if (stat.level === 'Low') {
    iconHtml = '<i class="fa-solid fa-circle-exclamation" style="color: #f43f5e; font-weight: 800;"></i>';
    iconClass = 'icon-low';
    tooltipText = `${stat.score}% Low Confidence (${stat.upvotes} confirm, ${stat.downvotes} report)`;
  }

  return `<span class="confidence-icon-indicator ${iconClass}" title="${tooltipText}" data-school-id="${schoolId}" data-field-name="${fieldName}">${iconHtml}</span>`;
}

// Bind event listeners to confidence vote buttons
function bindConfidenceVoteEvents() {
  // Confidence icon indicators display confidence details on mouse hover
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
    // Reconcile Multi-Source Admissions Data (DfE + Pillai + KPS + LLM)
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
    const offersInfo = p.offersAcceptance || k.offerDate || dates.resultsDate || dates.offersDate || dates.offersAcceptance || null;
    const offerAcceptBy = k.offerAcceptByDate || dates.offerAcceptByDate || dates.offerAcceptBy || null;

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

    const userReports = school.userReports || {};
    const userOverrides = school.userCustomOverrides || {};

    const renderWidget = (fieldName, fieldLabel, origValue) => {
      const report = userReports[fieldName] || null;
      const isUp = report && report.status === 'up';
      const isDown = report && report.status === 'down';
      const customVal = userOverrides[fieldName] !== undefined ? userOverrides[fieldName] : (report && report.customValue ? report.customValue : null);
      const isCustom = customVal !== null && customVal !== undefined && customVal !== '';
      const displayVal = isCustom ? customVal : (origValue !== null && origValue !== undefined && origValue !== '' ? origValue : 'N/A');

      const confBadge = typeof renderFieldConfidenceBadge === 'function' ? renderFieldConfidenceBadge(school.id, fieldName, confidenceStats) : '';

      return `
        <div class="field-rating-row" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; width: 100%; margin-bottom: 0.4rem; font-size: 0.85rem; color: #334155;">
          <div style="flex: 1; word-break: break-word;">
            <span style="font-weight: 600; color: #475569;">${fieldLabel}:</span> <span style="font-weight: ${displayVal !== 'N/A' ? '700' : '400'}; color: ${displayVal !== 'N/A' ? '#0f172a' : '#94a3b8'};">${displayVal}</span> ${confBadge}
            ${isCustom ? `
              <span class="badge-custom-value" style="background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; font-size:0.72rem; font-weight:700; padding:0.15rem 0.45rem; border-radius:999px; margin-left:0.35rem; display:inline-flex; align-items:center; gap:0.2rem;" title="Custom value updated in your personal record">
                <i class="fa-solid fa-user-pen"></i> Custom Value Updated by You
              </span>
              <button type="button" class="btn-reset-field-report" data-school-id="${school.id}" data-field-name="${fieldName}" style="background:none; border:none; color:#ef4444; font-size:0.75rem; text-decoration:underline; cursor:pointer; margin-left:0.35rem;">Reset</button>
            ` : ''}
          </div>

          <div style="display: flex; align-items: center; gap: 0.25rem; flex-shrink: 0;">
            <button type="button" class="btn-field-thumb btn-thumb-up ${isUp ? 'active' : ''}" data-school-id="${school.id}" data-field-name="${fieldName}" data-label="${fieldLabel}" data-orig="${origValue || ''}" title="Mark field as accurate" style="padding: 0.18rem 0.4rem; font-size: 0.75rem; border-radius: 6px; border: 1px solid ${isUp ? '#16a34a' : '#cbd5e1'}; background: ${isUp ? '#dcfce7' : '#ffffff'}; color: ${isUp ? '#15803d' : '#64748b'}; cursor: pointer;">
              <i class="fa-solid fa-thumbs-up"></i>
            </button>
            <button type="button" class="btn-field-thumb btn-thumb-down ${isDown ? 'active' : ''}" data-school-id="${school.id}" data-field-name="${fieldName}" data-label="${fieldLabel}" data-orig="${origValue || ''}" data-custom="${customVal || ''}" title="Mark as inaccurate & update in your records" style="padding: 0.18rem 0.4rem; font-size: 0.75rem; border-radius: 6px; border: 1px solid ${isDown ? '#dc2626' : '#cbd5e1'}; background: ${isDown ? '#fee2e2' : '#ffffff'}; color: ${isDown ? '#b91c1c' : '#64748b'}; cursor: pointer;">
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
      <div class="detail-box" style="grid-column: 1 / -1; background: #ffffff; border: 1px solid #cbd5e1; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.6rem; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
          <h4 style="color: #1e293b; font-size: 1.1rem; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
            <i class="fa-solid fa-calendar-check" style="color: #4338ca;"></i> 11+ Admissions Intelligence &amp; Examination Profile
          </h4>
          <span style="font-size: 0.78rem; font-weight: 700; color: #4338ca; background: #eef2ff; border: 1px solid #c7d2fe; padding: 0.2rem 0.6rem; border-radius: 6px;">
            <i class="fa-solid fa-graduation-cap"></i> ${examType}
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
          <!-- Column 1: Registration & Key Deadlines -->
          <div style="background: #f8fafc; padding: 0.9rem; border-radius: 8px; border: 1px solid #e2e8f0;">
            <strong style="color: #2563eb; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem; font-size: 0.92rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 0.35rem;">
              <i class="fa-solid fa-file-pen"></i> Registration &amp; Overview
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.3rem;">
              ${renderWidget('entranceExamType', 'Exam Type / Board', examBoard ? `${examType} (${examBoard})` : examType)}
              ${renderWidget('registrationStatus', 'Registration Status', regStatus || 'Active')}
              ${renderWidget('registrationOpen', 'Registration Opens', regOpen)}
              ${renderWidget('registrationDeadline', 'Registration Deadline', regDeadline)}
              ${renderWidget('openDayEvening', 'Open Events / Tours', openEvents)}
            </div>
          </div>

          <!-- Column 2: Stage 1 Assessment -->
          <div style="background: #f8fafc; padding: 0.9rem; border-radius: 8px; border: 1px solid #e2e8f0;">
            <strong style="color: #d97706; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem; font-size: 0.92rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 0.35rem;">
              <i class="fa-solid fa-pen-nib"></i> 1st Stage Assessment
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.3rem;">
              ${renderWidget('firstExamDate', '1st Exam Date', firstExamDate)}
              ${renderWidget('stage_one_format_and_subjects', '1st Exam Format & Subjects', firstExamSubjects)}
              ${renderWidget('firstStageResult', '1st Stage Results Release', firstStageResult)}
            </div>
          </div>

          <!-- Column 3: Stage 2 Assessment, Interviews & Offers -->
          <div style="background: #f8fafc; padding: 0.9rem; border-radius: 8px; border: 1px solid #e2e8f0;">
            <strong style="color: #059669; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem; font-size: 0.92rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 0.35rem;">
              <i class="fa-solid fa-award"></i> Stage 2, Interview &amp; Offers
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.3rem;">
              ${renderWidget('second_stage_exam_required', '2nd Stage Required', secondStageRequired)}
              ${renderWidget('secondExamDate', '2nd Exam Date', secondExamDate)}
              ${renderWidget('stage_two_format_and_subjects', '2nd Exam Format', secondExamSubjects)}
              ${renderWidget('secondStageResult', '2nd Stage Results', secondStageResult)}
              ${renderWidget('interviewInfo', 'Interview / Group Activity', interviewInfo)}
              ${renderWidget('offersInfo', 'Offers / Results Date', offersInfo)}
              ${renderWidget('offerAcceptBy', 'Accept Offer By Deadline', offerAcceptBy)}
            </div>
          </div>
        </div>
      </div>
    `;

    // ----------------------------------------------------
    // Build Financials, Tuition & Scholarships Card
    // ----------------------------------------------------
    const financialsHtml = `
      <div class="detail-box" style="background: #ffffff; border: 1px solid #cbd5e1;">
        <h4 style="color: #059669; font-size: 1.02rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-sterling-sign"></i> Tuition Fees, Financials &amp; Scholarships
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.35rem;">
          ${renderWidget('feesTermly', 'Termly Tuition Fees', feesTermly)}
          ${annualFeesEst ? `
            <div class="field-rating-row" style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #334155; margin-bottom: 0.4rem;">
              <div><span style="font-weight: 600; color: #475569;">Annual Fee (Estimated):</span> <strong style="color: #059669;">${annualFeesEst}</strong></div>
            </div>
          ` : ''}
          ${renderWidget('registrationFee', 'Registration Fee', regFee)}
          ${renderWidget('scholarshipsOffered', 'Scholarships &amp; Bursaries', scholarships)}
          ${bursaryDeadline ? renderWidget('bursaryDeadline', 'Bursary Application Deadline', bursaryDeadline) : ''}
        </div>
      </div>
    `;

    // ----------------------------------------------------
    // Build Admissions Policy & Catchment Card
    // ----------------------------------------------------
    const policyHtml = `
      <div class="detail-box" style="background: #ffffff; border: 1px solid #cbd5e1;">
        <h4 style="color: #7c3aed; font-size: 1.02rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-shield-halved"></i> Admissions Policy &amp; Catchment
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.35rem;">
          ${renderWidget('admissionsPolicy', 'Admissions Policy Summary', admissionsPolicy || 'Standard 11+ entry policy.')}
          ${catchmentInfo ? renderWidget('catchmentArea', 'Catchment Area / Oversubscription', catchmentInfo) : ''}
          ${notes ? renderWidget('additionalNotes', 'Additional Admissions Notes', notes) : ''}
        </div>
      </div>
    `;

    // ----------------------------------------------------
    // Build Academic Performance Card
    // ----------------------------------------------------
    const academicMetricsHtml = `
      <div class="detail-box" style="background: #ffffff; border: 1px solid #cbd5e1;">
        <h4 style="color: #2563eb; font-size: 1.02rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-chart-line"></i> Academic Metrics &amp; GCSE Performance
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.35rem;">
          ${renderWidget('pupilCount', 'Total Pupil Roll', school.pupilCount ? `${school.pupilCount.toLocaleString()} pupils` : 'N/A')}
          ${renderWidget('ageRange', 'Age Range', school.ageRange || '11 to 18')}
          ${renderWidget('gcseAttainment8', 'GCSE Attainment 8 Score', school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined && school.gcseAttainment8 !== '' ? school.gcseAttainment8 : 'N/A')}
          ${renderWidget('gcseProgress8', 'GCSE Progress 8 Score', school.gcseProgress8 !== null && school.gcseProgress8 !== undefined && school.gcseProgress8 !== '' ? school.gcseProgress8 : 'N/A')}
          ${renderWidget('ebaccAveragePointScore', 'EBacc Average Point Score', school.ebaccAveragePointScore !== null && school.ebaccAveragePointScore !== undefined && school.ebaccAveragePointScore !== '' ? school.ebaccAveragePointScore : 'N/A')}
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
    // Build Multi-Source Provenance & AI Audit Footprint Card
    // ----------------------------------------------------
    const provenanceHtml = `
      <div class="detail-box" style="background: #ffffff; border: 1px solid #cbd5e1;">
        <h4 style="color: #d97706; font-size: 1.02rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-database"></i> Multi-Source Provenance &amp; Verification Footprint
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.85rem; color: #334155;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 600; color: #475569;">Verification Status:</span>
            <span style="font-weight: 700; color: ${isLlmEnriched ? '#6d28d9' : '#059669'}; background: ${isLlmEnriched ? '#ede9fe' : '#dcfce7'}; border: 1px solid ${isLlmEnriched ? '#ddd6fe' : '#bbf7d0'}; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.76rem;">
              ${isLlmEnriched ? '<i class="fa-solid fa-wand-magic-sparkles"></i> AI Reconciled & Enriched' : (school.official ? '<i class="fa-solid fa-circle-check"></i> Official DfE Verified' : 'Community Reconciled')}
            </span>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 600; color: #475569;">Reconciliation Confidence:</span>
            <span style="font-weight: 800; color: ${confidenceScore >= 90 ? '#059669' : '#d97706'}; display: inline-flex; align-items: center; gap: 0.3rem;">
              ${confidenceScore}%
              <span style="display: inline-block; width: 60px; height: 6px; background: #e2e8f0; border-radius: 999px; overflow: hidden; vertical-align: middle;">
                <span style="display: block; width: ${confidenceScore}%; height: 100%; background: ${confidenceScore >= 90 ? '#10b981' : '#f59e0b'};"></span>
              </span>
            </span>
          </div>

          ${verifiedAt ? `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 600; color: #475569;">Last Intelligence Scan:</span>
              <span style="font-weight: 600; color: #1e293b;">${verifiedAt}</span>
            </div>
          ` : ''}

          <div style="margin-top: 0.35rem; border-top: 1px dashed #e2e8f0; padding-top: 0.45rem;">
            <span style="font-weight: 600; color: #475569; display: block; margin-bottom: 0.3rem;">Reconciled Source Datasets:</span>
            <div style="display: flex; flex-wrap: wrap; gap: 0.35rem;">
              ${school.urn ? `<span style="font-size: 0.74rem; background: #f1f5f9; color: #334155; padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid #e2e8f0;"><i class="fa-solid fa-landmark"></i> DfE Register (${school.urn})</span>` : ''}
              ${Object.keys(p).length > 0 ? `<span style="font-size: 0.74rem; background: #f0fdf4; color: #166534; padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid #bbf7d0;"><i class="fa-solid fa-book-bookmark"></i> Pillai Admissions Dataset</span>` : ''}
              ${Object.keys(k).length > 0 ? `<span style="font-size: 0.74rem; background: #eff6ff; color: #1e40af; padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid #bfdbfe;"><i class="fa-solid fa-list-check"></i> KPS 11+ Guide</span>` : ''}
              ${isLlmEnriched ? `<span style="font-size: 0.74rem; background: #faf5ff; color: #6b21a8; padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid #e9d5ff;"><i class="fa-solid fa-robot"></i> LLM Live Crawler</span>` : ''}
            </div>
          </div>

          ${sourceUrl ? `
            <div style="margin-top: 0.35rem;">
              <a href="${sourceUrl}" target="_blank" style="font-size: 0.78rem; color: #4338ca; font-weight: 700; text-decoration: underline; display: inline-flex; align-items: center; gap: 0.3rem;">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> View Verification Source Reference
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // ----------------------------------------------------
    // Build School Contact Card
    // ----------------------------------------------------
    const contactHtml = `
      <div class="detail-box" style="grid-column: 1 / -1; background: #ffffff; border: 1px solid #cbd5e1;">
        <h4 style="color: #0284c7; font-size: 1.02rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-address-book"></i> School Contact &amp; Location Details
        </h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem;">
          <div>
            ${renderWidget('phone', 'Phone Number', school.phone)}
            ${renderWidget('email', 'Email Address', school.email)}
          </div>
          <div>
            ${renderWidget('website', 'Official Website', school.website)}
            ${renderWidget('address', 'Postal Address', school.address ? `${school.address}, ${school.postcode || ''}` : school.la)}
          </div>
        </div>
      </div>
    `;

    // ----------------------------------------------------
    // Assemble Full Modal Content
    // ----------------------------------------------------
    detailContent.innerHTML = `
      <div class="detail-header-hero" style="border-bottom: 1px solid #e2e8f0; padding-bottom: 1.25rem; margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h2 style="font-size: 1.6rem; font-weight: 800; color: #0f172a; margin: 0 0 0.35rem 0; letter-spacing: -0.02em;">
              ${school.name}
            </h2>
            <div style="color: #64748b; font-size: 0.92rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span><i class="fa-solid fa-location-dot" style="color: #ef4444;"></i> ${school.address || school.la}, ${school.postcode || ''}</span>
              <span>•</span>
              <span><strong>Region:</strong> ${school.region || school.la}</span>
              <span>•</span>
              <span><strong>URN:</strong> ${school.urn || 'N/A'}</span>
            </div>
          </div>

          ${isLlmEnriched ? `
            <div style="background: linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%); border: 1px solid #ddd6fe; border-radius: 8px; padding: 0.45rem 0.85rem; display: flex; align-items: center; gap: 0.5rem;">
              <i class="fa-solid fa-wand-magic-sparkles" style="color: #7c3aed; font-size: 1.1rem;"></i>
              <div>
                <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #6d28d9; letter-spacing: 0.05em;">AI Enriched Record</div>
                <div style="font-size: 0.85rem; font-weight: 800; color: #4338ca;">${confidenceScore}% Confidence</div>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="detail-tags-row" style="display: flex; gap: 0.5rem; margin-top: 0.85rem; flex-wrap: wrap; align-items: center;">
          <span class="badge-ofsted" style="font-size: 0.78rem;"><i class="fa-solid fa-star"></i> ${formatOfsted(userOverrides.ofstedRating || school.ofstedRating)}</span>
          <span class="badge-exam" style="font-size: 0.78rem; background: #e0e7ff; color: #3730a3;"><i class="fa-solid fa-school"></i> ${userOverrides.schoolType || school.rawSchoolType || school.schoolType}</span>
          <span class="badge-exam" style="font-size: 0.78rem; background: #f1f5f9; color: #334155;"><i class="fa-solid fa-venus-mars"></i> ${userOverrides.gender || school.gender} intake</span>
          ${school.ageRange ? `<span class="badge-exam" style="font-size: 0.78rem; background: #f8fafc; color: #475569; border: 1px solid #cbd5e1;"><i class="fa-solid fa-user-group"></i> Age ${school.ageRange}</span>` : ''}
          ${school.pupilCount ? `<span class="badge-exam" style="font-size: 0.78rem; background: #f8fafc; color: #475569; border: 1px solid #cbd5e1;"><i class="fa-solid fa-users"></i> ${school.pupilCount.toLocaleString()} pupils</span>` : ''}

          <!-- Toggleable Hot Pill -->
          <button type="button" class="btn" id="toggle-hot-btn" style="border:none; cursor:${currentPermissions.includes('admin:edit') ? 'pointer' : 'default'}; padding:0;" title="${currentPermissions.includes('admin:edit') ? 'Click to toggle Hot status' : 'Hot status'}">
            ${school.hot
              ? `<span class="badge-hot" style="font-size:0.76rem;"><i class="fa-solid fa-fire"></i> Hot ${currentPermissions.includes('admin:edit') ? '✏️' : ''}</span>`
              : `<span style="font-size:0.76rem; padding:0.2rem 0.55rem; border-radius:999px; background:#f1f5f9; color:#94a3b8; border:1px solid #e2e8f0;"><i class="fa-solid fa-fire"></i> Not Hot ${currentPermissions.includes('admin:edit') ? '✏️' : ''}</span>`
            }
          </button>

          <!-- Toggleable Verified / Official Pill -->
          <button type="button" class="btn" id="toggle-official-btn" style="border:none; cursor:${currentPermissions.includes('admin:edit') ? 'pointer' : 'default'}; padding:0;" title="${currentPermissions.includes('admin:edit') ? 'Click to toggle Official DfE status' : 'Official status'}">
            ${school.official
              ? `<span class="badge-official" style="font-size:0.76rem;"><i class="fa-solid fa-circle-check"></i> Official DfE ${currentPermissions.includes('admin:edit') ? '✏️' : ''}</span>`
              : `<span style="font-size:0.76rem; padding:0.2rem 0.55rem; border-radius:999px; background:#f1f5f9; color:#94a3b8; border:1px solid #e2e8f0;"><i class="fa-solid fa-circle-question"></i> Unofficial ${currentPermissions.includes('admin:edit') ? '✏️' : ''}</span>`
            }
          </button>
        </div>
      </div>

      <p style="margin-bottom: 1.5rem; color: #334155; font-size: 0.95rem; line-height: 1.5; background: #f8fafc; padding: 0.9rem 1.1rem; border-radius: 8px; border: 1px solid #e2e8f0;">
        ${school.description || 'Comprehensive admissions and curriculum profile verified across UK official school registers, independent examination syndicates, and AI crawler intelligence.'}
      </p>

      <div class="detail-sections-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
        ${admissionsUnifiedHtml}
        ${financialsHtml}
        ${policyHtml}
        ${academicMetricsHtml}
        ${provenanceHtml}
        ${contactHtml}
      </div>

      <div style="margin-top: 1.5rem; display: flex; gap: 0.75rem; flex-wrap:wrap; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 1.25rem;">
        <button type="button" class="btn ${userSelectedSchools.some(u => u.id === school.id) ? 'btn-primary' : 'btn-outline'}" id="detail-shortlist-btn" style="${userSelectedSchools.some(u => u.id === school.id) ? 'background:#059669; border-color:#059669;' : 'color:#059669; border-color:#6ee7b7;'}">
          <i class="fa-solid ${userSelectedSchools.some(u => u.id === school.id) ? 'fa-check' : 'fa-plus'}"></i> ${userSelectedSchools.some(u => u.id === school.id) ? 'Shortlisted' : 'Add to Shortlist'}
        </button>

        ${school.website ? `<a href="${school.website}" target="_blank" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-globe"></i> Official Website</a>` : ''}
        ${school.compareSchoolPerformanceUrl ? `<a href="${school.compareSchoolPerformanceUrl}" target="_blank" class="btn btn-outline" style="color:#059669; border-color:#6ee7b7; display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-chart-bar"></i> Compare Performance</a>` : ''}
        ${school.phone ? `<a href="tel:${school.phone}" class="btn btn-outline" style="display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-phone"></i> ${school.phone}</a>` : ''}
        ${school.email ? `<a href="mailto:${school.email}" class="btn btn-outline" style="display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-envelope"></i> Email School</a>` : ''}

        ${currentPermissions.includes('admin:portal') ? `
          <button type="button" class="btn btn-outline" id="detail-version-history-btn" style="color:#4f46e5; border-color:#c7d2fe; margin-left:auto; display: inline-flex; align-items: center; gap: 0.35rem;">
            <i class="fa-solid fa-clock-rotate-left"></i> Version History
          </button>
          <button type="button" class="btn btn-primary" id="detail-merge-btn" style="background:#7c3aed; border-color:#7c3aed; display: inline-flex; align-items: center; gap: 0.35rem;">
            <i class="fa-solid fa-code-merge"></i> Merge Record
          </button>
        ` : ''}
      </div>
    `;

    // Wire Shortlist button listener
    const detailShortlistBtn = document.getElementById('detail-shortlist-btn');
    if (detailShortlistBtn) {
      detailShortlistBtn.addEventListener('click', (e) => {
        e.preventDefault();
        addUserSchool(school);
        openSchoolDetail(school.id);
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
        <i class="fa-solid fa-users" style="color: #7c3aed;"></i> New Gender Intake
      </label>
      <select id="bulk-val-input" style="width: 100%; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; background: white;">
        <option value="Girls">Girls Only</option>
        <option value="Boys">Boys Only</option>
        <option value="Mixed">Mixed Intake</option>
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

  try {
    const res = await fetch('/api/recommendation-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weights })
    });
    if (res.ok) {
      showToast('Algorithm weights updated successfully!', 'success');
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

  const payload = {
    llmProvider: provider,
    geminiModel,
    openaiModel,
    scannerSkipDays: isNaN(skipDays) ? 10 : Math.max(0, Math.min(100, skipDays)),
    scannerDelaySeconds: isNaN(delaySec) ? 20 : Math.max(0, Math.min(300, delaySec)),
    llmPromptTemplate: promptTemplate,
    recWeights
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
      if (data.state && data.state.isRunning) {
        startScannerPolling();
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

  if (statusPill) {
    statusPill.style.background = '#1e1b4b';
    statusPill.style.color = '#c7d2fe';
    statusPill.style.borderColor = '#6366f1';
    statusPill.innerHTML = `<i class="fa-solid fa-bolt" style="color:#a5b4fc;"></i> ${escapeHtml(schoolName)} • ${provider} (${model}) • ${timeStr}`;
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
  await refreshEnrichmentStatus();
}

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
      return item.status === 'llm_enriched' || item.status === 'auto_verified' || (item.tags && item.tags.includes('llm_enriched'));
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
  const currentFingerprint = `${enrichmentFeedFilterText}:${enrichmentFeedFilterStatus}:${filtered.map(i => `${i.schoolId}_${i.verifiedAt || ''}_${i.status || ''}_${(i.diffs || []).length}`).join('|')}`;
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
    const isAutoVerified = item.status === 'auto_verified';
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
      statusPill = `<span style="background: #ecfdf5; color: #065f46; font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid #a7f3d0;"><i class="fa-solid fa-circle-check"></i> Auto-Verified</span>`;
    }

    const confScore = item.qualityScore || (isLlmError ? 30 : 95);
    const timeFormatted = item.verifiedAt ? new Date(item.verifiedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Just now';

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

  scannerPollInterval = setInterval(async () => {
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
              <span style="color:#059669; font-weight:700;"><i class="fa-solid fa-circle-check"></i> ${st.stats.verifiedCount} enriched</span>, 
              <span style="color:#dc2626; font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> ${st.stats.anomaliesCount} anomalies</span>
            `;
          } else {
            statusText.innerHTML = `
              <i class="fa-solid fa-spider fa-bounce" style="color:#7c3aed;"></i> 
              Auditing <strong>${st.currentSchool || 'schools'}</strong> (${pct}%) &bull; 
              <span style="color:#059669; font-weight:700;"><i class="fa-solid fa-circle-check"></i> ${st.stats.verifiedCount} clean/enriched</span>, 
              <span style="color:#dc2626; font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> ${st.stats.anomaliesCount} anomalies</span>
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
        if (statusText) {
          statusText.innerHTML = `
            <i class="fa-solid fa-circle-check" style="color:#059669;"></i> 
            Completed web audit across <strong>${st.scannedCount}</strong> schools 
            (${st.stats.verifiedCount} auto-verified / enriched, ${st.stats.anomaliesCount} anomalies, ${st.stats.missingWebsitesCount} missing websites, ${st.stats.dataMissingCount} data missing).
          `;
        }

        showToast(`AI Enrichment scan complete: ${st.scannedCount} schools audited (${st.stats.verifiedCount} enriched)!`, 'success');
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
  }, 800);
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
