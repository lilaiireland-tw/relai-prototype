import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, RotateCw, Star } from "lucide-react";

import { useClientData } from "../services/useClientData";
import { clientData } from "../services/data";
import type { Flashcard } from "../services/types";

export default function FlashcardsPage() {
  const { data, error } = useClientData(() => clientData.listCards("vocabulary"));
  const cards: Flashcard[] = data ?? [];
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const totalCards = cards.length;
  const card = useMemo(() => (totalCards > 0 ? cards[index % totalCards] : null), [cards, index, totalCards]);
  const progressPercent = totalCards > 0 ? ((index + 1) / totalCards) * 100 : 0;

  function handleNext() {
    if (totalCards === 0) {
      return;
    }
    setFlipped(false);
    setIndex((prev) => (prev + 1) % totalCards);
  }

  return (
    <>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between px-4 pt-6">
          <Link
            to="/home"
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-primary transition-colors hover:bg-card-gray"
            aria-label="返回首頁"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-base font-bold text-text-primary">單字卡複習</h1>
          <div className="flex h-9 w-9 items-center justify-center rounded-full text-gray-300">
            <Star size={18} />
          </div>
        </header>

        <div className="px-5 pt-4">
          <p data-source={clientData.source} className="mb-2 text-xs text-text-secondary">單字卡 · 模擬資料</p>
          <p className="text-sm font-medium text-text-secondary">
            {totalCards === 0 ? 0 : index + 1} / {totalCards}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-irish-green transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <main className="flex flex-1 flex-col justify-center px-5 py-6">
          {card ? (
            <>
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

              <button
                type="button"
                aria-pressed={flipped}
                onClick={() => setFlipped((prev) => !prev)}
                className="mx-auto mt-6 flex flex-col items-center gap-1.5 text-text-secondary transition-colors hover:text-irish-green"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200">
                  <RotateCw size={18} />
                </span>
                <span className="text-xs font-medium">翻面</span>
              </button>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-10 text-center text-sm text-text-secondary">
              目前沒有 vocabulary 卡片。
            </div>
          )}

          {error ? (
            <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          ) : null}
        </main>

        <div className="px-5 pb-8">
          <button
            type="button"
            onClick={handleNext}
            disabled={!card}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-irish-green text-base font-semibold text-white transition-colors hover:bg-irish-green-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            下一張
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
