import fs from 'node:fs';

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const body = event.issue?.body || '';
const user = event.issue?.user?.login || 'unknown';
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
const record = { name, github_user: user, prediction: submitted, submitted_at: new Date().toISOString() };
const idx = (data.participants || []).findIndex(p => p.name === name);
if (idx >= 0) data.participants[idx] = record;
else (data.participants ||= []).push(record);
data.updated = new Date().toISOString();
fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
console.log(`Saved prediction for ${name}`);
