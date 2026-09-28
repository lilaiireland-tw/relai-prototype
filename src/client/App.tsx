import { BrowserRouter, NavLink, Route, Routes } from 'react-router'

export function AppRouter() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <App />
    </BrowserRouter>
  )
}

const pages = ['Login', 'Home', 'Cards', 'Stats', 'Settings']

function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <p>{title} page placeholder</p>
    </section>
  )
}

export function App() {
  return (
    <main>
      <h1>ReLai</h1>
      <p>Cloudflare runtime foundation</p>
      <nav aria-label="Main navigation">
        <ul>
          {pages.map((page) => (
            <li key={page}>
              <NavLink to={`/${page.toLowerCase()}`}>{page}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Routes>
        <Route index element={<Placeholder title="Home" />} />
        {pages.map((page) => (
          <Route key={page} path={page.toLowerCase()} element={<Placeholder title={page} />} />
        ))}
        <Route path="*" element={<h2>Page not found</h2>} />
      </Routes>
    </main>
  )
}
