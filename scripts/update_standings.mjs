import fs from 'node:fs';

const BASE = 'https://sdp-prem-prod.premier-league-prod.pulselive.com';
const TABLE_URL = `${BASE}/api/v5/competitions/8/seasons/2026/standings?live=false`;
const MATCHES_URL = `${BASE}/api/v2/matches?competition=8&season=2026&_limit=500`;
const STANDINGS_PATH = 'data/standings.json';
const TEAMS_PATH = 'data/teams.json';
const SEASON_STARTED_AT = new Date('2026-08-21T22:30:00Z');

const aliases = new Map([
  ['arsenal','Arsenal'],['aston villa','Aston Villa'],['bournemouth','AFC Bournemouth'],['afc bournemouth','AFC Bournemouth'],
  ['brentford','Brentford'],['brighton','Brighton & Hove Albion'],['brighton & hove albion','Brighton & Hove Albion'],
  ['brighton and hove albion','Brighton & Hove Albion'],['chelsea','Chelsea'],['coventry','Coventry City'],['coventry city','Coventry City'],
  ['crystal palace','Crystal Palace'],['everton','Everton'],['fulham','Fulham'],['hull','Hull City'],['hull city','Hull City'],
  ['ipswich','Ipswich Town'],['ipswich town','Ipswich Town'],['leeds','Leeds United'],['leeds united','Leeds United'],
  ['liverpool','Liverpool'],['manchester city','Manchester City'],['man city','Manchester City'],
  ['manchester united','Manchester United'],['man utd','Manchester United'],['newcastle','Newcastle United'],
  ['newcastle united','Newcastle United'],['nottingham forest','Nottingham Forest'],["nott'm forest",'Nottingham Forest'],
  ['nottm forest','Nottingham Forest'],['forest','Nottingham Forest'],['sunderland','Sunderland'],
  ['tottenham hotspur','Tottenham Hotspur'],['tottenham','Tottenham Hotspur'],['spurs','Tottenham Hotspur']
]);

function key(value){
  return String(value ?? '').normalize('NFKD').replace(/[’‘]/g,"'").trim().toLowerCase().replace(/\s+/g,' ');
}
function canonical(...names){
  for(const name of names){const mapped=aliases.get(key(name));if(mapped)return mapped;}
  return String(names.find(Boolean) ?? '').trim();
}
function num(v, fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback;}

async function fetchJson(url){
  let lastError;
  for(let i=1;i<=3;i++){
    try{
      const r=await fetch(url,{
        headers:{accept:'application/json','user-agent':'Mozilla/5.0 PL-Ranking-Prediction/1.0','origin':'https://www.premierleague.com','referer':'https://www.premierleague.com/'},
        signal:AbortSignal.timeout(20000)
      });
      if(r.ok)return await r.json();
      lastError=new Error(`HTTP ${r.status} from ${url}`);
    }catch(e){lastError=e;}
    if(i<3)await new Promise(resolve=>setTimeout(resolve,i*2000));
  }
  throw lastError;
}

const expectedTeams=JSON.parse(fs.readFileSync(TEAMS_PATH,'utf8'));
const expectedSet=new Set(expectedTeams);
const previous=JSON.parse(fs.readFileSync(STANDINGS_PATH,'utf8'));
const previousPlayed=(previous.teams||[]).reduce((sum,t)=>sum+num(t.played),0);

const [tablePayload,matchesPayload]=await Promise.all([fetchJson(TABLE_URL),fetchJson(MATCHES_URL)]);

const tables=Array.isArray(tablePayload?.tables)?tablePayload.tables:[];
const entries=tables.flatMap(t=>Array.isArray(t?.entries)?t.entries:[]);
if(entries.length<20)throw new Error(`Official standings returned only ${entries.length} entries`);

