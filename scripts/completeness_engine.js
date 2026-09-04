/**
 * School Data Completeness Scoring Engine
 * 
 * Computes a normalized 0-100% completeness score for school records.
 * Higher weightage is given to high-value parent decision attributes:
 * - Official Website
 * - 11+ Entrance Exam Dates & Milestones (Reg Open, Close, Exam 1, Results, Offers)
 * - Exam Type & Format
 * Lower weightage is given to auxiliary metadata:
 * - Postal Address, Phone, Email, Headteacher, Capacity/Pupils
 */

const DEFAULT_COMPLETENESS_WEIGHTS = {
  website: 20,           // Official Website / Active URL
  examDates: 25,         // Entrance exam milestones (Registration, Exam, Results, Offers)
  examFormat: 15,        // Entrance Exam Type & Format / Stages
  schoolClassification: 10, // School Type (Grammar, Independent, Comprehensive) & Gender Policy
  academicOfsted: 10,    // Ofsted Rating, Ofsted Report, Attainment 8, National Rank
  contactChannels: 8,    // Phone, Email
  addressGeography: 6,   // Street Address, Postcode, LA, Region
  leadershipCapacity: 6  // Headteacher, Termly Fees (if independent), Total Pupils
};

/**
 * Evaluates the completeness of a single school record against configured category weights.
 * @param {Object} school - School database record
 * @param {Object} [customWeights] - Custom weights dictionary
 * @returns {Object} { score: number, percentage: number, maxWeight: number, earnedWeight: number, breakdown: Object }
 */
