import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useReactTable} from '@tanstack/react-table';
import {farmSort, farmTableOptions} from './farm-table.js';
import {eligibility} from '../../../packages/domain/farms.mjs';
import './farms.css';

function money(copper) {
  if (copper == null) return '—';
  const raw = BigInt(copper), amount = raw < 0n ? -raw : raw;
  const parts = [[amount / 10000n,'g'],[amount / 100n % 100n,'s'],[amount % 100n,'c']];
  return (raw < 0n ? '−' : '') + (parts.filter(([n]) => n > 0n).map(([n,unit]) => n + unit).join(' ') || '0c');
}

function Numeric({label,value,set,min=0,max=1000000000,placeholder}) {
  return <label>{label}<input type="number" min={min} max={max} step="1" value={value ?? ''} placeholder={placeholder}
    onChange={e => set(e.target.value === '' ? '' : Number(e.target.value))}/></label>;
}

function RunEditor({route,save,actors,selectedActor}) {
  const fresh = () => ({elapsedMinutes:15,character:selectedActor?.name ?? '',characterId:selectedActor?.id ?? null,expenseCopper:0,coinCopper:0,
    haul:[{itemId:route.outputId,units:1,exit:'auction',bound:false,rare:false}]});
  const [run,setRun] = useState(fresh);
  const key = useRef(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const field = (k,v) => {key.current = null; setRun(prev => ({...prev,[k]:v}));};
  const stackField = (index,changes) => field('haul',run.haul.map((s,i) => i === index ? {...s,...changes} : s));
  return <form className="farm-form" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      key.current ??= crypto.randomUUID();
      await save({...run,id:key.current,revision:route.revision});
    } catch(err) {setError(err.message);} finally {setBusy(false);}
  }}>
    <div className="farm-inputs">
      <Numeric label="Elapsed minutes" min={1} max={1440} value={run.elapsedMinutes} set={v => field('elapsedMinutes',v)}/>
      <Numeric label="Looted coin (c)" value={run.coinCopper} set={v => field('coinCopper',v)}/>
      <Numeric label="Expenses (c)" value={run.expenseCopper} set={v => field('expenseCopper',v)}/>
      <label>Character<select value={run.characterId ?? ''} onChange={e => {
        key.current=null;
        const actor=actors.find(a => a.id===e.target.value);
        setRun(prev=>({...prev,characterId:actor?.id ?? null,character:actor?.name ?? ''}));
      }}><option value="">Manual / unassigned</option>{actors.map(a=><option key={a.id} value={a.id}>{a.name}{a.realm?' · '+a.realm:''}</option>)}</select></label>
      {!run.characterId && <label>Character name<input maxLength={100} value={run.character} onChange={e=>field('character',e.target.value)}/></label>}
    </div>
    <p>Include time spent clearing, waiting and resetting. Record approach time separately.</p>
    {run.haul.map((s,i) => <fieldset className="farm-inputs" key={i}>
      <legend>Loot {i+1}</legend>
      <Numeric label="Item ID" min={1} max={9999999} value={s.itemId} set={v => stackField(i,{itemId:v})}/>
      <Numeric label="Units" min={1} max={100000} value={s.units} set={v => stackField(i,{units:v})}/>
      <label>Exit<select value={s.exit} onChange={e => stackField(i,{exit:e.target.value})}>
        {!s.bound && <option value="auction">Auction</option>}<option value="vendor">Vendor</option><option value="keep">Keep</option>
      </select></label>
      <label><input type="checkbox" checked={s.bound} onChange={e => stackField(i,{bound:e.target.checked,...(e.target.checked && s.exit === 'auction' ? {exit:'keep'} : {})})}/> Bound</label>
      <label><input type="checkbox" checked={s.rare} onChange={e => stackField(i,{rare:e.target.checked})}/> Rare</label>
      <button type="button" onClick={() => field('haul',run.haul.filter((_,n) => n !== i))}>Remove</button>
    </fieldset>)}
    {error && <p role="alert">{error}</p>}
    <div className="farm-controls"><button type="button" disabled={run.haul.length>=32} onClick={() => field('haul',[...run.haul,{itemId:route.outputId,units:1,exit:'auction',bound:false,rare:false}])}>Add loot</button>
    <button disabled={busy} type="submit">Save run</button></div>
  </form>;
}

