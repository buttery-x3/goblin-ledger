import React,{useEffect,useRef,useState} from 'react';

const money = n => BigInt(n).toLocaleString()+'c';
export function FarmReceipts({api,runId,refresh}) {
  const [data,setData]=useState(null),[selected,setSelected]=useState(''),[units,setUnits]=useState(1);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const attempt=useRef(null);
  const path='/farm-runs/'+encodeURIComponent(runId)+'/receipts';
  useEffect(()=>{
    let active=true;
    api(path).then(res=>{if(active) setData(res);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[api,path]);
  const key = choice=>JSON.stringify([choice.stack,choice.saleId]);
  const choice=data?.choices.find(c=>key(c)===selected);
  async function update(task) {
    setBusy(true);setError('');
    try {
      await task();
      const next=await api(path);setData(next);setSelected('');setUnits(1);attempt.current=null;
      await refresh?.();
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  return <div className="farm-form">
    {error && <p role="alert">{error}</p>}
    {data?.reason && <p>{data.reason}</p>}
    {!!data?.choices.length && <form onSubmit={e=>{
      e.preventDefault();if(!choice)return;
      attempt.current??=crypto.randomUUID();
      update(()=>api(path,{method:'POST',body:{id:attempt.current,saleId:choice.saleId,stack:choice.stack,units}}));
    }}>
      <label>Sale and haul stack<select value={selected} onChange={e=>{setSelected(e.target.value);setUnits(1);attempt.current=null;}}>
        <option value="">Choose recorded settlement</option>{data.choices.map(c=><option key={key(c)} value={key(c)}>
          #{c.itemId} · stack {c.stack+1} · {new Date(c.saleTime*1000).toLocaleString()} · {c.settlementUnits} sold for {money(c.settlementNetCopper)} net · {c.saleId}
        </option>)}</select></label>
      {choice && <div className="farm-inputs">
        <label>Units from this run<input required type="number" min={1} max={choice.max} value={units} onChange={e=>{setUnits(e.target.value===''?'':Number(e.target.value));attempt.current=null;}}/></label>
        <span>{choice.availableSale} available on sale · {choice.availableHaul} available on haul</span>
        <button disabled={busy}>Attribute proceeds</button>
      </div>}
    </form>}
    {data?.linked.map(link=><p key={link.id}>Stack {link.stack+1} · {link.units} units · {money(link.netCopper)} settled · {link.saleId}{' '}
      <button disabled={busy} onClick={()=>update(()=>api(path+'/'+encodeURIComponent(link.id),{method:'DELETE'}))}>Undo attribution</button></p>)}
  </div>;
}
