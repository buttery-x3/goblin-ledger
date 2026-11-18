import React, {useEffect, useState} from 'react';

// All reads and quote calculations use the local database. Provider work is button-initiated.
function useCatalogRead(api,path,refresh,body=null) {
  const [saved,setSaved] = useState({});
  const encoded = body && JSON.stringify(body);
  const key = path+'|'+encoded;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const options = {signal:controller.signal,...(encoded ? {method:'POST',body:JSON.parse(encoded)} : {})};
        const data = await api(path,options);
        if (!controller.signal.aborted) setSaved({key,data});
      } catch (error) {
        if (!controller.signal.aborted) setSaved({key,error:error.message});
      }
    },120);
    return () => {clearTimeout(timer);controller.abort();};
  },[api,path,encoded,key,refresh]);
  return path && saved.key===key ? saved : {};
}

const utc = time => time == null ? 'Unknown' : new Date(time).toISOString().replace('T',' ').replace('.000Z','Z');

function RecipeQuote({api,recipe,refresh,follow,run,busy,money}) {
  const [batch,setBatch] = useState('1'), [cut,setCut] = useState('5'), [deposit,setDeposit] = useState('0');
  const [owned,setOwned] = useState({});
  const quantity = Number(batch), feeBps = cut==='' ? null : Math.round(Number(cut)*100);
  const valid = Number.isSafeInteger(quantity) && quantity>=1 && quantity<=1000 &&
    (cut==='' || (feeBps>=0 && feeBps<=10000)) && (deposit==='' || (Number.isSafeInteger(Number(deposit)) && Number(deposit)>=0 && Number(deposit)<=1e9));
  const {data:quote,error} = useCatalogRead(api,valid ? '/crafts/imported/'+recipe.id+'/quote' : null,refresh,{
    quantity,feeBps,lostDepositCopper:deposit==='' ? null : Number(deposit),owned,revision:recipe.catalog.revision});
  const links = (id,name) => <div className="rs-toolbar">
    <button onClick={()=>follow(id,name,'output')}>Recipes making {name}</button>
    <button onClick={()=>follow(id,name,'input')}>Recipes using {name}</button>
  </div>;
  return <article className="rs-card">
    <small>{recipe.profession} · recipe #{recipe.id}</small><h3>{recipe.name}</h3>
    <p>{recipe.outputId ? recipe.outputName+' #'+recipe.outputId : 'No output item identified'} · {recipe.outputUnits == null
      ? 'Yield unknown'+(recipe.reportedQuantity == null ? '' : ' (provider reports '+recipe.reportedQuantity+')')
      : recipe.outputUnits+' per craft'}</p>
    {recipe.outputId!=null && links(recipe.outputId,recipe.outputName)}
    <div className="rs-grid">
      <label className="rs-field">Crafts in batch<input type="number" min="1" max="1000" value={batch} onChange={e=>setBatch(e.target.value)}/></label>
      <label className="rs-field">Sale cut scenario (%)<input type="number" min="0" max="100" step="0.01" value={cut} placeholder="Unknown" onChange={e=>setCut(e.target.value)}/></label>
      <label className="rs-field">Lost deposit for batch (copper)<input type="number" min="0" max="1000000000" value={deposit} placeholder="Unknown" onChange={e=>setDeposit(e.target.value)}/></label>
    </div>
    {recipe.inputs.map(input=>{
      const row = quote?.rows.find(r=>r.itemId===input.itemId);
      return <section key={input.itemId} className="rs-readout"><strong>{input.name} #{input.itemId}</strong>
        <span>{input.units} per craft{row && ' · '+row.required+' required · '+row.shortfall+' unpriced'}</span>
        <label className="rs-field">Owned units of {input.name}<input type="number" min="0" max="1000000" value={owned[input.itemId] ?? 0}
          onChange={e=>setOwned({...owned,[input.itemId]:Number(e.target.value)})}/></label>
        {row && <span>Priced purchases {money(row.purchaseCopper)} · {row.book
          ? row.book.tiers+' observed price tiers'+(row.book.more ? ' ('+row.book.more+' additional tiers omitted)' : '')
          : 'Current price tiers unknown'}</span>}
        {row?.canCheck && row.shortfall>0 && <button disabled={busy} onClick={()=>run('/markets/'+input.itemId+'/detail')}>Check price tiers for {input.name}</button>}
        {input.vendorReferenceCopper!=null && <small>Vendor reference {money(input.vendorReferenceCopper)}. Bundle size and available stock unknown.</small>}
        {links(input.itemId,input.name)}
      </section>;
    })}
    {error && <p role="alert">{error}</p>}
    {!valid && <p>Enter a whole batch size from 1 to 1,000 and valid fee amounts.</p>}
    {quote && <><dl><dt>Priced purchases</dt><dd>{money(quote.cashCostCopper)}</dd>
      <dt>Owned materials at raw ask after cut</dt><dd>{money(quote.alternativeCopper)}</dd>
      <dt>Output ask per unit</dt><dd>{money(quote.outputAskCopper)}</dd>
      <dt>Output if batch sells after cut</dt><dd>{money(quote.netOutputCopper)}</dd>
      <dt>Increment over selling raw</dt><dd><strong>{money(quote.incrementalCopper)}</strong></dd></dl>
      <small>{quote.house ?? 'House unknown'} · {quote.marketSource ?? 'No house source'} · snapshot {utc(quote.t)} · Sale and demand unverified.</small>
      {!!quote.gaps.length && <ul>{quote.gaps.map(gap=><li key={gap}>{gap}</li>)}</ul>}
    </>}
    <p><a href={recipe.source} target="_blank" rel="noreferrer">AuctionHouse.tk.gg catalog</a> · imported {utc(recipe.catalog.retrieved)}
      {recipe.catalog.etag && <> · provider ETag <code>{recipe.catalog.etag}</code></>}
      {recipe.catalog.lastModified && <> · provider modified {recipe.catalog.lastModified}</>}
      {recipe.catalog.revision && <> · local revision <code>{recipe.catalog.revision.slice(0,12)}</code></>}</p>
    <small>The catalog supplies the profession and ingredients. Learning requirements and alternative yields need separate evidence.</small>
  </article>;
}

