// Operator-invoked, keyless diagnostic. Print contract evidence, never raw payloads.
import { discoverHouse, normalizeOverview, normalizeDetail, normalizeRecipes } from '../packages/domain/market.mjs';
const region=process.argv[2];
if(!['us','eu'].includes(region)) throw Error('Select a diagnostic region: us or eu.');
async function read(path) {
  const response=await fetch(new URL(path,'https://auctionhouse.tk.gg'),{
    signal:AbortSignal.timeout(20_000), redirect:'error',headers:{Accept:'application/json','User-Agent':'GoblinLedger/0.1 (public contract check)'}
  });
  if(!response.ok) throw Error('HTTP '+response.status);
  if(!response.headers.get('content-type')?.includes('json')) throw Error('Expected a JSON response');
  return response.json();
}
const evidence={region,checkedAt:new Date().toISOString(),calibration:'provider-inferred'};
try {
  const house=discoverHouse(await read('/api/markets'),region);
  evidence.discovery={key:house.key,group:house.grp,faction:house.faction};
  const snapshot=normalizeOverview(await read('/api/m/'+house.key),house);
  if (!snapshot?.items.length) throw Error('No published nonempty snapshot');
  evidence.overview={sourceTime:snapshot.t,itemCount:snapshot.items.length};
  const item=snapshot.items.find(i=>i.id===18945)??snapshot.items[0];
  const detail=normalizeDetail(await read('/api/m/'+house.key+'/item/'+item.id+'?hours=24'),house,item.id);
  evidence.detail={item:item.id,hours:detail.history.length,book:detail.book};
  if(evidence.detail.book) evidence.detail.book={t:detail.book.t,visibleTiers:detail.book.levels?.length,more:detail.book.more};
} catch(e){evidence.marketError=String(e.message)+' '+(e.cause?.code??'');}
try {
  const catalog=normalizeRecipes(await read('/api/recipes'));
  const sample=catalog.entries.find(e=>e.product && e.reagents?.length);
  evidence.recipes={count:catalog.entries.length,linkedSample:Boolean(sample)};
} catch(e){evidence.recipeError=String(e.message)+' '+(e.cause?.code??'');}
console.log('PROBE_RESULT '+JSON.stringify(evidence));
