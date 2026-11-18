import {checkedInt, copperValue, proceeds} from './farms.mjs';

export const recipes = [{
  id:'menders-potion', name:'Mender’s Potion', outputId:250946, outputUnits:1, profession:'Alchemy', skill:130,
  source:'https://www.foreverdb.app/en/forever/items/250946/mender-s-potion',
  inputs:[
    {itemId:3819, name:'Wintersbite', units:2}, {itemId:4625, name:'Firebloom', units:2},
    {itemId:3372, name:'Leaded Vial', units:1, vendor:true},
  ],
}];

function purchase(levels, required) {
  let shortfall = required, cost = 0n;
  for (const tier of [...levels].sort((a,b) => a.price - b.price)) {
    const units = Math.min(shortfall, tier.units);
    cost += BigInt(tier.price) * BigInt(units);
    shortfall -= units;
    if (!shortfall) break;
  }
  return {cost,shortfall};
}

// A vendor charges per indivisible bundle. The minimum over bought bundles
// can occur at either end or next to an auction-price breakpoint.
function buyInputs(book, vendor, required) {
  const levels = book?.levels ?? [];
  if (!vendor || !required) return purchase(levels,required);
  const size = checkedInt(vendor.bundleUnits,'Vendor bundle size',1,100000);
  const price = checkedInt(vendor.bundleCopper,'Vendor bundle price',0,1000000000);
  const stock = checkedInt(vendor.stockBundles,'Vendor stock in bundles',0,1000000);
  const maxBundles = Math.min(stock, Math.ceil(required / size));
  const candidates = new Set([0,maxBundles]);
  let available = 0;
  for (const tier of [...levels].sort((a,b) => a.price-b.price)) {
    available += tier.units;
    const position = (required-available) / size;
    for (const count of [Math.floor(position),Math.ceil(position)]) {
      if (count>=0 && count<=maxBundles) candidates.add(count);
    }
  }
  let best = null;
  for (const count of candidates) {
    const order = purchase(levels,Math.max(0,required-count*size));
    order.cost += BigInt(count)*BigInt(price);
    if (!best || order.shortfall<best.shortfall || (order.shortfall===best.shortfall && order.cost<best.cost)) best=order;
  }
  return best;
}

// Combine requirements before touching a price tier, even across multiple crafts.
export function quoteInputs(crafts, {books, asks, owned = {}, vendors = {}, feeBps, house, t}) {
  const needed = new Map();
  for (const {recipe,quantity} of crafts) {
    checkedInt(quantity,'Batch size',1,10000);
    for (const reagent of recipe.inputs) {
      const existing = needed.get(reagent.itemId) ?? {...reagent,required:0};
      existing.required += quantity * reagent.units;
      needed.set(reagent.itemId,existing);
    }
  }
  const gaps = [], rows = [];
  let cash = 0n, alternative = 0n;
  for (const reagent of needed.values()) {
    const id = reagent.itemId;
    const held = Math.min(reagent.required, checkedInt(owned[id] ?? 0,'Owned units',0,1000000));
    const toBuy = reagent.required - held;
    const ask = asks[id];
    const coherentAsk = ask && ask.house === house && ask.t === t && t != null && house != null;
    const rawUnit = coherentAsk ? copperValue(ask.ask) : null;
    const rawAlternative = held ? proceeds(rawUnit == null ? null : BigInt(held) * rawUnit, feeBps) : 0n;
    const book = books[id];
    const coherentBook = house != null && t != null && book && book.house === house && book.t === t ? book : null;
    const {cost,shortfall} = buyInputs(coherentBook, vendors[id], toBuy);
    cash += cost;
    if (rawAlternative == null) gaps.push(reagent.name + ' raw-sale alternative unknown');
    else alternative += rawAlternative;
    if (shortfall) gaps.push(reagent.name + ': ' + shortfall + ' unpriced units');
    rows.push({itemId:id,name:reagent.name,required:reagent.required,owned:held,purchaseCopper:String(cost),
      alternativeCopper:rawAlternative == null ? null : String(rawAlternative),shortfall});
  }
  return {rows,gaps,cash,alternative};
}

export function quoteCraft(recipe, quantity, inputs) {
  const {cash,alternative,rows,gaps} = quoteInputs([{recipe,quantity}],inputs);
  const output = inputs.asks[recipe.outputId];
  const sameSnapshot = output && output.house === inputs.house && output.t === inputs.t && inputs.t != null && inputs.house != null;
  const ask = sameSnapshot ? copperValue(output.ask) : null;
  const outputUnits = recipe.outputUnits ?? null;
  if (outputUnits == null) gaps.push('Variable output has no verified yield distribution');
  const gross = ask == null || outputUnits == null ? null : ask * BigInt(quantity) * BigInt(outputUnits);
  const net = proceeds(gross, inputs.feeBps);
  if (net == null) gaps.push('Coherent output quote, known yield and sale cut required');
  if (inputs.feeBps == null) gaps.push('Sale cut unknown');
  const lostDeposit = BigInt(checkedInt(inputs.lostDepositCopper ?? 0, 'Lost deposit', 0, 1000000000));
  const incremental = gaps.length ? null : net - cash - alternative - lostDeposit;
  return {quantity,rows,gaps,cashCostCopper:String(cash),alternativeCopper:gaps.some(g => g.includes('raw-sale')) ? null : String(alternative),
    netOutputCopper:net == null ? null : String(net),incrementalCopper:incremental == null ? null : String(incremental),
    source:recipe.source,t:inputs.t ?? null,house:inputs.house ?? null,feeBps:inputs.feeBps ?? null,
    lostDepositCopper:String(lostDeposit),breakEvenSales:null};
}

export function unlockPayback(recipe, maxCrafts, inputs, unlockCopper) {
  const cost = BigInt(checkedInt(unlockCopper,'Unlock cost',0,1000000000));
  if (!cost) return 0;
  // Each tier can change the sign of the next marginal sale. Check cumulative
  // profit for each attainable quantity, up to the requested horizon.
  for (let quantity = 1; quantity <= maxCrafts; quantity++) {
    const batch = quoteCraft(recipe,quantity,inputs);
    if (batch.incrementalCopper != null && BigInt(batch.incrementalCopper) >= cost) return quantity * recipe.outputUnits;
  }
  return null;
}
