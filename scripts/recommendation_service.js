/**
 * Intelligent School Recommendation Service
 *
 * Implements a multi-dimensional recommendation engine leveraging:
 * - Strict Hard Filter Elimination (Set-Theoretic Gender Matrix)
 * - Adaptive School Type Filtering (Hard when explicitly selected, soft affinity when unselected)
 * - Continuous Postcode Proximity Scoring via postcode_distance_engine
 * - Elevated Entrance Exam Type Affinity (analyzing user preferences & shortlisted schools)
 * - Elevated Child Ability & Academic Matching (Top 500 League Tables, Attainment 8 & Progress 8)
 * - Asymmetric Ofsted Scoring (Modest boost for Outstanding/Good, severe penalty for Requires Improvement)
 * - Latent Profile Extraction from User Shortlisted Schools
 */

const { getPostcodeCoordinatesSync, osgb36Distance, haversineDistance, normalizePostcode, isValidUkPostcode } = require('./postcode_distance_engine');

/**
 * Filter schools by strict gender requirements
 */
function passesGenderFilter(school, genderList) {
  if (!genderList || genderList.length === 0 || genderList.includes('NA') || genderList.includes('all')) {
    return true;
  }

  const rawGender = (school.gender || '').toLowerCase().trim();
  const isBoysOnly = rawGender.includes('boy') && !rawGender.includes('girl');
  const isGirlsOnly = rawGender.includes('girl') && !rawGender.includes('boy');
  const isMixed = rawGender.includes('mixed') || rawGender.includes('co-ed') || rawGender.includes('coeducational');

  const wantsBoys = genderList.includes('boys');
  const wantsGirls = genderList.includes('girls');
  const wantsMixed = genderList.includes('mixed') || genderList.includes('co-ed');

  // Case 1: All three selected -> Any school
  if (wantsBoys && wantsGirls && wantsMixed) return true;

  // Case 2: Only girls selected -> Strictly girls only
  if (wantsGirls && !wantsBoys && !wantsMixed) return isGirlsOnly;

  // Case 3: Only boys selected -> Strictly boys only
  if (wantsBoys && !wantsGirls && !wantsMixed) return isBoysOnly;

  // Case 4: Only mixed selected -> Strictly mixed only
  if (wantsMixed && !wantsBoys && !wantsGirls) return isMixed;

  // Case 5: Girls + Mixed selected -> Any school accepting girls (girls-only OR mixed; strictly NO boys-only)
  if (wantsGirls && wantsMixed && !wantsBoys) return isGirlsOnly || isMixed;

  // Case 6: Boys + Mixed selected -> Any school accepting boys (boys-only OR mixed; strictly NO girls-only)
  if (wantsBoys && wantsMixed && !wantsGirls) return isBoysOnly || isMixed;

  // Case 7: Boys + Girls selected -> Single-sex schools only (boys-only OR girls-only; NO mixed)
  if (wantsBoys && wantsGirls && !wantsMixed) return isBoysOnly || isGirlsOnly;

  return true;
}

/**
 * Check if school matches explicitly selected school types
 */
function passesSchoolTypeFilter(school, requiredTypes) {
  if (!requiredTypes || requiredTypes.length === 0 || requiredTypes.includes('NA') || requiredTypes.includes('all')) {
    return true;
  }

  const st = (school.schoolType || '').toLowerCase();
  return requiredTypes.some(t => {
    const typeKey = t.toLowerCase().trim();
    if (typeKey === 'grammar') return st.includes('grammar');
    if (typeKey === 'independent') return st.includes('independent');
    if (typeKey === 'comprehensive') return st.includes('comprehensive') || st.includes('academy') || st.includes('community');
    return st.includes(typeKey);
  });
}

/**
 * Extract exam board/format signature from a school
 */
