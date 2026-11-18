import {checkedInt} from './farms.mjs';
import {quoteInputs} from './crafts.mjs';
import {boxComparison} from './transformations.mjs';

export const apprenticeCrate = {itemId:248682,name:'Apprentice Herbs crate',units:1};
export const herbBundles = [
  {itemId:2447,name:'Peacebloom',units:20}, {itemId:765,name:'Silverleaf',units:20},
  {itemId:2449,name:'Earthroot',units:10},{itemId:785,name:'Mageroyal',units:10},{itemId:2450,name:'Briarthorn',units:10}
];
export const fragment = {itemId:279450,name:'Fractured Insignia',units:1};
export function compareCrate({count=1,first='unknown',perkRank=null},market) {
  checkedInt(count,'Number of crates',1,1000);
  if (!['unknown','available','completed'].includes(first)) throw Object.assign(new Error('Unknown introductory quest status'),{statusCode:400});
  if (perkRank != null) checkedInt(perkRank,'Performance Bonus rank',0,3);
  const options = herbBundles.map(bundle => {
    const q = quoteInputs([{quantity:count,recipe:{inputs:[apprenticeCrate,bundle]}}],market);
    return {...bundle,rows:q.rows,gaps:q.gaps,
      incrementalCostCopper:q.gaps.length ? null : String(q.cash+q.alternative)};
  });
  return {options,count,ordinaryFavor:count*5,introFavor:first==='unknown'?null:first==='available'?50:0,
    bonusChancePercent:perkRank == null ? null : perkRank*5, cashRewardCopper:String(250*count),
    source:'https://www.60.tools/guides/merchants-favor',mechanics:'https://aidvir.github.io/wow-forever-favor/favor.html'};
}

export function compareBox({hasBox,fragments=0},market) {
  checkedInt(fragments,'Fragments held',0,100000);
  const need = Math.max(0,6-fragments);
  const price = quantity => {
    if (!quantity) return {cost:0,gaps:[]};
    const quote = quoteInputs([{quantity,recipe:{inputs:[fragment]}}],{...market,owned:{}});
    return {cost:quote.gaps.length ? null : String(quote.cash),gaps:quote.gaps};
  };
  const buyOne = price(1), buyRest = price(need), buyAfterQuest = price(Math.max(0,need-1));
  const comparable = hasBox===true && buyOne.cost != null ? boxComparison(Number(buyOne.cost),16000) : null;
  return {differenceCopper:comparable?.differenceCopper ?? null,hasBox:hasBox===true,need,
    remainingCostCopper:buyRest.cost,afterHandinCostCopper:hasBox===true?buyAfterQuest.cost:null,
    nextFragmentCopper:buyOne.cost,xpForgone:6746,source:'https://ahledger.com/wow-forever/quests/96377-state-secrets',
    bindingSource:'https://wowclassicforever.info/quests/alcaz-operative-disguise/'};
}