const stats=new Map();
for(const entry of entries){
  const teamObj=entry?.team ?? entry?.owner ?? {};
  const team=canonical(teamObj?.name,teamObj?.club?.name,teamObj?.shortName,teamObj?.short_name,entry?.teamName);
  if(!expectedSet.has(team))continue;
  const o=entry?.overall ?? entry?.total ?? entry;
  const gf=num(o?.goalsFor);
  const ga=num(o?.goalsAgainst);
  stats.set(team,{
    team,
    baseRank:num(o?.position ?? entry?.position,99),
    played:num(o?.played),won:num(o?.won),drawn:num(o?.drawn),lost:num(o?.lost),
    gf,ga,gd:gf-ga,points:num(o?.points)
  });
}
if(stats.size!==20){
  const missing=expectedTeams.filter(t=>!stats.has(t));
  throw new Error(`Official standings team validation failed (${stats.size}/20). Missing: ${missing.join(', ')}`);
}

const allMatches = Array.isArray(matchesPayload)
  ? matchesPayload
  : Array.isArray(matchesPayload?.content)
    ? matchesPayload.content
    : Array.isArray(matchesPayload?.matches)
      ? matchesPayload.matches
      : Array.isArray(matchesPayload?.data)
        ? matchesPayload.data
        : [];

const livePeriods=new Set(['live','firsthalf','first half','halftime','half time','secondhalf','second half','extra time','extratime']);
const liveMatches=[];
for(const match of allMatches){
  const period=key(match?.period ?? match?.status ?? match?.matchStatus);
  if(!livePeriods.has(period))continue;
  const hObj=match?.homeTeam ?? match?.home ?? {};
  const aObj=match?.awayTeam ?? match?.away ?? {};
  const home=canonical(hObj?.name,hObj?.shortName,hObj?.short_name);
  const away=canonical(aObj?.name,aObj?.shortName,aObj?.short_name);
  const hs=num(hObj?.score ?? match?.homeScore,NaN);
  const as=num(aObj?.score ?? match?.awayScore,NaN);
  if(!expectedSet.has(home)||!expectedSet.has(away)||!Number.isFinite(hs)||!Number.isFinite(as))continue;
  liveMatches.push({home,away,hs,as,period});
}

for(const m of liveMatches){
  const h=stats.get(m.home), a=stats.get(m.away);
  h.played++; a.played++;
  h.gf+=m.hs; h.ga+=m.as; a.gf+=m.as; a.ga+=m.hs;
  if(m.hs>m.as){h.won++;a.lost++;h.points+=3;}
  else if(m.hs<m.as){a.won++;h.lost++;a.points+=3;}
  else{h.drawn++;a.drawn++;h.points++;a.points++;}
}
for(const s of stats.values())s.gd=s.gf-s.ga;

const normalized=[...stats.values()]
  .sort((a,b)=>b.points-a.points||b.gd-a.gd||b.gf-a.gf||a.baseRank-b.baseRank||a.team.localeCompare(b.team))
  .map((s,i)=>({team:s.team,rank:i+1,played:s.played,won:s.won,drawn:s.drawn,lost:s.lost,gd:s.gd,points:s.points}));

const totalPlayed=normalized.reduce((sum,t)=>sum+t.played,0);
if(new Date()>SEASON_STARTED_AT&&totalPlayed===0)throw new Error('Refusing zero-match standings after season start');
if(previousPlayed>0&&totalPlayed<previousPlayed){
  console.log(`Provider temporarily regressed: total played ${totalPlayed} < previous ${previousPlayed}. Keeping previous data.`);
  process.exit(0);
}

if(JSON.stringify(previous.teams||[])===JSON.stringify(normalized)){
  console.log(`Standings unchanged. Live matches=${liveMatches.length}; total played=${totalPlayed}.`);
  process.exit(0);
}

const jst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())+' JST';
fs.writeFileSync(STANDINGS_PATH,JSON.stringify({
  updated:jst,
  source:liveMatches.length?'Premier League official table + live match scores (Pulselive)':'Premier League official standings (Pulselive)',
  source_url:liveMatches.length?MATCHES_URL:TABLE_URL,
  live_matches:liveMatches.map(({home,away,hs,as})=>({home,away,home_score:hs,away_score:as})),
  teams:normalized
},null,2)+'\n');
console.log(`Updated standings at ${jst}; live matches=${liveMatches.length}; total played=${totalPlayed}`);
