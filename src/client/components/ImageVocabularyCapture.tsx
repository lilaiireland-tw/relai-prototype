import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../lib/api'
import { clearImageJobReference, imageJobIdempotencyKey, readImageJobReference, saveImageJobId } from '../lib/image-job-storage'
import { clientData } from '../services/data'
import type { Flashcard, ImageVocabularySuggestion, VocabularySaveResult } from '../services/types'

function summary(results: VocabularySaveResult[]) {
 const created = results.filter(item => item.status === 'saved').length
 const existing = results.filter(item => item.status === 'already_saved').length
 const ambiguous = results.filter(item => item.status === 'ambiguous').length
 const failed = results.filter(item => item.status === 'not_saved').length
 return `已建立 ${created} 張單字卡，${existing} 張已存在，${ambiguous} 個詞義需要確認，${failed} 個項目無法建立。`
}

function sameItem(a: ImageVocabularySuggestion, b: ImageVocabularySuggestion) {
 return a.headword === b.headword && a.part_of_speech === b.part_of_speech &&
  a.semantic_sense === b.semantic_sense && a.source_context === b.source_context
}

type ImageJob = Awaited<ReturnType<typeof clientData.getImageJob>>

export default function ImageVocabularyCapture() {
 const [file, setFile] = useState<File | null>(null)
 const [sourceItemId, setSourceItemId] = useState('')
 const [suggestions, setSuggestions] = useState<ImageVocabularySuggestion[]>([])
 const [results, setResults] = useState<VocabularySaveResult[]>([])
 const [cards, setCards] = useState<Flashcard[]>([])
 const [quota, setQuota] = useState<Awaited<ReturnType<typeof clientData.getImageQuota>> | null>(null)
 const [busy, setBusy] = useState(false)
 const [message, setMessage] = useState('')

 function applyJob(job: ImageJob) {
  setSourceItemId(job.job_id)
  setSuggestions(job.suggestions ?? [])
  setResults(job.results ?? [])
  setCards((job.cards ?? []) as Flashcard[])
  if (job.status === 'completed') setMessage(job.suggestions?.length ? summary(job.results ?? []) : '沒有辨識到可用的英文單字，請試試更清晰的照片。')
  else if (job.status === 'needs_attention') setMessage(`處理已暫停。請聯絡管理員並提供工作編號 ${job.job_id}。`)
  else if (job.status === 'failed') setMessage('照片暫時無法處理，請稍後再試。')
  else if (job.status === 'received' || job.status === 'queued') setMessage('照片已加入處理佇列…')
  else setMessage('正在辨識照片並建立單字卡…')
 }

 async function poll(jobId: string) {
  let delay = 1000
  for (let attempt = 0; attempt < 8; attempt++) {
   const job = await clientData.getImageJob(jobId)
   applyJob(job)
   if (['completed', 'failed', 'needs_attention'].includes(job.status)) return
   await new Promise(resolve => window.setTimeout(resolve, delay))
   delay = Math.min(8000, delay * 2)
  }
  setMessage('照片仍在處理中。離開此頁後，系統會保留進度；回來時會自動接續。')
 }

 useEffect(() => {
  void clientData.getImageQuota().then(setQuota).catch(() => undefined)
  const { key, id } = readImageJobReference()
  if (!key && !id) return
  let active = true
  setBusy(true)
  void (async () => {
   try {
    const job = id ? await clientData.getImageJob(id) : await clientData.findImageJobByKey(key!)
    if (!active) return
    saveImageJobId(job.job_id)
    applyJob(job)
    if (!['completed', 'failed', 'needs_attention'].includes(job.status)) await poll(job.job_id)
   } catch {
    if (active) setMessage('無法連線以恢復照片處理進度。請稍後重新開啟此頁。')
   } finally { if (active) setBusy(false) }
  })()
  return () => { active = false }
 }, [])

 function chooseFile(event: ChangeEvent<HTMLInputElement>) {
  setFile(event.currentTarget.files?.[0] ?? null)
  clearImageJobReference()
  setSuggestions([]); setSourceItemId(''); setResults([]); setCards([]); setMessage('')
 }

 async function analyze(event: FormEvent) {
  event.preventDefault()
  if (!file || busy || quota?.remaining === 0) return
  setBusy(true); setMessage('照片正在安全上傳…'); setResults([]); setCards([])
  const key = imageJobIdempotencyKey()
  try {
   const accepted = await clientData.submitImageVocabulary(file, key)
   saveImageJobId(accepted.job_id)
   setQuota(accepted.quota)
   setSourceItemId(accepted.job_id)
   await poll(accepted.job_id)
  } catch (error) {
   if (error instanceof ApiError && error.status === 429) {
    await clientData.getImageQuota().then(setQuota).catch(() => undefined)
    setMessage('今天的照片辨識次數已用完，請在畫面顯示的重設時間後再試。')
   } else if (error instanceof ApiError && error.status === 409) {
    setMessage('此照片請求資料不一致。選擇照片後重新提交即可。')
   } else {
    setMessage('照片已送出或仍在上傳。重試時會接續原工作，不會重複扣除次數。')
   }
  } finally { setBusy(false) }
 }

 async function resolve(item: Extract<VocabularySaveResult, { status: 'ambiguous' }>, semanticSense: string) {
  if (!sourceItemId || busy) return
  setBusy(true)
  try {
   const { headword, part_of_speech, source_context } = item.item
   const response = await clientData.saveVocabulary(sourceItemId, [{ headword, part_of_speech, source_context,
    semantic_sense: semanticSense, resolve_sense: true }])
   const updated = response.results[0]
   const nextResults = results.map(result => result.status === 'ambiguous' && sameItem(result.item, item.item) ? updated : result)
   setResults(nextResults)
   setCards(current => [...new Map([...current, ...response.cards].map(card => [card.id, card])).values()])
   setMessage(summary(nextResults))
  } catch { setMessage('詞義確認暫時無法完成，請重試。') }
  finally { setBusy(false) }
 }

 const exhausted = quota?.remaining === 0
 return <section aria-label="AI 圖片單字辨識" className="mx-auto mt-4 w-full max-w-lg rounded-2xl border border-gray-200 bg-card-gray p-4 sm:p-5">
  <h2 className="font-semibold">用照片建立單字卡</h2>
  <p className="mt-1 text-sm text-text-secondary">拍攝或上傳清晰照片，自動辨識最多 10 個英文單字。</p>
  {quota && <p className="mt-2 text-sm text-text-secondary" aria-live="polite">今日照片辨識：{quota.used} / {quota.limit}，剩餘 {quota.remaining} 次{exhausted ? `；重設時間 ${new Date(quota.resets_at).toLocaleString('zh-TW', { timeZone: 'Europe/Dublin' })}` : ''}</p>}
  <form onSubmit={analyze} className="mt-3 flex flex-col gap-3">
   <label className="flex min-h-12 flex-col justify-center gap-1 rounded-xl border border-gray-200 bg-white p-3 text-sm">拍攝照片
    <input aria-label="拍攝照片" type="file" accept="image/*" capture="environment" onChange={chooseFile} disabled={busy || exhausted} />
   </label>
   <label className="flex min-h-12 flex-col justify-center gap-1 rounded-xl border border-gray-200 bg-white p-3 text-sm">從裝置選擇照片
    <input aria-label="從裝置選擇照片" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} disabled={busy || exhausted} />
   </label>
   {file && <p className="truncate text-xs text-text-secondary">{file.name}</p>}
   <button disabled={!file || busy || exhausted} className="h-12 rounded-xl bg-irish-green font-semibold text-white disabled:opacity-60">{busy ? '處理中…' : exhausted ? '今日次數已用完' : '辨識並建立單字卡'}</button>
  </form>
  {suggestions.length > 0 && <ul className="mt-4 flex flex-col gap-2" aria-label="辨識結果">
   {suggestions.map((item, index) => {
    const result = results[index]
    return <li key={`${item.headword}-${index}`} className="rounded-xl bg-white p-3 text-sm">
     <strong>{item.headword}</strong><span className="ml-2 text-text-secondary">{item.part_of_speech}</span>
     <span className="ml-2 text-xs text-text-secondary">{result?.status === 'saved' ? '已建立' : result?.status === 'already_saved' ? '已存在' : result?.status === 'ambiguous' ? '需要確認詞義' : result?.status === 'not_saved' ? '未建立' : ''}</span>
     <span className="mt-1 block">{item.semantic_sense}</span>
     <span className="mt-1 block text-text-secondary">照片內容：{item.source_context}</span>
    </li>
   })}
  </ul>}
  {message && <p role="status" className="mt-3 text-sm text-text-secondary">{message}</p>}
  {results.filter((item): item is Extract<VocabularySaveResult, { status: 'ambiguous' }> => item.status === 'ambiguous').map(item => <div key={`${item.item.headword}-${item.item.source_context}`} className="mt-3 rounded-xl border border-amber-200 bg-white p-3 text-sm">
   <p>無法安全判斷「{item.headword}」的詞義。請選擇符合照片內容的意思：</p>
   {item.options.map(option => <button key={option.catalog_id} type="button" disabled={busy} onClick={() => void resolve(item, option.semantic_sense)} className="mt-2 block min-h-11 w-full rounded-lg border border-gray-200 px-3 text-left hover:border-irish-green disabled:opacity-60">使用「{option.semantic_sense}」</button>)}
   {!item.options.length && <p className="mt-2 text-text-secondary">請重新拍攝更清晰的照片，讓系統辨識正確詞義。</p>}
  </div>)}
  {cards.length > 0 && <nav aria-label="新建單字卡" className="mt-3 rounded-xl bg-white p-3">
   <p className="text-sm font-semibold">開啟剛建立的單字卡</p>
   {cards.map(card => <Link key={card.id} to={`/cards/${encodeURIComponent(card.id)}`} className="mt-2 block min-h-11 text-sm font-semibold text-irish-green underline">{card.front_content} — 查看單字卡</Link>)}
  </nav>}
 </section>
}
