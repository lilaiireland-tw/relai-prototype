"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";

import { useAuth } from "@/components/AuthProvider";

type AuthMode = "login" | "register";

export default function AuthFormPage({
  initialMode,
}: {
  initialMode: AuthMode;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, register, token, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!isLoading && token) {
      router.replace("/home");
    }
  }, [isLoading, router, token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, displayName);
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "操作失敗");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-white px-8 pb-10 pt-10">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="flex h-10 w-10 items-center justify-center rounded-full text-text-primary transition-colors hover:bg-card-gray"
          aria-label="返回首頁"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-1">
          <h1 className="text-lg font-bold text-text-primary">ReLai</h1>
          <Sparkles size={16} className="text-irish-green" strokeWidth={2.4} />
        </div>
        <div className="h-10 w-10" />
      </div>

      <div className="mt-8 text-center">
        <p className="text-sm text-text-secondary">哩來語感特訓</p>
        <h2 className="mt-3 text-2xl font-semibold text-text-primary">
          {mode === "login" ? "登入你的帳號" : "建立新的帳號"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          保持原本的學習流程，登入後直接接上你現在的後端 API。
        </p>
      </div>

      <div className="mt-8 rounded-2xl border border-gray-100 bg-card-gray p-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`h-11 rounded-xl text-sm font-semibold transition-colors ${
              mode === "login"
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-secondary"
            }`}
          >
            登入
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`h-11 rounded-xl text-sm font-semibold transition-colors ${
              mode === "register"
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-secondary"
            }`}
          >
            註冊
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        {mode === "register" ? (
          <label className="flex flex-col gap-2 text-sm text-text-primary">
            顯示名稱
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="h-12 rounded-xl border border-gray-200 bg-white px-4 text-sm outline-none transition-colors focus:border-irish-green"
              placeholder="例如 Alex"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-2 text-sm text-text-primary">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 rounded-xl border border-gray-200 bg-white px-4 text-sm outline-none transition-colors focus:border-irish-green"
            placeholder="you@example.com"
            required
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-text-primary">
          密碼
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-12 rounded-xl border border-gray-200 bg-white px-4 text-sm outline-none transition-colors focus:border-irish-green"
            placeholder="至少 8 碼"
            minLength={8}
            required
          />
        </label>

        {error ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-irish-green text-base font-semibold text-white transition-colors hover:bg-irish-green-dark disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : null}
          {mode === "login" ? "登入並開始" : "建立帳號並登入"}
        </button>
      </form>
    </div>
  );
}
