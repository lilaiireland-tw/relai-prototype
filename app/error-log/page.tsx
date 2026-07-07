"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  MoreVertical,
  Volume2,
  XCircle,
} from "lucide-react";
import { errorLogCards } from "@/lib/mock-data";

const TOTAL_CARDS = 20;
const START_POSITION = 8;

export default function ErrorLogPage() {
  const [index, setIndex] = useState(0);

  const card = errorLogCards[index % errorLogCards.length];
  const position = Math.min(START_POSITION + index, TOTAL_CARDS);
  const progressPercent = (position / TOTAL_CARDS) * 100;

  function handleNext() {
    setIndex((prev) => (prev + 1) % errorLogCards.length);
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 pt-6">
        <Link
          href="/home"
          className="flex h-9 w-9 items-center justify-center rounded-full text-text-primary transition-colors hover:bg-card-gray"
          aria-label="返回"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-base font-bold text-text-primary">英語糾察隊</h1>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full text-text-primary transition-colors hover:bg-card-gray"
          aria-label="更多選項"
        >
          <MoreVertical size={20} />
        </button>
      </header>

      <div className="px-5 pt-4">
        <p className="text-sm font-medium text-text-secondary">
          {position} / {TOTAL_CARDS}
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-irish-green transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <main
        key={card.id}
        className="flex-1 overflow-y-auto px-5 py-6 animate-pop-in"
      >
        <p className="text-sm font-semibold text-text-primary">
          原句（錯誤）
        </p>
        <div className="mt-2 flex items-start gap-3 rounded-2xl border border-red-100 bg-error-bg p-4">
          <XCircle size={20} className="mt-0.5 shrink-0 text-red-400" />
          <p className="flex-1 text-sm leading-relaxed text-text-primary">
            {card.wrongSentence}
          </p>
          <button
            type="button"
            aria-label="播放發音"
            className="mt-0.5 shrink-0 text-text-secondary transition-colors hover:text-irish-green"
          >
            <Volume2 size={16} />
          </button>
        </div>

        <div className="flex justify-center py-3">
          <ArrowDown size={18} className="text-gray-300" />
        </div>

        <p className="text-sm font-semibold text-text-primary">
          校正後（正確）
        </p>
        <div className="mt-2 flex items-start gap-3 rounded-2xl border border-green-100 bg-irish-green/5 p-4">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-irish-green" />
          <p className="flex-1 text-sm leading-relaxed text-text-primary">
            {card.correctSentence}
          </p>
          <button
            type="button"
            aria-label="播放發音"
            className="mt-0.5 shrink-0 text-text-secondary transition-colors hover:text-irish-green"
          >
            <Volume2 size={16} />
          </button>
        </div>

        <div className="mt-5 rounded-2xl bg-card-gray p-4">
          <p className="text-xs font-semibold text-text-secondary">解析</p>
          <p className="mt-1.5 text-sm leading-relaxed text-text-primary">
            {card.explanation}
          </p>
        </div>
      </main>

      <div className="px-5 pb-8">
        <button
          type="button"
          onClick={handleNext}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-irish-green text-base font-semibold text-white transition-colors hover:bg-irish-green-dark"
        >
          下一張
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
