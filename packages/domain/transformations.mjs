const boxSource = 'https://ahledger.com/wow-forever/quests/96377-state-secrets';
const crateSource = 'https://aidvir.github.io/wow-forever-favor/favor.html';
const writSource = 'https://www.60.tools/guides/merchants-favor';

export const choices = [
  {id:'alcaz-box',name:'Alcaz Document Box',description:'Compare mutually exclusive uses of one box.',source:boxSource,
    branches:[{name:'Vendor the box',detail:'Receive 25g. Buying a fragment uses part of that cash.'},
      {name:'Complete State Secrets',detail:'Surrender the box for one Fractured Insignia plus the applicable cash and XP reward.'},
      {name:'Combine six fragments',detail:'Consumes six fragments. The resulting disguise is bound.'}]},
  {id:'shipping-crate',name:'Merchant shipping crate',description:'Select one complete eligible bundle before binding the filled crate.',source:crateSource,
    branches:[{name:'Fill the empty crate',detail:'Consume one empty crate and the whole selected bundle.'},
      {name:'Deliver the filled crate',detail:'Ordinary payout and a first-only Shipping Label bonus have separate eligibility.'},
      {name:'Character perk',detail:'An additional Favor roll remains conditional on observed rank and payout evidence.'}]},
  {id:'writ',name:'Commerce Authority writ',description:'Inspect the writ’s own standing and delivery requirements.',source:writSource,
    branches:[{name:'Check the gate',detail:'A confirmed standing requirement controls access. An unknown standing leaves eligibility unresolved.'},
      {name:'Deliver the writ',detail:'Consume eligible materials and apply the reward once per permitted hand-in.'}]},
];

export function applyChoice(state, edge) {
  if (edge.gate && !state.gates?.includes(edge.gate)) return null;
  if (edge.once && state.used?.includes(edge.id)) return null;
  const stock = {...state.stock};
  for (const [item,n] of Object.entries(edge.inputs ?? {})) {
    if ((stock[item] ?? 0) < n) return null;
    stock[item] -= n;
  }
  if (edge.exit === 'auction' && Object.keys(edge.inputs ?? {}).some(item => state.bound?.includes(item))) return null;
  for (const [item,n] of Object.entries(edge.outputs ?? {})) stock[item] = (stock[item] ?? 0) + n;
  return {...state,stock,copper:state.copper + (edge.copper ?? 0),
    used:edge.once ? [...(state.used ?? []),edge.id] : state.used ?? [],
    bound:[...new Set([...(state.bound ?? []),...(edge.binds ?? [])])]};
}

// Bound the exploration to simple paths and the supplied depth. Each
// alternative starts from its own holdings; one item cannot fund two exits.
export function paths(state, edges, depth = 4, seen = new Set()) {
  if (depth <= 0) return [];
  const result = [];
  for (const edge of edges) {
    if (seen.has(edge.id)) continue;
    const next = applyChoice(state,edge);
    if (!next) continue;
    const nextSeen = new Set(seen).add(edge.id);
    result.push({edge:edge.id,state:next,children:paths(next,edges,depth - 1,nextSeen)});
  }
  return result;
}

export function boxComparison(fragmentAskCopper, rewardCopper) {
  const initial = {stock:{box:1},copper:0};
  const vendored = applyChoice(initial,{id:'vendor',inputs:{box:1},copper:250000});
  if (fragmentAskCopper == null || rewardCopper == null) return null;
  const handin = applyChoice(initial,{id:'quest',inputs:{box:1},outputs:{fragment:1},copper:rewardCopper});
  return {retained:'Fractured Insignia',differenceCopper:vendored.copper - fragmentAskCopper - handin.copper, xp:'Hand-in XP forgone'};
}
