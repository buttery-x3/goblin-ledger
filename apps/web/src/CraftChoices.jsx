import React, {useEffect, useState} from 'react';
import {apprenticeCrate, herbBundles, fragment} from '../../../packages/domain/farm-choices.mjs';

const allItems = [apprenticeCrate,...herbBundles,fragment];
const blank = {count:1,first:'unknown',perkRank:null,hasBox:true,fragments:0,daily:'unknown',prices:{}};
const amount = c => c == null ? 'Unpriced' : BigInt(c).toLocaleString()+'c';

export function ChoiceCalculator({api,mode,region}) {
  const [inputs,setInputs] = useState(blank),[result,setResult] = useState(null),[error,setError] = useState('');
  const [choice,setChoice] = useState('crate');
  const [priceItem,setPriceItem] = useState(apprenticeCrate.itemId),[price,setPrice] = useState(''),[depth,setDepth] = useState(20);
  useEffect(() => {setInputs(blank);setPrice('');},[mode,region]);
  useEffect(() => {
    let active = true;
    setResult(null);setError('');
    api('/crafts/choices',{method:'POST',body:inputs}).then(r => {if(active) setResult(r);})
      .catch(e => {if(active) setError(e.message);});
    return () => {active=false;};
  },[api,inputs,mode,region]);
  const field = (k,v) => setInputs(prev => ({...prev,[k]:v}));
  return <section className="farm-pane">
    <h3>Compare turn-ins</h3>
    <select aria-label="Turn-in" value={choice} onChange={e => setChoice(e.target.value)}>
      <option value="crate">Apprentice Herbs crate</option><option value="box">Alcaz Document Box</option><option value="writ">Dark Leather Tunic writ</option>
    </select>
    {choice==='crate' && <div className="farm-inputs">
      <label>Crates<input type="number" min="1" max="1000" value={inputs.count} onChange={e => field('count',Number(e.target.value))}/></label>
      <label>Shipping Label<select value={inputs.first} onChange={e => field('first',e.target.value)}>
        <option value="unknown">Unknown</option><option value="available">First turn-in available</option><option value="completed">Already completed</option></select></label>
      <label>Performance Bonus<select value={inputs.perkRank ?? ''} onChange={e => field('perkRank',e.target.value===''?null:Number(e.target.value))}>
        <option value="">Rank unknown</option>{[0,1,2,3].map(n => <option value={n} key={n}>Rank {n}</option>)}</select></label>
    </div>}
    {choice==='box' && <div className="farm-inputs"><label><input type="checkbox" checked={inputs.hasBox} onChange={e => field('hasBox',e.target.checked)}/> Already have the box</label>
      <label>Fragments held<input type="number" min="0" max="100000" value={inputs.fragments} onChange={e => field('fragments',Number(e.target.value))}/></label></div>}
    {choice==='writ' && <div className="farm-inputs">
      <label><input type="checkbox" checked={!!inputs.hasWrit} onChange={e => field('hasWrit',e.target.checked)}/> Writ owned</label>
      <label><input type="checkbox" checked={!!inputs.hasTunic} onChange={e => field('hasTunic',e.target.checked)}/> Tunic owned</label>
      <label>Daily turn-in<select value={inputs.daily} onChange={e => field('daily',e.target.value)}>
        <option value="unknown">Unknown</option><option value="available">Available</option><option value="completed">Completed today</option>
      </select></label>
    </div>}
    {choice!=='writ' && <details><summary>Scenario prices and visible units</summary>
      <form className="farm-inputs" onSubmit={e => {e.preventDefault();field('prices',{...inputs.prices,[priceItem]:{price:Number(price),units:Number(depth)}});}}>
        <label>Item<select value={priceItem} onChange={e => setPriceItem(Number(e.target.value))}>{allItems.map(i => <option key={i.itemId} value={i.itemId}>{i.name}</option>)}</select></label>
        <label>Copper per unit<input type="number" required min="0" max="1000000000" value={price} onChange={e => setPrice(e.target.value)}/></label>
        <label>Units available<input type="number" required min="0" max="1000000" value={depth} onChange={e => setDepth(e.target.value)}/></label>
        <button>Set tier</button><button type="button" onClick={() => field('prices',{})}>Use house books</button>
      </form>
      {allItems.filter(i => inputs.prices[i.itemId]).map(i => <p key={i.itemId}>{i.name} · {inputs.prices[i.itemId].units} at {amount(inputs.prices[i.itemId].price)}</p>)}
    </details>}
    {error && <p role="alert">{error}</p>}
    {result && choice==='crate' && <div>
      <p>{result.basis} · Include one empty crate and the entire selected bundle per fill. Filling binds the crate.</p>
      <table><thead><tr><th>One alternative per crate</th><th>Total copper</th></tr></thead><tbody>{result.crate.options.map(b => <tr key={b.itemId}>
        <td>{b.units} × {b.name}</td><td title={b.gaps.join(', ')}>{amount(b.incrementalCostCopper)}</td></tr>)}</tbody></table>
      <p>{result.crate.ordinaryFavor} ordinary Favor + {result.crate.introFavor ?? 'unknown'} introductory Favor · {amount(result.crate.cashRewardCopper)} reward.
        {result.crate.bonusChancePercent == null ? ' Perk roll unknown.' : ' Chance of doubling the ordinary payout: '+result.crate.bonusChancePercent+'%.'}</p>
      <a href={result.crate.source} target="_blank" rel="noreferrer">Bundles and payouts ↗</a>
    </div>}
    {result && choice==='box' && <div>
      <p>{result.basis} · Six fragments make a bound disguise. {result.box.need} more fragments cost {amount(result.box.remainingCostCopper)} at available depth.</p>
      {result.box.hasBox && <p>Vendor for 25g and buy one fragment, or hand in for a fragment and 1g 60s. Difference in cash for the same fragment: {amount(result.box.differenceCopper)}.
        Reported XP forgone: {result.box.xpForgone}. Remaining fragment cost after hand-in: {amount(result.box.afterHandinCostCopper)}.</p>}
      <a href={result.box.source} target="_blank" rel="noreferrer">Alliance hand-in evidence ↗</a>
    </div>}
    {result && choice==='writ' && <div><p>Deliver one writ and one Dark Leather Tunic to Kzixx in Duskwood.
      {result.writ.ready?' Your selected inputs qualify for 75 reputation and a coin pouch.':' Check possession and daily availability before valuing the reward.'}</p>
      <a href={result.writ.source} target="_blank" rel="noreferrer">Quest requirements ↗</a></div>}
  </section>;
}
