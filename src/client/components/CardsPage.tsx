import { useCallback, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, ArrowRight, RotateCw, Star } from 'lucide-react'
import { clientData } from '../services/data'
import { useClientData } from '../services/useClientData'
import type { CardFilter, CardPatch, Flashcard, StatsSummary } from '../services/types'
import CardContent from './CardContent'
import DataState from './DataState'

const filters: { value: CardFilter; label: string }[] = [
 { value: 'all', label: '全部' }, { value: 'vocabulary', label: 'Vocabulary' },
 { value: 'error_log', label: 'Error Log' }, { value: 'favorites', label: '收藏' },
 { value: 'needs_review', label: '需要複習' },
]
export default function CardsPage({ initialFilter, title }: { initialFilter: CardFilter; title: string }) {
 const [filter, setFilter] = useState(initialFilter)
 const load = useCallback(() => clientData.listCards(filter), [filter])
 const { data, loading, error, reload, setData } = useClientData(load)
 const [index, setIndex] = useState(0)
 const cards = data ?? []
 const position = cards.length ? index % cards.length : 0
 const card = cards[position]
 return <div className="flex flex-1 flex-col">
  <header className="flex items-center justify-between px-4 pt-6">
   <Link to="/home" aria-label="返回首頁" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-card-gray"><ArrowLeft size={20} /></Link>
   <h1 className="text-base font-bold text-text-primary">{title}</h1>
   <button type="button" onClick={reload} disabled={loading} aria-label="重新整理" className="h-9 w-9 text-text-secondary"><RotateCw size={18} /></button>
  </header>
  <div className="px-5 pt-4" data-source="api">
   <label className="flex items-center gap-3 text-sm text-text-secondary">篩選
    <select aria-label="篩選卡片" value={filter} onChange={event => { setData(null); setFilter(event.target.value as CardFilter); setIndex(0) }} className="rounded-xl border border-gray-200 bg-white p-2">
     {filters.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
   </label>
   <p className="mt-3 text-sm text-text-secondary">{card ? position + 1 : 0} / {cards.length}</p>
   <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-irish-green transition-all" style={{ width: `${card ? (position + 1) / cards.length * 100 : 0}%` }} /></div>
   <DataState loading={loading} error={error} retry={reload} />
  </div>
  {card ? <CardViewer key={`${filter}:${card.id}:${index}`} card={card} reload={reload} next={() => setIndex(value => value + 1)} /> : !loading && !error &&
   <div className="m-5 rounded-2xl border border-dashed border-gray-200 px-6 py-10 text-center text-sm text-text-secondary">目前沒有{filter === 'vocabulary' ? ' vocabulary' : filter === 'error_log' ? ' error log' : '符合篩選的'} 卡片。</div>}
 </div>
}

function CardViewer({ card, reload, next }: { card: Flashcard; reload: () => void; next: () => void }) {
 const [flipped, setFlipped] = useState(false)
 const [editing, setEditing] = useState(false)
 const [deleting, setDeleting] = useState(false)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [completed, setCompleted] = useState(false)
 const [summary, setSummary] = useState<StatsSummary | null>(null)
 const inFlight = useRef(false)
 // Retain this ID for retries after an uncertain network result; the server deduplicates it.
 const eventId = useRef<string | null>(null)
 async function mutate(action: () => Promise<unknown>) {
  if (inFlight.current) return
  inFlight.current = true; setBusy(true); setError('')
  try { await action(); reload() }
  catch { setError('操作未能確認，請重試。') }
  finally { inFlight.current = false; setBusy(false) }
 }
 async function complete() {
  if (completed || inFlight.current) return
  await mutate(async () => {
   eventId.current ??= crypto.randomUUID()
   await clientData.completeReview({ client_event_id: eventId.current, card_id: card.id, review_result: 'viewed' })
   setCompleted(true)
   try { setSummary(await clientData.getStats()) }
   catch { setError('複習已儲存，進度暫時無法更新；可在首頁重試讀取。') }
  })
 }
 return <>
  <main className="flex flex-1 flex-col px-5 py-6">
   <div className="mb-4 flex justify-end gap-4 text-sm text-text-secondary">
    <button type="button" disabled={busy} aria-pressed={card.is_favorite} aria-label={card.is_favorite ? '取消收藏' : '收藏卡片'} onClick={() => void mutate(() => clientData.setFavorite(card.id, !card.is_favorite))} className="flex items-center gap-1">
     <Star size={18} className={card.is_favorite ? 'fill-irish-green text-irish-green' : ''} />收藏
    </button>
    <button type="button" disabled={busy} onClick={() => { setEditing(true); setDeleting(false) }}>編輯</button>
    <button type="button" disabled={busy} onClick={() => { setDeleting(true); setEditing(false) }}>刪除</button>
   </div>
   {editing ? <CardEditor card={card} busy={busy} cancel={() => setEditing(false)} save={patch => void mutate(async () => { await clientData.updateCard(card.id, patch); setEditing(false) })} /> : <CardContent card={card} flipped={flipped} />}
   {!editing && card.card_type === 'vocabulary' && <button type="button" disabled={busy} aria-pressed={flipped} onClick={() => setFlipped(value => !value)} className="mx-auto mt-6 flex flex-col items-center gap-1.5 text-text-secondary hover:text-irish-green">
    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200"><RotateCw size={18} /></span><span className="text-xs font-medium">翻面</span>
   </button>}
   {deleting && <section role="dialog" aria-label="確認刪除卡片" className="mt-5 rounded-xl border border-red-100 bg-error-bg p-4 text-sm">
    <p>確定刪除此卡片？</p><div className="mt-3 flex gap-5">
     <button type="button" disabled={busy} onClick={() => void mutate(() => clientData.deleteCard(card.id))}>確認刪除</button>
     <button type="button" disabled={busy} onClick={() => setDeleting(false)}>取消</button>
    </div>
   </section>}
   {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
   {completed && <p role="status" className="mt-4 text-sm text-irish-green">複習已完成{summary && ` · 今日 ${summary.today_completed_reviews} / ${summary.daily_goal} 次 · 連續 ${summary.streak_days} 天`}</p>}
  </main>
  <div className="flex flex-col gap-3 px-5 pb-8">
   <button type="button" disabled={busy || completed || editing || deleting || (card.card_type === 'vocabulary' && !flipped)} onClick={() => void complete()} className="h-12 rounded-xl bg-irish-green font-semibold text-white hover:bg-irish-green-dark disabled:opacity-60">{completed ? '已完成複習' : '完成複習'}</button>
   <button type="button" disabled={busy} onClick={next} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-gray-200 font-semibold text-text-primary">下一張<ArrowRight size={18} /></button>
  </div>
 </>
}

function CardEditor({ card, busy, save, cancel }: { card: Flashcard; busy: boolean; save: (patch: CardPatch) => void; cancel: () => void }) {
 const fields = [
  ['front_content', card.card_type === 'vocabulary' ? '單字' : '原句'],
  ['back_content', card.card_type === 'vocabulary' ? '例句／內容' : '修正後'],
  ['part_of_speech', card.card_type === 'vocabulary' ? '詞性' : '錯誤類型'],
  [card.card_type === 'vocabulary' ? 'zh_tw_definition' : 'explanation', card.card_type === 'vocabulary' ? '中文釋義' : '說明'],
  ['irish_usage', 'Irish usage'],
 ] as const
 function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  const values = new FormData(event.currentTarget)
  const patch: CardPatch = {}
  for (const [key] of fields) {
   const value = String(values.get(key) ?? '').trim()
   if (key === 'front_content' || key === 'back_content') patch[key] = value
   else patch[key] = value || null
  }
  save(patch)
 }
 return <form aria-label="編輯卡片" onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-card-gray p-4">
  {fields.map(([key, label]) => <label key={key} className="flex flex-col gap-1 text-sm">{label}<textarea name={key} defaultValue={card[key] ?? ''} required={key === 'front_content' || key === 'back_content'} maxLength={10000} disabled={busy} className="rounded-xl border border-gray-200 p-3" /></label>)}
  <div className="flex gap-5 text-sm"><button disabled={busy} className="text-irish-green">儲存</button><button type="button" disabled={busy} onClick={cancel}>取消</button></div>
 </form>
}
