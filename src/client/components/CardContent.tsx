import { ArrowDown, CheckCircle2, XCircle } from 'lucide-react'
import type { Flashcard } from '../services/types'

export default function CardContent({ card, flipped }: { card: Flashcard; flipped: boolean }) {
 if (card.card_type === 'error_log') return <>
  <p className="text-sm font-semibold text-text-primary">原句</p>
  <div className="mt-2 flex items-start gap-3 rounded-2xl border border-red-100 bg-error-bg p-4">
   <XCircle size={20} className="mt-0.5 shrink-0 text-red-400" />
   <p className="flex-1 text-sm leading-relaxed text-text-primary">{card.front_content}</p>
  </div>
  <div className="flex justify-center py-3"><ArrowDown size={18} className="text-gray-300" /></div>
  <p className="text-sm font-semibold text-text-primary">修正後</p>
  <div className="mt-2 flex items-start gap-3 rounded-2xl border border-green-100 bg-irish-green/5 p-4">
   <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-irish-green" />
   <p className="flex-1 text-sm leading-relaxed text-text-primary">{card.back_content}</p>
  </div>
  <div className="mt-5 rounded-2xl bg-card-gray p-4">
   <p className="text-xs font-semibold text-text-secondary">{card.part_of_speech || '說明'}</p>
   <p className="mt-1.5 text-sm leading-relaxed text-text-primary">{card.explanation || '目前沒有補充說明。'}</p>
  </div>
 </>

 return <div className="perspective mx-auto h-[clamp(21rem,55vh,32rem)] w-full max-w-lg">
  <div className={`flip-card-inner relative h-full w-full ${flipped ? 'flipped' : ''}`}>
   <div aria-hidden={flipped} className="flip-card-face absolute inset-0 flex flex-col rounded-2xl border border-gray-100 bg-card-gray p-5 sm:p-8">
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
     <h2 className="break-words text-3xl font-bold leading-tight text-irish-green sm:text-4xl">{card.front_content}</h2>
     <p className="text-base text-text-secondary">{card.part_of_speech}</p>
    </div>
   </div>
   <div aria-hidden={!flipped} className="flip-card-face flip-card-back absolute inset-0 flex flex-col rounded-2xl border border-gray-100 bg-card-gray p-5 sm:p-8">
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
     <section>
      <h3 className="text-sm font-semibold text-text-secondary">繁體中文釋義</h3>
      <p className="mt-1 text-base leading-relaxed text-text-primary">{card.zh_tw_definition || '尚未提供'}</p>
     </section>
     <section>
      <h3 className="text-sm font-semibold text-text-secondary">英文例句</h3>
      <p className="mt-1 text-base leading-relaxed text-text-primary">{card.english_example || '尚未提供'}</p>
     </section>
     <section>
      <h3 className="text-sm font-semibold text-text-secondary">例句中文翻譯</h3>
      <p className="mt-1 text-base leading-relaxed text-text-primary">{card.zh_tw_example_translation || '尚未提供'}</p>
     </section>
     {(card.usage_patterns ?? []).map((usage, index) => <section key={`${usage.pattern}-${index}`}>
      <h3 className="text-sm font-semibold text-text-secondary">用法搭配</h3>
      <p className="mt-1 text-base font-medium text-text-primary">{usage.pattern}</p>
      <p className="text-sm leading-relaxed text-text-secondary">{usage.zh_tw_explanation}</p>
      <p className="mt-1 text-sm text-text-primary">{usage.example}</p>
      <p className="text-sm text-text-secondary">{usage.zh_tw_example_translation}</p>
     </section>)}
     {card.irish_usage && <section className="rounded-xl bg-irish-green/10 p-3">
      <h3 className="text-sm font-semibold text-irish-green">Irish usage</h3>
      <p className="mt-1 text-sm leading-relaxed text-text-primary">{card.irish_usage}</p>
     </section>}
    </div>
   </div>
  </div>
 </div>
}
