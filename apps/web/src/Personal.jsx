import React, { useEffect, useState } from 'react'
import { progressionForCharacter } from '../../../packages/domain/progression.mjs'
import { activityAccess } from '../../../packages/domain/character-activities.mjs'
import { CharacterActivities } from './CharacterActivities.jsx'
import './personal.css'

const fmt=Intl.NumberFormat()
function gold(c) {
  const n=BigInt(c), a=n<0n?-n:n
  return (n<0n?'−':'')+fmt.format(a/10000n)+'g '+(a/100n%100n)+'s '+(a%100n)+'c'
}
function date(sec){return sec ? new Date(sec*1000).toLocaleString() : 'Unobserved'}
function usePersonal(api,route,mode,refreshKey) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[revision,bump]=useState(0)
  useEffect(()=>{setData(null);setError('')},[route,mode])
  useEffect(()=>{
    let current=true
    api('/personal/'+route).then(result=>{if(current){setData(result);setError('')}}).catch(e=>{if(current)setError(e.message)})
    return ()=>{current=false}
  },[api,route,mode,refreshKey,revision])
  return {data,error,reload:()=>bump(n=>n+1)}
}
function Notice({msg}){return msg?<p className="personal-notice" role="status">{msg}</p>:null}
export function Characters({api,mode,region,refreshKey,routes=[],selectedRoute,onSelectRoute}) {
  const {data,error}=usePersonal(api,'characters',mode,refreshKey)
  const [completion,setCompletion]=useState({})
  useEffect(()=>{let active=true;setCompletion({});api('/progression/account').then(r=>{if(active)setCompletion(r.completion||{})}).catch(()=>{});return ()=>{active=false}},[api,mode,refreshKey])
  if (!data) return <Notice msg={error||'Loading characters…'}/>
  const route=routes.find(r=>r.id===selectedRoute)
  return <div className="personal-pane"><Notice msg={error}/>
    <CharacterActivities api={api} mode={mode} region={region} refreshKey={refreshKey} scope={data.scope} characters={data.characters} onSelectRoute={onSelectRoute}/>
    {!data.characters.length?<p>Install the addon in Settings, choose an account, then log out or reload WoW to save your first character observation.</p>:
      data.characters.map(c=>{
        const progress=progressionForCharacter(c,completion)
        return <details key={c.id}><summary><strong>{c.name}</strong> <span>Lv {c.level} · {c.className} · {gold(c.money)}</span></summary>
          <dl><dt>Realm</dt><dd>{c.realm}</dd><dt>Experience</dt><dd>{fmt.format(c.xp)} / {fmt.format(c.xpMax)}</dd>
            <dt>Rested XP observed</dt><dd>{c.restedXp==null?'Unobserved':fmt.format(c.restedXp)}</dd>
            <dt>Last login</dt><dd>{date(c.lastLogin)}</dd><dt>Last seen</dt><dd>{date(c.lastSeen)}</dd>
            <dt>Bags / bank</dt><dd>{date(c.bagsAt)} / {date(c.bankAt)}</dd><dt>Professions</dt><dd>{c.professions.map(p=>p.name+' '+p.skill).join(', ')||'Unobserved'}</dd>
            <dt>Class challenge</dt><dd>{progress.classChallenge?.label||'No further recorded challenge'}</dd>
            {progress.professionChallenges?.length>0&&<><dt>Profession challenges</dt><dd>{progress.professionChallenges.map(p=>p.label).join(' · ')}</dd></>}
            {progress.recipe&&<><dt>Recipe</dt><dd>{progress.recipe.label}</dd></>}
            {route&&<><dt>{route.name}</dt><dd>{activityAccess(route,c).reason}</dd></>}
          </dl></details>
      })}
  </div>
}
function NewEntry({api,characters,onDone}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[action,setAction]=useState('opening')
  async function submit(event) {
    event.preventDefault();const form=event.currentTarget,f=Object.fromEntries(new FormData(form))
    if (f.at && !Number.isFinite(Date.parse(f.at))) return setError('Choose a valid transaction time.')
    setBusy(true);setError('')
    try {
      const draft=JSON.stringify([action,f])
      if(form.dataset.draft!==draft){form.dataset.id=crypto.randomUUID();form.dataset.at=String(Math.floor(Date.now()/1000));form.dataset.draft=draft}
      await api('/personal/transactions',{method:'POST',body:{...f,action,id:form.dataset.id,
        itemId:Number(f.itemId),quantity:Number(f.quantity),unitCopper:f.unitCopper===''?null:f.unitCopper,at:f.at?Math.floor(Date.parse(f.at)/1000):Number(form.dataset.at),
        feeBps:Number(f.feeBps??500),depositPaidCopper:f.depositPaidCopper||'0',depositRefundCopper:f.depositRefundCopper||'0'}})
      delete form.dataset.draft;form.reset();onDone()
    } catch(e){setError(e.message)} finally {setBusy(false)}
  }
  return <form onSubmit={submit} className="personal-form"><label>Record type<select value={action} onChange={e=>setAction(e.target.value)}>
    <option value="opening">Opening cost basis</option><option value="purchase">Purchase</option><option value="sale">Auction sale</option></select></label>
    <label>Item ID<input name="itemId" type="number" min="1" required/></label><label>Quantity<input name="quantity" type="number" min="1" required/></label>
    <label>Unit price (copper)<input name="unitCopper" inputMode="numeric" pattern="[0-9]+" required={action==='sale'} placeholder="Unknown"/></label>
    <label>Character<select name="owner"><option value="manual">Manual holdings</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Suffix<input name="variant" defaultValue="0" required/></label>
    <label>Binding<select name="binding"><option>tradeable</option><option>bound</option><option>unknown</option></select></label>
    <label>Observed at<input type="datetime-local" name="at"/></label>
    {action==='sale'&&<><label>Sale cut (basis points)<input name="feeBps" type="number" min="0" max="10000" defaultValue="500"/></label>
      <label>Deposit paid (copper)<input name="depositPaidCopper" type="number" min="0" defaultValue="0"/></label>
      <label>Deposit returned (copper)<input name="depositRefundCopper" type="number" min="0" defaultValue="0"/></label></>}
    <button disabled={busy}>Record entry</button><Notice msg={error}/></form>
}
function PositionNote({api,pos,onDone}) {
  const [message,setMessage]=useState('')
  async function save(e) {
    e.preventDefault()
    try{
      await api('/personal/notes',{method:'PUT',body:{itemId:pos.itemId,variant:pos.variant,binding:pos.binding,...Object.fromEntries(new FormData(e.currentTarget))}})
      setMessage('Note saved.');onDone()
    }catch(err){setMessage(err.message)}
  }
  return <form className="personal-form" onSubmit={save}>{[['reason','Hold reason'],['target','Target'],['revisit','Revisit when']].map(([key,label])=>
    <label key={key}>{label}<input name={key} defaultValue={pos.note?.[key]??''} maxLength="2000"/></label>)}<button>Save note</button><Notice msg={message}/></form>
}
export function Positions({api,mode,region,refreshKey}) {
  const {data,error,reload}=usePersonal(api,'positions',mode,region+'|'+refreshKey)
  const {data:chars}=usePersonal(api,'characters',mode,refreshKey)
  const characters=chars?.scope===data?.scope ? chars?.characters??[] : []
  const names=Object.fromEntries(characters.map(c=>[c.id,c.name]))
  return <div className="personal-pane"><details><summary>Record a transaction</summary><NewEntry api={api} characters={characters} onDone={reload}/></details>
    <Notice msg={error}/>{!data?<p>Loading positions…</p>:!data.positions.length?<p>No holdings observed. Import a character or enter an opening balance above.</p>:data.positions.map(p=>
      <details key={p.asset}><summary><strong>{p.valuation?.name||('Item '+p.itemId)}</strong> <span>{fmt.format(p.economic)} units · {p.binding}</span></summary>
        <dl><dt>Item suffix</dt><dd>{p.variant}</dd><dt>Last observed stock</dt><dd>{fmt.format(p.physical)}</dd>
          <dt>Economic holdings</dt><dd>{fmt.format(p.economic)}</dd><dt>Known basis</dt><dd>{gold(p.knownBasisCopper)} on {fmt.format(p.knownUnits)} units</dd>
          <dt>Unknown basis</dt><dd>{fmt.format(p.unknownUnits)} units</dd><dt>Realised profit on known basis</dt><dd>{gold(p.realisedKnownCopper)}</dd>
          {p.unknownSold>0&&<><dt>Sold without basis</dt><dd>{p.unknownSold}</dd></>}
          {p.unreconciledUnits!==0&&<><dt>Ledger less economic quantity</dt><dd>{fmt.format(p.unreconciledUnits)} units to reconcile</dd></>}
          <dt>Vendor exit</dt><dd>{p.valuation?.vendorCopper!=null?gold(p.valuation.vendorCopper):'Unpriced'}</dd>
          <dt>AH sale scenario</dt><dd>{p.valuation?.scenarioNetCopper!=null?gold(p.valuation.scenarioNetCopper)+' at the current ask, assuming a full sale and a 5% cut':'No comparable tradeable quote'}</dd>
          {p.valuation&&<><dt>Base-item reference</dt><dd>{p.valuation.source} · {p.valuation.house} · {new Date(p.valuation.at).toLocaleString()}</dd></>}
          {p.timingUncertain&&<><dt>Reconciliation</dt><dd>Overlapping observations or same-second events leave the order uncertain.</dd></>}</dl>
        {p.locations.map((l,i)=><p key={i}>{names[l.id]??l.id} · {l.scope} · {fmt.format(l.quantity)} · {date(l.at)}</p>)}
        {p.receipts.map(r=><p key={r.id}>Sale · {date(r.at)} · {r.quantity} units · {gold(r.proceedsCopper)} proceeds</p>)}
        {p.transactions?.filter(tx=>tx.action==='transfer').map(tx=><p key={tx.id}>Archived transfer · {date(tx.at)} · {fmt.format(tx.quantity)} units from {names[tx.owner]??tx.owner} to {names[tx.recipient]??tx.recipient}{tx.unallocatedQuantity>0 && ' · '+fmt.format(tx.unallocatedQuantity)+' units unresolved'}</p>)}
        <PositionNote api={api} pos={p} onDone={reload}/></details>)}
  </div>
}
export function AddonSettings({api,mode,refreshKey}) {
  const {data,error,reload}=usePersonal(api,'setup',mode,refreshKey)
  const [candidate,setCandidate]=useState(''),[browser,setBrowser]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{setCandidate('');setBrowser(null);setMessage('')},[mode])
  async function action(endpoint,body={},text='') {
    setMessage('');setBusy(true)
    try {
      const result=await api('/personal/'+endpoint,{method:'POST',body})
      if(endpoint==='browse')setBrowser(result)
      else {setBrowser(null);if(endpoint==='inspect')setCandidate(result.product);reload();setMessage(text||result.action||result.status||'Saved.')}
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  }
  return <section className="personal-pane personal-setup"><h3>WoW addon</h3>
    {mode==='demo'?<p>Switch to Live to install the addon or select a local account.</p>:<>
    <form className="personal-form" onSubmit={e=>{e.preventDefault();action('inspect',{path:candidate},'Destination verified.')}}>
      <label>WoW installation<input value={candidate} onChange={e=>setCandidate(e.target.value)} placeholder={data?.product||'Paste the WoW or _forever_ folder'} required/></label>
      <button disabled={busy}>Verify folder</button><button type="button" disabled={busy} onClick={()=>action('browse',{path:''})}>Browse folders</button>
    </form>
    {data?.candidates?.map(d=><button key={d} onClick={()=>action('inspect',{path:d})}>Inspect {d}</button>)}
    {browser&&<div className="personal-browser"><strong>{browser.path||'Local drives'}</strong>
      {browser.path&&<><button onClick={()=>action('browse',{path:browser.parent})}>Up one folder</button><button onClick={()=>action('inspect',{path:browser.path})}>Use this folder</button></>}
      <button onClick={()=>setBrowser(null)}>Close browser</button>
      <ul>{browser.folders.map(f=><li key={f}><button onClick={()=>action('browse',{path:f})}>{f.split(/[\\/]/).filter(Boolean).at(-1)||f}</button></li>)}</ul></div>}
    {data?.install&&<><dl><dt>Destination</dt><dd>{data.install.destination}</dd><dt>Client build</dt><dd>{data.install.build||'Unobserved'} · bundled TOC {data.install.interface}</dd>
      <dt>Install status</dt><dd>{data.install.installed?'Installed':data.install.conflict||'Ready to install'}</dd><dt>Write access</dt><dd>{data.install.writeable?'Available':'Denied'}</dd></dl>
      <button disabled={busy||!data.install.writeable||!!data.install.conflict} onClick={()=>action('install',{product:data.product})}>{data.install.installed?'Check for addon update':'Install addon'}</button>
      <label>Local account<select value={data.account??''} onChange={e=>action('select-account',{account:e.target.value})}>
        <option value="" disabled>Select an account</option>{data.install.accounts.map(a=><option key={a} value={a}>{a}</option>)}</select></label>
      {data.account&&<button disabled={busy} onClick={()=>action('import')}>Import now</button>}
      <p>{data.importedAt?'Last import '+new Date(data.importedAt).toLocaleString():'Waiting for first export. Enable Goblin Ledger in WoW. Normal logout or UI reload writes the export.'}</p></>}
    </>}<Notice msg={message||error||data?.warning}/></section>
}
