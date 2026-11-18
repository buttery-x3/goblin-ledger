import React, {useEffect, useState} from 'react';
import {ItemUseEvidence} from './ItemUseEvidence.jsx';
import {refreshMarketReads} from './market-query.js';
import {ACTIONS,USE_KINDS} from '../../../packages/domain/research.mjs';
import {legacyRules,LEGACY_SOURCE,RECIPE_SOURCE} from '../../../packages/domain/progression.mjs';
import {ChoiceCalculator} from './CraftChoices.jsx';
import './research.css';

function useRead(api, path, refreshKey) {
  const [state,set] = useState({});
  useEffect(() => {
    let active = true;
    set({});
    if (path) api(path).then(data => active && set({data})).catch(e => active && set({error:e.message}));
    return () => {active=false;};
  },[api,path,refreshKey]);
  return state;
}

function Label({name,children}) {
  return <label className="rs-field"><span>{name}</span>{children}</label>;
}
function ErrorLine({error}) { return error ? <p role="alert" className="rs-error">{error}</p> : null; }
function Source({url,label}) {return <a href={url} target="_blank" rel="noreferrer">{label} ↗</a>;}
const initial = {title:'',url:'',publisher:'',summary:'',action:'gather',routeId:'',ids:'',publishedOn:'',revisedOn:'',effectiveOn:''};

function EvidenceEditor({api,routes,onSave,initialValue}) {
  const [form,setForm] = useState(initialValue), [error,setError] = useState(''), [saving,setSaving] = useState(false);
  const changedUse = form.action === 'changed use';
  const kind = form.useKind || 'source report';
  const observation = changedUse && kind === 'observed turn-in';
  const needsLink = !observation && !(form.localId && form.action === 'watch');
  const [draftId] = useState(() => crypto.randomUUID());
  const bind = key => ({value:form[key] || '',onChange:e => setForm({...form,[key]:e.target.value})});
  const submit = async e => {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const itemIds = form.ids.trim() ? form.ids.split(',').map(s => Number(s.trim())) : [];
      const observedAt = observation && form.observedTime ? form.observedTime+(form.observedTime.length === 16 ? ':00Z' : 'Z') : undefined;
      const localId = form.localId || (observation && !form.id ? draftId : undefined);
      const result = await api('/research',{method:'POST',body:{...form,itemIds,localId,observedAt,baseRevision:form.revision}});
      onSave(result.id);
    } catch(err){setError(err.message);} finally {setSaving(false);}
  };
  return <form onSubmit={submit} className="rs-form">
    <div className="rs-grid"><Label name="Action"><select {...bind('action')}>{ACTIONS.map(a => <option key={a}>{a}</option>)}</select></Label>
      {changedUse && <Label name="Evidence type"><select value={kind} onChange={e=>setForm({...form,useKind:e.target.value})}>{USE_KINDS.map(k=><option key={k}>{k}</option>)}</select></Label>}</div>
    <Label name={needsLink ? 'Source link' : 'Supporting link (optional)'}><input type="url" required={needsLink} readOnly={!!form.id && !form.localId} maxLength={2000} {...bind('url')}/></Label>
    <div className="rs-grid"><Label name="Title"><input required maxLength={200} {...bind('title')}/></Label>
    <Label name={observation ? "Observer or local record" : "Publisher"}><input required maxLength={100} {...bind('publisher')}/></Label></div>
    <Label name="Advice or observed change"><textarea required maxLength={800} {...bind('summary')}/></Label>
    <div className="rs-grid">
    {changedUse && kind !== 'source report' && <Label name={observation ? 'Turn-in and game context' : 'Game build'}><input required maxLength={160} {...bind('useContext')}/></Label>}
    {observation && <Label name="Hand-in observed (UTC)"><input type="datetime-local" step="any" required {...bind('observedTime')}/></Label>}
    <Label name="Named route"><select {...bind('routeId')}><option value="">Item-wide</option>{routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Label>
    <Label name="Item IDs, comma separated"><input required={changedUse} {...bind('ids')} placeholder="8845"/></Label>
    <Label name="Published"><input type="date" {...bind('publishedOn')}/></Label>
    <Label name="Revised"><input type="date" {...bind('revisedOn')}/></Label>
    <Label name="Game change effective"><input type="date" required={changedUse && kind === 'build change'} {...bind('effectiveOn')}/></Label></div>
    <ErrorLine error={error}/><button type="submit" disabled={saving}>Save evidence</button>
  </form>;
}

