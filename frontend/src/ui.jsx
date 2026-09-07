import React, { useEffect, useState } from 'react'
import { STATUS_COLOR } from './api'

/* ---------- primitives ---------- */
export function Pill({ children, status }) {
  const [fg, bg] = STATUS_COLOR[status] || ['var(--text-2)', 'var(--surface-3)']
  return <span className="pill" style={{ color: fg, background: bg }}>{children ?? status}</span>
}

export function Avatar({ name, sm }) {
  const initials = (name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return <span className={'avatar' + (sm ? ' sm' : '')} title={name}>{initials}</span>
}

export function Field({ label, children, wide }) {
  return (
    <div className={'f' + (wide ? ' wide' : '')}>
      <label>{label}</label>
      {children}
    </div>
  )
}

export function Empty({ title, children }) {
  return <div className="empty"><h3>{title}</h3><div>{children}</div></div>
}

export function Toast({ msg }) {
  if (!msg) return null
  return <div className="toast">{msg}</div>
}

export function useToast() {
  const [msg, setMsg] = useState('')
  const show = t => { setMsg(t); }
  useEffect(() => {
    if (!msg) return
    const id = setTimeout(() => setMsg(''), 2400)
    return () => clearTimeout(id)
  }, [msg])
  return [msg, show]
}

/* ---------- overlays ---------- */
export function Modal({ title, cap, onClose, children, actions }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {cap && <div className="cap">{cap}</div>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

export function Drawer({ onClose, children }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">{children}</aside>
    </>
  )
}

/* ---------- dates ---------- */
export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}
export function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}
export function dayDiff(iso) {
  if (!iso) return null
  const t = new Date(iso + 'T00:00:00')
  if (isNaN(t)) return null
  const n = new Date(); n.setHours(0, 0, 0, 0)
  return Math.round((t - n) / 86400000)
}
export function DueTag({ date, status }) {
  const d = dayDiff(date)
  if (!date) return null
  if (status === 'Done') return <span className="tag">{fmtDate(date)}</span>
  if (d === null) return <span className="tag">{fmtDate(date)}</span>
  if (d < 0) return <span className="tag" style={{ background: 'var(--bad-bg)', color: 'var(--bad)', fontWeight: 600 }}>{Math.abs(d)}d over</span>
  if (d <= 7) return <span className="tag" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', fontWeight: 600 }}>{d}d left</span>
  return <span className="tag">{fmtDate(date)}</span>
}

/* ---------- theme ---------- */
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('desk-theme') || '')
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme)
    else document.documentElement.removeAttribute('data-theme')
  }, [theme])
  const toggle = () => {
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const now = theme || (sysDark ? 'dark' : 'light')
    const next = now === 'dark' ? 'light' : 'dark'
    localStorage.setItem('desk-theme', next)
    setTheme(next)
  }
  return toggle
}

export const Mark = ({ title, sub }) => (
  <div className="mark">
    <div className="stamp">IA</div>
    <div className="wm">{title}<small>{sub}</small></div>
  </div>
)
