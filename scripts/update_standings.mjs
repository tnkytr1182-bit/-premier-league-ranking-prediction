import fs from 'node:fs';

const API_URL = 'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v5/competitions/8/seasons/2026/standings?live=false';
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
      const r=await fetch(url,{headers:{accept:'application/json','user-agent':'Mozilla/5.0 PL-Ranking-Prediction/1.0','origin':'https://www.premierleague.com','referer':'https://www.premierleague.com/'},signal:AbortSignal.timeout(20000)});
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

const payload=await fetchJson(API_URL);
const tables=Array.isArray(payload?.tables)?payload.tables:[];
const entries=tables.flatMap(t=>Array.isArray(t?.entries)?t.entries:[]);
if(entries.length<20)throw new Error(`Official standings returned only ${entries.length} entries`);

const rows=[];
const unmapped=[];
for(const entry of entries){
  const teamObj=entry?.team ?? entry?.owner ?? {};
  const team=canonical(teamObj?.name,teamObj?.club?.name,teamObj?.shortName,teamObj?.short_name,entry?.teamName);
  const o=entry?.overall ?? entry?.total ?? entry;
  if(!expectedSet.has(team)){unmapped.push({raw:teamObj,derived:team});continue;}
  rows.push({
    team,
    rank:num(o?.position ?? entry?.position),
    played:num(o?.played),
    won:num(o?.won),
    drawn:num(o?.drawn),
    lost:num(o?.lost),
    gd:num(o?.goalDifference, num(o?.goalsFor)-num(o?.goalsAgainst)),
    points:num(o?.points)
  });
}

const unique=new Map(rows.map(r=>[r.team,r]));
const normalized=[...unique.values()].sort((a,b)=>a.rank-b.rank);
const found=new Set(normalized.map(r=>r.team));
const missing=expectedTeams.filter(t=>!found.has(t));
if(normalized.length!==20||missing.length){
  console.error('Unmapped official entries:',JSON.stringify(unmapped));
  throw new Error(`Official standings team validation failed (${normalized.length}/20). Missing: ${missing.join(', ')}`);
}

const ranks=normalized.map(r=>r.rank).sort((a,b)=>a-b);
if(ranks.some((r,i)=>r!==i+1))throw new Error(`Invalid official ranks: ${ranks.join(',')}`);

const totalPlayed=normalized.reduce((sum,t)=>sum+t.played,0);
if(new Date()>SEASON_STARTED_AT && totalPlayed===0){
  throw new Error('Refusing zero-match standings after season start');
}
if(previousPlayed>0 && totalPlayed<previousPlayed){
  throw new Error(`Refusing regressed standings: total played ${totalPlayed} < previous ${previousPlayed}`);
}

if(JSON.stringify(previous.teams||[])===JSON.stringify(normalized)){
  console.log(`Standings unchanged. Official table total played=${totalPlayed}.`);
  process.exit(0);
}

const jst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())+' JST';
fs.writeFileSync(STANDINGS_PATH,JSON.stringify({updated:jst,source:'Premier League official standings (Pulselive)',source_url:API_URL,teams:normalized},null,2)+'\n');
console.log(`Updated official standings at ${jst}; total played=${totalPlayed}`);