function LocalModel({api,config,onChange}) {
  const [model,setModel] = useState(config?.model || ''),[port,setPort] = useState(config?.port || 1234),[error,setError] = useState('');
  return <details><summary>Local model settings</summary><form className="rs-form" onSubmit={async e => {
    e.preventDefault(); setError('');
    try {await api('/research/ai',{method:'PUT',body:{model,port:Number(port)}});onChange();}catch(err){setError(err.message);}
  }}>
    <p>Generate a note from the selected article’s saved summary and item tags via a local OpenAI-compatible server.</p>
    <div className="rs-grid"><Label name="Model identifier"><input value={model} maxLength={160} placeholder="Leave blank to disable" onChange={e=>setModel(e.target.value)}/></Label>
    <Label name="127.0.0.1 port"><input type="number" min="1" max="65535" required value={port} onChange={e=>setPort(e.target.value)}/></Label></div>
    <button>Save model settings</button><ErrorLine error={error}/>
  </form></details>;
}

function Response({api,article,asOf,refreshKey}) {
  const path='/research/'+article.id+'/response'+(asOf ? '?asOf='+encodeURIComponent(asOf) : '');
  const {data,error}=useRead(api,path,refreshKey);
  const c=data?.comparison;
  return <div className="rs-readout"><strong>Before / after</strong><ErrorLine error={error}/>
    {data ? <>{c && <span>{c.before} / {c.after} observed hours · {c.pairs} paired of {c.hours}</span>}
    <span>{c?.reason || data.reason || ('Mean paired ask change '+c.priceChangeCopper.toLocaleString()+'c · listed units '+c.supplyChange.toLocaleString())}</span>
    {c && <small>Equal UTC windows either side of {data.day}, excluding that calendar day. Price and supply describe the house.</small>}</> : !error && <span>Loading house observations…</span>}
  </div>;
}

export function Research({api,routes=[],pane={},updatePane,onSelectRoute,refreshKey,mode,region}) {
  const [bump,setBump] = useState(0),[editor,setEditor]=useState(null),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false);
  const refresh = [mode,region,refreshKey,bump].join('|');
  const replay = pane.replayDate ? pane.replayDate+'T23:59:59.999Z' : '';
  const path = '/research'+(replay ? '?asOf='+encodeURIComponent(replay) : '');
  const {data,error} = useRead(api,path,refresh);
  const items=data?.items || [];
  const selected=items.find(a=>a.id===pane.articleId) || items[0];
  const reload=()=>setBump(v=>v+1);
  const run=async(fn)=>{setProblem('');setBusy(true);try {await fn();reload();}catch(e){setProblem(e.message);}finally{setBusy(false);}};
  return <section className="rs-panel">
    <div className="rs-toolbar"><Label name="Replay through (UTC)"><input type="date" value={pane.replayDate || ''} onChange={e=>updatePane({replayDate:e.target.value})}/></Label>
    {replay && <button onClick={()=>updatePane({replayDate:''})}>Today</button>}
    <button disabled={!!replay} onClick={()=>setEditor(editor ? null : {...initial})}>{editor ? 'Close editor':'Add source'}</button>
    <button disabled={busy || !!replay} onClick={()=>run(()=>api('/research/refresh',{method:'POST',body:{}}))}>Check guide</button></div>
    <ErrorLine error={error || problem}/>
    {editor && !replay && <EvidenceEditor key={editor.id || 'new'} api={api} routes={routes} initialValue={editor} onSave={id=>{setEditor(null);updatePane({articleId:id});reload();refreshMarketReads(api,mode,region);}}/>}
    {!data && !error && <p>Loading source revisions…</p>}
    {data && !items.length && <p>No research was recorded by this date.</p>}
    {selected && <>
      <Label name="Source"><select value={selected.id} onChange={e=>updatePane({articleId:e.target.value})}>{items.map(a=><option key={a.id} value={a.id}>{a.publisher} · {a.title}</option>)}</select></Label>
      <article className="rs-card"><small>{selected.action.toUpperCase()} · {selected.evidence} · revision {selected.revision}</small>
        {selected.useThesis ? <ItemUseEvidence record={selected}/> : <><h3>{selected.title}</h3><p>{selected.summary}</p></>}
        <dl><dt>Published</dt><dd>{selected.publishedOn || 'Unknown'}</dd><dt>Revised</dt><dd>{selected.revisedOn || 'Unknown'}</dd>
        {!selected.useThesis && selected.effectiveOn && <><dt>Game change effective</dt><dd>{selected.effectiveOn}</dd></>}
        <dt>First seen locally</dt><dd>{new Date(selected.firstSeenAt).toLocaleString()}</dd>
        {!selected.useThesis && <><dt>Audience reach</dt><dd>Unknown</dd></>}
        {!selected.useThesis && selected.itemIds.length > 0 && <><dt>Items</dt><dd>{selected.itemIds.join(', ')}</dd></>}
        <dt>Applies to</dt><dd>{selected.routeId ? <button onClick={()=>onSelectRoute(selected.routeId)}>{routes.find(r=>r.id===selected.routeId)?.name || selected.routeId}</button> : 'Linked items'}</dd></dl>
        {!selected.useThesis && selected.url && <Source url={selected.url} label={selected.publisher}/>}
      </article>
      <Response api={api} article={selected} asOf={replay} refreshKey={refresh}/>
      {!replay && <button onClick={()=>setEditor({...initial,...selected,ids:selected.itemIds.join(', '),observedTime:selected.observedAt?.slice(0,-1)})}>Record a revision</button>}
      {selected.annotation && <p><strong>Model note</strong> · {selected.annotation.summary} <small>{selected.annotation.model} · prompt {selected.annotation.promptVersion}</small></p>}
      {data?.ai && !replay && <button disabled={busy} onClick={()=>run(()=>api('/research/'+selected.id+'/annotation',{method:'POST',body:{revision:selected.revision}}))}>Generate local note</button>}
    </>}
    {data && !replay && <LocalModel api={api} config={data.ai} onChange={reload}/>}
  </section>;
}

