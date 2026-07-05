// One-time offline research pass for Green Fund projects that couldn't be tied to an island.
// Run locally with your own key: ANTHROPIC_API_KEY=sk-... npm run research
// Writes public/data/green_fund_qa_research.json, which the Data quality tab reads at runtime.
// ponytail: sequential + a fixed delay between calls, not a queue/retry framework - fine for a
// one-off ~50-project run. Add backoff/retry if this ever needs to run against a much bigger list.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/data.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UNMAPPED_CSV = `${ROOT}public/data/green_fund_unmapped_projects.csv`;
const OUTPUT_JSON = `${ROOT}public/data/green_fund_qa_research.json`;
const MODEL = 'claude-haiku-4-5-20251001';
const DELAY_MS = 1000;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY before running this script.');
  process.exit(1);
}

const force = process.argv.includes('--force');

function buildPrompt(project) {
  return `You are researching a Maldives Green Fund-financed infrastructure project that could not be automatically matched to a specific island from government spending records.

Project name: ${project.project_name}
Project code: ${project.project_code}
Category: ${project.category}
Total spend: MVR ${project.total_mvr}
Recorded spatial scope: ${project.spatial_scope || 'unknown'}
Existing note: ${project.review_note || 'none'}

Search the public web (news coverage, Ministry of Finance / Ministry of Environment / Green Fund press releases, tender notices, parliament records, atoll/island council pages) for information about this project. Determine:
1. lead_institution - the ministry, council or agency implementing it (or null if unknown)
2. status - one of "completed", "ongoing", "unknown"
3. suggested_atoll - the Maldives atoll code (e.g. "Sh", "GA") if a specific location is identifiable, else null
4. suggested_island - the island name if identifiable, else null
5. confidence - one of "high", "medium", "low", "none"
6. sources - array of {url, title} for every source you used
7. summary - 1-2 sentences explaining what you found and, if location is unclear, that it should be verified via an RTI request

Respond with ONLY a single JSON object with exactly these keys: lead_institution, status, suggested_atoll, suggested_island, confidence, sources, summary. No markdown fences, no extra prose.`;
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in response');
  return JSON.parse(text.slice(start, end + 1));
}

async function researchProject(project) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: buildPrompt(project) }]
    })
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
  return extractJson(text);
}

async function main() {
  const csvText = await readFile(UNMAPPED_CSV, 'utf8');
  const projects = parseCsv(csvText);

  let output = { generated_at: new Date().toISOString(), model: MODEL, projects: {} };
  try {
    output = JSON.parse(await readFile(OUTPUT_JSON, 'utf8'));
  } catch {
    // no existing file yet, start fresh
  }

  const todo = projects.filter((p) => force || !output.projects[p.project_code]);
  console.log(`${todo.length} of ${projects.length} projects need research.`);

  for (const [index, project] of todo.entries()) {
    process.stdout.write(`[${index + 1}/${todo.length}] ${project.project_code} - ${project.project_name} ... `);
    try {
      const result = await researchProject(project);
      output.projects[project.project_code] = result;
      output.generated_at = new Date().toISOString();
      await writeFile(OUTPUT_JSON, JSON.stringify(output, null, 2));
      console.log(`ok (${result.confidence} confidence, ${result.status})`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
    if (index < todo.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`Done. Results in ${OUTPUT_JSON}`);
  console.log('Copy public/data/green_fund_qa_research.json to the deployed data/ folder alongside the other CSVs before pushing.');
}

main();