export function CraftCatalog({api,region,refresh,money}) {
  const [search,setSearch] = useState(''),[offset,setOffset] = useState(0),[linked,setLinked] = useState(null);
  const [selected,select] = useState(''),[bump,reload] = useState(0),[busy,setBusy] = useState(false),[message,setMessage] = useState('');
  const params = new URLSearchParams({q:search,offset:String(offset),limit:'25'});
  if (linked) {params.set('itemId',String(linked.id));params.set('role',linked.role);}
  const revision = refresh+'|'+bump;
  const page = useCatalogRead(api,'/crafts/imported?'+params,revision);
  const detail = useCatalogRead(api,selected ? '/crafts/imported/'+selected : null,revision);
  const follow = (id,name,role) => {setLinked({id,name,role});setSearch('');setOffset(0);select('');};
  const run = async path => {
    setBusy(true);setMessage('');
    try {
      const job = await api(path,{method:'POST',body:{}});
      if (job?.held) setMessage('Next provider check '+utc(job.next));
    } catch(error) {setMessage(error.message);}
    finally {reload(n=>n+1);setBusy(false);}
  };
  return <section className="rs-form"><h3>Profession catalog</h3>
    <div className="rs-toolbar"><label className="rs-field">Search recipes, professions or items
      <input type="search" value={search} maxLength={150} onChange={e=>{setSearch(e.target.value);setOffset(0);select('');}}/></label>
      <button disabled={busy || !region} onClick={()=>run('/markets/recipes/refresh')}>Refresh catalog</button></div>
    {!region && <small>Choose a region in Settings to import recipes and collect house prices.</small>}
    {linked && <div className="rs-toolbar"><span>Recipes {linked.role==='input' ? 'using' : 'making'} {linked.name} #{linked.id}</span>
      <button onClick={()=>{setLinked(null);setOffset(0);select('');}}>Clear item filter</button></div>}
    {(message || page.error || detail.error) && <p role="status">{message || page.error || detail.error}</p>}
    {page.data && (page.data.count ? <>
      <label className="rs-field">Recipe<select value={selected} onChange={e=>select(e.target.value)}><option value="">Select a recipe</option>
        {page.data.recipes.map(r=><option value={r.id} key={r.id}>{r.name} · {r.profession} · #{r.id}</option>)}</select></label>
      <div className="rs-toolbar"><button disabled={offset===0} onClick={()=>{setOffset(offset-25);select('');}}>Previous</button>
        <span>{offset+1}–{offset+page.data.recipes.length} of {page.data.count}</span>
        <button disabled={offset+25>=page.data.count} onClick={()=>{setOffset(offset+25);select('');}}>Next</button></div>
    </> : <p>{search || linked ? 'No matching recipes.' : 'No imported recipes yet.'}</p>)}
    {detail.data && <RecipeQuote key={detail.data.id+'|'+detail.data.catalog.revision} api={api} recipe={detail.data}
      refresh={revision} follow={follow} run={run} busy={busy} money={money}/>}
  </section>;
}
