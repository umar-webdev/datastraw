import { NavLink, Navigate, Route, Routes } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api/client'
import { AgentView } from './agent/AgentView'
import { SESSION_KEY, useSession } from './agent/session'
import { CustomerView } from './customer/CustomerView'

function SessionControls() {
  const queryClient = useQueryClient()
  const { data: agent } = useSession()
  const logout = useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.setQueryData(SESSION_KEY, null)
      queryClient.removeQueries({ queryKey: ['agent'] })
    },
  })
  if (!agent) return null
  return (
    <div className="session">
      <span className="muted small">{agent.email}</span>
      <button type="button" className="button button-small" onClick={() => logout.mutate()}>
        Sign out
      </button>
    </div>
  )
}

export default function App() {
  return (
    <>
      <header className="topbar">
        <strong className="brand">Verdant &amp; Co Support</strong>
        <nav className="toggle" aria-label="Switch view">
          <NavLink to="/customer">Customer</NavLink>
          <NavLink to="/agent">Agent</NavLink>
        </nav>
        <SessionControls />
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/customer" replace />} />
          <Route path="/customer" element={<CustomerView />} />
          <Route path="/agent/*" element={<AgentView />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </>
  )
}
