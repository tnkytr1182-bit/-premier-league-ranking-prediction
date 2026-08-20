import fs from 'node:fs';

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const body = event.issue?.body || '';
const user = event.issue?.user?.login || 'unknown';
const submittedAt = event.issue?.created_at ? new Date(event.issue.created_at) : new Date();

// Arsenal v Coventry City: 21 Aug 2026 20:00 BST = 21 Aug 2026 19:00 UTC = 22 Aug 2026 04:00 JST
const DEADLINE = new Date('2026-08-21T19:00:00Z');
if (submittedAt >= DEADLINE) {
  throw new Error('Prediction registration is closed. The deadline was 2026-08-22 04:00 JST.');
}

const match = body.match(/```json\s*([\s\S]*?)```/i);
if (!match) throw new Error('JSON payload not found');

const payload = JSON.parse(match[1]);
if (payload.type !== 'premier-league-prediction') throw new Error('Invalid prediction type');
if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 30) throw new Error('Invalid participant name');

const teams = JSON.parse(fs.readFileSync('data/teams.json','utf8'));
if (!Array.isArray(payload.prediction) || payload.prediction.length !== teams.length) throw new Error('Prediction must contain all 20 teams');
const submitted = [...payload.prediction];
if (new Set(submitted).size !== teams.length) throw new Error('Duplicate teams found');
for (const team of teams) if (!submitted.includes(team)) throw new Error(`Missing team: ${team}`);

const path = 'data/predictions.json';
const data = JSON.parse(fs.readFileSync(path,'utf8'));
const name = payload.name.trim();
const participants = (data.participants ||= []);

// One GitHub account owns one entry. Re-submission before kickoff replaces that account's previous prediction.
let idx = participants.findIndex(p => p.github_user === user);

// Keep compatibility with any old record created before github_user was stored.
if (idx < 0) idx = participants.findIndex(p => !p.github_user && p.name === name);

// Prevent another GitHub user from taking over an existing participant name.
const nameOwner = participants.findIndex((p, i) => i !== idx && p.name === name);
if (nameOwner >= 0) {
  throw new Error(`Participant name already in use: ${name}`);
}

const record = {
  name,
  github_user: user,
  prediction: submitted,
  submitted_at: submittedAt.toISOString(),
  updated_at: new Date().toISOString()
};

if (idx >= 0) participants[idx] = record;
else participants.push(record);

data.updated = new Date().toISOString();
fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
console.log(`${idx >= 0 ? 'Updated' : 'Saved'} prediction for ${name} (${user})`);
