"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, MoreVertical, RotateCw, Star, Volume2 } from "lucide-react";
import { vocabFlashcards } from "@/lib/mock-data";

const TOTAL_CARDS = 40;
const START_POSITION = 12;

export default function FlashcardsPage() {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [favorited, setFavorited] = useState<Record<number, boolean>>({});

  const card = vocabFlashcards[index % vocabFlashcards.length];
  const position = Math.min(START_POSITION + index, TOTAL_CARDS);
  const progressPercent = (position / TOTAL_CARDS) * 100;
  const isFavorited = !!favorited[index];

  function handleNext() {
    setFlipped(false);
    setIndex((prev) => (prev + 1) % vocabFlashcards.length);
  }

  function toggleFavorite() {
    setFavorited((prev) => ({ ...prev, [index]: !prev[index] }));
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
        <h1 className="text-base font-bold text-text-primary">單字閃卡</h1>
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

      <main className="flex flex-1 flex-col justify-center px-5 py-6">
        <div className="perspective mx-auto h-80 w-full max-w-sm">
          <div
            className={`flip-card-inner relative h-full w-full ${flipped ? "flipped" : ""}`}
          >
            <div className="flip-card-face absolute inset-0 flex flex-col rounded-2xl border border-gray-100 bg-card-gray p-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Front
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite();
                  }}
                  aria-label="收藏"
                  aria-pressed={isFavorited}
                >
                  <Star
                    size={20}
                    className={
                      isFavorited
                        ? "fill-irish-green text-irish-green"
                        : "text-gray-300"
                    }
                  />
                </button>
              </div>

              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <h2 className="text-3xl font-bold text-irish-green">
                  {card.word}
                </h2>
                <p className="text-sm text-text-secondary">{card.phonetic}</p>
                <button
                  type="button"
                  aria-label="播放發音"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-text-secondary shadow-sm transition-colors hover:text-irish-green"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Volume2 size={18} />
                </button>
                <p className="text-sm text-text-primary">
                  <span className="text-text-secondary">
                    {card.partOfSpeech}
                  </span>{" "}
                  {card.zhDefinition}
                </p>
              </div>
            </div>

            <div className="flip-card-face flip-card-back absolute inset-0 flex flex-col rounded-2xl border border-gray-100 bg-card-gray p-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Back
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite();
                  }}
                  aria-label="收藏"
                  aria-pressed={isFavorited}
                >
                  <Star
                    size={20}
                    className={
                      isFavorited
                        ? "fill-irish-green text-irish-green"
                        : "text-gray-300"
                    }
                  />
                </button>
              </div>

              <div className="flex flex-1 flex-col justify-center gap-4">
                <div>
                  <p className="text-base font-semibold leading-relaxed text-text-primary">
                    {card.exampleEn}
                  </p>
                  <div className="mt-2 flex items-start gap-2">
                    <button
                      type="button"
                      aria-label="播放發音"
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-text-secondary shadow-sm transition-colors hover:text-irish-green"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Volume2 size={14} />
                    </button>
                    <p className="text-sm text-text-secondary">
                      {card.exampleZh}
                    </p>
                  </div>
                </div>

                {card.irishUsage && (
                  <div className="rounded-xl bg-irish-green/10 p-3">
                    <span className="text-xs font-semibold text-irish-green">
                      🇮🇪 在地用法
                    </span>
                    <p className="mt-1 text-xs leading-relaxed text-text-primary">
                      {card.irishUsage}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFlipped((prev) => !prev)}
          className="mx-auto mt-6 flex flex-col items-center gap-1.5 text-text-secondary transition-colors hover:text-irish-green"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200">
            <RotateCw size={18} />
          </span>
          <span className="text-xs font-medium">翻轉卡片</span>
        </button>
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
