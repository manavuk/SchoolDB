# SchoolDB Project Context & Architecture Reference

> **Fast Reference for AI Agent**: Maintained map of the application architecture, database layer, API endpoints, frontend architecture, and verification systems.

---

## 1. Application Overview
- **Name**: England & Greater London High Schools Directory & Admissions Intelligence Portal (EduLondon DB / SchoolDB)
- **Stack**: Pure Vanilla JS / HTML5 / CSS3 frontend (no bundler/framework build step), Node.js Express backend (`server.js`), Node SQLite sync database (`db.js` with `node:sqlite`).
- **Port**: 3000 (configurable via `PORT` env var).
- **Session & Auth**: Custom session tokens via header `x-session-id`, 30-day persistence in SQLite `sessions` table. Google OAuth + email/password auth. Superadmin account `aa@bb.cc`.
- **Database Storage**: `data/schooldb.sqlite` (production) and `data/schooldb_test.sqlite` (test instance), with live instance switching configured via `data/active_instance.json`.

---

## 2. Directory Structure & Key Files
```
/
├── server.js               # Express server, REST endpoints, auth middleware, scanner endpoints
├── db.js                   # SQLite DAO, schema definitions, anomalies engine, verification DAO
├── package.json            # Scripts & minimal dependencies (express, cors)
├── .env                    # Environment variables (OAuth keys, port)
├── data/
│   ├── schooldb.sqlite     # Production SQLite database (6,497+ schools)
│   ├── schooldb_test.sqlite# Test sandbox database
│   ├── active_instance.json# Points to 'production' or 'test'
│   └── admissions_knowledge_matrix.json # Consortia & exam formats rule engine
├── public/
│   ├── index.html          # Main single-page interface (Parent Portal 2.0 & Admin Portal)
│   ├── js/
│   │   └── app.js          # Core frontend application logic, state, renderers, modals
│   └── css/
│       └── styles.css      # Core styles, glassmorphism, responsive data tables, badge pills
└── scripts/
    ├── scanner_verifier.js # Automated web crawler, content verifier & admissions date auditor
    ├── enrich_*.js         # Consortia & DfE enrichment batch scripts
    └── test_*.js           # Automated backend/frontend test scripts
```

---

## 3. Database Schema (`db.js`)
### Main Tables:
- **`schools`**:
  - Primary fields: `id`, `name`, `urn`, `la`, `region`, `postcode`, `address`, `schoolType`, `rawSchoolType`, `gender`, `ageRange`, `pupilCount`, `ofstedRating`, `gcseProgress8`, `gcseAttainment8`, `ebaccAveragePointScore`.
  - Admissions & dates: `entranceExamType`, `entranceExamDates` (JSON string containing `registrationOpen`, `registrationDeadline`, `examDate`, `secondExamDate`, `resultsDate`, `interviewInfo`, `offersAcceptance`), `admissionsPolicy`.
  - Contact: `website`, `phone`, `email`, `description`.
  - Verification & Metadata: `verification_status`, `verification_tags` (JSON array), `verification_report` (JSON object), `verified_at`, `confidence_score`, `pillaiDetails`, `kpsDetails`, `extra_json`.
- **`users`**: `id`, `name`, `email`, `password`, `permissions` (JSON array), `createdAt`.
- **`sessions`**: `token`, `userId`, `expiresAt`, `createdAt`.
- **`user_portfolios`**: User shortlists, custom target notes, tracking stages.
- **`user_field_reports`**: Community crowd-sourced corrections.
- **`field_confidence_votes`**: Granular confidence voting (`+1` / `-1`).
- **`admin_field_reviews`**: Admin overrides and audit history.

---

