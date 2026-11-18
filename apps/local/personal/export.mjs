import { createHash } from 'node:crypto'

export const MAX_EXPORT = 8 * 1024 * 1024

/** Read the literal subset emitted by the WoW SavedVariables writer. */
export function readExport(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_EXPORT) throw Error('Export exceeds the local size limit.')
  let cursor = 0, values = 0
  const skip = /(?:\s+|--[^\r\n]*(?:\r?\n|$))*/y
  function space() { skip.lastIndex = cursor; skip.exec(text); cursor = skip.lastIndex }
  function take(token) {
    space()
    if (!text.startsWith(token,cursor)) return false
    cursor += token.length
    return true
  }
  function required(token) { if (!take(token)) throw Error('Unexpected SavedVariables syntax.') }
  function string() {
    const quote = text[cursor++]
    let out = ''
    while (cursor < text.length) {
      const ch = text[cursor++]
      if (ch === quote) return out
      if (ch !== '\\') { out += ch; continue }
      const escaped = text[cursor++]
      const simple = {n:'\n',r:'\r',t:'\t',a:'\x07',b:'\b',f:'\f',v:'\v','"':'"',"'":"'",'\\':'\\','\n':'\n'}
      if (Object.hasOwn(simple,escaped)) out += simple[escaped]
      else if (/\d/.test(escaped)) {
        let digits = escaped
        while (digits.length < 3 && cursor < text.length && /\d/.test(text[cursor])) digits += text[cursor++]
        if (+digits > 255) throw Error('Invalid character escape.')
        out += String.fromCharCode(+digits)
      } else throw Error('Unsupported string escape.')
    }
    throw Error('Incomplete SavedVariables string.')
  }
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const identifier = /[A-Za-z_]\w*/y
  function match(pattern) {
    space(); pattern.lastIndex = cursor
    const m = pattern.exec(text)
    if (m) cursor = pattern.lastIndex
    return m?.[0]
  }
  function value(depth) {
    if (depth > 32 || ++values > 500000) throw Error('Export exceeds parser limits.')
    space()
    if (text[cursor] === '"' || text[cursor] === "'") return string()
    if (take('{')) {
      const result = Object.create(null)
      let next = 1
      while (!take('}')) {
        let key
        if (take('[')) {
          key = value(depth+1)
          if (typeof key !== 'string' && !Number.isSafeInteger(key)) throw Error('Invalid table key.')
          required(']'); required('=')
        } else {
          const start = cursor, field = match(identifier)
          if (field && take('=')) key = field
          else { cursor = start; key = next++ }
        }
        if (Object.hasOwn(result,key)) throw Error('Repeated table key.')
        result[key] = value(depth+1)
        if (take(',') || take(';')) continue
        required('}'); break
      }
      return result
    }
    const numeric = match(number)
    if (numeric !== undefined) {
      const result = Number(numeric)
      if (!Number.isFinite(result)) throw Error('Invalid number.')
      return result
    }
    const name = match(identifier)
    if (name === 'true') return true
    if (name === 'false') return false
    if (name === 'nil') return null
    throw Error('Expected a literal in the export.')
  }
  required('GoblinLedgerDB'); required('=')
  const exportData = value(0)
  take(';'); space()
  if (cursor !== text.length) throw Error('Unexpected trailing data.')
  if (exportData?.schema !== 1 || !exportData.characters || typeof exportData.characters !== 'object') throw Error('Unsupported export schema. Update Goblin Ledger.')
  return exportData
}

export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function integer(n,min=0,max=Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('Expected a whole number within range.')
  return n
}
export function label(value,max=180) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('Invalid text field.')
  return value.trim()
}
function list(table) {
  if (!table || typeof table !== 'object') throw Error('Expected a SavedVariables table.')
  const entries = Object.entries(table).sort(([a],[b]) => Number(a)-Number(b))
  if (entries.some(([key],i)=>key !== String(i+1))) throw Error('Incomplete list in export.')
  return entries.map(([,v])=>v)
}
function entry(item) {
  const itemId = integer(item.itemId,1), link = label(item.link,1024)
  if (Number(link.split(':')[0]) !== itemId) throw Error('Item identity mismatch.')
  const suffixText = link.split(':')[6]
  if (suffixText && !/^-?\d+$/.test(suffixText)) throw Error('Invalid item suffix.')
  const variant = suffixText === undefined ? 'unknown' : String(Number(suffixText || 0))
  if (!['bound','tradeable','unknown'].includes(item.binding)) throw Error('Invalid binding.')
  return {itemId,variant,link,binding:item.binding,quantity:integer(item.quantity,1,1_000_000_000)}
}
export function normaliseCharacters(data) {
  return Object.entries(data.characters).map(([key,c])=>{
    const id = label(c.id), at = integer(c.lastSeen,1), seq = integer(c.sequence,1)
    if (key !== id) throw Error('Character identity mismatch.')
    const character = {id,name:label(c.name),realm:label(c.realm),className:label(c.className),lastSeen:at,sequence:seq,
      level:integer(c.level,1,255),xp:integer(c.xp),xpMax:integer(c.xpMax),money:integer(c.money),
      lastLogin:c.lastLogin == null ? null : integer(c.lastLogin,1,at),restedXp:c.restedXp == null ? null : integer(c.restedXp),
      build:label(c.build),interface:integer(c.interface,1)}
    const scopes = []
    for (const scope of ['bags','bank','professions']) {
      const s = c[scope]
      if (s?.complete !== true) continue
      scopes.push({scope,at:integer(s.at,1,at),seq:integer(s.seq,1,seq),items:list(s.items).map(i=>scope === 'professions' ?
        {name:label(i.name),skill:integer(i.skill,0,10000)} : entry(i))})
    }
    return {character,scopes}
  })
}
