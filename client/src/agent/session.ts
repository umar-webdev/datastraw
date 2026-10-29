import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { Agent } from '../api/types'

export const SESSION_KEY = ['session']

/** The signed-in agent, or null when there's no valid session. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        return (await api<{ agent: Agent }>('/api/auth/me')).agent
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}
