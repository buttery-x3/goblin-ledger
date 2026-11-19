import React, { useRef, useState } from 'react'

function characterName(character) {
  return character.realm ? character.name + ' · ' + character.realm : character.name
}

export function PositionTransfers({ api, scope, position, characters, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [sender, setSender] = useState('')
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const draft = useRef(null)
  const sending = useRef(false)
  const transfers = (position.transactions ?? []).filter(tx => tx.action === 'transfer')
  const names = new Map(characters.map(c => [c.id, characterName(c)]))
  const eligible = position.binding === 'tradeable' && /^-?\d{1,10}$/.test(position.variant) &&
    String(Number(position.variant)) === position.variant
  const canRecord = Boolean(scope) && eligible && characters.length >= 2
  if (!canRecord && !transfers.length) return null

  async function submit(event) {
    event.preventDefault()
    if (sending.current) return
    const form = new FormData(event.currentTarget)
    const quantity = Number(form.get('quantity'))
    const received = form.get('received')
    const at = received ? Math.floor(new Date(received).getTime() / 1000) : null
    if (!names.has(sender) || !names.has(recipient) || sender === recipient) {
      setMessage('Choose two different imported characters.')
      return
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000_000 ||
        (at !== null && !Number.isSafeInteger(at))) {
      setMessage('Enter a whole quantity and a valid time received.')
      return
    }
    // Retrying a lost response must use the same event ID and timestamp.
    const key = JSON.stringify([position.asset, sender, recipient, quantity, at])
    if (draft.current?.key !== key) {
      draft.current = { key, id: crypto.randomUUID(), at: at ?? Math.floor(Date.now() / 1000) }
    }
    sending.current = true
    setBusy(true)
    setMessage('')
    try {
      await api('/personal/transactions', { method: 'POST', body: {
        action: 'transfer', scope, id: draft.current.id, at: draft.current.at,
        itemId: position.itemId, variant: position.variant, binding: position.binding,
        owner: sender, recipient, quantity, confirmed: true,
      } })
      draft.current = null
      setOpen(false)
      setSender('')
      setRecipient('')
      setMessage('Recorded '+quantity.toLocaleString()+' units from '+names.get(sender)+' to '+names.get(recipient)+'.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      sending.current = false
      setBusy(false)
      onRefresh()
    }
  }

  return <section aria-label="Character transfers">
    {transfers.map(tx => <p key={tx.id}>
      Player-confirmed transfer · {new Date(tx.at * 1000).toLocaleString()} · {tx.quantity.toLocaleString()} units
      {' from '}{names.get(tx.owner) ?? tx.owner}{' to '}{names.get(tx.recipient) ?? tx.recipient}
      {tx.transferStatus === 'needs-reconciliation' &&
        <> · {tx.unallocatedQuantity.toLocaleString()} units need reconciliation against the sender’s history</>}
    </p>)}
    {canRecord && <button type="button" aria-expanded={open} disabled={busy} onClick={() => {
        setOpen(!open)
        setMessage('')
      }}>{open ? 'Close transfer form' : 'Record a transfer'}</button>}
    {canRecord && open && <form className="personal-form" onSubmit={submit}>
      <label>From character<select required disabled={busy} value={sender} onChange={e => {
        const next = e.target.value
        setSender(next)
        if (recipient === next) setRecipient('')
      }}>
        <option value="">Choose sender</option>
        {characters.map(c => <option key={c.id} value={c.id}>{characterName(c)}</option>)}
      </select></label>
      <label>To character<select required disabled={busy} value={recipient} onChange={e => setRecipient(e.target.value)}>
        <option value="">Choose recipient</option>
        {characters.filter(c => c.id !== sender).map(c => <option key={c.id} value={c.id}>{characterName(c)}</option>)}
      </select></label>
      <label>Units received<input name="quantity" type="number" min="1" max="1000000000" step="1" required disabled={busy}/></label>
      <label>Time received (local, defaults to now)<input name="received" type="datetime-local" step="1" disabled={busy}/></label>
      <button type="submit" disabled={busy || !sender || !recipient}>Confirm completed transfer</button>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>
}