function money(value) {
  if (value == null) return 'Unknown';
  const copper=BigInt(value), abs=copper<0n ? -copper:copper;
  return (copper<0n?'−':'')+(abs>=10000n?abs/10000n+'g ':'')+(abs>=100n?(abs/100n)%100n+'s ':'')+abs%100n+'c';
}

function Batch({api,recipe,refresh}) {
  const [quantity,setQuantity]=useState(1),[owned,setOwned]=useState({}),[unlock,setUnlock]=useState(''),[quote,setQuote]=useState(null),[error,setError]=useState('');
  const serialized=JSON.stringify(owned);
  useEffect(()=>{
    let current=true;
    setQuote(null);setError('');
    if (Number(quantity)<1 || !Number.isSafeInteger(Number(quantity))) return;
    const timer=setTimeout(()=>api('/crafts/quote',{method:'POST',body:{recipeId:recipe.id,quantity:Number(quantity),owned:JSON.parse(serialized),
      ...(unlock!=='' ? {unlockCopper:Number(unlock)} : {})}}).then(q=>current&&setQuote(q)).catch(e=>current&&setError(e.message)),150);
    return ()=>{current=false;clearTimeout(timer);};
  },[api,recipe.id,quantity,serialized,unlock,refresh]);
  return <section className="rs-card"><small>{recipe.profession} · skill {recipe.skill}</small>
    <h3>{recipe.name}</h3><div className="rs-grid">
      <Label name="Crafts in batch"><input type="number" min="1" max="1000" value={quantity} onChange={e=>setQuantity(e.target.value)}/></Label>
      <Label name="Unlock cost scenario (copper)"><input type="number" min="0" max="1000000000" placeholder="Optional" value={unlock} onChange={e=>setUnlock(e.target.value)}/></Label></div>
    <table><thead><tr><th>Input</th><th>Per craft</th><th>Already owned</th><th>Purchase cost</th></tr></thead><tbody>
    {recipe.inputs.map(i=><tr key={i.itemId}><td>{i.name}</td><td>{i.units}</td><td><input type="number" min="0" max="1000000" aria-label={i.name+' owned'} value={owned[i.itemId] ?? 0} onChange={e=>setOwned({...owned,[i.itemId]:Number(e.target.value)})}/></td>
    <td>{money(quote?.rows?.find(r=>r.itemId===i.itemId)?.purchaseCopper)}</td></tr>)}</tbody></table>
    <ErrorLine error={error}/>{quote && <><dl><dt>Increment over raw sale</dt><dd><strong>{money(quote.incrementalCopper)}</strong></dd>
    <dt>Priced purchases</dt><dd>{money(quote.cashCostCopper)}</dd><dt>Owned materials’ sale value</dt><dd>{money(quote.alternativeCopper)}</dd>
    <dt>Conditional output after cut</dt><dd>{money(quote.netOutputCopper)}</dd>
    {unlock!=='' && <><dt>Unlock payback</dt><dd>{quote.breakEvenSales===null ? 'Unproven within this batch' : quote.breakEvenSales+' sales'}</dd></>}
    <dt>Quote basis</dt><dd>{quote.basis} · {(quote.feeBps / 100).toLocaleString()}% cut · {quote.t ? new Date(quote.t).toLocaleString() : 'No snapshot'}</dd></dl>
    {quote.gaps.length>0 && <p>{quote.gaps.join(' · ')}</p>}</>}
    <Source url={recipe.source} label="Recipe and ingredients"/>
  </section>;
}

