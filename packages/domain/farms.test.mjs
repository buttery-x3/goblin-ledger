import test from 'node:test';
import assert from 'node:assert/strict';
import {farmReturns, eligibility, validRun, routesCatalog} from './farms.mjs';
import {quoteCraft, quoteInputs, recipes, unlockPayback} from './crafts.mjs';
import {applyChoice, boxComparison, paths} from './transformations.mjs';
import {compareBox, compareCrate} from './farm-choices.mjs';

const run = (minutes,units) => validRun({elapsedMinutes:minutes,haul:[{itemId:8845,units,exit:'auction'}]});
const session = {primaryItemId:8845,sessionMinutes:30,approachMinutes:0,feeBps:500,prices:{8845:{ask:10000}}};
test('ranks by session as well as elapsed time and weights runs by duration', () => {
  const a=farmReturns([run(30,12)],session);
  const b=farmReturns([run(15,7)],{...session,approachMinutes:10});
  assert.equal(a.rateCopperPerHour,228000);
  assert.equal(b.rateCopperPerHour,266000);
  assert.equal(b.loops,1);
  assert.equal(b.sessionGoldCopper,66500);
  assert.ok(a.sessionGoldCopper>b.sessionGoldCopper);
  assert.equal(farmReturns([run(30,12),run(15,7)],session).rateCopperPerHour,240667);
});

test('keeps missing yields and prices unknown, separates cash and the proceeds of bound vendor loot', () => {
  const unknown=farmReturns([],{...session,feeBps:0,prices:{8845:{ask:5000}}});
  assert.equal(unknown.rateCopperPerHour,null);
  assert.equal(unknown.requiredUnitsPerHour,20);
  assert.equal(farmReturns([run(15,4)],{...session,prices:{}}).sessionGoldCopper,null);
  const observed=validRun({elapsedMinutes:30,coinCopper:100,expenseCopper:50,haul:[{itemId:22,units:2,rare:true,bound:true,exit:'vendor'}]});
  const result=farmReturns([observed],{...session,prices:{22:{sell:20}}});
  assert.equal(result.rateCopperPerHour,180);
  assert.deepEqual([result.coinCopper,result.vendorCopper,result.auctionCopper,result.rareCopper],['100','40','0','40']);
  assert.throws(() => validRun({elapsedMinutes:15,haul:[{itemId:22,units:1,bound:true,exit:'auction'}]}));
});

test('stable farm IDs distinguish same-herb same-zone localities; eligibility retains unknown', () => {
  const [a,b,c]=routesCatalog;
  assert.equal(a.zone,b.zone);
  assert.equal(a.output,b.output);
  assert.notEqual(a.geometry.id,b.geometry.id);
  assert.equal(c.geometry.precision,'Approximate world entrance');
  assert.equal(eligibility(a,{professions:[]}), 'Unknown');
  assert.equal(eligibility(a,{professions:[{name:'Herbalism',skill:244}]}),'Below skill');
  assert.equal(eligibility(a,{professions:[{name:'Herbalism',skill:245}]}),'Meets skill');
});

const t=100, house='example';
const book = tiers => ({house,t,levels:tiers.map(([price,units]) => ({price,units}))});
const ask = price => ({house,t,ask:price});
function market() {
  return {t,house,feeBps:500,books:{3819:book([[1000,2],[1800,18]]),4625:book([[400,20]])},
    asks:{3819:ask(1000),4625:ask(400),250946:ask(3500)},vendors:{3372:{bundleUnits:1,bundleCopper:100,stockBundles:200}}};
}
const potion=recipes[0];
test('Mender batch quote includes expensive tiers and compares owned inputs with their net sale', () => {
  assert.equal(quoteCraft(potion,1,market()).incrementalCopper,'425');
  assert.equal(quoteCraft(potion,10,market()).incrementalCopper,'-10150');
  assert.equal(quoteCraft(potion,1,{...market(),owned:{3819:2,4625:2}}).incrementalCopper,'565');
  assert.equal(unlockPayback(potion,10,market(),425),1);
  assert.equal(unlockPayback(potion,10,market(),426),null);
});

test('shared reagents consume the cheapest tier once; vendor bundles and depth are finite', () => {
  const m=market();m.vendors[3372]={bundleUnits:5,bundleCopper:400,stockBundles:1};
  const order=quoteInputs([{quantity:1,recipe:potion},{quantity:1,recipe:potion}],m);
  assert.equal(order.rows.find(r => r.itemId===3819).purchaseCopper,'5600');
  assert.equal(order.rows.find(r => r.itemId===3372).purchaseCopper,'400');
  assert.equal(quoteCraft(potion,6,m).rows.find(r => r.itemId===3372).shortfall,1);
  assert.equal(quoteCraft(potion,11,m).incrementalCopper,null);
  assert.equal(quoteCraft({...potion,outputUnits:null},1,m).incrementalCopper,null);
});

