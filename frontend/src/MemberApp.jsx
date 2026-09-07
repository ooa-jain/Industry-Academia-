import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, STATUS_COLOR, TASK_STATUSES } from './api'
import { useAuth } from './authctx'
import {
  Avatar, DueTag, Empty, fmtDate, fmtWhen, Mark, Pill, Toast, useTheme, useToast,
} from './ui'

export default function MemberApp() {
  const { actor, setActor } = useAuth()
  const nav = useNavigate()
  const toggleTheme = useTheme()
  const [toastMsg, toast] = useToast()

  const [board, setBoard] = useState(null)
  const [tab, setTab] = useState('mine')     // mine | tagged | done
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    try { setBoard(await api.myBoard()) } catch (ex) { toast(ex.message) }
  }, [])                                     // eslint-disable-line
  useEffect(() => { load() }, [load])

  async function signOut() {
    await api.logout().catch(() => {})
    setActor(null); nav('/login', { replace: true })
  }

  const mine = board?.mine || []
  const tagged = board?.mentioned || []
  const openMine = mine.filter(t => t.status !== 'Done')
  const doneMine = mine.filter(t => t.status === 'Done')

  const overdue = openMine.filter(t => t.due_date &&
    new Date(t.due_date + 'T00:00:00') < new Date(new Date().toDateString()))

  const list = tab === 'mine' ? openMine : tab === 'tagged' ? tagged : doneMine
  const open = useMemo(() => (board?.tasks || []).find(t => t.id === openId), [board, openId])

  if (!board) return <div className="centre"><div style={{ color: 'var(--text-3)' }}>Loading your tasks…</div></div>

  return (
    <div className="main" style={{ minHeight: '100vh' }}>
      <header className="topbar">
        <Mark title="My tasks" sub={board.group?.name || 'Engagement Desk'} />
        <div className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          <Avatar name={actor?.name} />
          <div style={{ lineHeight: 1.25 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{actor?.name}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{actor?.email}</div>
          </div>
          <button className="btn sm ghost" onClick={toggleTheme}>◐</button>
          <button className="btn sm ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="metrics">
        <div className="metric"><div className="v mono">{openMine.length}</div>
          <div className="k">Open with you</div><div className="t">assigned to your name</div></div>
        <div className={'metric' + (overdue.length ? ' alert' : '')}>
          <div className="v mono">{overdue.length}</div>
          <div className="k">Past due</div><div className="t">needs a status update</div></div>
        <div className="metric good"><div className="v mono">{doneMine.length}</div>
          <div className="k">Completed</div><div className="t">marked done by you</div></div>
        <div className="metric"><div className="v mono">{tagged.length}</div>
          <div className="k">Tagged in</div><div className="t">someone else owns these</div></div>
      </div>

      <div className="row" style={{ padding: '12px 22px 0', gap: 7, flexWrap: 'wrap' }}>
        {[['mine', `To do (${openMine.length})`], ['tagged', `Tagged in (${tagged.length})`],
          ['done', `Done (${doneMine.length})`]].map(([k, label]) => (
          <button key={k} className={'btn sm' + (tab === k ? ' primary' : ' ghost')}
                  onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div className="pane">
        {list.length === 0 && (
          <Empty title={tab === 'mine' ? 'Nothing on your plate' : tab === 'tagged'
            ? 'You are not tagged on anything' : 'Nothing completed yet'}>
            {tab === 'mine'
              ? 'When the coordinator assigns you a task it appears here straight away.'
              : 'Tagged tasks are ones somebody else owns but wants you to follow.'}
          </Empty>
        )}
        <div className="col-stack" style={{ gap: 10, maxWidth: 860 }}>
          {list.map(t => (
            <TaskRow key={t.id} t={t} readOnly={tab === 'tagged' && !isMine(t, actor)}
                     onOpen={() => setOpenId(t.id)}
                     onStatus={async st => {
                       try { await api.patchTask(t.id, { status: st }); toast(`Marked ${st}`); load() }
                       catch (ex) { toast(ex.message) }
                     }} />
          ))}
        </div>
      </div>

      {open && <TaskSheet task={open} onClose={() => setOpenId(null)} onChanged={load} toast={toast} />}
      <Toast msg={toastMsg} />
    </div>
  )
}

const isMine = (t, actor) => (t.assignee || {}).id === actor?.id

function TaskRow({ t, onOpen, onStatus, readOnly }) {
  const [fg] = STATUS_COLOR[t.status] || ['var(--muted)']
  return (
    <div className="card" style={{ padding: 0, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 4, background: fg, flex: 'none' }} />
      <div style={{ padding: '13px 15px', flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
            {t.engagement ? `IAE-${String(t.engagement.seq).padStart(3, '0')} · ${t.engagement.company_name}` : 'No topic'}
          </span>
          <div className="spacer" />
          <DueTag date={t.due_date} status={t.status} />
          {t.priority === 'High' &&
            <span className="tag" style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>High</span>}
        </div>

        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 17, fontWeight: 600,
                      margin: '6px 0 4px', cursor: 'pointer' }} onClick={onOpen}>
          {t.title}
        </div>
        {t.detail && <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>{t.detail}</div>}

        {t.progress > 0 && t.status !== 'Done' && (
          <div className="prog" style={{ margin: '8px 0 4px' }}><i style={{ width: `${t.progress}%` }} /></div>
        )}

        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {readOnly ? (
            <><Pill status={t.status} />
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                owned by {(t.assignee || {}).name || 'nobody'}</span></>
          ) : (
            <select className="inp" style={{ width: 150, padding: '5px 9px', fontSize: 12.5 }}
                    value={t.status} onChange={e => onStatus(e.target.value)}>
              {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          )}
          <button className="btn sm ghost" onClick={onOpen}>
            Open{t.comment_count > 0 ? ` · ${t.comment_count} updates` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskSheet({ task, onClose, onChanged, toast }) {
  const [comments, setComments] = useState([])
  const [note, setNote] = useState('')
  const [progress, setProgress] = useState(task.progress)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.comments(task.id).then(r => setComments(r.comments)).catch(ex => toast(ex.message))
  }, [task.id])                                        // eslint-disable-line

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function post() {
    if (!note.trim()) return
    setBusy(true)
    try {
      const r = await api.addComment(task.id, note.trim())
      setComments(c => [...c, r.comment]); setNote(''); onChanged()
    } catch (ex) { toast(ex.message) } finally { setBusy(false) }
  }
  async function saveProgress(v) {
    try { await api.patchTask(task.id, { progress: v }); onChanged(); toast(`Progress ${v}%`) }
    catch (ex) { toast(ex.message) }
  }
  async function setStatus(st) {
    try { await api.patchTask(task.id, { status: st }); onChanged(); toast(`Marked ${st}`) }
    catch (ex) { toast(ex.message) }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="dr-head">
          <div style={{ minWidth: 0 }}>
            <div className="fileno">
              {task.engagement
                ? `IAE-${String(task.engagement.seq).padStart(3, '0')} · ${task.engagement.company_name}`
                : 'No topic'}
            </div>
            <h2>{task.title}</h2>
            <Pill status={task.status} />
            {task.due_date && <span className="pill" style={{
              background: 'var(--surface-3)', color: 'var(--text-2)', marginLeft: 5,
            }}>Due {fmtDate(task.due_date)}</span>}
          </div>
          <button className="dr-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="dr-body">
          {task.detail && (
            <section>
              <div className="sec-hd">What is being asked<div className="rule" /></div>
              <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{task.detail}</div>
            </section>
          )}

          {task.engagement && (
            <section>
              <div className="sec-hd">Topic<div className="rule" /></div>
              <div className="card" style={{ padding: '12px 14px' }}>
                <div style={{ fontWeight: 600 }}>{task.engagement.company_name}</div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {task.engagement.theme && <span className="tag theme">{task.engagement.theme}</span>}
                  <Pill status={task.engagement.status} />
                </div>
              </div>
            </section>
          )}

          <section>
            <div className="sec-hd">Your update<div className="rule" /></div>
            <div className="f" style={{ marginBottom: 14 }}>
              <label>Status</label>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {TASK_STATUSES.map(s => (
                  <button key={s} className={'btn sm' + (task.status === s ? ' primary' : '')}
                          onClick={() => setStatus(s)}>{s}</button>
                ))}
              </div>
            </div>
            <div className="f">
              <label>Progress — {progress}%</label>
              <input type="range" min="0" max="100" step="5" value={progress}
                     style={{ width: '100%', accentColor: 'var(--accent)' }}
                     onChange={e => setProgress(Number(e.target.value))}
                     onMouseUp={e => saveProgress(Number(e.target.value))}
                     onTouchEnd={e => saveProgress(Number(e.target.value))} />
            </div>
          </section>

          <section>
            <div className="sec-hd">Updates<div className="rule" /></div>
            <div className="log" style={{ marginBottom: 12 }}>
              {comments.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                  Nothing posted yet. Say where things stand — the coordinator sees it immediately.
                </div>
              )}
              {comments.map(c => (
                <div key={c.id} className={'log-item' + (c.kind === 'note' ? ' hi' : '')}>
                  <div className="t"><b>{c.author_name}</b> — {c.text}</div>
                  <div className="ts">{fmtWhen(c.created_at)}</div>
                </div>
              ))}
            </div>
            <textarea className="inp" value={note} placeholder="What have you done, what is blocking you…"
                      onChange={e => setNote(e.target.value)} />
            <button className="btn sm primary" style={{ marginTop: 8 }} disabled={busy || !note.trim()}
                    onClick={post}>Post update</button>
          </section>

          <div className="row">
            <div className="spacer" />
            <button className="btn sm ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </aside>
    </>
  )
}
