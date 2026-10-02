import { createContext, useContext } from 'react'
import { Navigate, Outlet } from 'react-router'
import { clientData } from '../services/data'
import { useClientData } from '../services/useClientData'
import type { Settings } from '../services/types'
import DataState from './DataState'

const ProductSession = createContext<{ settings: Settings; setSettings: (settings: Settings) => void } | null>(null)
export function ProductSessionProvider() {
 const { data, loading, error, reload, setData } = useClientData(clientData.getSettings)
 if (!data) return <div className="p-8"><DataState loading={loading} error={error} retry={reload} /></div>
 return <ProductSession.Provider value={{ settings: data, setSettings: setData }}><Outlet /></ProductSession.Provider>
}
export function useProductSession() {
 const session = useContext(ProductSession)
 if (!session) throw new Error('ProductSessionProvider is required')
 return session
}
export function RequireLevel() {
 const { settings } = useProductSession()
 return settings.english_level === null ? <Navigate to="/onboarding" replace /> : <Outlet />
}
