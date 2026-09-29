import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowLeft, ArrowRight, CheckCircle2, XCircle } from "lucide-react";

import { useClientData } from "../services/useClientData";
import { clientData } from "../services/data";
import type { Flashcard } from "../services/types";

export default function ErrorLogPage() {
  const { data, error } = useClientData(() => clientData.listCards("error_log"));
  const cards: Flashcard[] = data ?? [];
  const [index, setIndex] = useState(0);

  const totalCards = cards.length;
  const card = useMemo(() => (totalCards > 0 ? cards[index % totalCards] : null), [cards, index, totalCards]);
  const progressPercent = totalCards > 0 ? ((index + 1) / totalCards) * 100 : 0;

  function handleNext() {
    if (totalCards === 0) {
      return;
    }
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
          <h1 className="text-base font-bold text-text-primary">錯誤筆記</h1>
          <div className="h-9 w-9" />
        </header>

        <div className="px-5 pt-4">
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

        <main key={card?.id ?? "empty"} className="flex-1 overflow-y-auto px-5 py-6">
          {card ? (
            <>
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
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-10 text-center text-sm text-text-secondary">
              目前沒有 error log 卡片。
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
