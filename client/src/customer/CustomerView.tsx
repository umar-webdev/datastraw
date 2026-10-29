import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { CustomerConversation, TestCustomer } from '../api/types'
import { MessageList } from '../components/MessageList'

/** The brief's sample messages, one click away. */
const SAMPLE_MESSAGES = [
  "Hi, my order #4471 hasn't arrived yet. Can I change the delivery address?",
  'What is your return policy?',
  'Do you deliver to Dubai?',
  'Is cash on delivery available for a ₹3,500 order?',
  "I think I'm allergic to the serum I bought. What should I do?",
]

type Customer = { id?: string; name: string; phone: string }

const STORAGE_KEY = 'verdant.customer'

// Remembers who you were playing, per browser. Storage can be unavailable (private mode), so it's best effort.
function loadCustomer(): Customer | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return saved?.name && saved?.phone ? saved : null
  } catch {
    return null
  }
}

function saveCustomer(customer: Customer) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customer))
  } catch {
    // not remembered, which is fine
  }
}

/** Same rule as the server (testCustomers.ts), so a typed-in customer can read their conversation before sending. */
function customerIdFor(customer: Customer): string {
  return customer.id ?? 'web_' + customer.phone.replace(/\D/g, '')
}

export function CustomerView() {
  const [customer, setCustomer] = useState<Customer | null>(loadCustomer)

  const choose = (next: Customer) => {
    setCustomer(next)
    saveCustomer(next)
  }

  return (
    <div className="customer-layout">
      <CustomerPicker current={customer} onChoose={choose} />
      {customer ? (
        <CustomerChat key={customerIdFor(customer)} customer={customer} />
      ) : (
        <section className="panel chat-panel empty-state">
          <h2>Who are you?</h2>
          <p className="muted">Pick a test customer, or enter a name and phone number, to start chatting with Verdant & Co.</p>
        </section>
      )}
    </div>
  )
}

function CustomerPicker({ current, onChoose }: { current: Customer | null; onChoose: (c: Customer) => void }) {
  const { data, isError } = useQuery({
    queryKey: ['test-customers'],
    queryFn: () => api<{ customers: TestCustomer[] }>('/api/customer/test-customers'),
    staleTime: Infinity,
  })
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim() && phone.trim()) onChoose({ name: name.trim(), phone: phone.trim() })
  }

  return (
    <aside className="panel picker">
      <h2>Play as a customer</h2>
      <p className="muted small">A test tool: this view needs no sign-in. Messages sent here are handled exactly like webhook messages.</p>
      {isError && <p className="error small">Couldn't load test customers.</p>}
      <ul className="picker-list">
        {data?.customers.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`picker-item ${current?.id === c.id ? 'active' : ''}`}
              onClick={() => onChoose(c)}
            >
              <strong>{c.name}</strong>
              <span className="muted small">{c.phone}</span>
            </button>
          </li>
        ))}
      </ul>
      <form className="picker-form" onSubmit={submit}>
        <h3>Someone else</h3>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" />
        </label>
        <label>
          Phone
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98000 00000"
            inputMode="tel"
            autoComplete="off"
          />
        </label>
        <button type="submit" className="button" disabled={!name.trim() || !phone.trim()}>
          Chat as this customer
        </button>
      </form>
    </aside>
  )
}

function CustomerChat({ customer }: { customer: Customer }) {
  const queryClient = useQueryClient()
  const customerId = customerIdFor(customer)
  const queryKey = ['customer-conversation', customerId]
  const [text, setText] = useState('')

  const conversation = useQuery({
    queryKey,
    queryFn: () => api<CustomerConversation>(`/api/customer/conversation?customerId=${encodeURIComponent(customerId)}`),
    refetchInterval: 4000, // approved replies show up without a reload
  })

  const send = useMutation({
    mutationFn: (message: string) =>
      api('/api/customer/messages', { method: 'POST', body: { customer, text: message } }),
    onSuccess: () => {
      setText('')
      queryClient.invalidateQueries({ queryKey })
    },
  })

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (text.trim() && !send.isPending) send.mutate(text.trim())
  }

  // Enter sends, Shift+Enter adds a new line, like most chat apps.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) submit(e)
  }

  const messages = conversation.data?.messages ?? []
  const waitingForReply = messages.at(-1)?.sender === 'customer'

  return (
    <section className="panel chat-panel">
      <header className="chat-header">
        <div>
          <h2>{customer.name}</h2>
          <span className="muted small">{customer.phone} · chatting with Verdant & Co</span>
        </div>
      </header>

      {conversation.isError ? (
        <p className="error thread-empty">Couldn't load the conversation. Retrying…</p>
      ) : conversation.isPending ? (
        <p className="muted thread-empty">Loading…</p>
      ) : (
        <MessageList messages={messages} mine="customer" empty="No messages yet. Say hello, or try a sample below." />
      )}

      {waitingForReply && <p className="muted small waiting">Sent. The support team will reply here soon.</p>}

      <div className="samples" aria-label="Sample messages">
        {SAMPLE_MESSAGES.map((sample) => (
          <button key={sample} type="button" className="chip" onClick={() => setText(sample)}>
            {sample}
          </button>
        ))}
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a message…"
          rows={2}
          maxLength={4000}
          aria-label="Message"
        />
        <button type="submit" className="button button-primary" disabled={!text.trim() || send.isPending}>
          {send.isPending ? 'Sending…' : 'Send'}
        </button>
      </form>
      {send.isError && <p className="error small composer-error">{send.error.message}</p>}
    </section>
  )
}
