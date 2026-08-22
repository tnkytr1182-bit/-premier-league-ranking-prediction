import fs from 'node:fs';

const BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const FIXTURES_URL = 'https://fantasy.premierleague.com/api/fixtures/';
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
  ["nott'm forest", 'Nottingham Forest'],
  ['nottm forest', 'Nottingham Forest'],
  ['forest', 'Nottingham Forest'],
  ['sunderland', 'Sunderland'],
  ['tottenham hotspur', 'Tottenham Hotspur'],
  ['tottenham', 'Tottenham Hotspur'],
  ['spurs', 'Tottenham Hotspur']
]);

function key(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[’‘]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function canonical(...names) {
  for (const name of names) {
    const mapped = aliases.get(key(name));
    if (mapped) return mapped;
  }
  return String(names.find(Boolean) || '').trim();
}

async function fetchJson(url) {
  let lastError;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, {
        headers: {accept:'application/json','user-agent':'PL-Ranking-Prediction/1.0'},
        signal: AbortSignal.timeout(20000)
      });
      if (r.ok) return await r.json();
      lastError = new Error(`HTTP ${r.status} from ${url}`);
    } catch (e) {
      lastError = e;
    }
    if (i < 3) await new Promise(resolve => setTimeout(resolve, i * 2000));
  }
  throw lastError;
}

const expectedTeams = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
const expectedSet = new Set(expectedTeams);
const previous = JSON.parse(fs.readFileSync(STANDINGS_PATH, 'utf8'));

let bootstrap, fixtures;
try {
  [bootstrap, fixtures] = await Promise.all([fetchJson(BOOTSTRAP_URL), fetchJson(FIXTURES_URL)]);
} catch (e) {
  console.error(`FPL fetch failed: ${e.message}`);
  process.exit(1);
}

const fplTeams = Array.isArray(bootstrap?.teams) ? bootstrap.teams : [];
if (fplTeams.length !== 20) throw new Error(`Expected 20 FPL teams, got ${fplTeams.length}`);

const idToTeam = new Map();
const unmapped = [];
for (const t of fplTeams) {
  const name = canonical(t.name, t.short_name);
  if (expectedSet.has(name)) idToTeam.set(t.id, name);
  else unmapped.push({id:t.id,name:t.name,short_name:t.short_name,mapped:name});
}

if (idToTeam.size !== 20) {
  const found = new Set(idToTeam.values());
  const missing = expectedTeams.filter(t => !found.has(t));
  console.error('Unmapped FPL teams:', JSON.stringify(unmapped));
  throw new Error(`FPL team mapping incomplete (${idToTeam.size}/20). Missing: ${missing.join(', ')}`);
}

const stats = new Map(expectedTeams.map(team => [team, {
  team, played:0, won:0, drawn:0, lost:0, gf:0, ga:0, gd:0, points:0
}]));

let completed = 0;
for (const f of fixtures) {
  if (!f.finished || f.team_h_score == null || f.team_a_score == null) continue;
  const home = idToTeam.get(f.team_h);
  const away = idToTeam.get(f.team_a);
  if (!home || !away) continue;

  completed++;
  const h = stats.get(home);
  const a = stats.get(away);
  const hs = Number(f.team_h_score);
  const as = Number(f.team_a_score);

  h.played++; a.played++;
  h.gf += hs; h.ga += as;
  a.gf += as; a.ga += hs;

  if (hs > as) {
    h.won++; a.lost++; h.points += 3;
  } else if (hs < as) {
    a.won++; h.lost++; a.points += 3;
  } else {
    h.drawn++; a.drawn++; h.points++; a.points++;
  }
}

for (const s of stats.values()) s.gd = s.gf - s.ga;

const normalized = [...stats.values()]
  .sort((a,b) => b.points-a.points || b.gd-a.gd || b.gf-a.gf || a.team.localeCompare(b.team))
  .map((s,i) => ({
    team:s.team, rank:i+1, played:s.played, won:s.won, drawn:s.drawn,
    lost:s.lost, gd:s.gd, points:s.points
  }));

if (JSON.stringify(previous.teams || []) === JSON.stringify(normalized)) {
  console.log(`Standings unchanged. FPL reports ${completed} completed matches.`);
  process.exit(0);
}

const jst = new Intl.DateTimeFormat('sv-SE', {
  timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
}).format(new Date()) + ' JST';

fs.writeFileSync(STANDINGS_PATH, JSON.stringify({
  updated:jst,
  source:'Official Fantasy Premier League fixtures',
  source_url:FIXTURES_URL,
  teams:normalized
}, null, 2) + '\n');

console.log(`Updated standings from ${completed} completed matches at ${jst}`);