test('choose the cheapest feasible mix of finite bundles and actual auction depth', () => {
  const m=market();m.vendors[3372]={bundleUnits:3,bundleCopper:300,stockBundles:1};
  m.books[3372]=book([[20,1],[200,3]]);
  assert.equal(quoteCraft(potion,1,m).rows[2].purchaseCopper,'20');
  assert.equal(quoteCraft(potion,4,m).rows[2].purchaseCopper,'320');
  assert.equal(quoteCraft(potion,6,m).rows[2].purchaseCopper,'720');
  assert.equal(quoteCraft(potion,8,m).rows[2].shortfall,1);
});

test('oversized absolute values and hourly rates withhold numeric projections', () => {
  const form = validRun({elapsedMinutes:1,haul:[{itemId:8845,units:100000,exit:'auction'}]});
  const value = farmReturns([form],{...session,prices:{8845:{ask:99999999999}}});
  assert.equal(value.rateCopperPerHour,null); assert.equal(value.sessionGoldCopper,null);
  assert.ok(BigInt(value.auctionCopper)>BigInt(Number.MAX_SAFE_INTEGER));
});

test('stale, different-house, unknown-fee and exhausted inputs suppress valuations', () => {
  const m=market();
  m.books[3819].house='other';
  assert.equal(quoteCraft(potion,1,m).incrementalCopper,null);
  m.books[3819].house=house;m.books[3819].t=t-1;
  assert.equal(quoteCraft(potion,1,m).incrementalCopper,null);
  assert.equal(quoteCraft(potion,1,{...market(),feeBps:null}).incrementalCopper,null);
  assert.equal(quoteCraft(potion,1,{...market(),lostDepositCopper:26}).incrementalCopper,'399');
});

test('state transitions preserve exclusive choices, consume on hand-in and exclude bound AH exits', () => {
  assert.equal(boxComparison(160000,16000).differenceCopper,74000);
  const start={copper:0,stock:{box:1}};
  const handIn={id:'hand-in',inputs:{box:1},outputs:{fragment:1},copper:16000};
  const complete=applyChoice(start,handIn);
  assert.equal(complete.stock.fragment,1);
  assert.equal(applyChoice(complete,{id:'vendor',inputs:{box:1},copper:250000}),null);
  const toy=applyChoice({stock:{fragment:6},copper:0},{inputs:{fragment:6},outputs:{toy:1},binds:['toy']});
  assert.equal(applyChoice(toy,{inputs:{toy:1},exit:'auction'}),null);
  assert.equal(applyChoice(start,{gate:'daily-open',copper:50}),null);
  const bonus={id:'first',once:true,copper:250};
  assert.equal(applyChoice(applyChoice(start,bonus),bonus),null);
  const tree=paths(start,[handIn,{id:'convert',inputs:{fragment:1},outputs:{box:1}}],20);
  assert.equal(tree[0].children[0].children.length,0);
});

test('crate quotes bind the complete bundle; introductory reward applies once across crates', () => {
  const m={house,t,feeBps:500,books:{248682:book([[500,3]]),2447:book([[12,59]]),765:book([[15,60]])},asks:{}};
  const out=compareCrate({count:3,first:'available',perkRank:1},m);
  assert.equal(out.options.find(b => b.itemId===2447).incrementalCostCopper,null);
  assert.equal(out.options.find(b => b.itemId===765).incrementalCostCopper,'2400');
  assert.deepEqual([out.ordinaryFavor,out.introFavor,out.bonusChancePercent],[15,50,5]);
  const missing=compareCrate({count:2},m);
  assert.equal(missing.introFavor,null); assert.equal(missing.bonusChancePercent,null);
  assert.equal(compareCrate({count:1,first:'completed'},m).introFavor,0);
});

test('box choice prices obtainable quantities and removes an unavailable box’s vendor exit', () => {
  const m={t,house,feeBps:500,books:{279450:book([[160000,1],[170000,4]])},asks:{}};
  const result=compareBox({hasBox:true},m);
  assert.equal(result.differenceCopper,74000);
  assert.equal(result.remainingCostCopper,null);
  assert.equal(result.afterHandinCostCopper,'840000');
  assert.equal(compareBox({hasBox:false,fragments:1},m).differenceCopper,null);
});
