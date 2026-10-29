import { NavLink, Navigate, Route, Routes } from 'react-router'
import { useQuery } from '@tanstack/react-query'

type Health = { ok: boolean; db: boolean }

// Phase 0 placeholder: proves the client reaches the server through the proxy.
function HealthBadge() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<Health> => (await fetch('/health')).json(),
  })
  if (isError) return <span className="badge badge-bad">server unreachable</span>
  if (!data) return <span className="badge">checking…</span>
  return (
    <span className={`badge ${data.ok ? 'badge-ok' : 'badge-bad'}`}>
      {data.ok ? 'server + db ok' : 'db down'}
    </span>
  )
}

export default function App() {
  return (
    <>
      <header className="topbar">
        <strong>Verdant &amp; Co Support</strong>
        <nav className="toggle" aria-label="View">
          <NavLink to="/customer">Customer</NavLink>
          <NavLink to="/agent">Agent</NavLink>
        </nav>
        <HealthBadge />
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/customer" replace />} />
          <Route path="/customer" element={<p>Customer view — coming in Phase 5.</p>} />
          <Route path="/agent/*" element={<p>Agent view — coming in Phase 5.</p>} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </>
  )
}