function Progression({api,refresh}) {
  const [bump,setBump]=useState(0),[id,setId]=useState('class:druid:25'),[error,setError]=useState('');
  const [className,setClass]=useState('Druid'),[level,setLevel]=useState(24),[skill,setSkill]=useState(123);
  const {data,error:loadError}=useRead(api,'/progression/account',refresh+'|'+bump);
  const [result,setResult]=useState(null);
  useEffect(()=>{
    let active=true;
    setResult(null);
    const timer=setTimeout(()=>api('/progression/preview',{method:'POST',body:{character:{className,level:Number(level),professions:[{name:'Alchemy',skill:Number(skill)}]}}})
      .then(d=>active&&setResult(d.result)).catch(e=>active&&setError(e.message)),150);
    return ()=>{active=false;clearTimeout(timer);};
  },[api,className,level,skill,bump,refresh]);
  return <details><summary>Character and account unlocks</summary><div className="rs-form"><small>Character scenario</small><div className="rs-grid">
    <Label name="Class"><select value={className} onChange={e=>setClass(e.target.value)}>{legacyRules.classes.map(c=><option key={c}>{c}</option>)}</select></Label>
    <Label name="Level"><input type="number" min="1" max="60" value={level} onChange={e=>setLevel(e.target.value)}/></Label>
    <Label name="Alchemy skill"><input type="number" min="0" max="300" value={skill} onChange={e=>setSkill(e.target.value)}/></Label></div>
    {result && <ul>{[result.classChallenge,...result.professionChallenges,result.recipe].filter(Boolean).map(c=><li key={c.id}>{c.label}</li>)}</ul>}
    <p>Learning the potion requires Alchemy 130. The teaching item costs 45 Merchant’s Favor. Vendor standing is unverified. <Source url={RECIPE_SOURCE} label="Recipe tooltip"/></p>
    {data && <div className="rs-grid"><Label name="Account challenge"><select value={id} onChange={e=>setId(e.target.value)}>
    {data.catalog.map(c=><option key={c.id} value={c.id}>{c.name} {c.target}</option>)}</select></Label>
    <Label name="Recorded completion"><select value={String(data.completion[id] ?? 'unknown')} onChange={async e=>{
      const value=e.target.value;try{setError('');await api('/progression/account',{method:'PUT',body:{id,state:value==='unknown'?null:value==='true',scope:data.scope}});setBump(b=>b+1);}catch(err){setError(err.message);}
    }}><option value="unknown">Unknown</option><option value="true">Earned</option><option value="false">Unearned</option></select></Label></div>}
    <ErrorLine error={error || loadError}/><Source url={LEGACY_SOURCE} label="Blizzard Legacy rules"/></div></details>;
}

export function Professions({api,refreshKey,mode,region}) {
  const refresh=[mode,region,refreshKey].join('|');
  const catalog=useRead(api,'/crafts/catalog',refresh);
  return <section className="rs-panel"><ErrorLine error={catalog.error}/>
    {(!catalog.data && !catalog.error) && <p>Loading recipes…</p>}
    {catalog.data?.recipes.map(r=><Batch key={r.id} api={api} recipe={r} refresh={refresh}/>)}
    <Progression api={api} refresh={refresh}/>
    <ChoiceCalculator api={api} mode={mode} region={region}/>
  </section>;
}
