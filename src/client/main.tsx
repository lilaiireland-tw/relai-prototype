import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter } from './App'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
