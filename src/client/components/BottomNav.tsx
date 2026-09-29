import { NavLink, useLocation } from "react-router";
import { BookOpen, Home, Languages, LogOut } from "lucide-react";

import { useAuthSession } from "./AuthSession";

const tabs = [
  { key: "home", label: "首頁", href: "/home", icon: Home },
  { key: "cards", label: "單字卡", href: "/cards", icon: BookOpen },
  { key: "errors", label: "錯誤卡", href: "/error-log", icon: Languages },
];

export default function BottomNav() {
  const pathname = useLocation().pathname;
  const { logout } = useAuthSession();

  return (
    <nav aria-label="主要導覽" className="sticky bottom-0 z-10 flex border-t border-gray-100 bg-white px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;

        return (
          <NavLink
            key={tab.key}
            to={tab.href}
            className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors ${
              isActive ? "text-irish-green" : "text-text-secondary"
            }`}
          >
            <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
            <span className="text-[11px] font-medium">{tab.label}</span>
          </NavLink>
        );
      })}

      <button
        type="button"
        onClick={() => void logout()}
        className="flex flex-1 flex-col items-center gap-1 py-1 text-text-secondary transition-colors hover:text-irish-green"
      >
        <LogOut size={22} />
        <span className="text-[11px] font-medium">登出</span>
      </button>
    </nav>
  );
}
