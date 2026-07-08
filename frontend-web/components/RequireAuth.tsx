"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";

export default function RequireAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  const { token, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !token) {
      router.replace("/");
    }
  }, [isLoading, router, token]);

  if (isLoading || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-text-secondary">
        正在驗證登入狀態...
      </div>
    );
  }

  return <>{children}</>;
}
