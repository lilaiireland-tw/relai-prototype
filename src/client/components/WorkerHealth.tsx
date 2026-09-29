import { useEffect, useState } from 'react'
import { runtimeData } from '../services/runtime'

type HealthState =
  | { phase: 'loading' }
  | { phase: 'success' }
  | { phase: 'error'; message: string }

export default function WorkerHealth() {
  const [state, setState] = useState<HealthState>({ phase: 'loading' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    void runtimeData.getHealth().then(() => {
      if (active) setState({ phase: 'success' })
    }).catch(() => {
      if (active) setState({
        phase: 'error',
        message: '無法連線至服務，請稍後再試。',
      })
    })
    return () => { active = false }
  }, [revision])

  return <section aria-label="Worker 連線" data-source={runtimeData.source} className="mt-5 rounded-xl border border-gray-100 bg-card-gray p-4 text-sm">
    <p className="font-semibold">服務連線 · 真實 API</p>
    <div role="status" aria-live="polite" className="mt-1 text-text-secondary">
      {state.phase === 'loading' ? '正在檢查服務連線…' :
        state.phase === 'success' ? '服務已連線（health: ok）' : state.message}
    </div>
    <p className="mt-1 text-xs text-text-secondary">僅檢查服務可用性；首頁、卡片、統計與設定仍為模擬資料。</p>
    <button type="button" disabled={state.phase === 'loading'} className="mt-2 text-irish-green disabled:opacity-50" onClick={() => {
      setState({ phase: 'loading' })
      setRevision(value => value + 1)
    }}>重新檢查連線</button>
  </section>
}
