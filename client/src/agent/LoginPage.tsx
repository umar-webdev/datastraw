import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Agent } from '../api/types'
import { SESSION_KEY } from './session'

export function LoginPage() {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: () => api<{ agent: Agent }>('/api/auth/login', { method: 'POST', body: { email, password } }),
    onSuccess: ({ agent }) => queryClient.setQueryData(SESSION_KEY, agent),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate()
  }

  return (
    <div className="login-wrap">
      <form className="panel login" onSubmit={submit}>
        <h2>Agent sign in</h2>
        <p className="muted small">Sign in to see customer conversations and the AI's suggested replies.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {login.isError && <p className="error small">{login.error.message}</p>}
        <button type="submit" className="button button-primary" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
