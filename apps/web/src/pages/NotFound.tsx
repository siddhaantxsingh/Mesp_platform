import { Link } from 'react-router-dom'
export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <p className="font-mono text-sm text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold">No signal here</h1>
        <p className="mt-2 text-sm text-muted">The page you asked for doesn’t exist.</p>
        <Link to="/" className="mt-6 inline-block text-sm text-primary underline underline-offset-4">Go home</Link>
      </div>
    </div>
  )
}
