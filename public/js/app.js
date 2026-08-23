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
  activeSubView: 'matchmaker' // 'matchmaker', 'dualtrack', 'matrix', 'calendar'
};

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

  // 4. Fetch initial school catalog & stats before UI permission routing
  await fetchStats();
  await loadSchools();
  loadRecWeights();
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

  // Enforce tab access permissions: Admin Portal hidden unless session holds explicit permission
  const canViewAdmin = Array.isArray(currentPermissions) && currentPermissions.includes('admin:portal');

  if (directoryTabBtn) directoryTabBtn.style.display = 'none';
  if (adminTabBtn) adminTabBtn.style.display = canViewAdmin ? 'inline-flex' : 'none';

  updateAuthUserBadge();

  if (!currentUserAccount) {
    if (parent2TabBtn) parent2TabBtn.style.display = 'none';
  } else {
    if (parent2TabBtn) parent2TabBtn.style.display = 'inline-flex';
  }

  // Landing page hierarchy: Land on Admin Portal if admin, otherwise land on Parent Portal 2.0 (New Default)
  if (canViewAdmin) {
    switchTab('admin');
  } else {
    switchTab('parent2');
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

  // Reset tab button states
  [parent2TabBtn, recommendTabBtn, adminTabBtn, directoryTabBtn].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });

  // Hide all view containers
  [parent2Content, recommendContent, adminContent, directoryContent].forEach(c => {
    if (c) c.style.display = 'none';
  });

  const canViewAdmin = Array.isArray(currentPermissions) && currentPermissions.includes('admin:portal');

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
    switchAdminSubTab(targetSubTab);
    loadAdminFieldReports();
  } else {
    // Default fallback to Parent Portal 2.0
    if (parent2TabBtn) parent2TabBtn.classList.add('active');
    if (parent2Content) parent2Content.style.display = 'block';
    renderParent2Views();
    fetchRecommendations();
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
  } else if (subTabName === 'bulk-edit') {
    renderBulkEditTable();
  } else if (subTabName === 'corrections') {
    loadAdminFieldReports();
  } else if (subTabName === 'settings') {
    loadRecWeights();
  }
}



// Fetch dashboard statistics
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();

    // Populate LA dropdown
    const laSelect = document.getElementById('la-select');
    const prevVal = laSelect.value;
    laSelect.innerHTML = '<option value="">All Boroughs / Local Authorities</option>';
    data.localAuthorities.forEach(la => {
      const opt = document.createElement('option');
      opt.value = la;
      opt.textContent = la;
      laSelect.appendChild(opt);
    });
    laSelect.value = prevVal;
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

