import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, Outlet, useNavigate } from 'react-router'
import { ApiError, apiClient, type AuthUser } from '../lib/api'

type AuthState =
 | { status: 'loading' | 'unauthenticated' | 'error'; user: null }
 | { status: 'authenticated'; user: AuthUser }
const AuthSession = createContext<{
 state: AuthState
 notice: string
 retry: () => Promise<void>
 login: (username: string, password: string) => Promise<void>
 changePassword: (currentPassword: string, newPassword: string) => Promise<void>
 logout: () => Promise<void>
} | null>(null)

export function AuthSessionProvider({ children }: { children: ReactNode }) {
 const [state, setState] = useState<AuthState>({ status: 'loading', user: null })
 const [notice, setNotice] = useState('')
 const generation = useRef(0)
 const navigate = useNavigate()
 const retry = useCallback(async () => {
  const current = ++generation.current
  setState({ status: 'loading', user: null })
  try {
   const { user } = await apiClient.me()
   if (current === generation.current) setState({ status: 'authenticated', user })
  } catch (error) {
   if (current === generation.current) setState({ status: error instanceof ApiError && error.status === 401 ? 'unauthenticated' : 'error', user: null })
  }
 }, [])
 useEffect(() => {
  const unsubscribe = apiClient.onUnauthorized(() => {
   ++generation.current
   setState({ status: 'unauthenticated', user: null })
  })
  void retry()
  return () => { ++generation.current; unsubscribe() }
 }, [retry])
 // Mock product data makes no authenticated requests; recheck on returning to the app.
 useEffect(() => {
  if (state.status !== 'authenticated') return
  const check = () => { void retry() }
  window.addEventListener('focus', check)
  return () => window.removeEventListener('focus', check)
 }, [state.status, retry])
 return <AuthSession.Provider value={{ state, notice, retry,
  async login(username, password) {
   const current = ++generation.current
   setState({ status: 'loading', user: null })
   try {
    const { user } = await apiClient.login({ username, password })
    if (current !== generation.current) return
    setNotice('')
    setState({ status: 'authenticated', user })
    void navigate(user.must_change_password ? '/change-password' : '/home', { replace: true })
   } catch (error) {
    if (current === generation.current) setState({ status: 'unauthenticated', user: null })
    throw error
   }
  },
  async changePassword(currentPassword, newPassword) {
   const current = generation.current
   await apiClient.changePassword({ current_password: currentPassword, new_password: newPassword })
   if (current !== generation.current) return
   setState({ status: 'loading', user: null })
   let user: AuthUser
   try { ({ user } = await apiClient.me()) }
   catch (error) {
    if (current === generation.current) setState({ status: error instanceof ApiError && error.status === 401 ? 'unauthenticated' : 'error', user: null })
    throw error
   }
   if (current !== generation.current) return
   setState({ status: 'authenticated', user })
   if (user.must_change_password) throw new Error('Password change was not confirmed')
   void navigate('/home', { replace: true })
  },
  async logout() {
   const current = ++generation.current
   setState({ status: 'loading', user: null })
   try { await apiClient.logout(); if (current === generation.current) setNotice('') }
   catch { if (current === generation.current) setNotice('無法確認伺服器登出，請稍後重試。') }
   finally {
    if (current === generation.current) {
     setState({ status: 'unauthenticated', user: null })
     void navigate('/login', { replace: true })
    }
   }
  },
 }}>{children}</AuthSession.Provider>
}
export function useAuthSession() {
 const session = useContext(AuthSession)
 if (!session) throw new Error('AuthSessionProvider is required')
 return session
}
export function RequireAuth() {
 const { state, retry } = useAuthSession()
 if (state.status === 'loading') return <p role="status" className="p-8">正在確認登入狀態…</p>
 if (state.status === 'error') return <section className="p-8">
  <p role="alert">無法確認登入狀態，請重試。</p>
  <button type="button" onClick={() => void retry()}>重試</button>
  <Link to="/login">前往登入</Link>
 </section>
 if (state.status === 'unauthenticated') return <Navigate to="/login" replace />
 return <Outlet />
}
export function RequirePasswordChanged() {
 const { state } = useAuthSession()
 if (state.status !== 'authenticated') return null
 return state.user.must_change_password ? <Navigate to="/change-password" replace /> : <Outlet />
}
