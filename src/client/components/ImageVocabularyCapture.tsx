import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router'
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

export default function ImageVocabularyCapture() {
 const [file, setFile] = useState<File | null>(null)
 const [sourceItemId, setSourceItemId] = useState('')
 const [suggestions, setSuggestions] = useState<ImageVocabularySuggestion[]>([])
 const [results, setResults] = useState<VocabularySaveResult[]>([])
 const [cards, setCards] = useState<Flashcard[]>([])
 const [busy, setBusy] = useState(false)
 const [canRetry, setCanRetry] = useState(false)
 const [message, setMessage] = useState('')

 function chooseFile(event: ChangeEvent<HTMLInputElement>) {
  setFile(event.currentTarget.files?.[0] ?? null)
  setSuggestions([]); setSourceItemId(''); setResults([]); setCards([]); setCanRetry(false); setMessage('')
 }

 async function save(sourceId: string, items: ImageVocabularySuggestion[]) {
  const response = await clientData.saveVocabulary(sourceId, items.map(({ headword, part_of_speech, semantic_sense, source_context }) => ({
   headword, part_of_speech, semantic_sense, source_context,
  })))
  setResults(response.results)
  setCards(response.cards)
  setCanRetry(false)
  setMessage(summary(response.results))
 }

 async function analyze(event: FormEvent) {
  event.preventDefault()
  if (!file || busy) return
  setBusy(true); setMessage(''); setResults([]); setCards([]); setCanRetry(false)
  try {
   const extraction = await clientData.extractImageVocabulary(file)
   setSourceItemId(extraction.source_item_id)
   setSuggestions(extraction.suggestions)
   if (!extraction.suggestions.length) {
    setMessage('沒有辨識到可用的英文單字，請試試更清晰的照片。')
    return
   }
   setMessage('已辨識單字，正在建立卡片…')
   try {
    await save(extraction.source_item_id, extraction.suggestions)
   } catch {
    setCanRetry(true)
    setMessage('單字已辨識，但卡片暫時無法建立。請重試。')
   }
  } catch {
   setMessage('照片辨識暫時無法完成，請重試。')
  } finally { setBusy(false) }
 }

 async function retrySave() {
  if (!sourceItemId || busy) return
  setBusy(true)
  try { await save(sourceItemId, suggestions) }
  catch { setMessage('卡片暫時無法建立，請再試一次。') }
  finally { setBusy(false) }
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

 return <section aria-label="AI 圖片單字辨識" className="mx-auto mt-4 w-full max-w-lg rounded-2xl border border-gray-200 bg-card-gray p-4 sm:p-5">
  <h2 className="font-semibold">用照片建立單字卡</h2>
  <p className="mt-1 text-sm text-text-secondary">拍攝或上傳包含英文的清晰照片，自動建立最多 10 張單字卡。</p>
  <form onSubmit={analyze} className="mt-3 flex flex-col gap-3">
   <label className="flex min-h-12 flex-col justify-center gap-1 rounded-xl border border-gray-200 bg-white p-3 text-sm">拍攝照片
    <input aria-label="拍攝照片" type="file" accept="image/*" capture="environment" onChange={chooseFile} disabled={busy} />
   </label>
   <label className="flex min-h-12 flex-col justify-center gap-1 rounded-xl border border-gray-200 bg-white p-3 text-sm">從裝置選擇照片
    <input aria-label="從裝置選擇照片" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} disabled={busy} />
   </label>
   {file && <p className="truncate text-xs text-text-secondary">{file.name}</p>}
   <button disabled={!file || busy} className="h-12 rounded-xl bg-irish-green font-semibold text-white disabled:opacity-60">{busy ? '處理中…' : '辨識並建立單字卡'}</button>
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
  {canRetry && <button type="button" onClick={() => void retrySave()} disabled={busy} className="mt-3 min-h-11 rounded-xl border border-irish-green px-4 text-sm font-semibold text-irish-green disabled:opacity-60">重試建立卡片</button>}
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
