import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Bootstrap, Me, StorageInfo } from '../lib/types'

export function useBootstrap() {
  return useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => api.get<Bootstrap>('/api/bootstrap'),
    staleTime: 60_000,
  })
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/api/auth/me'),
  })
}

export function useStorage() {
  return useQuery({
    queryKey: ['storage'],
    queryFn: () => api.get<StorageInfo>('/api/storage'),
  })
}

export function useRefreshAuth() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['bootstrap'] })
}
