const assert = require('assert');

function extractJsonFromLlmText(text) {
  if (!text || typeof text !== 'string') return null;
  let clean = text.trim();

  // Try direct parse first
  try {
    return JSON.parse(clean);
  } catch (e) {}

  // 1. Remove markdown fences ```json ... ``` or extract block
  if (clean.includes('```')) {
    const codeMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeMatch && codeMatch[1]) {
      clean = codeMatch[1].trim();
      try {
        return JSON.parse(clean);
      } catch (e) {}
    } else {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
  }

  // 2. Extract outermost JSON boundaries { ... }
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(clean);
  } catch (e) {}

  // 3. Repair Step: Strip JS comments
  let repaired = clean
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');

  // 4. Repair Step: Replace Python constants
  repaired = repaired
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false');

  // 5. Repair Step: Remove trailing commas before } or ]
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // 6. Repair Step: Normalize single-quoted property keys
  repaired = repaired.replace(/([{,]\s*)'([^'\r\n]+)'\s*:/g, '$1"$2":');

  try {
    return JSON.parse(repaired);
  } catch (e) {}

  // 7. Repair Step: Fix unescaped control characters in string values
  repaired = repaired.replace(/[\u0000-\u0009\u000B-\u001F]+/g, ' ');

  try {
    return JSON.parse(repaired);
  } catch (e) {}

  return null;
}

console.log('=== Testing extractJsonFromLlmText ===');

const test1 = '{\n  "name": "Test School",\n  "gender": null,\n  "dates": [\n    "1 Dec 2026",\n  ],\n}';
const res1 = extractJsonFromLlmText(test1);
assert(res1 && res1.name === 'Test School');
console.log('✓ Trailing commas handled:', res1);

const test2 = 'Here is the JSON:\n```json\n{\n  "name": "Markdown School",\n  "gender": "Girls",\n}\n```\nHope this helps!';
const res2 = extractJsonFromLlmText(test2);
assert(res2 && res2.name === 'Markdown School');
console.log('✓ Markdown block handled:', res2);

const test3 = '{\n  "name": "Python School",\n  "website": None,\n  "fees": None\n}';
const res3 = extractJsonFromLlmText(test3);
assert(res3 && res3.name === 'Python School' && res3.website === null);
console.log('✓ Python None handled:', res3);

console.log('All parser tests passed!');
