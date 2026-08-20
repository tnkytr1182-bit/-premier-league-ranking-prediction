import fs from 'node:fs';

const API_URL = 'https://www.thesportsdb.com/api/v1/json/123/lookuptable.php?l=4328&s=2026-2027';
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
  ['brighton and hove', 'Brighton & Hove Albion'],
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

async function fetchJsonWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'PL-Ranking-Prediction/1.0'
        },
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok) return await response.json();

      lastError = new Error(`HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
  throw lastError || new Error('Unable to fetch standings');
}

const expectedTeams = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
const expectedSet = new Set(expectedTeams);
const previous = JSON.parse(fs.readFileSync(STANDINGS_PATH, 'utf8'));

let payload;
try {
  payload = await fetchJsonWithRetry(API_URL);
} catch (error) {
  // Keep the last known-good standings instead of failing the GitHub Action.
  console.warn(`Standings fetch unavailable (${error.message}). Keeping existing standings.`);
  process.exit(0);
}

const rows = Array.isArray(payload?.table) ? payload.table : [];
if (rows.length < 20) {
  console.warn(`TheSportsDB returned ${rows.length} standings rows. Keeping existing standings.`);
  process.exit(0);
}

const normalized = rows.map(row => {
  const team = canonicalTeam(row.strTeam);
  return {
    team,
    rank: number(row.intRank),
    played: number(row.intPlayed),
    won: number(row.intWin),
    drawn: number(row.intDraw),
    lost: number(row.intLoss),
    gd: number(row.intGoalDifference, number(row.intGoalsFor) - number(row.intGoalsAgainst)),
    points: number(row.intPoints)
  };
}).filter(row => expectedSet.has(row.team));

const seen = new Set(normalized.map(row => row.team));
const missing = expectedTeams.filter(team => !seen.has(team));
if (normalized.length !== expectedTeams.length || missing.length) {
  console.warn(`Team validation incomplete. Found ${normalized.length}/20. Missing: ${missing.join(', ') || 'none'}. Keeping existing standings.`);
  process.exit(0);
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
}).format(now) + ' JST';

const output = {
  updated: jst,
  source: 'TheSportsDB English Premier League 2026/27 standings',
  source_url: API_URL,
  teams: normalized
};

fs.writeFileSync(STANDINGS_PATH, JSON.stringify(output, null, 2) + '\n');
console.log(`Updated ${STANDINGS_PATH} at ${jst}`);