function evaluateSchoolCompleteness(school, customWeights = {}) {
  if (!school || typeof school !== 'object') {
    return { score: 0, percentage: 0, maxWeight: 100, earnedWeight: 0, breakdown: {} };
  }

  const weights = { ...DEFAULT_COMPLETENESS_WEIGHTS, ...customWeights };
  let earnedWeight = 0;
  let maxWeight = 0;
  const breakdown = {};

  // 1. Official Website (Weight: default 20)
  const wWebsite = Math.max(0, Number(weights.website) || 0);
  maxWeight += wWebsite;
  const hasWebsite = Boolean(school.website && typeof school.website === 'string' && school.website.trim().startsWith('http'));
  const earnedWebsite = hasWebsite ? wWebsite : 0;
  earnedWeight += earnedWebsite;
  breakdown.website = {
    weight: wWebsite,
    earned: earnedWebsite,
    passed: hasWebsite,
    label: 'Official Website'
  };

  // 2. 11+ Entrance Exam Dates & Key Milestones (Weight: default 25)
  const wExamDates = Math.max(0, Number(weights.examDates) || 0);
  maxWeight += wExamDates;
  let datesObj = school.entranceExamDates;
  if (typeof datesObj === 'string') {
    try { datesObj = JSON.parse(datesObj); } catch (e) { datesObj = null; }
  }
  datesObj = datesObj && typeof datesObj === 'object' ? datesObj : {};

  // Check milestone presence (registrationOpen, deadline/close, examDate, resultsDate, offers)
  const milestoneKeys = ['registrationOpen', 'registrationDeadline', 'examDate', 'resultsDate', 'offersAcceptance'];
  const populatedMilestones = milestoneKeys.filter(k => {
    const val = datesObj[k] || datesObj[k.toLowerCase()] || school[k];
    return Boolean(val && typeof val === 'string' && val.trim() !== '' && !val.toLowerCase().includes('tbc') && !val.toLowerCase().includes('n/a'));
  });

  // Scale earned weight proportionately by number of populated milestones (at least 1 gives partial credit)
  const datesFraction = milestoneKeys.length > 0 ? (populatedMilestones.length / milestoneKeys.length) : 0;
  const earnedExamDates = Math.round(wExamDates * datesFraction);
  earnedWeight += earnedExamDates;
  breakdown.examDates = {
    weight: wExamDates,
    earned: earnedExamDates,
    passed: populatedMilestones.length >= 2,
    details: `${populatedMilestones.length}/${milestoneKeys.length} milestones present`,
    label: '11+ Admissions & Exam Dates'
  };

  // 3. Admissions & Exam Format (Weight: default 15)
  const wExamFormat = Math.max(0, Number(weights.examFormat) || 0);
  maxWeight += wExamFormat;
  const hasExamType = Boolean(school.entranceExamType && school.entranceExamType.trim() && !school.entranceExamType.toLowerCase().includes('unknown'));
  const hasStageInfo = Boolean(school.stage_one_format_and_subjects || school.second_stage_exam_required);
  const examFormatFraction = (hasExamType ? 0.7 : 0) + (hasStageInfo ? 0.3 : 0);
  const earnedExamFormat = Math.round(wExamFormat * Math.min(1, examFormatFraction));
  earnedWeight += earnedExamFormat;
  breakdown.examFormat = {
    weight: wExamFormat,
    earned: earnedExamFormat,
    passed: hasExamType,
    label: 'Exam Board & Admissions Format'
  };

  // 4. School Classification & Gender Policy (Weight: default 10)
  const wClass = Math.max(0, Number(weights.schoolClassification) || 0);
  maxWeight += wClass;
  const hasType = Boolean(school.schoolType && school.schoolType.trim());
  const hasGender = Boolean(school.gender && school.gender.trim());
  const classFraction = (hasType ? 0.6 : 0) + (hasGender ? 0.4 : 0);
  const earnedClass = Math.round(wClass * Math.min(1, classFraction));
  earnedWeight += earnedClass;
  breakdown.schoolClassification = {
    weight: wClass,
    earned: earnedClass,
    passed: hasType && hasGender,
    label: 'School Type & Gender Policy'
  };

  // 5. Academic Performance & Ofsted (Weight: default 10)
  const wAcademic = Math.max(0, Number(weights.academicOfsted) || 0);
  maxWeight += wAcademic;
  const hasOfsted = Boolean(school.ofstedRating && school.ofstedRating.trim() && !school.ofstedRating.toLowerCase().includes('unknown'));
  const hasGcse = Boolean(school.gcseAttainment8 !== null && school.gcseAttainment8 !== undefined && school.gcseAttainment8 !== '');
  const hasRank = Boolean(school.national_rank_england || school.gcse_rank_england);
  const academicFraction = (hasOfsted ? 0.5 : 0) + (hasGcse ? 0.3 : 0) + (hasRank ? 0.2 : 0);
  const earnedAcademic = Math.round(wAcademic * Math.min(1, academicFraction));
  earnedWeight += earnedAcademic;
  breakdown.academicOfsted = {
    weight: wAcademic,
    earned: earnedAcademic,
    passed: hasOfsted || hasGcse,
    label: 'Ofsted Rating & Academic Ranks'
  };

  // 6. Direct Contact Channels (Weight: default 8)
  const wContact = Math.max(0, Number(weights.contactChannels) || 0);
  maxWeight += wContact;
  const hasPhone = Boolean(school.phone && school.phone.trim() && school.phone.replace(/[^0-9]/g, '').length >= 7);
  const hasEmail = Boolean(school.email && school.email.trim() && school.email.includes('@'));
  const contactFraction = (hasPhone ? 0.5 : 0) + (hasEmail ? 0.5 : 0);
  const earnedContact = Math.round(wContact * Math.min(1, contactFraction));
  earnedWeight += earnedContact;
  breakdown.contactChannels = {
    weight: wContact,
    earned: earnedContact,
    passed: hasPhone && hasEmail,
    label: 'Direct Phone & Email'
  };

  // 7. Postal Address & Geography (Weight: default 6)
  const wAddress = Math.max(0, Number(weights.addressGeography) || 0);
  maxWeight += wAddress;
  const hasAddress = Boolean(school.address && school.address.trim());
  const hasPostcode = Boolean(school.postcode && school.postcode.trim());
  const hasLa = Boolean(school.la && school.la.trim());
  const addressFraction = (hasAddress ? 0.4 : 0) + (hasPostcode ? 0.4 : 0) + (hasLa ? 0.2 : 0);
  const earnedAddress = Math.round(wAddress * Math.min(1, addressFraction));
  earnedWeight += earnedAddress;
  breakdown.addressGeography = {
    weight: wAddress,
    earned: earnedAddress,
    passed: hasAddress && hasPostcode,
    label: 'Postal Address & Local Authority'
  };

  // 8. Leadership & Capacity / Fees (Weight: default 6)
  const wLeader = Math.max(0, Number(weights.leadershipCapacity) || 0);
  maxWeight += wLeader;
  const hasHead = Boolean(school.headteacher && school.headteacher.trim() && !school.headteacher.toLowerCase().includes('unknown'));
  const isIndependent = (school.schoolType || '').toLowerCase().includes('independent');
  const hasFees = isIndependent ? Boolean(school.fees_termly_gbp || school.feesTermly) : true;
  const hasPupils = Boolean(school.totalPupils || school.pupils);
  const leaderFraction = (hasHead ? 0.5 : 0) + (hasFees ? 0.3 : 0) + (hasPupils ? 0.2 : 0);
  const earnedLeader = Math.round(wLeader * Math.min(1, leaderFraction));
  earnedWeight += earnedLeader;
  breakdown.leadershipCapacity = {
    weight: wLeader,
    earned: earnedLeader,
    passed: hasHead,
    label: 'Leadership & Capacity / Fees'
  };

  const finalScore = maxWeight > 0 ? Math.min(100, Math.max(0, Math.round((earnedWeight / maxWeight) * 100))) : 0;

  return {
    score: finalScore,
    percentage: finalScore,
    earnedWeight,
    maxWeight,
    breakdown
  };
}

