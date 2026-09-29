import { useEffect, useRef, useState } from 'react'
export function useClientData<T>(load: () => Promise<T>) {
 const loader = useRef(load)
 const [data, setData] = useState<T | null>(null)
 const [error, setError] = useState('')
 const [revision, setRevision] = useState(0)
 useEffect(() => {
  let active = true
  void loader.current().then(value => {
   if (active) { setData(value); setError('') }
  }).catch(() => { if (active) setError('讀取資料失敗，請稍後再試。') })
  return () => { active = false }
 }, [revision])
 return { data, error, reload: () => setRevision(value => value + 1) }
}