function RouteEditor({route,save}) {
  const [draft,setDraft] = useState({name:route.name,notes:route.notes,approachMinutes:route.approachMinutes,revision:route.revision});
  const [error,setError] = useState(''), [busy,setBusy] = useState(false);
  return <form className="farm-form" onSubmit={async e => {
    e.preventDefault();setBusy(true);
    try {await save(draft);} catch(err) {setError(err.message);} finally {setBusy(false);}
  }}>
    <label>Route name<input required maxLength={100} value={draft.name} onChange={e => setDraft({...draft,name:e.target.value})}/></label>
    <label>Route notes<textarea required maxLength={1500} value={draft.notes} onChange={e => setDraft({...draft,notes:e.target.value})}/></label>
    <Numeric label="One-time approach (min)" max={1440} value={draft.approachMinutes} set={v => setDraft({...draft,approachMinutes:v})}/>
    <p>Saving a revision starts a fresh run comparison. Earlier runs retain their original route details and revision.</p>
    {error && <p role="alert">{error}</p>}<button disabled={busy}>Save revision</button>
  </form>;
}

function RunHistory({api,route}) {
  const [rows,setRows] = useState([]), [offset,setOffset] = useState(0), [error,setError] = useState('');
  useEffect(() => {let active = true; setError('');api('/farms/'+route.id+'/history?offset='+offset).then(r => {if(active) setRows(r.rows);}).catch(e => {if(active) setError(e.message);});
    return () => {active=false;};},[api,route.id,offset]);
  return <div>{error && <p role="alert">{error}</p>}{rows.length ? <ul>{rows.map(r => <li key={r.id}>
    {new Date(r.observed).toLocaleString()} · r{r.revision} · {r.character || 'Unassigned'} · {r.elapsedMinutes} min · {money(r.coinCopper)} looted · {r.haul.map(s => s.units+' × #'+s.itemId).join(', ') || 'Empty haul'}
  </li>)}</ul> : <p>No recorded runs on this page.</p>}
  <div className="farm-controls"><button disabled={offset===0} onClick={() => setOffset(offset-50)}>Previous</button><button disabled={rows.length<50} onClick={() => setOffset(offset+50)}>Next</button></div></div>;
}

