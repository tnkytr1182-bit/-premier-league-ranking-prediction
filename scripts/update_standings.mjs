import fs from 'node:fs';

const BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const FIXTURES_URL = 'https://fantasy.premierleague.com/api/fixtures/';
const STANDINGS_PATH = 'data/standings.json';
const TEAMS_PATH = 'data/teams.json';

const aliases = new Map([
  ['arsenal', 'Arsenal'], ['aston villa', 'Aston Villa'], ['bournemouth', 'AFC Bournemouth'],
  ['brentford', 'Brentford'], ['brighton', 'Brighton & Hove Albion'], ['chelsea', 'Chelsea'],
  ['coventry', 'Coventry City'], ['coventry city', 'Coventry City'], ['crystal palace', 'Crystal Palace'],
  ['everton', 'Everton'], ['fulham', 'Fulham'], ['hull', 'Hull City'], ['hull city', 'Hull City'],
  ['ipswich', 'Ipswich Town'], ['ipswich town', 'Ipswich Town'], ['leeds', 'Leeds United'],
  ['leeds united', 'Leeds United'], ['liverpool', 'Liverpool'], ['man city', 'Manchester City'],
  ['manchester city', 'Manchester City'], ['man utd', 'Manchester United'], ['manchester united', 'Manchester United'],
  ['newcastle', 'Newcastle United'], ['newcastle united', 'Newcastle United'],
  ['nottm forest', 'Nottingham Forest'], ['nottingham forest', 'Nottingham Forest'],
  ['sunderland', 'Sunderland'], ['spurs', 'Tottenham Hotspur'], ['tottenham', 'Tottenham Hotspur'],
  ['tottenham hotspur', 'Tottenham Hotspur']
]);

const canonical = name => aliases.get(String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')) || String(name || '').trim();

async function fetchJson(url) {
  let lastError;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, {headers:{accept:'application/json','user-agent':'PL-Ranking-Prediction/1.0'}, signal:AbortSignal.timeout(20000)});
      if (r.ok) return await r.json();
      lastError = new Error(`HTTP ${r.status} from ${url}`);
    } catch (e) { lastError = e; }
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
for (const t of fplTeams) {
  const name = canonical(t.name);
  if (expectedSet.has(name)) idToTeam.set(t.id, name);
}
if (idToTeam.size !== 20) {
  const found = new Set(idToTeam.values());
  throw new Error(`FPL team mapping incomplete (${idToTeam.size}/20). Missing: ${expectedTeams.filter(t=>!found.has(t)).join(', ')}`);
}

const stats = new Map(expectedTeams.map(team => [team, {team, played:0, won:0, drawn:0, lost:0, gf:0, ga:0, gd:0, points:0}]));
let completed = 0;
for (const f of fixtures) {
  if (!f.finished || f.team_h_score == null || f.team_a_score == null) continue;
  const home = idToTeam.get(f.team_h), away = idToTeam.get(f.team_a);
  if (!home || !away) continue;
  completed++;
  const h = stats.get(home), a = stats.get(away);
  const hs = Number(f.team_h_score), as = Number(f.team_a_score);
  h.played++; a.played++; h.gf += hs; h.ga += as; a.gf += as; a.ga += hs;
  if (hs > as) { h.won++; a.lost++; h.points += 3; }
  else if (hs < as) { a.won++; h.lost++; a.points += 3; }
  else { h.drawn++; a.drawn++; h.points++; a.points++; }
}

for (const s of stats.values()) s.gd = s.gf - s.ga;
const normalized = [...stats.values()].sort((a,b) => b.points-a.points || b.gd-a.gd || b.gf-a.gf || a.team.localeCompare(b.team)).map((s,i)=>({team:s.team,rank:i+1,played:s.played,won:s.won,drawn:s.drawn,lost:s.lost,gd:s.gd,points:s.points}));

if (JSON.stringify(previous.teams || []) === JSON.stringify(normalized)) {
  console.log(`Standings unchanged. FPL reports ${completed} completed matches.`);
  process.exit(0);
}

const jst = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()) + ' JST';
fs.writeFileSync(STANDINGS_PATH, JSON.stringify({updated:jst,source:'Official Fantasy Premier League fixtures',source_url:FIXTURES_URL,teams:normalized}, null, 2) + '\n');
console.log(`Updated standings from ${completed} completed matches at ${jst}`);
