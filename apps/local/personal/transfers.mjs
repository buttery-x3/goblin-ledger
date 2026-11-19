// A confirmed transfer has two inventory clocks but no pool-level acquisition or disposal.
// Track each alt's evidence independently of the pool-wide FIFO order used for sales.
export class TransferBalances {
  constructor() {
    this.owners = new Map()
    this.handoffTimes = new Map()
    this.uncertain = false
  }

  markHandoff(tx) {
    for (const id of [tx.owner, tx.recipient]) {
      if (!this.handoffTimes.has(id)) this.handoffTimes.set(id, new Set())
      const times = this.handoffTimes.get(id)
      if (times.has(tx.at)) this.uncertain = true
      times.add(tx.at)
    }
  }

  owner(id) {
    if (!this.owners.has(id)) this.owners.set(id, { net: 0, movement: 0, projected: 0, bags: null, bank: null })
    return this.owners.get(id)
  }

  observe(id, scope, at, units) {
    // The export has second precision. It may already include either leg of the handoff.
    // Keep its raw quantity in Locations, but never infer another lot from this ambiguity.
    if (this.handoffTimes.get(id)?.has(at)) {
      this.uncertain = true
      return false
    }
    const owner = this.owner(id)
    const prior = owner[scope], other = owner[scope === 'bags' ? 'bank' : 'bags']
    owner[scope] = { at, units, net: owner.net, movement: owner.movement }
    if (!other) {
      owner.projected = units
    } else if (other.at === at) {
      owner.projected = units + other.units
    } else if (other.movement === owner.movement && (!prior || prior.movement === owner.movement)) {
      // With no intervening recorded movement, retain the pre-existing bags + bank
      // estimate. Physical overlap at different timestamps remains visible.
      owner.projected += units - (prior?.units ?? 0)
    } else {
      // A refreshed container can be consistent with several allocations of an
      // earlier handoff between bags and bank. Preserve the already-booked total
      // when it falls inside those bounds, without minting another acquisition.
      const sinceOther = owner.net - other.net
      const low = Math.max(units, other.units + sinceOther)
      const high = units + other.units + Math.max(0, sinceOther)
      owner.projected = Math.max(low, Math.min(owner.projected, high))
    }
    return true
  }

  adjust(id, units, opening = false) {
    const owner = this.owner(id)
    if (!opening || (!owner.bags && !owner.bank)) {
      owner.net += units
      owner.projected += units
      owner.movement++
    }
  }

  receive(id, units) {
    const owner = this.owner(id)
    // A completed handoff is portable stock even if only the recipient's bank has
    // been sampled. A later bank-only export cannot reconcile away that receipt.
    if (!owner.bags) owner.bags = { at: null, units: 0, net: owner.net, movement: owner.movement }
    this.adjust(id, units)
  }

  available(id) {
    const { net, bags, bank } = this.owner(id)
    if (!bags && !bank) return Math.max(0, net)
    // Simultaneous complete scopes can be added. Older bags and bank can describe
    // the same units. Roll each scope forward by confirmed movements since its read.
    if (bags && bank && bags.at === bank.at) return Math.max(0, bags.units + bank.units + net - bags.net)
    const roll = scope => scope ? scope.units + net - scope.net : 0
    if (bags && bank && (bags.units || bank.units)) this.uncertain = true
    return Math.max(0, roll(bags), roll(bank))
  }

  total() {
    let quantity = 0
    for (const owner of this.owners.values()) quantity += owner.projected
    return quantity
  }
}

// Reassign the oldest qualifying slices in their existing array positions. A transferred
// unknown-basis lot remains unknown and an opening balance can still attach basis to it.
export function moveLots(lots, from, to, quantity) {
  let remaining = quantity
  for (let i = 0; i < lots.length && remaining; i++) {
    const lot = lots[i]
    if (lot.owner !== from || !lot.left) continue
    const moved = Math.min(lot.left, remaining)
    if (moved === lot.left) {
      lot.owner = to
    } else {
      lot.left -= moved
      lots.splice(i++, 0, { ...lot, owner: to, left: moved })
    }
    remaining -= moved
  }
  return quantity - remaining
}