export function Farms({api,mode,region,pane,updatePane,selectedRoute,onSelectRoute,routes=[],refreshRoutes,refreshKey}) {
  const query = pane.query ?? '', session = pane.sessionMinutes ?? 60;
  const [compared,setCompared] = useState(null),[actors,setActors] = useState([]),[notice,setNotice] = useState(''),[tool,setTool] = useState('');
  const focus = useRef(null);
  const options = {...pane.farmOptions,characterId:pane.actor || null};
  const lookup = JSON.stringify(options);
  useEffect(() => {
    let active = true;
    setCompared(null);
    api('/farms/compare',{method:'POST',body:{...options,sessionMinutes:session}}).then(r => {
      if (active) {setCompared(r.routes);setNotice('');}
    }).catch(e => {if(active) setNotice(e.message);});
    return () => {active=false;};
  },[api,mode,region,session,lookup,refreshKey,routes]);
  useEffect(() => {
    let active=true;setActors([]);
    api('/personal/characters').then(r => {if (active) setActors(r.characters);}).catch(e => {if(active) setNotice(e.message);});
    return () => {active=false;};
  },[api,mode,refreshKey]);
  useEffect(() => {setTool('');},[selectedRoute,mode]);
  useEffect(() => {if (pane.revealRoute && focus.current) focus.current.scrollIntoView?.({block:'nearest'});},[pane.revealRoute,selectedRoute]);
  const actor = actors.find(a => a.id === pane.actor);
  const list = compared ?? routes;
  const route = list.find(r => r.id === selectedRoute);
  const matches = useMemo(() => list.filter(r =>
    (r.name+' '+r.zone+' '+r.type+' '+r.output).toLowerCase().includes(query.toLowerCase())
    && (!pane.skillOnly || eligibility(r,actor)==='Meets skill')
  ),[list,query,actor,pane.skillOnly]);
  const filtered = r => matches.includes(r);
  const visible = useMemo(() => list.filter(r => matches.includes(r) || r.id===pane.revealRoute),[list,matches,pane.revealRoute]);
  const sorting = useMemo(() => farmSort(pane.farmSort),[pane.farmSort]);
  const table = useReactTable(farmTableOptions(visible,sorting,updater => {
    updatePane({farmSort:typeof updater==='function' ? updater(sorting) : updater});
  }));
  const editOptions = next => updatePane({farmOptions:{...options,...next}});
  const refreshed = async (message) => {
    const result = await api('/farms/compare',{method:'POST',body:{...options,sessionMinutes:session}});
    await refreshRoutes?.();
    setCompared(result.routes);setTool('');setNotice(message);
  };
  return <section className="farm-pane" aria-label="Farm comparisons">
    <div className="farm-controls">
      <input type="search" placeholder="Find a route or herb" aria-label="Search farms" value={query} onChange={e => updatePane({query:e.target.value,revealRoute:null})}/>
      <select aria-label="Session length" value={session} onChange={e => updatePane({sessionMinutes:Number(e.target.value)})}>
        {[15,30,60,120].map(n => <option key={n} value={n}>{n} min</option>)}
      </select>
      <button aria-expanded={tool==='compare'} onClick={() => setTool(tool==='compare'?'':'compare')}>Compare</button>
    </div>
    {tool==='compare' && <div className="farm-inputs">
      <Numeric label="Shared herb price (c)" value={options.unitCopper} placeholder="House ask" set={v => editOptions({unitCopper:v===''?null:v})}/>
      <Numeric label="Alternative return (c/h)" value={options.targetCopperPerHour ?? 100000} set={v => editOptions({targetCopperPerHour:v===''?100000:v})}/>
      <label>Character<select value={pane.actor ?? ''} onChange={e => updatePane({actor:e.target.value})}><option value="">Any character</option>
        {actors.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
      <label><input type="checkbox" checked={!!pane.skillOnly} onChange={e => updatePane({skillOnly:e.target.checked})}/> Meets observed skill</label>
      {actor && <label><input type="checkbox" checked={options.allowAggregate!==false} onChange={e => editOptions({allowAggregate:e.target.checked})}/> Use all runs if this character has none</label>}
    </div>}
    {route && pane.revealRoute && !filtered(route) && <p>Showing selected route outside filter. <button onClick={() => updatePane({revealRoute:null})}>Return to filter</button></p>}
    <table><thead><tr>{table.getAllLeafColumns().map(column => {
      const direction=column.getIsSorted();
      return <th key={column.id} scope="col" aria-sort={direction==='asc'?'ascending':direction==='desc'?'descending':undefined}>
        <button className="farm-row" onClick={column.getToggleSortingHandler()}>{column.id==='session'?session+' min':column.columnDef.header}
          {direction && <span aria-hidden="true">{direction==='asc'?' ↑':' ↓'}</span>}</button></th>;
    })}</tr></thead><tbody>{table.getRowModel().rows.map(({original:r}) => <tr key={r.id} ref={r.id===selectedRoute?focus:null} className={r.id===selectedRoute?'selected':''}>
        <td><button className="farm-row" onClick={() => onSelectRoute(r.id)}>{r.name}</button><small>{r.zone} · {r.yieldBasis}{actor?' · '+r.sampleScope:''}</small></td>
        <td>{money(r.rateCopperPerHour)}</td><td>{money(r.sessionGoldCopper)}</td>
      </tr>)}</tbody></table>
    {!visible.length && <p>No routes match these filters.</p>}
    {notice && <p role="status">{notice}</p>}
    {route && (filtered(route) || pane.revealRoute===route.id) && <article className="farm-detail" key={route.id}>
      <h3>{route.name}</h3><p>{route.notes}</p>
      <p>{route.requirements} · {actor ? actor.name+' · '+eligibility(route,actor) : 'No character selected'} · {route.geometry.precision}</p>
      <p>{route.loops ?? '—'} complete loops · {route.approachMinutes} min approach · {route.runCount} samples · {route.sampleScope} · {route.priceBasis}
        {route.quote?.t ? ' · '+new Date(route.quote.t).toLocaleString() : ''}</p>
      <p>Across samples · Coin {money(route.coinCopper)} · Vendor scenario {money(route.vendorCopper)} · Auction scenario {money(route.auctionCopper)} · Expenses {money(route.expenseCopper)} · Rare share {money(route.rareCopper)}</p>
      <p>Sale cut scenario {route.feeBps/100}% · Match target at {route.requiredUnitsPerHour ?? '—'} herbs/hour before expenses.</p>
      {route.baselineTime!=null && <p>Same haul and elapsed time · {money(route.changeCopperPerHour)}/h change since {new Date(route.baselineTime).toLocaleString()}.</p>}
      {!!route.gaps?.length && <p>Missing · {route.gaps.join(', ')}</p>}
      <a href={route.source} target="_blank" rel="noreferrer">Route source ↗</a>
      <div className="farm-controls">{[['run','Record run'],['edit','Edit route'],['scenario','Try a yield'],['history','History']].map(([k,label]) =>
        <button key={k} aria-expanded={tool===k} onClick={() => setTool(tool===k?'':k)}>{label}</button>)}</div>
      {tool==='run' && <RunEditor route={route} actors={actors} selectedActor={actor} save={async data => {await api('/farms/'+route.id+'/runs',{method:'POST',body:data});await refreshed('Run recorded.');}}/>}
      {tool==='edit' && <RouteEditor route={route} save={async data => {await api('/farms/'+route.id,{method:'PUT',body:data});await refreshed('Revision saved.');}}/>}
      {tool==='history' && <RunHistory api={api} route={route}/>}
      {tool==='scenario' && <Scenario route={route} options={options} apply={editOptions}/>}
    </article>}
  </section>;
}

function Scenario({route,options,apply}) {
  const current=options.scenarios?.[route.id];
  const [minutes,setMinutes]=useState(current?.elapsedMinutes ?? 15),[units,setUnits]=useState(current?.haul?.[0]?.units ?? 1);
  const [approach,setApproach]=useState(route.approachMinutes);
  return <form className="farm-form" onSubmit={e => {e.preventDefault();apply({
    scenarios:{...options.scenarios,[route.id]:{elapsedMinutes:minutes,haul:units ? [{itemId:route.outputId,units,exit:'auction'}] : [],coinCopper:0,expenseCopper:0}},
    approaches:{...options.approaches,[route.id]:approach}
  });}}>
    <div className="farm-inputs"><Numeric label="Minutes per loop" min={1} max={1440} value={minutes} set={setMinutes}/>
    <Numeric label="Herbs per loop" max={100000} value={units} set={setUnits}/><Numeric label="Approach (min)" max={1440} value={approach} set={setApproach}/></div>
    <div className="farm-controls"><button>Apply scenario</button><button type="button" onClick={() => {
      const scenarios={...options.scenarios},approaches={...options.approaches};delete scenarios[route.id];delete approaches[route.id];
      apply({scenarios,approaches});
    }}>Use recorded runs</button></div>
  </form>;
}
