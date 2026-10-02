import { useCallback, useEffect, useState } from 'react'
export function useClientData<T>(load: () => Promise<T>) {
 const [data, setData] = useState<T | null>(null)
 const [error, setError] = useState('')
 const [revision, setRevision] = useState(0)
 const [loading, setLoading] = useState(true)
 const reload = useCallback(() => setRevision(value => value + 1), [])
 useEffect(() => {
  let active = true
  setLoading(true)
  setError('')
  void load().then(value => {
   if (active) { setData(value); setError('') }
  }).catch(() => { if (active) setError('讀取資料失敗，請稍後再試。') })
   .finally(() => { if (active) setLoading(false) })
  return () => { active = false }
 }, [load, revision])
 return { data, error, loading, reload, setData }
}