function extractExamSignature(school) {
  const parts = [];
  const et = (school.entranceExamType || '').toLowerCase();
  const s1 = (school.stage_one_format_and_subjects || '').toLowerCase();
  const s2 = (school.stage_two_format_and_subjects || '').toLowerCase();
  const dates = school.entranceExamDates || {};
  const board = (dates.examBoard || '').toLowerCase();

  const combined = `${et} ${s1} ${s2} ${board}`;

  if (combined.includes('two-stage') || combined.includes('stage 2') || combined.includes('second stage') || school.second_stage_exam_required === 'Yes') {
    parts.push('two_stage');
  }
  if (combined.includes('cem')) parts.push('cem');
  if (combined.includes('gl assessment') || combined.includes('gl')) parts.push('gl');
  if (combined.includes('iseb')) parts.push('iseb');
  if (combined.includes('csse')) parts.push('csse');
  if (combined.includes('set') || combined.includes('selective eligibility')) parts.push('sutton_set');
  if (combined.includes('bexley')) parts.push('bexley');
  if (combined.includes('kent')) parts.push('kent');
  if (school.examConsortium) {
    const ec = school.examConsortium.toLowerCase();
    if (ec.includes('sutton')) parts.push('sutton_set');
    if (ec.includes('kent')) parts.push('kent');
    if (ec.includes('slough')) parts.push('slough');
    if (ec.includes('bexley')) parts.push('bexley');
    if (ec.includes('csse')) parts.push('csse');
    if (ec.includes('trafford')) parts.push('trafford');
    if (ec.includes('birmingham')) parts.push('birmingham');
  }

  return parts;
}

/**
 * Calculate distance between a source coordinate and a school postcode
 */
function calculateDistanceToSchool(sourceCoords, schoolPostcode) {
  if (!sourceCoords || !schoolPostcode) return null;
  const schoolCoords = getPostcodeCoordinatesSync(schoolPostcode);
  if (!schoolCoords) return null;

  if (sourceCoords.easting && sourceCoords.northing && schoolCoords.easting && schoolCoords.northing) {
    const osgb = osgb36Distance(sourceCoords.easting, sourceCoords.northing, schoolCoords.easting, schoolCoords.northing);
    return { miles: osgb.miles, km: osgb.km, schoolCoords };
  } else {
    const hav = haversineDistance(sourceCoords.lat, sourceCoords.lon, schoolCoords.lat, schoolCoords.lon);
    return { miles: hav.miles, km: hav.km, schoolCoords };
  }
}

/**
 * Evaluate recommendations for a parent
 */
