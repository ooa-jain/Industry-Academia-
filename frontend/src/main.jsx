import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BrowserRouter, Navigate, Route, Routes, useNavigate, useParams,
} from 'react-router-dom'

import './styles.css'
import { api } from './api'
import { AuthProvider, useAuth } from './authctx'
import AdminApp from './AdminApp'
import MemberApp from './MemberApp'
import { Mark } from './ui'

function Splash({ text = 'Opening the desk…' }) {
  return (
    <div className="centre">
      <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
        <div style={{ display: 'inline-block' }}><Mark title="Engagement Desk" sub="JAIN · OoA" /></div>
        <div style={{ marginTop: 18, fontSize: 13 }}>{text}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ auth / login / register */
function Login({ initialMode = 'login' }) {
  const { actor, setActor } = useAuth()
  const nav = useNavigate()
  const [mode, setMode] = useState(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    if (actor?.role === 'admin') nav('/admin', { replace: true })
    if (actor?.role === 'member') nav('/me', { replace: true })
  }, [actor, nav])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      if (mode === 'register') {
        if (!name.trim()) throw new Error('Please enter your full name.')
        if (!email.trim()) throw new Error('Please enter your email or username.')
        if (password.length < 6) throw new Error('Password must be at least 6 characters long.')
        if (password !== confirmPassword) throw new Error('Passwords do not match.')
        const r = await api.register(name.trim(), email.trim(), password)
        setActor(r.actor)
        nav('/admin', { replace: true })
      } else {
        const r = await api.login(email.trim(), password)
        setActor(r.actor)
        nav('/admin', { replace: true })
      }
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  function switchMode(newMode) {
    setMode(newMode)
    setErr('')
  }

  return (
    <div className="centre">
      <form className="authcard" onSubmit={submit}>
        <Mark title="Engagement Desk" sub="Industry–Academia Register" />

        <div className="auth-tabs">
          <button type="button" className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
                  onClick={() => switchMode('login')}>
            Sign in
          </button>
          <button type="button" className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
                  onClick={() => switchMode('register')}>
            New user? Register
          </button>
        </div>

        <h1>{mode === 'login' ? 'Coordinator sign-in' : 'New coordinator register'}</h1>
        <p className="cap">
          {mode === 'login'
            ? 'Group members do not sign in here — they open the personal link you share with them.'
            : 'Register as a new coordinator to create groups, case files, and manage engagements.'}
        </p>

        {err && <div className="err">{err}</div>}

        <div className="col-stack">
          {mode === 'register' && (
            <div className="f">
              <label>Full name</label>
              <input className="inp" type="text" value={name} autoFocus
                     placeholder="e.g. Dr. Priya Sharma"
                     onChange={e => setName(e.target.value)} required />
            </div>
          )}

          <div className="f">
            <label>Email or username</label>
            <input className="inp" type="text" value={email} autoComplete="username"
                   autoCapitalize="none" spellCheck="false"
                   placeholder={mode === 'register' ? 'priya@jainuniversity.ac.in' : ''}
                   onChange={e => setEmail(e.target.value)} required />
          </div>

          <div className="f">
            <label>Password</label>
            <input className="inp" type="password" value={password}
                   autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                   placeholder={mode === 'register' ? 'At least 6 characters' : ''}
                   onChange={e => setPassword(e.target.value)} required />
          </div>

          {mode === 'register' && (
            <div className="f">
              <label>Confirm password</label>
              <input className="inp" type="password" value={confirmPassword}
                     autoComplete="new-password"
                     placeholder="Re-enter password"
                     onChange={e => setConfirmPassword(e.target.value)} required />
            </div>
          )}

          <button className="btn primary" style={{ justifyContent: 'center', marginTop: 8 }}
                  disabled={busy}>
            {busy
              ? (mode === 'login' ? 'Signing in…' : 'Creating account…')
              : (mode === 'login' ? 'Sign in' : 'Create account & enter')}
          </button>
        </div>

        <div className="auth-switch">
          {mode === 'login' ? (
            <>
              New user?{' '}
              <button type="button" className="auth-link" onClick={() => switchMode('register')}>
                Register as coordinator
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className="auth-link" onClick={() => switchMode('login')}>
                Sign in here
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}

/* -------------------------------------------------------- magic-link entry */
function Join() {
  const { token } = useParams()
  const { setActor } = useAuth()
  const nav = useNavigate()
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    api.join(token)
      .then(r => { if (!cancelled) { setActor(r.actor); nav('/me', { replace: true }) } })
      .catch(ex => { if (!cancelled) setErr(ex.message) })
    return () => { cancelled = true }
  }, [token, setActor, nav])

  if (err) {
    return (
      <div className="centre">
        <div className="authcard">
          <Mark title="Engagement Desk" sub="JAIN · OoA" />
          <h1>This link no longer works</h1>
          <p className="cap">{err}</p>
          <div className="note">
            Ask the Office of Academics for a fresh link. Links are personal — each one opens only
            the tasks assigned to that person.
          </div>
        </div>
      </div>
    )
  }
  return <Splash text="Signing you in…" />
}

/* ----------------------------------------------------------------- routing */
function Gate({ role, children }) {
  const { actor } = useAuth()
  if (actor === undefined) return <Splash />
  if (!actor) return <Navigate to="/login" replace />
  if (role && actor.role !== role) {
    return <Navigate to={actor.role === 'admin' ? '/admin' : '/me'} replace />
  }
  return children
}

function Home() {
  const { actor } = useAuth()
  if (actor === undefined) return <Splash />
  if (!actor) return <Navigate to="/login" replace />
  return <Navigate to={actor.role === 'admin' ? '/admin' : '/me'} replace />
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login initialMode="login" />} />
          <Route path="/register" element={<Login initialMode="register" />} />
          <Route path="/join/:token" element={<Join />} />
          <Route path="/admin/*" element={<Gate role="admin"><AdminApp /></Gate>} />
          <Route path="/me" element={<Gate role="member"><MemberApp /></Gate>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')).render(<App />)
