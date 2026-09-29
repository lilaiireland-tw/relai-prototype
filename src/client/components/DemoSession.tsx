import { createContext, useContext, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
type Profile = { username: string; display_name: string }
const DemoSession = createContext<{
 profile: Profile | null
 login: (username: string, password: string) => void
 logout: () => void
} | null>(null)
// Demo UI state only. No credentials/tokens persisted, no security or API auth.
// Reload clears the session; deep-linked mock screens are publicly previewable.
export function DemoSessionProvider({ children }: { children: ReactNode }) {
 const [profile, setProfile] = useState<Profile | null>(null)
 const navigate = useNavigate()
 return <DemoSession.Provider value={{ profile,
  login(username, password) {
   if (!username.trim() || !password) throw new Error('請輸入使用者名稱與密碼。')
   setProfile({ username: username.trim(), display_name: username.trim() })
   void navigate('/home')
  },
  logout() { setProfile(null); void navigate('/login') },
 }}>{children}</DemoSession.Provider>
}
export function useDemoSession() {
 const session = useContext(DemoSession)
 if (!session) throw new Error('DemoSessionProvider is required')
 return session
}