function evaluateRecommendations({
  allSchools = [],
  userSchools = [],
  targetLocation = '',
  removedSchoolIds = [],
  genderChoice = 'all',
  preferencesOverride = null
}) {
  const removedSet = new Set(removedSchoolIds);
  const userSchoolSet = new Set(userSchools.map(s => s.id));

  // Base pool: Exclude already shortlisted or dismissed schools
  let candidates = allSchools.filter(s => !userSchoolSet.has(s.id) && !removedSet.has(s.id));

  const binaryFilters = preferencesOverride?.binaryFilters || {};
  const qualWeights = preferencesOverride?.qualitativeWeights || {};
  const childAbility = preferencesOverride?.childAbilityLevel || 'NA';

  // -------------------------------------------------------------
  // LATENT SHORTLIST ATTRIBUTE EXTRACTION
  // -------------------------------------------------------------
  const shortlistGenders = new Set();
  const shortlistSchoolTypes = new Set();
  const userExamSignatures = new Set();
  let userAvgAttainment = 0;
  let userAttainmentCount = 0;

  userSchools.forEach(us => {
    // Latent Gender
    const g = (us.gender || '').toLowerCase().trim();
    if (g.includes('girl') && !g.includes('boy')) {
      shortlistGenders.add('girls');
    } else if (g.includes('boy') && !g.includes('girl')) {
      shortlistGenders.add('boys');
    } else if (g.includes('mixed') || g.includes('co-ed') || g.includes('coeducational')) {
      shortlistGenders.add('mixed');
    }

    // Latent School Type
    const st = (us.schoolType || '').toLowerCase().trim();
    if (st.includes('grammar')) shortlistSchoolTypes.add('grammar');
    else if (st.includes('independent')) shortlistSchoolTypes.add('independent');
    else if (st.includes('comprehensive') || st.includes('academy') || st.includes('community')) shortlistSchoolTypes.add('comprehensive');
    else if (st) shortlistSchoolTypes.add(st);

    // Latent Exam Signatures
    extractExamSignature(us).forEach(sig => userExamSignatures.add(sig));

    // Academic Attainment
    if (typeof us.gcseAttainment8 === 'number') {
      userAvgAttainment += us.gcseAttainment8;
      userAttainmentCount++;
    }
  });

  const benchmarkAttainment = userAttainmentCount > 0 ? (userAvgAttainment / userAttainmentCount) : 65;

  // -------------------------------------------------------------
  // STAGE 1: HARD BINARY FILTERS
  // -------------------------------------------------------------

  // 1. Strict Gender Filter with Shortlist Attribute Union
  let explicitGenderList = [];
  const rawGender = binaryFilters.gender && binaryFilters.gender !== 'NA' ? binaryFilters.gender : genderChoice;
  if (Array.isArray(rawGender)) {
    explicitGenderList = rawGender.filter(g => g && g !== 'NA' && g !== 'all');
  } else if (typeof rawGender === 'string' && rawGender !== 'all' && rawGender !== 'NA' && rawGender !== '') {
    explicitGenderList = rawGender.split(',').map(s => s.trim().toLowerCase()).filter(g => g && g !== 'na' && g !== 'all');
  }

  const hasExplicitGenderFilter = explicitGenderList.length > 0;
  let effectiveGenderList = [];

  if (hasExplicitGenderFilter) {
    // If a filter is set, still use the 'union' of selected filters and shortlisted schools
    const unionGenders = new Set([...explicitGenderList, ...shortlistGenders]);
    effectiveGenderList = Array.from(unionGenders);
  } else if (shortlistGenders.size > 0) {
    // In absence of filter selections, use the 'union' of selected school attributes for recommendation
    effectiveGenderList = Array.from(shortlistGenders);
  }

  if (effectiveGenderList.length > 0) {
    candidates = candidates.filter(s => passesGenderFilter(s, effectiveGenderList));
  }

  // 2. Adaptive School Type Filter with Shortlist Union
  const rawTypes = binaryFilters.schoolTypes;
  let isExplicitTypeFilter = false;
  let explicitTypes = [];
  if (Array.isArray(rawTypes)) {
    explicitTypes = rawTypes.filter(t => t && t !== 'NA' && t !== 'all');
    if (explicitTypes.length > 0) isExplicitTypeFilter = true;
  } else if (typeof rawTypes === 'string' && rawTypes !== 'NA' && rawTypes !== 'all' && rawTypes !== '') {
    explicitTypes = [rawTypes.trim()];
    isExplicitTypeFilter = true;
  }

  if (isExplicitTypeFilter) {
    // If a filter is set, use the 'union' of selected filters and shortlisted schools
    const unionTypes = new Set([...explicitTypes.map(t => t.toLowerCase().trim()), ...shortlistSchoolTypes]);
    candidates = candidates.filter(s => passesSchoolTypeFilter(s, Array.from(unionTypes)));
  }

  // 3. Ofsted Floor (if explicitly set)
  const ofstedFloor = (binaryFilters.ofstedFloor || '').toLowerCase().trim();
  if (ofstedFloor === 'outstanding') {
    candidates = candidates.filter(s => {
      const o = (s.ofstedRating || '').toLowerCase();
      return o.includes('outstanding') || o.includes('excellent');
    });
  } else if (ofstedFloor === 'good') {
    candidates = candidates.filter(s => {
      const o = (s.ofstedRating || '').toLowerCase();
      return o.includes('outstanding') || o.includes('excellent') || o.includes('good');
    });
  }

  // -------------------------------------------------------------
  // STAGE 2: LATENT USER PROFILE EXTRACTION
  // -------------------------------------------------------------

  // Geographic anchor: User input location or centroid of user's saved schools
  let userCoords = null;
  let targetLocationClean = (binaryFilters.locations || preferencesOverride?.targetPostcode || preferencesOverride?.targetBorough || targetLocation || '').trim();

  if (targetLocationClean && isValidUkPostcode(targetLocationClean)) {
    userCoords = getPostcodeCoordinatesSync(targetLocationClean);
  }

  // If user didn't provide a valid postcode but has saved schools, calculate centroid of saved schools
  if (!userCoords && userSchools.length > 0) {
    let sumE = 0, sumN = 0, count = 0;
    userSchools.forEach(us => {
      if (us.postcode) {
        const c = getPostcodeCoordinatesSync(us.postcode);
        if (c && c.easting && c.northing) {
          sumE += c.easting;
          sumN += c.northing;
          count++;
        }
      }
    });
    if (count > 0) {
      userCoords = {
        lat: 0, lon: 0,
        easting: Math.round(sumE / count),
        northing: Math.round(sumN / count),
        precision: 'centroid',
        source: 'User Shortlist Centroid'
      };
    }
  }

  // -------------------------------------------------------------
  // STAGE 3: MULTI-DIMENSIONAL SCORING ENGINE (0-100%)
  // -------------------------------------------------------------

  const QUALITATIVE_MULTIPLIERS = {
    'NA': 0.50,
    'not_important': 0.25,
    'somewhat': 0.60,
    'very': 0.85,
    'top_priority': 1.00
  };

  const wProxMult = QUALITATIVE_MULTIPLIERS[qualWeights.proximity] ?? 0.60;
  const wAcadMult = QUALITATIVE_MULTIPLIERS[qualWeights.academicExcellence] ?? 0.85;
  const wProgMult = QUALITATIVE_MULTIPLIERS[qualWeights.pupilProgress] ?? 0.60;

  const scored = candidates.map(candidate => {
    let proximityScore = 0.50;
    let distanceMiles = null;
    let distanceKm = null;
    const reasons = [];

    // --- Component 1: Distance & Proximity Curve ---
    if (userCoords && candidate.postcode) {
      const dist = calculateDistanceToSchool(userCoords, candidate.postcode);
      if (dist) {
        distanceMiles = dist.miles;
        distanceKm = dist.km;

        if (dist.miles <= 3.0) {
          proximityScore = 1.00;
          reasons.push(`${dist.miles.toFixed(1)} miles away • Very close commute`);
        } else if (dist.miles <= 6.0) {
          proximityScore = 0.88;
          reasons.push(`${dist.miles.toFixed(1)} miles away • Within local radius`);
        } else if (dist.miles <= 10.0) {
          proximityScore = 0.72;
          reasons.push(`~${dist.miles.toFixed(1)} miles away`);
        } else if (dist.miles <= 15.0) {
          proximityScore = 0.52;
        } else if (dist.miles <= 25.0) {
          proximityScore = 0.32;
        } else {
          proximityScore = 0.12;
        }
      }
    } else if (targetLocationClean) {
      // Fallback borough / text match
      const tok = targetLocationClean.toLowerCase();
      const la = (candidate.la || '').toLowerCase();
      const pc = (candidate.postcode || '').toLowerCase();
      if (la.includes(tok) || pc.includes(tok)) {
        proximityScore = 0.85;
        reasons.push(`Located in ${candidate.la}`);
      }
    }

    // --- Component 2: Elevated Entrance Exam Type Affinity (25% Weight) ---
    let examScore = 0.50;
    const candidateExamSigs = extractExamSignature(candidate);

    // Check user explicit exam format
    const explicitExams = Array.isArray(binaryFilters.examFormats) ? binaryFilters.examFormats.filter(f => f && f !== 'NA' && f !== 'all') : [];
    if (explicitExams.length > 0) {
      const et = (candidate.entranceExamType || '').toLowerCase();
      const matchesExplicit = explicitExams.some(f => et.includes(f.toLowerCase()));
      if (matchesExplicit) {
        examScore = 1.00;
        reasons.push(`Matches requested exam format: ${candidate.entranceExamType}`);
      } else if (userExamSignatures.size > 0 && candidateExamSigs.some(s => userExamSignatures.has(s))) {
        examScore = 0.80;
        reasons.push('Compatible admissions format from shortlisted schools');
      } else {
        examScore = 0.40;
      }
    } else if (userExamSignatures.size > 0 && candidateExamSigs.length > 0) {
      // Check intersection with shortlisted schools
      const matchingSigs = candidateExamSigs.filter(s => userExamSignatures.has(s));
      if (matchingSigs.length > 0) {
        examScore = 0.95;
        if (matchingSigs.includes('two_stage')) {
          reasons.push('Compatible admissions format: 11+ Two-Stage Assessment');
        } else if (matchingSigs.includes('sutton_set')) {
          reasons.push('Shares Sutton Selective Eligibility Test (SET)');
        } else if (matchingSigs.includes('cem')) {
          reasons.push('Shares CEM 11+ entrance assessment');
        } else if (matchingSigs.includes('gl')) {
          reasons.push('Shares GL Assessment 11+ format');
        } else {
          reasons.push('Matches entrance exam type of your shortlisted schools');
        }
      } else {
        examScore = 0.40;
      }
    }

    // --- Component 3: Elevated Child Ability & Academic Matching (25% Weight) ---
    let academicScore = 0.50;
    const natRank = candidate.national_rank_england;
    const gcseRank = candidate.gcse_rank_england;
    const attainment = typeof candidate.gcseAttainment8 === 'number' ? candidate.gcseAttainment8 : null;
    const progress = typeof candidate.gcseProgress8 === 'number' ? candidate.gcseProgress8 : null;

    if (childAbility === 'top_class') {
      // High Academic - 11+ Selective
      const isTop100 = (natRank && natRank <= 100) || (gcseRank && gcseRank <= 100) || (candidate.a_level_rank_england && candidate.a_level_rank_england <= 100);
      if (isTop100) {
        academicScore = 1.00;
        const rankNum = natRank || gcseRank || candidate.a_level_rank_england;
        reasons.push(`Top 100 League Table School in England (#${rankNum})`);
      } else if (natRank && natRank <= 250) {
        academicScore = 0.94;
        reasons.push(`Top 250 School in England (#${natRank} National)`);
      } else if (attainment && attainment >= 70) {
        academicScore = 0.90;
        reasons.push(`Outstanding GCSE Attainment 8 (${attainment})`);
      } else if (natRank && natRank <= 500) {
        academicScore = 0.85;
        reasons.push(`Top 500 School in England (#${natRank} National)`);
      } else {
        academicScore = 0.45;
      }
    } else if (childAbility === 'above_average') {
      if (attainment && attainment >= 60) {
        academicScore = 0.92;
        reasons.push(`Strong GCSE Attainment 8 (${attainment})`);
      } else if (natRank && natRank <= 400) {
        academicScore = 0.85;
        reasons.push(`Ranked #${natRank} in England League Tables`);
      } else if (progress && progress >= 0.35) {
        academicScore = 0.85;
        reasons.push(`High Pupil Progress (+${progress})`);
      } else {
        academicScore = 0.60;
      }
    } else if (childAbility === 'average' || childAbility === 'below_average') {
      // Nurturing Growth & Progress 8 priority
      if (progress !== null && progress >= 0.50) {
        academicScore = 1.00;
        reasons.push(`Top 5% Student Growth in England (Progress 8: +${progress})`);
      } else if (progress !== null && progress >= 0.20) {
        academicScore = 0.85;
        reasons.push(`Above Average Pupil Growth (Progress 8: +${progress})`);
      } else if (progress !== null && progress >= 0.0) {
        academicScore = 0.70;
      } else {
        academicScore = 0.40;
      }
    } else {
      // General match
      if (natRank && natRank <= 100) {
        academicScore = 0.95;
        reasons.push(`Top 100 School in England (#${natRank})`);
      } else if (attainment && attainment >= 65) {
        academicScore = 0.85;
        reasons.push(`High Academic Attainment 8 (${attainment})`);
      } else if (progress && progress >= 0.40) {
        academicScore = 0.80;
        reasons.push(`Strong Progress 8 Growth (+${progress})`);
      }
    }

    // --- Component 4: Progress 8 Standalone Value-Add ---
    let progressScore = 0.50;
    if (progress !== null) {
      if (progress >= 0.70) progressScore = 1.00;
      else if (progress >= 0.40) progressScore = 0.85;
      else if (progress >= 0.00) progressScore = 0.65;
      else progressScore = 0.35;
    }

    // --- Component 5: School Type Affinity with Filter Priority (15% Weight) ---
    let typeAffinityScore = 0.50;
    if (isExplicitTypeFilter) {
      if (passesSchoolTypeFilter(candidate, explicitTypes)) {
        typeAffinityScore = 1.00;
        reasons.push(`Matches requested school type: ${candidate.schoolType}`);
      } else if (passesSchoolTypeFilter(candidate, Array.from(shortlistSchoolTypes))) {
        typeAffinityScore = 0.70;
        reasons.push(`Shares school type with shortlisted schools (${candidate.schoolType})`);
      } else {
        typeAffinityScore = 0.40;
      }
    } else if (shortlistSchoolTypes.size > 0 && candidate.schoolType) {
      if (passesSchoolTypeFilter(candidate, Array.from(shortlistSchoolTypes))) {
        typeAffinityScore = 0.90;
        reasons.push(`Matches school type of your shortlisted schools (${candidate.schoolType})`);
      } else if (candidate.schoolType.includes('Grammar') && shortlistSchoolTypes.has('independent')) {
        typeAffinityScore = 0.75; // Selective grammar is good alternative to independent
      }
    }

    // --- Component 6: Asymmetric Ofsted Scoring ---
    // Modest reward for Outstanding (+4 pts), Severe penalty for Requires Improvement (-30 pts)
    let ofstedBonusOrPenalty = 0;
    const ofstedStr = (candidate.ofstedRating || '').toLowerCase();
    if (ofstedStr.includes('outstanding') || ofstedStr.includes('excellent')) {
      ofstedBonusOrPenalty = 4;
      reasons.push('Ofsted Outstanding');
    } else if (ofstedStr.includes('good')) {
      ofstedBonusOrPenalty = 2;
    } else if (ofstedStr.includes('requires improvement') || ofstedStr.includes('special measures') || ofstedStr.includes('inadequate')) {
      ofstedBonusOrPenalty = -30; // Heavy penalty
    }

    // --- Component 7: Gender Filter Priority Weightage ---
    let genderExplicitBonus = 0;
    if (hasExplicitGenderFilter) {
      if (passesGenderFilter(candidate, explicitGenderList)) {
        genderExplicitBonus = 8;
        reasons.unshift(`Matches requested gender: ${candidate.gender}`);
      } else if (shortlistGenders.size > 0 && passesGenderFilter(candidate, Array.from(shortlistGenders))) {
        genderExplicitBonus = 0;
        reasons.unshift(`Matches gender of your shortlisted schools (${candidate.gender})`);
      }
    } else if (shortlistGenders.size > 0) {
      reasons.unshift(`Matches gender of your shortlisted schools (${candidate.gender})`);
    }

    // --- Weighted Composite Calculation ---
    const weightProximity = wProxMult * 20;
    const weightExam = 25;
    const weightAcademic = wAcadMult * 25;
    const weightProgress = wProgMult * 15;
    const weightType = 15;

    const totalWeight = weightProximity + weightExam + weightAcademic + weightProgress + weightType;

    const rawComposite = (
      (proximityScore * weightProximity) +
      (examScore * weightExam) +
      (academicScore * weightAcademic) +
      (progressScore * weightProgress) +
      (typeAffinityScore * weightType)
    ) / totalWeight * 100;

    let finalScore = Math.round(rawComposite + ofstedBonusOrPenalty + genderExplicitBonus);
    finalScore = Math.max(15, Math.min(99, finalScore)); // Clamp between 15% and 99%

    // Deduplicate reasons and keep top 4
    const uniqueReasons = [...new Set(reasons)].slice(0, 4);
    if (uniqueReasons.length === 0) {
      uniqueReasons.push(candidate.schoolType ? `${candidate.schoolType} secondary school` : 'High school recommendation');
    }

    // Attach computed distance to candidate object so UI card can show it if available
    const enrichedCandidate = {
      ...candidate,
      distanceMiles: distanceMiles !== null ? distanceMiles : candidate.distanceMiles,
      distanceKm: distanceKm !== null ? distanceKm : candidate.distanceKm,
      distanceFormatted: distanceMiles !== null ? `${distanceMiles.toFixed(1)} mi` : undefined
    };

    return {
      school: enrichedCandidate,
      matchScore: finalScore,
      reasons: uniqueReasons
    };
  });

  // Sort highest match score first
  scored.sort((a, b) => b.matchScore - a.matchScore);

  return {
    totalCandidates: candidates.length,
    recommendations: scored.slice(0, 30)
  };
}

module.exports = {
  passesGenderFilter,
  passesSchoolTypeFilter,
  extractExamSignature,
  evaluateRecommendations
};