// Fetch schools based on filters
async function loadSchools() {
  const search = document.getElementById('search-input').value;
  const la = document.getElementById('la-select').value;
  const type = document.getElementById('type-select').value;
  const gender = document.getElementById('gender-select').value;
  const ofsted = document.getElementById('ofsted-select').value;
  const exam = document.getElementById('exam-select').value;

  const hotSelect = document.getElementById('hot-select') ? document.getElementById('hot-select').value : '';

  const queryParams = new URLSearchParams();
  if (search) queryParams.append('search', search);
  if (la) queryParams.append('la', la);
  if (type) queryParams.append('type', type);
  if (gender) queryParams.append('gender', gender);
  if (ofsted) queryParams.append('ofsted', ofsted);
  if (exam) queryParams.append('exam', exam);
  if (hotSelect === 'hot') queryParams.append('hot', 'true');
  if (hotSelect === 'official') queryParams.append('official', 'true');


  try {
    const res = await fetch(`/api/schools?${queryParams.toString()}`);
    const data = await res.json();
    currentSchools = data.schools;

    document.getElementById('results-num').textContent = data.total;
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

  cardsContainer.innerHTML = '';
  tableBody.innerHTML = '';

  if (currentSchools.length === 0) {
    cardsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: white; border-radius: 12px; border: 1px solid #e2e8f0;">
        <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; color: #94a3b8; margin-bottom: 1rem;"></i>
        <h3>No matching high schools found</h3>
        <p style="color: #64748b; font-size: 0.9rem;">Try adjusting your filter criteria or search keyword.</p>
      </div>
    `;
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
        <strong>${displayName}</strong>
        ${school.hot ? `<span class="badge-hot" style="font-size:0.68rem; padding:0.1rem 0.4rem; margin-left:0.4rem; display:inline-flex;"><i class="fa-solid fa-fire"></i>&nbsp;Hot</span>` : ''}
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



  const filterInputs = ['search-input', 'la-select', 'type-select', 'gender-select', 'ofsted-select', 'exam-select', 'hot-select'];
  filterInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadSchools);
  });

  document.getElementById('search-input').addEventListener('input', debounce(loadSchools, 300));

  // Reset Filters
  document.getElementById('reset-filters-btn').addEventListener('click', () => {
    filterInputs.forEach(id => {
      document.getElementById(id).value = '';
    });
    loadSchools();
  });

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
      : '<span style="color:#94a3b8;">No subjects cataloged</span>';

    const dates = school.entranceExamDates || {};

    // Extract and reconcile all admissions data sources
    const k = school.kpsDetails || {};
    const p = school.pillaiDetails || {};

    const regStatus = p.registrationStatus || null;
    const regFee = k.registrationFee || null;
    const regOpen = p.registrationOpens || dates.registrationOpen || null;
    const regDeadline = p.registrationDeadline || k.registrationCloseDate || k.registrationCloses || dates.registrationDeadline || null;
    const examBoard = p.examBoard || null;
    const examType = school.entranceExamType || 'Standard Assessment';

    const firstExamDate = p.firstExamDate || k.firstExamDate || dates.examDate || null;
    const firstExamSubjects = p.firstExamSubjects || k.firstExamFormatSubjects || k.examFormat || null;
    const firstStageResult = p.firstExamResults || k.firstStageResult || null;

    const secondExamDate = p.secondExamDate || k.secondStageExamDate || null;
    const secondExamSubjects = p.secondExamSubjects || k.secondExamFormatSubjects || null;
    const secondStageResult = p.secondExamResults || k.secondStageResult || null;

    const interviewInfo = p.interview || k.interviewGroupActivity || k.interviewsDate || null;
    const offersInfo = p.offersAcceptance || k.offerDate || dates.resultsDate || null;
    const offerAcceptBy = k.offerAcceptByDate || null;
    const openEvents = p.openDayEvening || null;
    const scholarships = k.scholarshipsOffered || null;
    const notes = p.notes || null;

    const userReports = school.userReports || {};
    const userOverrides = school.userCustomOverrides || {};

    const renderWidget = (fieldName, fieldLabel, origValue) => {
      const report = userReports[fieldName] || null;
      const isUp = report && report.status === 'up';
      const isDown = report && report.status === 'down';
      const customVal = userOverrides[fieldName] !== undefined ? userOverrides[fieldName] : (report && report.customValue ? report.customValue : null);
      const isCustom = customVal !== null && customVal !== undefined && customVal !== '';
      const displayVal = isCustom ? customVal : (origValue !== null && origValue !== undefined && origValue !== '' ? origValue : 'N/A');

      const confBadge = renderFieldConfidenceBadge(school.id, fieldName, confidenceStats);

      return `
        <div class="field-rating-row" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; width: 100%; margin-bottom: 0.35rem; font-size: 0.85rem; color: #475569;">
          <div style="flex: 1; word-break: break-word;">
            <strong>${fieldLabel}:</strong> ${displayVal} ${confBadge}
            ${isCustom ? `
              <span class="badge-custom-value" style="background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; font-size:0.72rem; font-weight:700; padding:0.15rem 0.45rem; border-radius:999px; margin-left:0.35rem; display:inline-flex; align-items:center; gap:0.2rem;" title="Custom value updated in your personal record">
                <i class="fa-solid fa-user-pen"></i> Custom Value Updated by You
              </span>
              <button type="button" class="btn-reset-field-report" data-school-id="${school.id}" data-field-name="${fieldName}" style="background:none; border:none; color:#ef4444; font-size:0.75rem; text-decoration:underline; cursor:pointer; margin-left:0.35rem;">Reset</button>
            ` : ''}
          </div>

          <div style="display: flex; align-items: center; gap: 0.25rem;">
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

    // Unified Admissions & Key Dates Card Block
    const admissionsUnifiedHtml = `
      <div class="detail-box" style="grid-column: 1 / -1; background: #f8fafc; border-color: #cbd5e1;">
        <h4 style="color: #1e293b; font-size: 1.05rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.8rem;">
          <i class="fa-solid fa-calendar-check" style="color: #2563eb;"></i> Admissions & Key Dates Data
        </h4>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
          <!-- Registration & Overview -->
          <div style="background: white; padding: 0.8rem; border-radius: 8px; border: 1px solid #e2e8f0;">
            <strong style="color: #3b82f6; display: block; margin-bottom: 0.4rem; font-size: 0.9rem;">
              <i class="fa-solid fa-file-pen"></i> Registration & Overview
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.3rem;">
              ${renderWidget('entranceExamType', 'Exam Type / Board', examBoard ? `${examType} (${examBoard})` : examType)}
              ${regStatus ? renderWidget('registrationStatus', 'Registration Status', regStatus) : ''}
              ${regFee ? renderWidget('registrationFee', 'Registration Fee', regFee) : ''}
              ${renderWidget('registrationOpen', 'Registration Opens', regOpen)}
              ${renderWidget('registrationDeadline', 'Registration Deadline', regDeadline)}
              ${openEvents ? renderWidget('openDayEvening', 'Open Events', openEvents) : ''}
            </div>
          </div>

          <!-- Stage 1 Assessment -->
          <div style="background: white; padding: 0.8rem; border-radius: 8px; border: 1px solid #e2e8f0;">
            <strong style="color: #d97706; display: block; margin-bottom: 0.4rem; font-size: 0.9rem;">
              <i class="fa-solid fa-pen-nib"></i> 1st Stage Assessment
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.3rem;">
              ${renderWidget('firstExamDate', '1st Exam Date', firstExamDate)}
              ${firstExamSubjects ? renderWidget('firstExamSubjects', 'Format / Subjects', firstExamSubjects) : ''}
              ${firstStageResult ? renderWidget('firstStageResult', '1st Stage Result', firstStageResult) : ''}
            </div>
          </div>

          <!-- Stage 2 / Interview & Offers -->
          <div style="background: white; padding: 0.8rem; border-radius: 8px; border: 1px solid #e2e8f0;">
            <strong style="color: #059669; display: block; margin-bottom: 0.4rem; font-size: 0.9rem;">
              <i class="fa-solid fa-award"></i> Stage 2, Interview & Offers
            </strong>
            <div style="display: flex; flex-direction: column; gap: 0.3rem;">
              ${secondExamDate ? renderWidget('secondExamDate', '2nd Exam Date', secondExamDate) : ''}
              ${secondExamSubjects ? renderWidget('secondExamSubjects', '2nd Exam Format', secondExamSubjects) : ''}
              ${secondStageResult ? renderWidget('secondStageResult', '2nd Stage Result', secondStageResult) : ''}
              ${renderWidget('interviewInfo', 'Interview / Activity', interviewInfo)}
              ${renderWidget('offersInfo', 'Offers / Results', offersInfo)}
              ${offerAcceptBy ? renderWidget('offerAcceptBy', 'Accept Offer By', offerAcceptBy) : ''}
            </div>
          </div>
        </div>

        ${scholarships || notes || school.admissionsPolicy ? `
          <div style="margin-top: 0.8rem; background: white; padding: 0.8rem; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 0.85rem; color: #475569;">
            ${scholarships ? renderWidget('scholarshipsOffered', 'Scholarships Offered', scholarships) : ''}
            ${notes ? renderWidget('additionalNotes', 'Additional Notes', notes) : ''}
            <div style="border-top: 1px dashed #e2e8f0; padding-top: 0.4rem; margin-top: 0.4rem;">
              ${renderWidget('admissionsPolicy', 'Admissions Policy Summary', school.admissionsPolicy || 'Standard admissions policy.')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    detailContent.innerHTML = `
      <div class="detail-header-hero">
        <h2>${school.name}</h2>
        <div style="color: var(--text-muted); font-size: 0.95rem; margin-top: 0.2rem;">
          <i class="fa-solid fa-location-dot"></i> ${school.address || school.la}, ${school.postcode || ''} | URN: ${school.urn || 'N/A'}
        </div>
        <div class="detail-tags-row" style="align-items: center;">
          <span class="badge-ofsted"><i class="fa-solid fa-star"></i> ${formatOfsted(userOverrides.ofstedRating || school.ofstedRating)}</span>
          <span class="badge-exam">${userOverrides.schoolType || school.schoolType}</span>
          <span class="badge-exam">${userOverrides.gender || school.gender} intake</span>

          <!-- Toggleable Hot Pill -->
          <button type="button" class="btn" id="toggle-hot-btn" style="border:none; cursor:${currentPermissions.includes('admin:edit') ? 'pointer' : 'default'}; padding:0;" title="${currentPermissions.includes('admin:edit') ? 'Click to toggle Hot status' : 'Hot status'}">
            ${school.hot
              ? `<span class="badge-hot"><i class="fa-solid fa-fire"></i> Hot ${currentPermissions.includes('admin:edit') ? '✏️' : ''}</span>`
              : `<span style="font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px; background:#f1f5f9; color:#94a3b8; border:1px solid #e2e8f0;"><i class="fa-solid fa-fire"></i> Not Hot ${currentPermissions.includes('admin:edit') ? '✏️' : ''}</span>`
            }
          </button>

          <!-- Toggleable Verified / Official Pill -->
          <button type="button" class="btn" id="toggle-official-btn" style="border:none; cursor:${currentPermissions.includes('admin:edit') ? 'pointer' : 'default'}; padding:0;" title="${currentPermissions.includes('admin:edit') ? 'Click to toggle Official DfE status' : 'Official status'}">
            ${school.official
              ? `<span class="badge-official"><i class="fa-solid fa-circle-check"></i> Official DfE ${currentPermissions.includes('admin:edit') ? '✏️' : ''}</span>`
              : `<span style="font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px; background:#f1f5f9; color:#94a3b8; border:1px solid #e2e8f0;"><i class="fa-solid fa-circle-question"></i> Unofficial ${currentPermissions.includes('admin:edit') ? '✏️' : ''}</span>`
            }
          </button>
        </div>
      </div>

      <p style="margin-bottom: 1.5rem; color: #334155; font-size: 0.95rem;">${school.description || 'No summary description provided.'}</p>

      <div class="detail-sections-grid">
        ${admissionsUnifiedHtml}

        <div class="detail-box" style="grid-column: 1 / -1;">
          <h4><i class="fa-solid fa-chart-line"></i> Academic Metrics & GCSE</h4>
          <div style="display: flex; flex-direction: column; gap: 0.4rem;">
            ${renderWidget('pupilCount', 'Pupil Count', school.pupilCount ? school.pupilCount.toLocaleString() : 'N/A')}
            ${renderWidget('gcseAttainment8', 'GCSE Attainment 8', school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined ? school.gcseAttainment8 : 'N/A')}
            ${renderWidget('gcseProgress8', 'Progress 8 Score', school.gcseProgress8 !== null && school.gcseProgress8 !== undefined ? school.gcseProgress8 : 'N/A')}
            ${renderWidget('ebaccAveragePointScore', 'EBacc Average Point Score', school.ebaccAveragePointScore !== null && school.ebaccAveragePointScore !== undefined ? school.ebaccAveragePointScore : 'N/A')}
          </div>
          <div style="margin-top: 0.8rem; border-top: 1px dashed #cbd5e1; padding-top: 0.6rem;">
            <strong>Offered GCSE Subjects (${subjectsArray.length}):</strong>
            <div class="subjects-tags" style="margin-top: 0.4rem;">${subjectsHtml}</div>
          </div>
        </div>

        <div class="detail-box" style="grid-column: 1 / -1;">
          <h4><i class="fa-solid fa-address-book"></i> School Contact & Details</h4>
          <div style="display: flex; flex-direction: column; gap: 0.4rem;">
            ${renderWidget('phone', 'Phone Number', school.phone)}
            ${renderWidget('email', 'Email Address', school.email)}
            ${renderWidget('website', 'Official Website', school.website)}
          </div>
        </div>
      </div>

      <div style="margin-top: 1.5rem; display: flex; gap: 0.75rem; flex-wrap:wrap; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
        <button type="button" class="btn ${userSelectedSchools.some(u => u.id === school.id) ? 'btn-primary' : 'btn-outline'}" id="detail-shortlist-btn" style="${userSelectedSchools.some(u => u.id === school.id) ? 'background:#059669; border-color:#059669;' : 'color:#059669; border-color:#6ee7b7;'}">
          <i class="fa-solid ${userSelectedSchools.some(u => u.id === school.id) ? 'fa-check' : 'fa-plus'}"></i> ${userSelectedSchools.some(u => u.id === school.id) ? 'Shortlisted' : 'Add to Shortlist'}
        </button>
        ${school.website ? `<a href="${school.website}" target="_blank" class="btn btn-primary"><i class="fa-solid fa-globe"></i> Official Website</a>` : ''}
        ${school.compareSchoolPerformanceUrl ? `<a href="${school.compareSchoolPerformanceUrl}" target="_blank" class="btn btn-outline" style="color:#059669; border-color:#6ee7b7;"><i class="fa-solid fa-chart-bar"></i> Compare Performance</a>` : ''}
        ${school.phone ? `<a href="tel:${school.phone}" class="btn btn-outline"><i class="fa-solid fa-phone"></i> ${school.phone}</a>` : ''}
        ${school.email ? `<a href="mailto:${school.email}" class="btn btn-outline"><i class="fa-solid fa-envelope"></i> Email School</a>` : ''}
        ${currentPermissions.includes('admin:portal') ? `
          <button type="button" class="btn btn-primary" id="detail-merge-btn" style="background:#7c3aed; border-color:#7c3aed; margin-left:auto;">
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
  } else if (parent2State.activeSubView === 'dualtrack') {
    renderDualTrackHub();
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
      switchParent2SubView('dualtrack');
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
        const res = await fetch(`/api/schools?search=${encodeURIComponent(q)}&schoolType=Independent`);
        const data = await res.json();
        const matches = data.schools || [];

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