/**
 * Batch recalculate and store completeness scores for all schools in the database.
 * @param {Object} db - Database access module
 * @param {Object} [customWeights] - Custom weights dictionary
 * @returns {Object} { totalUpdated: number, avgScore: number, distribution: Object }
 */
function batchRecalculateAllSchools(db, customWeights = {}) {
  const sqlite = typeof db.getDb === 'function' ? db.getDb() : db;
  const rows = sqlite.prepare(`
    SELECT id, name, schoolType, rawSchoolType, gender, sixthFormGenderPolicy, website,
           entranceExamDates, entranceExamType, stage_one_format_and_subjects, second_stage_exam_required,
           ofstedRating, gcseAttainment8, national_rank_england, gcse_rank_england,
           phone, email, address, postcode, la, feesTermly, fees_termly_gbp, pupilCount
    FROM schools
  `).all();

  const distribution = {
    excellent: 0, // 80-100%
    good: 0,      // 60-79%
    fair: 0,      // 40-59%
    poor: 0       // 0-39%
  };

  let totalScore = 0;
  const updateStmt = sqlite.prepare('UPDATE schools SET completeness_score = ? WHERE id = ?');

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    for (let i = 0; i < rows.length; i++) {
      const s = rows[i];
      const { score } = evaluateSchoolCompleteness(s, customWeights);
      updateStmt.run(score, s.id);
      totalScore += score;
      if (score >= 80) distribution.excellent++;
      else if (score >= 60) distribution.good++;
      else if (score >= 40) distribution.fair++;
      else distribution.poor++;
    }
    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }

  const avgScore = rows.length > 0 ? Math.round(totalScore / rows.length) : 0;

  return {
    success: true,
    totalUpdated: rows.length,
    avgScore,
    distribution
  };
}

module.exports = {
  DEFAULT_COMPLETENESS_WEIGHTS,
  evaluateSchoolCompleteness,
  batchRecalculateAllSchools
};