## 4. Admin Portal & Anomaly Review Architecture
### Admin Subtabs:
1. **Directory View** (`#admin-subpane-directory`): School search, filters, CRUD modals, bulk operations.
2. **Bulk Edit** (`#admin-subpane-bulk-edit`): Multi-record updates, field-level editing.
3. **Data Corrections** (`#admin-subpane-corrections`): Community feedback & user reports triage.
4. **Date Anomaly & Web Verification Review** (`#admin-subpane-date-anomalies`):
   - KPI counters: Verified schools, anomalies count, missing websites, missing data, quality score.
   - Categorized sections / tabs:
     - **Active Web & Date Anomalies** (`date_mismatch`, `chrono_inversion`, `contact_mismatch`, `domain_mismatch`)
     - **Missing Website Schools** (`missing_website`, `dead_website`)
     - **Missing Admissions Data** (`auto_verification_data_missing`)
     - **Auto-Verified Schools** (`auto_verified`)
   - Interactive verification actions: Scan single school, batch scan queue by priority, apply proposed fixes, manual override.
5. **Merge & De-Duplicate** (`#admin-subpane-merge`): Duplicate record candidate matching and merging.
6. **Import & Export** (`#admin-subpane-import-export`): CSV verification preview, DfE ingestion.
7. **Settings** (`#admin-subpane-settings`): Database instance switcher (Prod vs Test), Parent Portal 2.0 feature flag, Automated Web Scanner skip window (`scannerSkipDays`: default 10 days, 0 = scan every time, max 100 days), recommendation weights.

---

## 5. Verification & Scanner Priority Pipeline
1. **Queue Priority & Cache / Skip Window**:
   - Configurable `scannerSkipDays` (0–100 days, default 10 days). If a school was verified within the last *n* days, batch crawler automatically skips it unless *n = 0*.
   - Priority 1: London Area Independent Schools (`region = 'Greater London'` & `schoolType = 'Independent'`)
   - Priority 2: Other Independent Schools (`schoolType = 'Independent'`)
   - Priority 3: Selective Grammar Schools (`schoolType = 'Grammar'`)
   - Priority 4: State Comprehensive Schools (`schoolType = 'Comprehensive'`)
   - Priority 5: All Remaining Schools
2. **Verification Criteria & Tag Taxonomy**:
   - `auto_verified`: School website active, identity matches, contact valid, and 11+ dates valid and aligned with web/consortium. Boosts confidence score to High (95%+).
   - `missing_website`: School has no website URL recorded or URL is unreachable (DNS/404/SSL fail). Flagged in dedicated "Missing Websites" review bucket.
   - `auto_verification_data_missing`: School website reachable, but no 11+ admissions schedule / dates found on pages.
   - `contact_mismatch`: Mismatch found in phone or email (contact contains phone and email only; postcodes are part of address).
   - `domain_mismatch`: Website exists but title / contents suggest domain squatter, unrelated entity, or wrong school name.
   - `exam_type_mismatch`: Entrance exam format/board (e.g., GL Assessment, ISEB, London Consortium, CSSE, Non-Selective) differs from web admissions policy.
   - `gender_mismatch`: Gender policy (Boys, Girls, Mixed/Co-ed) differs from verified school website.
   - `date_mismatch`: Proposed or web-crawled 11+ dates differ from database record.
   - `chrono_inversion`: Admission dates out of logical chronological sequence.
   - `outdated_cycle`: Dates reference past cycles (e.g. 2024 or 2025 past dates without 2026/2027 updates).

---

## 6. Background Web Crawler & Scanner Endpoints
- `POST /api/admin/scanner/start-batch-scan` & `POST /api/admin/scanner/batch-scan`: Asynchronously spawns non-blocking concurrent worker pool (4 parallel threads, 3.5s timeout) to audit prioritized batch with `skipDays` support.
- `GET /api/admin/scanner/status`: Real-time polling endpoint returning progress (`scannedCount`, `totalQueued`, `currentSchool`, `stats`, `recentResults`).
- `POST /api/admin/scanner/stop`: Signals cancellation to running background worker.
- `POST /api/admin/scanner/verify-school/:id`: Live on-demand single school audit.
- `POST /api/admin/scanner/apply-fixes` & `apply-all-fixes`: Single & bulk verified data patch application.

---

## 7. Testing & Operational Commands
- Start dev server: `npm start` (or `node server.js`)
- Run verification tests: `node scripts/test_scanner_verifier.js`, `node scripts/test_background_scanner.js`, `node scripts/test_date_anomalies_engine.js`
