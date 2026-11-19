import React,{useEffect,useState} from 'react';
import './character-activities.css';

const fmt=new Intl.NumberFormat();
const groups=[
  ['ranked','Ranked for this session'],
  ['lead','Routes to try'],
  ['check','Check access or difficulty'],
  ['low-return','Low return for this session'],
  ['unlock','Profession unlocks'],
];
const when=t=>new Date(t).toISOString().slice(0,16).replace('T',' ')+' UTC';

function MarketReason({quote}) {
  if (quote?.ask==null) return <p>No current house ask for this item.{quote?.listed!=null && ' '+fmt.format(quote.listed)+' units listed.'}</p>;
  const delta=quote.priorAsk==null ? null : quote.ask-quote.priorAsk;
  return <p><strong>{coins(quote.ask)} per unit</strong> at {when(quote.t)}
    {quote.listed!=null && ' · '+fmt.format(quote.listed)+' units listed'}
    {delta!=null && <span> · {delta===0?'ask unchanged':(delta>0?'ask up ':'ask down ')+coins(Math.abs(delta))} since {when(quote.priorTime)}</span>}.
  </p>;
}
function coins(value) {
  const n=Math.abs(value);
  const parts=[];
  if (n>=10000) parts.push(fmt.format(Math.floor(n/10000))+'g');
  if (n>=100 && n%10000>=100) parts.push(Math.floor(n/100)%100+'s');
  if (n%100 || parts.length===0) parts.push(n%100+'c');
  return (value<0?'−':'')+parts.join(' ');
}
function RouteSuggestion({activity:a,onSelectRoute,sessionMinutes,targetCopper}) {
  const benchmark=a.ownRuns?'this character’s runs':a.yieldBasis==='Demo scenario'?'synthetic demo benchmark':'account runs on other or unspecified characters';
  return <li className="activity-card"><button type="button" className="activity-route" onClick={()=>onSelectRoute(a.routeId)}>{a.title}</button>
    <div>{a.zone} · {a.access.reason}</div>
    <MarketReason quote={a.quote}/>
    {a.access.state!=='available' ? <p>Resolve the access requirement before estimating this character’s return.</p>
      : a.sessionCopper!=null
      ? <p><strong>{coins(a.sessionCopper)} {a.ownRuns?'projected in':'benchmark for'} {sessionMinutes} min</strong> using {benchmark} ({fmt.format(a.runCount)} {a.runCount===1?'run':'runs'}).
          {' '}{a.loops} complete {a.loops===1?'loop':'loops'}, with {a.approachMinutes} min approach in the model.</p>
      : <p>{a.runCount ? 'Session value unavailable. '+a.gaps.join(', ')+'.' : 'Yield per hour is unmeasured.'}
          {a.requiredUnitsPerHour!=null && <> To target {coins(targetCopper)}/h, sell <strong>{fmt.format(a.requiredUnitsPerHour)} {a.item}/h</strong> at this ask before other expenses.</>}</p>}
    <details><summary>Route and evidence</summary><p>{a.notes}</p><p>{a.evidence}. <a href={a.source} target="_blank" rel="noreferrer">Read route guide</a></p></details>
  </li>;
}
function RouteGroup({rows,label,id,...props}) {
  if (!rows.length) return null;
  const list=<ol className="activity-list">{rows.map(a=><RouteSuggestion key={a.routeId} activity={a} {...props}/>)}</ol>;
  if (id==='unlock' || id==='check' || id==='low-return') return <details><summary>{label} ({rows.length})</summary>{list}</details>;
  return <section><h4>{label}</h4>{id==='lead'&&rows.length>1&&<p>Priced routes appear first. Rising asks help order routes with unmeasured returns.</p>}{list}</section>;
}

export function CharacterActivities({api,mode,region,refreshKey,scope,characters,onSelectRoute}) {
  const [chosen,choose]=useState(''),[minutes,setMinutes]=useState(30),[target,setTarget]=useState(100000);
  const [result,setResult]=useState(null);
  const actor=characters.find(c=>c.id===chosen) ?? characters[0];
  const actorId=actor?.id;
  const key=JSON.stringify([scope,mode,region,refreshKey,actorId,minutes,target]);
  useEffect(()=>{
    if (!actorId) return;
    let current=true;
    const query=new URLSearchParams({sessionMinutes:String(minutes),targetCopperPerHour:String(target),scope});
    api('/personal/characters/'+encodeURIComponent(actorId)+'/activities?'+query).then(data=>{
      if (!current) return;
      if (data.scope!==scope || data.actorId!==actorId || data.mode!==mode || (region && data.region!==region)) {
        setResult({key,error:'Character or house changed. Refresh Characters.'});
      } else setResult({key,data});
    }).catch(err=>{if(current)setResult({key,error:err.message})});
    return ()=>{current=false};
  },[api,actorId,scope,mode,region,minutes,target,key]);
  if (!actor) return null;
  const visible=result?.key===key ? result : null;
  const data=visible?.data;
  return <section className="character-activities" aria-label="Gold-making activities">
    <h3>Gold-making activities</h3>
    <div className="personal-form"><label>Character<select value={actorId} onChange={e=>choose(e.target.value)}>
      {characters.map(c=><option key={c.id} value={c.id}>{c.name} · Lv {c.level} {c.className} · {c.realm}</option>)}</select></label>
      <label>Session<select value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>{[15,30,60,120].map(m=><option key={m} value={m}>{m} min</option>)}</select></label>
      <label>Gold target<select value={target} onChange={e=>setTarget(Number(e.target.value))}>{[1,5,10,25,50,100].map(g=><option key={g} value={g*10000}>{g}g/h</option>)}</select></label>
    </div>
    <p>{actor.professionsAt==null ? 'Profession skills unobserved.' :
      (actor.professions.map(p=>p.name+' '+p.skill).join(' · ') || 'No professions recorded')+' · observed '+when(actor.professionsAt*1000)}</p>
    {!data ? <p role="status">{visible?.error || 'Checking routes and market observations…'}</p> : <>
      <p>{data.mode==='demo'?'Demo market':'Auction house'} · {data.house ?? 'No house selected'}{data.marketTime!=null && ' · '+when(data.marketTime)}{data.source && ' · '+data.source}</p>
      <p>Projections assume sale at the observed ask with a 5% cut. Listed units measure supply.</p>
      {groups.map(([id,label])=><RouteGroup key={id} id={id} label={label} rows={data.activities.filter(a=>a.category===id)}
        sessionMinutes={minutes} targetCopper={target} onSelectRoute={routeId=>onSelectRoute(routeId,{actor:actorId,sessionMinutes:minutes,targetCopperPerHour:target})}/>)}
      {data.alchemy && <section><h4>Alchemy opportunity</h4><strong>{data.alchemy.name}</strong>
        <p>{data.alchemy.label}. {data.alchemy.status!=='known' && <>Check the teaching recipe for {data.alchemy.costFavor} Merchant’s Favor with Nina Surefire in Redridge Mountains (Alliance) or Apothecary Durelle in the Barrens (Horde). Purchase eligibility and recipe ownership need confirmation. </>}
        Craft margin depends on reagent costs and sale proceeds.</p>
        <MarketReason quote={data.alchemy.quote}/><a href={data.alchemy.source} target="_blank" rel="noreferrer">Recipe</a> · <a href={data.alchemy.vendorSource} target="_blank" rel="noreferrer">Faction vendors</a></section>}
    </>}
  </section>;
}
