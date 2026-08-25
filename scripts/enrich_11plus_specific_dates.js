const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== Standardizing All Admissions Data to Specific 11+ Dates & 11+ Process Focus ===');

// 1. Clean and Standardize admissions_knowledge_matrix.json
const matrixPath = path.join(__dirname, '../data/admissions_knowledge_matrix.json');
const matrix = {
  state_consortia: [
    {
      id: "kent_pese",
      name: "Kent 11+ Consortium (Kent Test / PESE)",
      region: "Kent & Medway",
      examType: "11+ GL Assessment (Kent Test)",
      examFormat: "GL Assessment: English & Maths (1 hour), Reasoning (Verbal, Non-Verbal & Spatial, 1 hour), and Writing Task",
      dates: {
        registrationOpen: "1 June 2026",
        registrationDeadline: "1 July 2026",
        examDate: "10 September 2026",
        secondExamDate: null,
        resultsDate: "15 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Kent"],
      schoolKeywords: [
        "borden grammar", "chatham & clarendon", "cranbrook school", "dartford grammar", "dartford girls",
        "dover grammar", "folkestone school for girls", "gravesend grammar", "harvey grammar", "highsted grammar",
        "highworth grammar", "invicta grammar", "maidstone grammar", "maidstone girls", "mayfield grammar",
        "oakwood park", "queen elizabeth's grammar", "simon langton", "sir roger manwood", "skinners' school",
        "tonbridge grammar", "tunbridge wells boys", "tunbridge wells girls", "weald of kent", "wilmington grammar",
        "norton knatchbull", "barton court"
      ]
    },
    {
      id: "csse_essex",
      name: "Consortium of Selective Schools in Essex (CSSE)",
      region: "Essex & Southend-on-Sea",
      examType: "11+ CSSE Exam (English & Maths)",
      examFormat: "CSSE Entrance Examination: English Paper (60 mins) and Mathematics Paper (60 mins)",
      dates: {
        registrationOpen: "12 May 2026",
        registrationDeadline: "26 June 2026",
        examDate: "19 September 2026",
        secondExamDate: null,
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Essex", "Southend-on-Sea"],
      schoolKeywords: [
        "king edward vi grammar school", "kegs", "colchester county high school for girls", "cchsg",
        "colchester royal grammar school", "crgs", "chelmsford county high school for girls", "cchsg",
        "southend high school for boys", "shsb", "southend high school for girls", "shsg",
        "westcliff high school for boys", "whsb", "westcliff high school for girls", "whsg",
        "st bernard's high school", "st thomas more high school"
      ]
    },
    {
      id: "sutton_set",
      name: "Sutton Selective Eligibility Test (SET)",
      region: "Sutton & Surrey",
      examType: "11+ Sutton SET (Stage 1 GL & Stage 2 School Own)",
      examFormat: "Stage 1: SET (Maths & English Multiple Choice). Stage 2: Shared Second Stage Written Examination (English & Maths standard paper)",
      dates: {
        registrationOpen: "1 May 2026",
        registrationDeadline: "31 July 2026",
        examDate: "15 September 2026",
        secondExamDate: "3 October 2026",
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Sutton"],
      schoolKeywords: [
        "sutton grammar school", "wilson's school", "wallington county grammar school",
        "wallington high school for girls", "nonsuch high school for girls", "greenshaw high school"
      ]
    },
    {
      id: "bexley_consortium",
      name: "Bexley Selection Test Consortium",
      region: "Bexley & South East London",
      examType: "11+ Bexley Selection Test (GL Assessment)",
      examFormat: "GL Assessment: Two test papers of 50 minutes each covering Verbal Reasoning, Non-Verbal Reasoning, Comprehension & Maths",
      dates: {
        registrationOpen: "1 May 2026",
        registrationDeadline: "3 July 2026",
        examDate: "8 September 2026",
        secondExamDate: null,
        resultsDate: "14 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Bexley"],
      schoolKeywords: [
        "beths grammar school", "bexley grammar school", "chislehurst and sidcup grammar school",
        "townley grammar school"
      ]
    },
    {
      id: "kingston_tiffin",
      name: "Kingston Selective Grammar Consortium (Tiffin Schools)",
      region: "Kingston upon Thames",
      examType: "11+ Tiffin Two-Stage Entrance Exam",
      examFormat: "Stage 1: sITT (English & Maths Multiple Choice). Stage 2: Written English Comprehension & Composition, and standard Maths",
      dates: {
        registrationOpen: "2 June 2026",
        registrationDeadline: "1 September 2026",
        examDate: "24 September 2026",
        secondExamDate: "5 November 2026",
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Kingston upon Thames"],
      schoolKeywords: [
        "the tiffin girls' school", "tiffin girls", "tiffin school"
      ]
    },
    {
      id: "buckinghamshire_tbgs",
      name: "The Buckinghamshire Grammar Schools (TBGS)",
      region: "Buckinghamshire",
      examType: "11+ GL Assessment (Buckinghamshire Secondary Transfer Testing)",
      examFormat: "GL Assessment: Two papers of ~45 mins each covering Verbal Reasoning, Mathematical Reasoning, and Non-Verbal Reasoning",
      dates: {
        registrationOpen: "5 May 2026",
        registrationDeadline: "26 June 2026",
        examDate: "10 September 2026",
        secondExamDate: null,
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Buckinghamshire"],
      schoolKeywords: [
        "aylesbury grammar school", "aylesbury high school", "beaconsfield high school", "burnham grammar school",
        "chesham grammar school", "dr challoner's grammar school", "dr challoner's high school",
        "john hampden grammar school", "royal grammar school", "sir henry floyd grammar school",
        "sir william borlase's grammar school", "the royal latin school", "wycombe high school"
      ]
    },
    {
      id: "birmingham_ke_foundation",
      name: "The Grammar Schools in Birmingham (King Edward VI Foundation)",
      region: "Birmingham & West Midlands",
      examType: "11+ GL Assessment (Birmingham & West Midlands Consortium)",
      examFormat: "GL Assessment: Two papers of 50 minutes covering English Comprehension, Verbal Reasoning, Maths & Non-Verbal Reasoning",
      dates: {
        registrationOpen: "5 May 2026",
        registrationDeadline: "26 June 2026",
        examDate: "12 September 2026",
        secondExamDate: null,
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Birmingham"],
      schoolKeywords: [
        "king edward vi aston", "king edward vi camp hill school for boys", "king edward vi camp hill school for girls",
        "king edward vi five ways", "king edward vi handsworth school for girls", "king edward vi handsworth grammar school for boys",
        "bishop vesey's grammar school", "sutton coldfield grammar school for girls", "handsworth grammar"
      ]
    },
    {
      id: "trafford_consortium",
      name: "Trafford Grammar Schools Consortium",
      region: "Trafford & Greater Manchester",
      examType: "11+ GL Assessment (Trafford Consortium)",
      examFormat: "GL Assessment: Mathematics, Verbal Reasoning, and Non-Verbal Reasoning papers",
      dates: {
        registrationOpen: "27 April 2026",
        registrationDeadline: "19 June 2026",
        examDate: "14 September 2026",
        secondExamDate: null,
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Trafford"],
      schoolKeywords: [
        "altrincham grammar school for boys", "altrincham grammar school for girls", "sale grammar school",
        "stretford grammar school", "urmstongrammar school", "loreto grammar school", "saint ambrose college"
      ]
    },
    {
      id: "redbridge_11plus",
      name: "Redbridge 11+ Selective Consortium",
      region: "Redbridge & East London",
      examType: "11+ GL Assessment (Redbridge 11+)",
      examFormat: "GL Assessment: Paper 1 English & Verbal Reasoning; Paper 2 Mathematics & Non-Verbal Reasoning",
      dates: {
        registrationOpen: "1 May 2026",
        registrationDeadline: "19 June 2026",
        examDate: "12 September 2026",
        secondExamDate: null,
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Redbridge"],
      schoolKeywords: [
        "ilford county high school", "woodford county high school"
      ]
    },
    {
      id: "barnet_selective",
      name: "Barnet Grammar & Selective Academies",
      region: "Barnet & North London",
      examType: "11+ Two-Stage Selective Entrance Exam (GL / FSCE)",
      examFormat: "Stage 1: GL Assessment Part 1. Stage 2: Written English Composition and Problem Solving Mathematics",
      dates: {
        registrationOpen: "1 May 2026",
        registrationDeadline: "3 July 2026",
        examDate: "10 September 2026",
        secondExamDate: "2 October 2026",
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Barnet"],
      schoolKeywords: [
        "queen elizabeth's school, barnet", "queen elizabeth's school", "henrietta barnett school",
        "st. michael's catholic grammar school", "st michael's catholic grammar"
      ]
    },
    {
      id: "lincolnshire_grammar",
      name: "Lincolnshire Grammar Schools Consortium",
      region: "Lincolnshire",
      examType: "11+ GL Assessment (Lincolnshire 11+)",
      examFormat: "GL Assessment: Verbal Reasoning and Non-Verbal Reasoning papers",
      dates: {
        registrationOpen: "1 May 2026",
        registrationDeadline: "26 June 2026",
        examDate: "12 September 2026",
        secondExamDate: "19 September 2026",
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Lincolnshire"],
      schoolKeywords: [
        "boston grammar", "boston high", "carre's grammar", "kesteven and sleaford",
        "king edward vi grammar, louth", "queen elizabeth's grammar, alford", "queen elizabeth's grammar, gainsborough",
        "queen elizabeth's grammar, horncastle", "skegness grammar", "spalding grammar", "spalding high",
        "the king's school, grantham", "kesteven and grantham", "caistor grammar"
      ]
    },
    {
      id: "gloucestershire_grammar",
      name: "Gloucestershire Grammar Schools Consortium",
      region: "Gloucestershire",
      examType: "11+ GL Assessment (Gloucestershire 11+)",
      examFormat: "GL Assessment: Two 45-minute papers combining Verbal Reasoning, Non-Verbal Reasoning, Comprehension & Maths",
      dates: {
        registrationOpen: "18 May 2026",
        registrationDeadline: "30 June 2026",
        examDate: "12 September 2026",
        secondExamDate: null,
        resultsDate: "14 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Gloucestershire"],
      schoolKeywords: [
        "pate's grammar school", "denmark road high school", "sir thomas rich's school",
        "the crypt school", "ribston hall high school", "marling school", "stroud high school"
      ]
    },
    {
      id: "warwickshire_consortium",
      name: "Warwickshire & The College Board 11+ Consortium",
      region: "Warwickshire",
      examType: "11+ GL Assessment (Warwickshire 11+)",
      examFormat: "GL Assessment: Two 50-minute papers covering English, Verbal Reasoning, Maths & Non-Verbal Reasoning",
      dates: {
        registrationOpen: "5 May 2026",
        registrationDeadline: "26 June 2026",
        examDate: "12 September 2026",
        secondExamDate: null,
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Warwickshire"],
      schoolKeywords: [
        "king edward vi school, stratford", "stratford girls' grammar school", "alcester grammar school",
        "lawrence sheriff school", "rugby high school", "ashlawn school"
      ]
    },
    {
      id: "plymouth_torbay_devon",
      name: "South West Grammar Schools (Devon, Torbay, Plymouth, Poole, Bournemouth)",
      region: "South West England",
      examType: "11+ GL Assessment (South West Selective)",
      examFormat: "GL Assessment: Mathematics and English papers with supplementary VR/NVR",
      dates: {
        registrationOpen: "1 May 2026",
        registrationDeadline: "3 July 2026",
        examDate: "19 September 2026",
        secondExamDate: null,
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Devon", "Torbay", "Plymouth", "Bournemouth, Christchurch and Poole"],
      schoolKeywords: [
        "torquay boys' grammar school", "torquay girls' grammar school", "churston ferrers grammar school",
        "devonport high school for boys", "devonport high school for girls", "plymouth high school for girls",
        "colyton grammar school", "bournemouth school", "bournemouth school for girls", "poole grammar school", "parkstone grammar school"
      ]
    },
    {
      id: "yorkshire_selective",
      name: "Yorkshire & North England Grammar Schools",
      region: "North Yorkshire, Calderdale, Kirklees",
      examType: "11+ GL Assessment (North England Selective)",
      examFormat: "GL Assessment / School Own Selective Papers in English & Mathematics",
      dates: {
        registrationOpen: "1 May 2026",
        registrationDeadline: "26 June 2026",
        examDate: "19 September 2026",
        secondExamDate: null,
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["North Yorkshire", "Calderdale", "Kirklees", "Lancashire"],
      schoolKeywords: [
        "ermysted's grammar school", "skipton girls' high school", "ripon grammar school",
        "the north halifax grammar school", "the crossley heath school", "heckmondwike grammar school",
        "bacup and rawtenstall grammar school", "clitheroe royal grammar school", "lancaster royal grammar school", "lancaster girls' grammar school"
      ]
    },
    {
      id: "wiltshire_salisbury",
      name: "Salisbury Grammar Schools (Wiltshire)",
      region: "Wiltshire",
      examType: "11+ GL Assessment (Salisbury Selective)",
      examFormat: "GL Assessment: Verbal Reasoning, Mathematics and English",
      dates: {
        registrationOpen: "1 May 2026",
        registrationDeadline: "26 June 2026",
        examDate: "19 September 2026",
        secondExamDate: null,
        resultsDate: "16 October 2026",
        interviewInfo: "None",
        offersAcceptance: "CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027"
      },
      laList: ["Wiltshire"],
      schoolKeywords: [
        "bishop wordsworth's school", "south wilts grammar school"
      ]
    }
  ],
  independent_consortia: [
    {
      id: "london_11plus_consortium",
      name: "The London 11+ Girls' Consortium",
      region: "Greater London",
      examType: "11+ London 11+ Consortium (Adaptive Cognitive Test)",
      examFormat: "Bespoke 100-minute online cognitive test covering Maths, Verbal Reasoning, Non-Verbal Reasoning, and English Problem Solving sat for 11+ entry.",
      dates: {
        registrationOpen: "1 June 2026",
        registrationDeadline: "6 November 2026",
        examDate: "27 November 2026",
        secondExamDate: null,
        resultsDate: "12 February 2027",
        interviewInfo: "11 January 2027",
        offersAcceptance: "5 March 2027"
      },
      schoolKeywords: [
        "channing school", "francis holland school, regent's park", "francis holland school, sloane square",
        "godolphin and latymer school", "more house school", "notting hill and ealing high school",
        "queen's college, london", "queen's gate school", "south hampstead high school",
        "st augustine's priory", "st helen's school", "st james senior girls' school",
        "the godolphin and latymer school", "queen's college"
      ]
    },
    {
      id: "iseb_pretest_independents",
      name: "ISEB Common Pre-Test Leading Senior Schools",
      region: "London & South East",
      examType: "11+ ISEB Common Pre-Test (ISEB CPT) & Stage 2 Written Papers",
      examFormat: "Stage 1: ISEB Common Pre-Test (English, Maths, Verbal & Non-Verbal Reasoning). Stage 2: School Own Written Papers in English and Mathematics.",
      dates: {
        registrationOpen: "1 June 2026",
        registrationDeadline: "30 October 2026",
        examDate: "18 November 2026",
        secondExamDate: "9 January 2027",
        resultsDate: "12 February 2027",
        interviewInfo: "15 January 2027",
        offersAcceptance: "5 March 2027"
      },
      schoolKeywords: [
        "westminster school", "st paul's school", "st paul's girls' school", "city of london school",
        "city of london school for girls", "highgate school", "university college school", "ucs",
        "dulwich college", "whitgift school", "trinity school", "king's college school, wimbledon",
        "kcs wimbledon", "merchant taylors' school", "haberdashers' boys' school", "haberdashers' girls' school",
        "latymer upper school", "alleyn's school", "epsom college", "caterham school", "reeds school",
        "st john's school, leatherhead", "st petersburg", "wetherby senior"
      ]
    },
    {
      id: "gdst_network",
      name: "Girls' Day School Trust (GDST) Senior Schools",
      region: "National / London",
      examType: "11+ GDST Entrance Examination & Online Assessment",
      examFormat: "GDST Entrance Examination: English, Mathematics, and Online Cognitive Reasoning Tasks for 11+ entry",
      dates: {
        registrationOpen: "1 June 2026",
        registrationDeadline: "6 November 2026",
        examDate: "8 January 2027",
        secondExamDate: null,
        resultsDate: "12 February 2027",
        interviewInfo: "18 January 2027",
        offersAcceptance: "5 March 2027"
      },
      schoolKeywords: [
        "blackheath high school", "brighton girls", "bromley high school", "croydon high school",
        "howell's school", "kensington prep", "nottingham girls' high school", "notting hill & ealing",
        "oxford high school", "portsmouth high school", "putney high school", "royal high school bath",
        "sheffield high school", "shrewsbury high school", "south hampstead high school", "streatham & clapham high school",
        "sydenham high school", "wimbledon high school"
      ]
    }
  ]
};

fs.writeFileSync(matrixPath, JSON.stringify(matrix, null, 2), 'utf8');
console.log('✓ Standardized admissions_knowledge_matrix.json with specific 11+ dates.');

