// Checks the Task ID extractor against the shapes real pasted content takes.
//
// This is the one piece of parsing in the app, and it runs on every paste into
// the upload form. Getting it wrong means creating a task under the wrong ID,
// which duplicate detection then cannot catch — so it gets a test.
//
//   node scripts/check-task-id-detection.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/utils/taskId.ts'), 'utf8');

// The module is plain regex logic; strip the types and run it directly rather
// than pulling in a TypeScript loader for four functions.
const js = source
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/export interface [\s\S]*?\n\}\n/g, '')
  .replace(/: DetectedTaskId \| null/g, '')
  .replace(/\(text: string\)/g, '(text)')
  .replace(/\(value: string\)/g, '(value)')
  .replace(/: string/g, '')
  .replace(/export /g, '');

const { detectTaskId, normalizeTaskIdInput } = await import(
  `data:text/javascript,${encodeURIComponent(`${js}\nexport { detectTaskId, normalizeTaskIdInput };`)}`
);

const REAL_PASTE = `Task ID: task_fd544c3673dd4dfc97abfc1e12a7b49b
This task is unclaimed. Claim it to begin editing.
Claim

Mark this task as an onboarding task.
Finance

10 sources
https://www.casemine.com/judgement/us/5914b652add7b04934778605; https://www.law.cornell.edu/uscode/text/11/328

Which fees did the NorthWestern Corporation retention order name?
• Seed: Which fees did the NorthWestern Corporation retention order name?
Restructuring Fee; Sale Transaction Fee; Financing Fee`;

const cases = [
  {
    name: 'the real pasted task page',
    input: REAL_PASTE,
    expect: 'task_fd544c3673dd4dfc97abfc1e12a7b49b',
    source: 'labelled',
  },
  {
    name: 'label with no space after the colon',
    input: 'Task ID:task_1923ee7739a44e60b8555536838ffad8\nrest of body',
    expect: 'task_1923ee7739a44e60b8555536838ffad8',
  },
  {
    name: 'lowercase label',
    input: 'task id: task_a2657735851ae973e85e198bd554d2cf',
    expect: 'task_a2657735851ae973e85e198bd554d2cf',
  },
  {
    name: 'no label, bare id in the text',
    input: 'Some preamble\ntask_c23aacd550bc57054c85201af15007ce\nmore text',
    expect: 'task_c23aacd550bc57054c85201af15007ce',
    source: 'canonical',
  },
  {
    name: 'labelled id wins over an unrelated one mentioned later',
    input: 'Task ID: task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nseed refers to task_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    expect: 'task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  {
    name: 'counts distinct ids so ambiguity can be surfaced',
    input: 'task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa and task_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    expect: 'task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    candidates: 2,
  },
  {
    name: 'the same id repeated is not ambiguous',
    input: 'task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa again task_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    expect: 'task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    candidates: 1,
  },
  { name: 'empty input', input: '', expect: null },
  { name: 'text with no id at all', input: 'just some notes about the work', expect: null },
  { name: 'the word task alone is not an id', input: 'this task is unclaimed', expect: null },
  {
    name: 'a URL containing the id still yields it',
    input: 'https://example.com/tasks/task_fd544c3673dd4dfc97abfc1e12a7b49b/edit',
    expect: 'task_fd544c3673dd4dfc97abfc1e12a7b49b',
  },
];

let failures = 0;

for (const testCase of cases) {
  const result = detectTaskId(testCase.input);
  const actual = result?.id ?? null;
  try {
    assert.equal(actual, testCase.expect);
    if (testCase.source) assert.equal(result.source, testCase.source);
    if (testCase.candidates) assert.equal(result.candidates, testCase.candidates);
    console.log(`  ok    ${testCase.name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL  ${testCase.name}`);
    console.error(`        expected ${JSON.stringify(testCase.expect)}, got ${JSON.stringify(actual)}`);
    if (testCase.source && result) console.error(`        source ${result.source}`);
    void error;
  }
}

// Pasting the whole blob into the ID field itself must still yield just the ID.
const normalizeCases = [
  ['task_fd544c3673dd4dfc97abfc1e12a7b49b', 'task_fd544c3673dd4dfc97abfc1e12a7b49b'],
  [REAL_PASTE, 'task_fd544c3673dd4dfc97abfc1e12a7b49b'],
  ['  task_fd544c3673dd4dfc97abfc1e12a7b49b  ', 'task_fd544c3673dd4dfc97abfc1e12a7b49b'],
  ['', ''],
  // A typed value that is not an id is left alone, so the duplicate check and
  // the server can reject it rather than the field silently emptying.
  ['my custom id', 'my custom id'],
];

for (const [input, expected] of normalizeCases) {
  const actual = normalizeTaskIdInput(input);
  if (actual === expected) {
    console.log(`  ok    normalize ${JSON.stringify(input.slice(0, 28))}`);
  } else {
    failures += 1;
    console.error(`  FAIL  normalize ${JSON.stringify(input.slice(0, 28))}`);
    console.error(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} task ID detection check(s) failed.`);
  process.exit(1);
}
console.log(`\nTask ID detection: ${cases.length + normalizeCases.length} checks passed.`);
