import fs from 'node:fs';

const API_URL = 'https://www.sofascore.com/api/v1/unique-tournament/17/season/96668/standings/total';
const STANDINGS_PATH = 'data/standings.json';
const TEAMS_PATH = 'data/teams.json';

const aliases = new Map([
  ['arsenal', 'Arsenal'],
  ['aston villa', 'Aston Villa'],
  ['afc bournemouth', 'AFC Bournemouth'],
  ['bournemouth', 'AFC Bournemouth'],
  ['brentford', 'Brentford'],
  ['brighton & hove albion', 'Brighton & Hove Albion'],
  ['brighton and hove albion', 'Brighton & Hove Albion'],
  ['brighton', 'Brighton & Hove Albion'],
  ['chelsea', 'Chelsea'],
  ['coventry city', 'Coventry City'],
  ['coventry', 'Coventry City'],
  ['crystal palace', 'Crystal Palace'],
  ['everton', 'Everton'],
  ['fulham', 'Fulham'],
  ['hull city', 'Hull City'],
  ['hull', 'Hull City'],
  ['ipswich town', 'Ipswich Town'],
  ['ipswich', 'Ipswich Town'],
  ['leeds united', 'Leeds United'],
  ['leeds', 'Leeds United'],
  ['liverpool', 'Liverpool'],
  ['manchester city', 'Manchester City'],
  ['man city', 'Manchester City'],
  ['manchester united', 'Manchester United'],
  ['man utd', 'Manchester United'],
  ['newcastle united', 'Newcastle United'],
  ['newcastle', 'Newcastle United'],
  ['nottingham forest', 'Nottingham Forest'],
  ['forest', 'Nottingham Forest'],
  ['sunderland', 'Sunderland'],
  ['tottenham hotspur', 'Tottenham Hotspur'],
  ['tottenham', 'Tottenham Hotspur'],
  ['spurs', 'Tottenham Hotspur']
]);

function canonicalTeam(name) {
  const key = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return aliases.get(key) || String(name || '').trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const expectedTeams = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
const expectedSet = new Set(expectedTeams);
const previous = JSON.parse(fs.readFileSync(STANDINGS_PATH, 'utf8'));

const response = await fetch(API_URL, {
  headers: {
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (compatible; PL-Ranking-Prediction/1.0; +https://github.com/tnkytr1182-bit/-premier-league-ranking-prediction)'
  }
});

if (!response.ok) {
  throw new Error(`Standings API returned HTTP ${response.status}`);
}

const payload = await response.json();
const groups = Array.isArray(payload.standings)
  ? payload.standings
  : Array.isArray(payload.data?.groups)
    ? payload.data.groups
    : [];

const rows = groups.flatMap(group => Array.isArray(group.rows) ? group.rows : []);
if (rows.length < 20) {
  throw new Error(`Expected at least 20 standings rows, received ${rows.length}`);
}

const normalized = rows.map(row => {
  const team = canonicalTeam(row.team?.name || row.team?.shortName || row.team?.short_name);
  return {
    team,
    rank: number(row.position),
    played: number(row.matches),
    won: number(row.wins),
    drawn: number(row.draws),
    lost: number(row.losses),
    gd: number(row.scoresFor ?? row.scores_for) - number(row.scoresAgainst ?? row.scores_against),
    points: number(row.points)
  };
}).filter(row => expectedSet.has(row.team));

const seen = new Set(normalized.map(row => row.team));
const missing = expectedTeams.filter(team => !seen.has(team));
if (normalized.length !== expectedTeams.length || missing.length) {
  throw new Error(`Team validation failed. Found ${normalized.length}/20. Missing: ${missing.join(', ') || 'none'}`);
}

normalized.sort((a, b) => a.rank - b.rank || b.points - a.points || b.gd - a.gd || a.team.localeCompare(b.team));

const previousComparable = JSON.stringify(previous.teams || []);
const nextComparable = JSON.stringify(normalized);
if (previousComparable === nextComparable) {
  console.log('Standings unchanged; nothing to update.');
  process.exit(0);
}

const now = new Date();
const jst = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false
}).format(now).replace(' ', ' ') + ' JST';

const output = {
  updated: jst,
  source: 'Sofascore Premier League 2026/27 standings',
  source_url: API_URL,
  teams: normalized
};

fs.writeFileSync(STANDINGS_PATH, JSON.stringify(output, null, 2) + '\n');
console.log(`Updated ${STANDINGS_PATH} at ${jst}`);
