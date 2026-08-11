// High Schools Database Frontend Application Script (User & Admin Roles)
let currentSchools = [];
let compareList = [];
let currentViewMode = 'table'; // 'table' or 'cards' (Default to Table View)
let currentRole = 'admin'; // 'admin' or 'user' (Default to Admin Role)
let currentVerifiedBatch = null;


document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  await fetchStats();
  await loadSchools();
  setupEventListeners();
  applyRoleUI();
}

// Apply Role UI controls
function applyRoleUI() {
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => {
    el.style.display = currentRole === 'admin' ? 'inline-flex' : 'none';
  });

  if (currentRole === 'user') {
    // Force directory tab active if switching to user role
    switchTab('directory');
  }
}

// Switch main navigation tab
function switchTab(tabName) {
  const directoryTabBtn = document.getElementById('tab-directory-btn');
  const adminTabBtn = document.getElementById('tab-admin-btn');
  const directoryContent = document.getElementById('directory-tab-content');
  const adminContent = document.getElementById('admin-tab-content');

  if (tabName === 'admin' && currentRole === 'admin') {
    directoryTabBtn.classList.remove('active');
    adminTabBtn.classList.add('active');
    directoryContent.style.display = 'none';
    adminContent.style.display = 'block';
  } else {
    directoryTabBtn.classList.add('active');
    adminTabBtn.classList.remove('active');
    directoryContent.style.display = 'block';
    adminContent.style.display = 'none';
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
    renderSchools();
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
        ${currentRole === 'admin' ? `
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
    if (currentRole === 'admin') {
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
          ${currentRole === 'admin' ? `
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
    if (currentRole === 'admin') {
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
  // Role switcher listener
  document.getElementById('role-select').addEventListener('change', (e) => {
    currentRole = e.target.value;
    applyRoleUI();
    renderSchools();
  });

  // Nav Tab Buttons
  document.getElementById('tab-directory-btn').addEventListener('click', () => switchTab('directory'));
  document.getElementById('tab-admin-btn').addEventListener('click', () => switchTab('admin'));

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
  document.getElementById('add-school-btn').addEventListener('click', () => {
    openAddModal();
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
  document.getElementById('compare-bar-btn').addEventListener('click', openCompareModal);
  document.getElementById('modal-close-compare').addEventListener('click', () => {
    document.getElementById('compare-modal').style.display = 'none';
  });

  // Add / Edit School Form Submit Handler
  document.getElementById('add-school-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('edit-school-id').value;

    const schoolPayload = {
      name: document.getElementById('add-name').value,
      urn: document.getElementById('add-urn').value,
      la: document.getElementById('add-la').value,
      postcode: document.getElementById('add-postcode').value,
      schoolType: document.getElementById('add-type').value,
      gender: document.getElementById('add-gender').value,
      pupilCount: document.getElementById('add-pupils').value,
      ofstedRating: document.getElementById('add-ofsted').value,
      gcseProgress8: document.getElementById('add-progress8').value,
      gcseAttainment8: document.getElementById('add-attainment8').value,
      entranceExamType: document.getElementById('add-exam-type').value,
      gcseSubjects: document.getElementById('add-subjects').value,
      admissionsPolicy: document.getElementById('add-policy').value,
      website: document.getElementById('add-website').value,
      phone: document.getElementById('add-phone').value
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

// Helper to show non-blocking persistent toast notifications

function showToast(message, type = 'success', duration = 5000) {
  const toast = document.getElementById('toast-notification');
  const msgEl = document.getElementById('toast-message');
  const iconEl = document.getElementById('toast-icon');

  toast.className = `toast-banner ${type}`;
  msgEl.textContent = message;

  if (type === 'success') iconEl.className = 'fa-solid fa-circle-check';
  else if (type === 'error') iconEl.className = 'fa-solid fa-triangle-exclamation';
  else iconEl.className = 'fa-solid fa-circle-info';

  toast.style.display = 'flex';

  document.getElementById('toast-close-btn').onclick = () => {
    toast.style.display = 'none';
  };

  if (duration > 0) {
    setTimeout(() => {
      toast.style.display = 'none';
    }, duration);
  }
}

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

      // --- Right side: Merge button + Chevron ---
      const rightEl = document.createElement('div');
      rightEl.style.cssText = 'display:flex; align-items:center; gap:0.5rem; flex-shrink:0;';

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
    await fetchStats();
    await loadSchools();
    await runDedupScan();

  } catch (err) {
    console.error('DB merge error:', err);
    showToast('Failed to complete merge operation.', 'error');
  }
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
        "name": "Queen Elizabeth's School, Barnet", // Intentional duplicate to test de-duplication
        "urn": "136272",
        "la": "Barnet",
        "schoolType": "Grammar (Academy)",
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
        "schoolType": "Comprehensive (Academy)",
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
        "schoolType": "Comprehensive (Academy)",
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
        "schoolType": "Comprehensive (Academy)"
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

// Open Edit Modal with pre-filled school values (Admin privilege)
async function openEditModal(id) {
  if (currentRole !== 'admin') return;

  try {
    const res = await fetch(`/api/schools/${id}`);
    if (!res.ok) {
      showToast('Could not fetch school details to edit.', 'error');
      return;
    }
    const school = await res.json();

    document.getElementById('edit-school-id').value = school.id;
    document.getElementById('add-name').value = school.name || '';
    document.getElementById('add-urn').value = school.urn !== 'N/A' ? (school.urn || '') : '';
    document.getElementById('add-la').value = school.la || '';
    document.getElementById('add-postcode').value = school.postcode || '';
    document.getElementById('add-type').value = school.schoolType || 'Comprehensive (Academy)';
    document.getElementById('add-gender').value = school.gender || 'Mixed';
    document.getElementById('add-pupils').value = school.pupilCount || '';
    document.getElementById('add-ofsted').value = school.ofstedRating || 'Good';
    document.getElementById('add-progress8').value = school.gcseProgress8 !== null && school.gcseProgress8 !== undefined ? school.gcseProgress8 : '';
    document.getElementById('add-attainment8').value = school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined ? school.gcseAttainment8 : '';
    document.getElementById('add-exam-type').value = school.entranceExamType || '';
    document.getElementById('add-subjects').value = Array.isArray(school.gcseSubjects) ? school.gcseSubjects.join(', ') : (school.gcseSubjects || '');
    document.getElementById('add-policy').value = school.admissionsPolicy || '';
    document.getElementById('add-website').value = school.website || '';
    document.getElementById('add-phone').value = school.phone || '';

    document.getElementById('modal-title-text').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Edit High School Record';
    document.getElementById('modal-subtitle-text').textContent = `Update specs and details for ${school.name}`;
    document.getElementById('add-modal').style.display = 'flex';
  } catch (err) {
    console.error('Error opening edit modal:', err);
    showToast('Error opening edit modal.', 'error');
  }
}

// Delete single school record (Admin privilege)
async function deleteSchool(id) {
  if (currentRole !== 'admin') return;
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


// Open School Detail View
async function openSchoolDetail(id) {
  try {
    const res = await fetch(`/api/schools/${id}`);
    const school = await res.json();

    const detailContent = document.getElementById('detail-modal-content');

    const subjectsHtml = school.gcseSubjects && school.gcseSubjects.length > 0
      ? school.gcseSubjects.map(sub => `<span class="subject-tag">${sub}</span>`).join('')
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
            <div style="font-size: 0.85rem; color: #475569; display: flex; flex-direction: column; gap: 0.3rem;">
              <p><strong>Exam Type / Board:</strong> ${examBoard ? `${examType} (${examBoard})` : examType}</p>
              ${regStatus ? `<p><strong>Registration Status:</strong> ${regStatus}</p>` : ''}
              ${regFee ? `<p><strong>Registration Fee:</strong> ${regFee}</p>` : ''}
              <p><strong>Registration Opens:</strong> ${regOpen || 'N/A'}</p>
              <p><strong>Registration Deadline:</strong> ${regDeadline || 'N/A'}</p>
              ${openEvents ? `<p><strong>Open Events:</strong> ${openEvents}</p>` : ''}
            </div>
          </div>

          <!-- Stage 1 Assessment -->
          <div style="background: white; padding: 0.8rem; border-radius: 8px; border: 1px solid #e2e8f0;">
            <strong style="color: #d97706; display: block; margin-bottom: 0.4rem; font-size: 0.9rem;">
              <i class="fa-solid fa-pen-nib"></i> 1st Stage Assessment
            </strong>
            <div style="font-size: 0.85rem; color: #475569; display: flex; flex-direction: column; gap: 0.3rem;">
              <p><strong>1st Exam Date:</strong> ${firstExamDate || 'N/A'}</p>
              ${firstExamSubjects ? `<p><strong>Format / Subjects:</strong> ${firstExamSubjects}</p>` : ''}
              ${firstStageResult ? `<p><strong>1st Stage Result:</strong> ${firstStageResult}</p>` : ''}
            </div>
          </div>

          <!-- Stage 2 / Interview & Offers -->
          <div style="background: white; padding: 0.8rem; border-radius: 8px; border: 1px solid #e2e8f0;">
            <strong style="color: #059669; display: block; margin-bottom: 0.4rem; font-size: 0.9rem;">
              <i class="fa-solid fa-award"></i> Stage 2, Interview & Offers
            </strong>
            <div style="font-size: 0.85rem; color: #475569; display: flex; flex-direction: column; gap: 0.3rem;">
              ${secondExamDate ? `<p><strong>2nd Exam Date:</strong> ${secondExamDate}</p>` : ''}
              ${secondExamSubjects ? `<p><strong>2nd Exam Format:</strong> ${secondExamSubjects}</p>` : ''}
              ${secondStageResult ? `<p><strong>2nd Stage Result:</strong> ${secondStageResult}</p>` : ''}
              <p><strong>Interview / Activity:</strong> ${interviewInfo || 'N/A'}</p>
              <p><strong>Offers / Results:</strong> ${offersInfo || 'N/A'}</p>
              ${offerAcceptBy ? `<p><strong>Accept Offer By:</strong> ${offerAcceptBy}</p>` : ''}
            </div>
          </div>
        </div>

        ${scholarships || notes || school.admissionsPolicy ? `
          <div style="margin-top: 0.8rem; background: white; padding: 0.8rem; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 0.85rem; color: #475569;">
            ${scholarships ? `<p style="margin-bottom: 0.3rem;"><strong>Scholarships Offered:</strong> ${scholarships}</p>` : ''}
            ${notes ? `<p style="margin-bottom: 0.3rem;"><strong>Additional Notes:</strong> ${notes}</p>` : ''}
            <p style="border-top: 1px dashed #e2e8f0; padding-top: 0.4rem; margin-top: 0.4rem;">
              <strong>Admissions Policy Summary:</strong> ${school.admissionsPolicy || 'Standard admissions policy.'}
            </p>
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
          <span class="badge-ofsted"><i class="fa-solid fa-star"></i> ${formatOfsted(school.ofstedRating)}</span>
          <span class="badge-exam">${school.schoolType}</span>
          <span class="badge-exam">${school.gender} intake</span>

          <!-- Editable / Toggleable Hot Pill -->
          <button type="button" class="btn" id="toggle-hot-btn" style="border:none; cursor:${currentRole === 'admin' ? 'pointer' : 'default'}; padding:0;" title="${currentRole === 'admin' ? 'Click to toggle Hot status' : 'Hot status'}">
            ${school.hot
              ? `<span class="badge-hot"><i class="fa-solid fa-fire"></i> Hot ${currentRole === 'admin' ? '✏️' : ''}</span>`
              : `<span style="font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px; background:#f1f5f9; color:#94a3b8; border:1px solid #e2e8f0;"><i class="fa-solid fa-fire"></i> Not Hot ${currentRole === 'admin' ? '✏️' : ''}</span>`
            }
          </button>

          <!-- Editable / Toggleable Verified / Official Pill -->
          <button type="button" class="btn" id="toggle-official-btn" style="border:none; cursor:${currentRole === 'admin' ? 'pointer' : 'default'}; padding:0;" title="${currentRole === 'admin' ? 'Click to toggle Official DfE status' : 'Official status'}">
            ${school.official
              ? `<span class="badge-official"><i class="fa-solid fa-circle-check"></i> Official DfE ${currentRole === 'admin' ? '✏️' : ''}</span>`
              : `<span style="font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px; background:#f1f5f9; color:#94a3b8; border:1px solid #e2e8f0;"><i class="fa-solid fa-circle-question"></i> Unofficial ${currentRole === 'admin' ? '✏️' : ''}</span>`
            }
          </button>
        </div>
      </div>

      <p style="margin-bottom: 1.5rem; color: #334155; font-size: 0.95rem;">${school.description || 'No summary description provided.'}</p>

      <div class="detail-sections-grid">
        ${admissionsUnifiedHtml}

        <div class="detail-box" style="grid-column: 1 / -1;">
          <h4><i class="fa-solid fa-chart-line"></i> Academic Metrics & GCSE</h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.6rem; font-size: 0.85rem; color: #475569;">
            <p><strong>Pupil Count:</strong> ${school.pupilCount ? school.pupilCount.toLocaleString() : 'N/A'}</p>
            <p><strong>GCSE Attainment 8:</strong> ${school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined ? school.gcseAttainment8 : 'N/A'}</p>
            <p><strong>Progress 8 Score:</strong> ${school.gcseProgress8 !== null && school.gcseProgress8 !== undefined ? school.gcseProgress8 : 'N/A'}</p>
            <p><strong>EBacc Average Point Score:</strong> ${school.ebaccAveragePointScore !== null && school.ebaccAveragePointScore !== undefined ? school.ebaccAveragePointScore : 'N/A'}</p>
          </div>
          <div style="margin-top: 0.8rem; border-top: 1px dashed #cbd5e1; padding-top: 0.6rem;">
            <strong>Offered GCSE Subjects (${school.gcseSubjects ? school.gcseSubjects.length : 0}):</strong>
            <div class="subjects-tags" style="margin-top: 0.4rem;">${subjectsHtml}</div>
          </div>
        </div>
      </div>

      <div style="margin-top: 1.5rem; display: flex; gap: 0.75rem; flex-wrap:wrap; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
        ${school.website ? `<a href="${school.website}" target="_blank" class="btn btn-primary"><i class="fa-solid fa-globe"></i> Official Website</a>` : ''}
        ${school.compareSchoolPerformanceUrl ? `<a href="${school.compareSchoolPerformanceUrl}" target="_blank" class="btn btn-outline" style="color:#059669; border-color:#6ee7b7;"><i class="fa-solid fa-chart-bar"></i> Compare School Performance</a>` : ''}
        ${school.phone ? `<a href="tel:${school.phone}" class="btn btn-outline"><i class="fa-solid fa-phone"></i> ${school.phone}</a>` : ''}
        ${school.email ? `<a href="mailto:${school.email}" class="btn btn-outline"><i class="fa-solid fa-envelope"></i> Email School</a>` : ''}
      </div>
    `;

    // Wire toggle listeners for Admin role
    const hotBtn = document.getElementById('toggle-hot-btn');
    if (hotBtn && currentRole === 'admin') {
      hotBtn.addEventListener('click', async () => {
        const newHot = !school.hot;
        await updateSchoolPill(school.id, { hot: newHot });
        showToast(`School status updated: ${newHot ? 'Marked as Hot 🔥' : 'Removed Hot status'}`);
        openSchoolDetail(school.id);
        await loadSchools();
      });
    }

    const officialBtn = document.getElementById('toggle-official-btn');
    if (officialBtn && currentRole === 'admin') {
      officialBtn.addEventListener('click', async () => {
        const newOfficial = !school.official;
        await updateSchoolPill(school.id, { official: newOfficial });
        showToast(`School status updated: ${newOfficial ? 'Marked as Official DfE ✓' : 'Marked as Unofficial'}`);
        openSchoolDetail(school.id);
        await loadSchools();
      });
    }

    document.getElementById('detail-modal').style.display = 'flex';

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

// Utility debounce
function debounce(func, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

