import { ArrowDown, CheckCircle2, XCircle } from 'lucide-react'
import type { Flashcard } from '../services/types'

export default function CardContent({ card, flipped }: { card: Flashcard; flipped: boolean }) {
 if (card.card_type === 'error_log') return <>
              <p className="text-sm font-semibold text-text-primary">原句</p>
              <div className="mt-2 flex items-start gap-3 rounded-2xl border border-red-100 bg-error-bg p-4">
                <XCircle size={20} className="mt-0.5 shrink-0 text-red-400" />
                <p className="flex-1 text-sm leading-relaxed text-text-primary">{card.front_content}</p>
              </div>

              <div className="flex justify-center py-3">
                <ArrowDown size={18} className="text-gray-300" />
              </div>

              <p className="text-sm font-semibold text-text-primary">修正後</p>
              <div className="mt-2 flex items-start gap-3 rounded-2xl border border-green-100 bg-irish-green/5 p-4">
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-irish-green" />
                <p className="flex-1 text-sm leading-relaxed text-text-primary">{card.back_content}</p>
              </div>

              <div className="mt-5 rounded-2xl bg-card-gray p-4">
                <p className="text-xs font-semibold text-text-secondary">{card.part_of_speech || "說明"}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-text-primary">
                  {card.explanation || "目前沒有補充說明。"}
                </p>
              </div>
 </>
 return <>
              <div className="perspective mx-auto h-80 w-full max-w-sm">
                <div className={`flip-card-inner relative h-full w-full ${flipped ? "flipped" : ""}`}>
                  <div aria-hidden={flipped} className="flip-card-face absolute inset-0 flex flex-col rounded-2xl border border-gray-100 bg-card-gray p-6">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Front
                    </span>
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                      <h2 className="text-3xl font-bold text-irish-green">{card.front_content}</h2>
                      <p className="text-sm text-text-secondary">
                        {card.part_of_speech || "Vocabulary"}
                      </p>
                      <p className="text-sm text-text-primary">{card.zh_tw_definition || card.back_content}</p>
                    </div>
                  </div>

                  <div aria-hidden={!flipped} className="flip-card-face flip-card-back absolute inset-0 flex flex-col rounded-2xl border border-gray-100 bg-card-gray p-6">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Back
                    </span>
                    <div className="flex flex-1 flex-col justify-center gap-4">
                      <p className="text-base font-semibold leading-relaxed text-text-primary">
                        {card.back_content}
                      </p>
                      {card.explanation ? (
                        <p className="text-sm leading-relaxed text-text-secondary">{card.explanation}</p>
                      ) : null}
                      {card.irish_usage ? (
                        <div className="rounded-xl bg-irish-green/10 p-3">
                          <span className="text-xs font-semibold text-irish-green">Irish usage</span>
                          <p className="mt-1 text-xs leading-relaxed text-text-primary">{card.irish_usage}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

 </>
}
