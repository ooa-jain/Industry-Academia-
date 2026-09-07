import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  api, DECISIONS, ENGAGEMENT_STATUSES, PRIORITIES, STAGES, STATUS_COLOR, TASK_STATUSES,
} from './api'
import { useAuth } from './authctx'
import {
  Avatar, Drawer, DueTag, Empty, Field, fmtDate, fmtWhen, Mark, Modal, Pill, Toast,
  useTheme, useToast,
} from './ui'

const NAV = [
  { k: 'tasks',   label: 'Task board',  gl: '▦' },
  { k: 'files',   label: 'Case files',  gl: '☰' },
  { k: 'people',  label: 'People',      gl: '☺' },
  { k: 'activity',label: 'Activity',    gl: '≡' },
]
const DIRECTORY_NAV = { k: 'directory', label: 'Project managers', gl: '⌘' }

export default function AdminApp() {
  const { actor, setActor } = useAuth()
  const nav = useNavigate()
  const toggleTheme = useTheme()
  const [toastMsg, toast] = useToast()
  const isSuperAdmin = actor?.role === 'super_admin'

  const [groups, setGroups] = useState([])
  const [gid, setGid] = useState(() => localStorage.getItem('desk-gid') || '')
  const [view, setView] = useState(() => (actor?.role === 'super_admin' ? 'directory' : 'tasks'))

  const [members, setMembers] = useState([])
  const [engagements, setEngagements] = useState([])
  const [tasks, setTasks] = useState([])
  const [activity, setActivity] = useState([])
  const [coordinators, setCoordinators] = useState([])

  const navItems = useMemo(() => (isSuperAdmin ? [...NAV, DIRECTORY_NAV] : NAV), [isSuperAdmin])

  const [openTask, setOpenTask] = useState(null)
  const [openEng, setOpenEng] = useState(null)
  const [modal, setModal] = useState(null)   // 'group' | 'member' | 'engagement' | 'task'
  const [filterAssignee, setFilterAssignee] = useState('')
  const [q, setQ] = useState('')

  /* ---------------------------------------------------------- data loading */
  const loadGroups = useCallback(async () => {
    const r = await api.groups()
    setGroups(r.groups)
    if (r.groups.length && !r.groups.find(g => g.id === gid)) {
      setGid(r.groups[0].id)
    }
    return r.groups
  }, [gid])

  const loadGroupData = useCallback(async id => {
    if (!id) { setMembers([]); setEngagements([]); setTasks([]); setActivity([]); return }
    const [m, e, t, a] = await Promise.all([
      api.members(id), api.engagements(id), api.tasks(id), api.activity(id),
    ])
    setMembers(m.members); setEngagements(e.engagements)
    setTasks(t.tasks); setActivity(a.activity)
  }, [])

  const loadCoordinators = useCallback(async () => {
    const r = await api.coordinators()
    setCoordinators(r.coordinators)
  }, [])

  useEffect(() => { loadGroups().catch(() => {}) }, [])            // eslint-disable-line
  useEffect(() => {
    if (gid) localStorage.setItem('desk-gid', gid)
    loadGroupData(gid).catch(ex => toast(ex.message))
  }, [gid, loadGroupData])                                        // eslint-disable-line
  useEffect(() => {
    if (isSuperAdmin) loadCoordinators().catch(ex => toast(ex.message))
  }, [isSuperAdmin, loadCoordinators])                             // eslint-disable-line

  const refresh = () => loadGroupData(gid).catch(ex => toast(ex.message))

  async function signOut() {
    await api.logout().catch(() => {})
    setActor(null); nav('/login', { replace: true })
  }

  const group = groups.find(g => g.id === gid)
  const byId = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members])

  const shownTasks = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tasks.filter(t => {
      if (filterAssignee === 'unassigned' && t.assignee) return false
      if (filterAssignee && filterAssignee !== 'unassigned'
          && (t.assignee || {}).id !== filterAssignee) return false
      if (needle) {
        const hay = [t.title, t.detail, (t.assignee || {}).name, (t.engagement || {}).company_name]
          .join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [tasks, filterAssignee, q])

  /* --------------------------------------------------------------- actions */
  async function moveTask(taskId, status) {
    const t = tasks.find(x => x.id === taskId)
    if (!t || t.status === status) return
    setTasks(ts => ts.map(x => (x.id === taskId ? { ...x, status } : x)))   // optimistic
    try {
      const r = await api.patchTask(taskId, { status })
      setTasks(ts => ts.map(x => (x.id === taskId ? r.task : x)))
      toast(`“${t.title}” → ${status}`)
    } catch (ex) { toast(ex.message); refresh() }
  }

  /* ------------------------------------------------------------------ view */
  if (!groups.length && !isSuperAdmin) {
    return (
      <>
        <div className="centre">
          <div className="authcard">
            <Mark title="Engagement Desk" sub="Industry–Academia Register" />
            <h1>Create your first group</h1>
            <p className="cap">
              A group is one working circle — a cell, a committee, a cohort. You add people to it by
              name and email, then share each person a private link to their own tasks.
            </p>
            <button className="btn primary" style={{ justifyContent: 'center', width: '100%' }}
                    onClick={() => setModal('group')}>＋ New group</button>
          </div>
        </div>
        {modal === 'group' && (
          <GroupModal onClose={() => setModal(null)} onSaved={async g => {
            setModal(null); const gs = await loadGroups(); setGid(g.id); toast('Group created')
          }} />
        )}
        <Toast msg={toastMsg} />
      </>
    )
  }

  return (
    <div className="app">
      {/* ------------------------------------------------------------ rail */}
      <aside className="rail">
        <Mark title="Engagement Desk" sub={isSuperAdmin ? 'Super Admin' : 'Project Manager'} />

        <div className="rail-sec">
          <div className="rail-hd">Group</div>
          <select className="inp" value={gid} onChange={e => setGid(e.target.value)}
                  style={{ fontSize: 13 }}>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button className="navbtn" onClick={() => setModal('group')}>
            <span className="gl">＋</span>New group
          </button>
        </div>

        <nav className="rail-sec">
          <div className="rail-hd">Views</div>
          {navItems.map(n => (
            <button key={n.k} className={'navbtn' + (view === n.k ? ' on' : '')}
                    onClick={() => setView(n.k)}>
              <span className="gl">{n.gl}</span>{n.label}
              <span className="kb">
                {n.k === 'tasks' ? tasks.length : n.k === 'files' ? engagements.length
                  : n.k === 'people' ? members.length : n.k === 'directory' ? coordinators.length : ''}
              </span>
            </button>
          ))}
        </nav>

        <div className="rail-sec">
          <div className="rail-hd">Desk</div>
          <button className="navbtn" onClick={toggleTheme}><span className="gl">◐</span>Theme</button>
          <button className="navbtn" onClick={signOut}><span className="gl">⏻</span>Sign out</button>
        </div>

        <div className="rail-foot">
          <div className="whoami">
            <div className="n">{actor?.name}</div>
            <div className="e">{actor?.email}</div>
          </div>
          {view !== 'directory' && gid && (
            <button className="btn primary" style={{ justifyContent: 'center' }}
                    onClick={() => setModal(view === 'people' ? 'member'
                      : view === 'files' ? 'engagement' : 'task')}>
              ＋ {view === 'people' ? 'Add person' : view === 'files' ? 'New case file' : 'New task'}
            </button>
          )}
        </div>
      </aside>

      {/* ------------------------------------------------------------ main */}
      <div className="main">
        <header className="topbar">
          <div>
            <h1>{navItems.find(n => n.k === view)?.label}</h1>
            <div className="sub">{view === 'directory' ? 'Every project manager on the desk' : group?.name}</div>
          </div>
          <div className="spacer" />
          {view === 'tasks' && (
            <>
              <input className="inp" style={{ width: 220 }} placeholder="Search tasks…"
                     value={q} onChange={e => setQ(e.target.value)} />
              <select className="inp" style={{ width: 190 }} value={filterAssignee}
                      onChange={e => setFilterAssignee(e.target.value)}>
                <option value="">Everyone</option>
                <option value="unassigned">Unassigned</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </>
          )}
        </header>

        {view === 'tasks' && <TaskMetrics tasks={tasks} members={members} />}

        <div className="pane">
          {view === 'tasks' && (
            <TaskBoard tasks={shownTasks} onMove={moveTask} onOpen={setOpenTask}
                       onAdd={() => setModal('task')} />
          )}
          {view === 'files' && (
            <CaseFiles engagements={engagements} onOpen={setOpenEng}
                       onAdd={() => setModal('engagement')} />
          )}
          {view === 'people' && (
            <People members={members} gid={gid} onAdd={() => setModal('member')}
                    onChanged={refresh} toast={toast} />
          )}
          {view === 'activity' && <ActivityLog rows={activity} />}
          {view === 'directory' && (
            <CoordinatorDirectory rows={coordinators} actorId={actor?.id}
                                   onChanged={loadCoordinators} toast={toast} />
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- overlays */}
      {openTask && (
        <TaskDrawer task={tasks.find(t => t.id === openTask.id) || openTask}
                    members={members} engagements={engagements}
                    onClose={() => setOpenTask(null)} onChanged={refresh} toast={toast} />
      )}
      {openEng && (
        <EngagementDrawer eng={engagements.find(e => e.id === openEng.id) || openEng}
                          tasks={tasks.filter(t => (t.engagement || {}).id === openEng.id)}
                          members={members} onOpenTask={t => { setOpenEng(null); setOpenTask(t) }}
                          onClose={() => setOpenEng(null)} onChanged={refresh} toast={toast} />
      )}
      {modal === 'group' && (
        <GroupModal onClose={() => setModal(null)}
                    onSaved={async g => { setModal(null); await loadGroups(); setGid(g.id) }} />
      )}
      {modal === 'member' && (
        <MemberModal gid={gid} onClose={() => setModal(null)}
                     onSaved={() => { setModal(null); refresh() }} toast={toast} />
      )}
      {modal === 'engagement' && (
        <EngagementModal gid={gid} onClose={() => setModal(null)}
                         onSaved={() => { setModal(null); refresh() }} />
      )}
      {modal === 'task' && (
        <TaskModal engagements={engagements} members={members} onClose={() => setModal(null)}
                   onSaved={() => { setModal(null); refresh() }} />
      )}
      <Toast msg={toastMsg} />
    </div>
  )
}

/* ======================================================= task board + cards */
function TaskMetrics({ tasks, members }) {
  const open = tasks.filter(t => t.status !== 'Done')
  const late = open.filter(t => {
    if (!t.due_date) return false
    return new Date(t.due_date + 'T00:00:00') < new Date(new Date().toDateString())
  })
  const unassigned = tasks.filter(t => !t.assignee)
  const done = tasks.filter(t => t.status === 'Done')
  const pct = tasks.length ? Math.round(done.length / tasks.length * 100) : 0
  return (
    <div className="metrics">
      <div className="metric"><div className="v mono">{tasks.length}</div>
        <div className="k">Tasks</div><div className="t">{members.length} people on the group</div></div>
      <div className="metric good"><div className="v mono">{pct}<span style={{ fontSize: 15 }}>%</span></div>
        <div className="k">Complete</div><div className="t">{done.length} done, {open.length} open</div></div>
      <div className={'metric' + (late.length ? ' alert' : '')}><div className="v mono">{late.length}</div>
        <div className="k">Overdue</div><div className="t">against the due date set</div></div>
      <div className="metric"><div className="v mono">{unassigned.length}</div>
        <div className="k">Unassigned</div><div className="t">nobody owns these yet</div></div>
    </div>
  )
}

function TaskBoard({ tasks, onMove, onOpen, onAdd }) {
  const [dragId, setDragId] = useState(null)
  const [over, setOver] = useState(null)

  if (!tasks.length) {
    return <Empty title="No tasks yet">
      <div>Open a case file, then break it into tasks and assign each one to a person.</div>
      <button className="btn primary" style={{ marginTop: 14 }} onClick={onAdd}>＋ New task</button>
    </Empty>
  }

  return (
    <div className="board">
      {TASK_STATUSES.map(st => {
        const col = tasks.filter(t => t.status === st)
        const [fg] = STATUS_COLOR[st]
        return (
          <section key={st} className={'tcol' + (over === st ? ' over' : '')}
            onDragOver={e => { e.preventDefault(); setOver(st) }}
            onDragLeave={() => setOver(o => (o === st ? null : o))}
            onDrop={e => { e.preventDefault(); setOver(null); if (dragId) onMove(dragId, st) }}>
            <div className="cap" style={{ background: fg }} />
            <div className="hd"><span className="nm">{st}</span><span className="ct">{col.length}</span></div>
            <div className="body">
              {col.map(t => (
                <article key={t.id} className={'tcard' + (dragId === t.id ? ' dragging' : '')}
                  draggable onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}
                  onClick={() => onOpen(t)} tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') onOpen(t) }}>
                  <div className="eyebrow">
                    {t.engagement ? `IAE-${String(t.engagement.seq).padStart(3, '0')} · ${t.engagement.company_name}` : 'No case file'}
                  </div>
                  <h4>{t.title}</h4>
                  {t.progress > 0 && t.status !== 'Done' &&
                    <div className="prog"><i style={{ width: `${t.progress}%` }} /></div>}
                  <div className="row" style={{ gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                    <DueTag date={t.due_date} status={t.status} />
                    {t.priority === 'High' &&
                      <span className="tag" style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>High</span>}
                    {t.comment_count > 0 && <span className="tag">💬 {t.comment_count}</span>}
                    {t.mention_people?.length > 0 && <span className="tag">@{t.mention_people.length}</span>}
                  </div>
                  <div className="foot">
                    {t.assignee ? <><Avatar sm name={t.assignee.name} />
                      <span className="who">{t.assignee.name}</span></>
                      : <span className="who" style={{ color: 'var(--text-3)' }}>Unassigned</span>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/* ============================================================== case files */
function CaseFiles({ engagements, onOpen, onAdd }) {
  if (!engagements.length) {
    return <Empty title="No case files">
      <div>A case file is one industry engagement. Tasks hang off it.</div>
      <button className="btn primary" style={{ marginTop: 14 }} onClick={onAdd}>＋ New case file</button>
    </Empty>
  }
  return (
    <div className="tablewrap">
      <table>
        <thead><tr>
          <th style={{ width: 96 }}>File</th><th>Partner</th><th>Theme</th>
          <th>University SPOC</th><th>Stage</th><th>Tasks</th><th>Target</th>
        </tr></thead>
        <tbody>
          {engagements.map(e => (
            <tr key={e.id} onClick={() => onOpen(e)} style={{ cursor: 'pointer' }}>
              <td className="num" style={{ color: 'var(--text-3)' }}>
                IAE-{String(e.seq).padStart(3, '0')}
              </td>
              <td><div style={{ fontWeight: 600 }}>{e.company_name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{e.industry_personnel || '—'}</div></td>
              <td>{e.theme ? <span className="tag theme">{e.theme}</span> : '—'}</td>
              <td style={{ color: 'var(--text-2)' }}>{e.university_spoc || '—'}</td>
              <td><Pill status={e.status} /></td>
              <td className="num">{e.task_done}/{e.task_total}</td>
              <td className="num">{fmtDate(e.target_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ================================================================== people */
function People({ members, gid, onAdd, onChanged, toast }) {
  const [links, setLinks] = useState({})   // id -> url, only held in memory

  async function rotate(m) {
    if (!confirm(`Issue a new link for ${m.name}? Their current link stops working immediately.`)) return
    try {
      const r = await api.rotateLink(m.id)
      setLinks(l => ({ ...l, [m.id]: r.link }))
      toast('New link issued — copy and send it')
    } catch (ex) { toast(ex.message) }
  }
  async function toggle(m) {
    try { await api.patchMember(m.id, { active: !m.active }); onChanged() }
    catch (ex) { toast(ex.message) }
  }
  async function remove(m) {
    if (!confirm(`Remove ${m.name} from the group? Their tasks stay, but become unassigned.`)) return
    try { await api.delMember(m.id); onChanged(); toast('Removed') } catch (ex) { toast(ex.message) }
  }
  function copy(url) {
    navigator.clipboard?.writeText(url).then(() => toast('Link copied'),
      () => toast('Select the link and copy it manually'))
  }

  if (!members.length) {
    return <Empty title="Nobody in this group yet">
      <div>Add a person by name and email, then send them their private link.</div>
      <button className="btn primary" style={{ marginTop: 14 }} onClick={onAdd}>＋ Add person</button>
    </Empty>
  }

  return (
    <>
      <div className="note" style={{ marginBottom: 16 }}>
        Each person gets one private link. Opening it signs them in — no password — and shows only
        the tasks assigned to or mentioning them. Links are shown once when created; use
        <b> New link</b> to issue a fresh one, which retires the old.
      </div>
      <div className="mlist">
        {members.map(m => (
          <div key={m.id} className="mrow" style={{ opacity: m.active ? 1 : 0.55 }}>
            <Avatar name={m.name} />
            <div style={{ minWidth: 160 }}>
              <div className="n">{m.name} {!m.active && <span className="tag">paused</span>}</div>
              <div className="e">{m.email}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                {m.title || m.role} · {m.open_tasks} open
                {m.last_seen ? ` · last seen ${fmtDate(m.last_seen)}` : ' · not opened yet'}
              </div>
            </div>
            <div className="spacer" />
            {links[m.id] ? (
              <div className="linkbox">
                <code>{links[m.id]}</code>
                <button className="btn sm" onClick={() => copy(links[m.id])}>Copy</button>
                <a className="btn sm ghost" target="_blank" rel="noreferrer"
                   href={`mailto:${m.email}?subject=${encodeURIComponent('Your task link — Engagement Desk')}&body=${encodeURIComponent(`Hello ${m.name},\n\nHere is your personal link to the Engagement Desk. It opens your assigned tasks directly — no password needed. Please keep it to yourself.\n\n${links[m.id]}\n\n— Office of Academics`)}`}>
                  Mail
                </a>
              </div>
            ) : (
              <span className="tag mono">link ends …{m.token_tail}</span>
            )}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => rotate(m)}>New link</button>
              <button className="btn sm ghost" onClick={() => toggle(m)}>
                {m.active ? 'Pause' : 'Resume'}
              </button>
              <button className="btn sm danger" onClick={() => remove(m)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ================================================================ activity */
function ActivityLog({ rows }) {
  if (!rows.length) return <Empty title="Nothing logged yet">Activity appears as people work.</Empty>
  return (
    <div className="panel" style={{ maxWidth: 720 }}>
      <h3>Recent activity</h3>
      <div className="cap">Newest first. Everything members and project managers do lands here.</div>
      <div className="log">
        {rows.map(r => (
          <div key={r.id} className="log-item hi">
            <div className="t"><b>{r.actor}</b> — {r.text}</div>
            <div className="ts">{fmtWhen(r.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ========================================= coordinator directory (super admin) */
function CoordinatorDirectory({ rows, actorId, onChanged, toast }) {
  async function setRole(row, role) {
    try {
      await api.patchCoordinator(row.id, { role })
      onChanged()
      toast(`${row.name} is now ${role === 'super_admin' ? 'a super admin' : 'a project manager'}`)
    } catch (ex) { toast(ex.message) }
  }
  async function setActive(row, active) {
    if (!active && !confirm(`Pause ${row.name}'s account? They will not be able to sign in until resumed.`)) return
    try {
      await api.patchCoordinator(row.id, { active })
      onChanged()
      toast(active ? 'Account resumed' : 'Account paused')
    } catch (ex) { toast(ex.message) }
  }

  if (!rows.length) {
    return <Empty title="No project managers yet">Accounts appear here as people register.</Empty>
  }

  return (
    <>
      <div className="note" style={{ marginBottom: 16 }}>
        Every project manager who has registered, and what they run. Promote someone to super admin
        to give them this same view over the whole desk; pause an account to stop it signing in.
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr>
            <th>Name</th><th>Role</th><th>Groups</th><th>People</th>
            <th>Registered</th><th>Last login</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {r.name} {r.id === actorId && <span className="tag">you</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{r.email}</div>
                </td>
                <td>
                  <span className="tag" style={r.role === 'super_admin'
                    ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : undefined}>
                    {r.role === 'super_admin' ? 'Super admin' : 'Project manager'}
                  </span>
                  {r.active === false && <span className="tag" style={{ marginLeft: 4 }}>paused</span>}
                </td>
                <td className="num">{r.group_count}</td>
                <td className="num">{r.member_count}</td>
                <td>{fmtDate(r.created_at)}</td>
                <td>{r.last_login ? fmtWhen(r.last_login) : 'never'}</td>
                <td>
                  {r.id !== actorId && (
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn sm ghost"
                              onClick={() => setRole(r, r.role === 'super_admin' ? 'project_manager' : 'super_admin')}>
                        {r.role === 'super_admin' ? 'Demote' : 'Promote'}
                      </button>
                      <button className={'btn sm' + (r.active === false ? '' : ' ghost')}
                              onClick={() => setActive(r, r.active === false)}>
                        {r.active === false ? 'Resume' : 'Pause'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ================================================================= drawers */
function TaskDrawer({ task, members, engagements, onClose, onChanged, toast }) {
  const [t, setT] = useState(task)
  const [comments, setComments] = useState([])
  const [note, setNote] = useState('')
  useEffect(() => { setT(task) }, [task])
  useEffect(() => {
    api.comments(task.id).then(r => setComments(r.comments)).catch(() => {})
  }, [task.id])

  async function save(patch) {
    try {
      const r = await api.patchTask(t.id, patch)
      setT(r.task); onChanged()
    } catch (ex) { toast(ex.message) }
  }
  async function post() {
    if (!note.trim()) return
    try {
      const r = await api.addComment(t.id, note.trim())
      setComments(c => [...c, r.comment]); setNote(''); onChanged()
    } catch (ex) { toast(ex.message) }
  }
  async function del() {
    if (!confirm('Delete this task?')) return
    try { await api.delTask(t.id); onClose(); onChanged() } catch (ex) { toast(ex.message) }
  }

  const mentionIds = (t.mention_people || []).map(p => p.id)

  return (
    <Drawer onClose={onClose}>
      <div className="dr-head">
        <div style={{ minWidth: 0 }}>
          <div className="fileno">
            {t.engagement ? `IAE-${String(t.engagement.seq).padStart(3, '0')} · ${t.engagement.company_name}` : 'No case file'}
          </div>
          <h2>{t.title}</h2>
          <Pill status={t.status} />
          {t.assignee && <span className="pill" style={{ background: 'var(--surface-3)', color: 'var(--text-2)', marginLeft: 5 }}>
            {t.assignee.name}</span>}
        </div>
        <button className="dr-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="dr-body">
        <section>
          <div className="sec-hd">Task<div className="rule" /></div>
          <div className="fgrid">
            <Field label="Title" wide>
              <input className="inp" defaultValue={t.title}
                     onBlur={e => e.target.value !== t.title && save({ title: e.target.value })} />
            </Field>
            <Field label="Detail" wide>
              <textarea className="inp" defaultValue={t.detail}
                        placeholder="What exactly needs doing, and what does done look like?"
                        onBlur={e => e.target.value !== t.detail && save({ detail: e.target.value })} />
            </Field>
            <Field label="Assigned to">
              <select className="inp" value={(t.assignee || {}).id || ''}
                      onChange={e => save({ assignee_id: e.target.value || null })}>
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name} · {m.email}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="inp" value={t.status} onChange={e => save({ status: e.target.value })}>
                {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="inp" value={t.priority} onChange={e => save({ priority: e.target.value })}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Due date">
              <input className="inp" type="date" defaultValue={t.due_date}
                     onChange={e => save({ due_date: e.target.value })} />
            </Field>
            <Field label={`Progress — ${t.progress}%`} wide>
              <input type="range" min="0" max="100" step="5" defaultValue={t.progress}
                     style={{ width: '100%', accentColor: 'var(--accent)' }}
                     onMouseUp={e => save({ progress: Number(e.target.value) })}
                     onTouchEnd={e => save({ progress: Number(e.target.value) })} />
            </Field>
          </div>
        </section>

        <section>
          <div className="sec-hd">Also tagged<div className="rule" /></div>
          <div className="cap" style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 9 }}>
            Tagged people see this task on their own link and can post updates, but the assignee owns it.
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {members.filter(m => m.id !== (t.assignee || {}).id).map(m => {
              const on = mentionIds.includes(m.id)
              return (
                <button key={m.id} className="btn sm" onClick={() => save({
                  mentions: on ? mentionIds.filter(x => x !== m.id) : [...mentionIds, m.id],
                })} style={on ? {
                  background: 'var(--accent-bg)', borderColor: 'var(--accent-line)', color: 'var(--accent)',
                } : undefined}>
                  @{m.email.split('@')[0]}
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <div className="sec-hd">Updates<div className="rule" /></div>
          <div className="log" style={{ marginBottom: 12 }}>
            {comments.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
              No updates yet.</div>}
            {comments.map(c => (
              <div key={c.id} className={'log-item' + (c.kind === 'note' ? ' hi' : '')}>
                <div className="t"><b>{c.author_name}</b> — {c.text}</div>
                <div className="ts">{fmtWhen(c.created_at)}</div>
              </div>
            ))}
          </div>
          <textarea className="inp" value={note} placeholder="Post an update for this task…"
                    onChange={e => setNote(e.target.value)} />
          <button className="btn sm primary" style={{ marginTop: 8 }} onClick={post}>Post update</button>
        </section>

        <div className="row">
          <button className="btn sm danger" onClick={del}>Delete task</button>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Drawer>
  )
}

function EngagementDrawer({ eng, tasks, members, onOpenTask, onClose, onChanged, toast }) {
  const [e, setE] = useState(eng)
  useEffect(() => { setE(eng) }, [eng])

  async function save(patch) {
    try { const r = await api.patchEngagement(e.id, patch); setE(r.engagement); onChanged() }
    catch (ex) { toast(ex.message) }
  }
  async function del() {
    if (!confirm(`Delete ${e.company_name} and its ${tasks.length} task(s)?`)) return
    try { await api.delEngagement(e.id); onClose(); onChanged() } catch (ex) { toast(ex.message) }
  }
  const ip = e.ipooi || {}

  return (
    <Drawer onClose={onClose}>
      <div className="dr-head">
        <div style={{ minWidth: 0 }}>
          <div className="fileno">IAE-{String(e.seq).padStart(3, '0')}{e.theme ? ` · ${e.theme}` : ''}</div>
          <h2>{e.company_name}</h2>
          <Pill status={e.status} />
          <span className="pill" style={{ background: 'var(--surface-3)', color: 'var(--text-2)', marginLeft: 5 }}>
            {e.decision}</span>
        </div>
        <button className="dr-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="dr-body">
        <section>
          <div className="sec-hd">Case file<div className="rule" /></div>
          <div className="fgrid">
            {[['company_name', 'Partner organisation'], ['theme', 'Major theme'],
              ['industry_personnel', 'Key personnel from industry'],
              ['industry_spoc', 'Industry SPOC'], ['university_spoc', 'University SPOC']].map(([k, l]) => (
              <Field key={k} label={l} wide={k === 'industry_personnel'}>
                <input className="inp" defaultValue={e[k]}
                       onBlur={ev => ev.target.value !== e[k] && save({ [k]: ev.target.value })} />
              </Field>
            ))}
            <Field label="Stage">
              <select className="inp" value={e.status} onChange={ev => save({ status: ev.target.value })}>
                {ENGAGEMENT_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Decision">
              <select className="inp" value={e.decision} onChange={ev => save({ decision: ev.target.value })}>
                {DECISIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Start date">
              <input className="inp" type="date" defaultValue={e.start_date}
                     onChange={ev => save({ start_date: ev.target.value })} />
            </Field>
            <Field label="Target date">
              <input className="inp" type="date" defaultValue={e.target_date}
                     onChange={ev => save({ target_date: ev.target.value })} />
            </Field>
            <Field label="Assigned work" wide>
              <textarea className="inp" defaultValue={e.assigned_work}
                        onBlur={ev => ev.target.value !== e.assigned_work && save({ assigned_work: ev.target.value })} />
            </Field>
            <Field label="KPIs" wide>
              <textarea className="inp" defaultValue={e.kpis}
                        onBlur={ev => ev.target.value !== e.kpis && save({ kpis: ev.target.value })} />
            </Field>
          </div>
        </section>

        <section>
          <div className="sec-hd">Input → Impact<div className="rule" /></div>
          <div className="col-stack">
            {STAGES.map(s => {
              const cur = ip[s.k] || { status: 'not-started', text: '' }
              const col = cur.status === 'done' ? 'var(--ok)'
                : cur.status === 'in-progress' ? 'var(--warn)' : 'var(--line-strong)'
              return (
                <div key={s.k} className="card" style={{ padding: '11px 13px' }}>
                  <div className="row">
                    <span className="avatar sm" style={{ background: 'transparent', borderColor: col, color: col }}>
                      {s.sh}</span>
                    <b style={{ fontSize: 13.5 }}>{s.n}</b>
                    <div className="spacer" />
                    <select className="inp" style={{ width: 140, padding: '4px 8px', fontSize: 11.5 }}
                      value={cur.status}
                      onChange={ev => save({ ipooi: { [s.k]: { status: ev.target.value } } })}>
                      <option value="not-started">Not started</option>
                      <option value="in-progress">In progress</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', fontStyle: 'italic', margin: '7px 0 8px' }}>
                    {s.d}</div>
                  <textarea className="inp" style={{ minHeight: 56 }} defaultValue={cur.text}
                    placeholder={`Record the ${s.n.toLowerCase()}…`}
                    onBlur={ev => ev.target.value !== cur.text &&
                      save({ ipooi: { [s.k]: { text: ev.target.value } } })} />
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <div className="sec-hd">Tasks on this file<div className="rule" />
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {tasks.filter(t => t.status === 'Done').length}/{tasks.length} done</span>
          </div>
          <div className="col-stack">
            {tasks.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
              No tasks yet on this case file.</div>}
            {tasks.map(t => (
              <div key={t.id} className="card" style={{ padding: '9px 11px', cursor: 'pointer' }}
                   onClick={() => onOpenTask(t)}>
                <div className="row">
                  <Pill status={t.status} />
                  <b style={{ fontSize: 13, flex: 1 }}>{t.title}</b>
                  {t.assignee && <Avatar sm name={t.assignee.name} />}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="row">
          <button className="btn sm danger" onClick={del}>Delete case file</button>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Drawer>
  )
}

/* ================================================================== modals */
function GroupModal({ onClose, onSaved }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [err, setErr] = useState('')
  async function go() {
    try { const r = await api.createGroup({ name, description }); onSaved(r.group) }
    catch (ex) { setErr(ex.message) }
  }
  return (
    <Modal title="New group" cap="One working circle — a cell, a committee, a project cohort."
      onClose={onClose}
      actions={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={go} disabled={!name.trim()}>Create group</button></>}>
      {err && <div className="err">{err}</div>}
      <div className="col-stack">
        <Field label="Group name">
          <input className="inp" value={name} autoFocus onChange={e => setName(e.target.value)}
                 placeholder="Entrepreneurship & Industry Liaison Cell" />
        </Field>
        <Field label="Description">
          <textarea className="inp" value={description} onChange={e => setDescription(e.target.value)}
                    placeholder="What this group is responsible for" />
        </Field>
      </div>
    </Modal>
  )
}

function MemberModal({ gid, onClose, onSaved, toast }) {
  const [form, setForm] = useState({ name: '', email: '', title: '', role: 'Member' })
  const [err, setErr] = useState('')
  const [link, setLink] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function go() {
    try { const r = await api.addMember(gid, form); setLink(r.member.link) }
    catch (ex) { setErr(ex.message) }
  }
  function copy() {
    navigator.clipboard?.writeText(link).then(() => toast('Link copied'), () => {})
  }

  if (link) {
    return (
      <Modal title={`${form.name} added`}
        cap="This link is shown once. Copy it now and send it to them."
        onClose={() => { onSaved() }}
        actions={<button className="btn primary" onClick={() => onSaved()}>Done</button>}>
        <div className="linkbox" style={{ marginBottom: 12 }}>
          <code>{link}</code>
          <button className="btn sm" onClick={copy}>Copy</button>
        </div>
        <a className="btn sm" target="_blank" rel="noreferrer"
           href={`mailto:${form.email}?subject=${encodeURIComponent('Your task link — Engagement Desk')}&body=${encodeURIComponent(`Hello ${form.name},\n\nHere is your personal link to the Engagement Desk. It opens your assigned tasks directly — no password needed. Please keep it to yourself.\n\n${link}\n\n— Office of Academics`)}`}>
          Open a pre-filled email
        </a>
        <div className="note" style={{ marginTop: 14 }}>
          If it is ever shared by mistake, use <b>New link</b> on the People list — the old one
          stops working straight away.
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Add a person" cap="They sign in with the link — no password, no account to create."
      onClose={onClose}
      actions={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={go}
                disabled={!form.name.trim() || !form.email.trim()}>Add &amp; make link</button></>}>
      {err && <div className="err">{err}</div>}
      <div className="fgrid">
        <Field label="Full name">
          <input className="inp" autoFocus value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Email address">
          <input className="inp" type="email" value={form.email}
                 onChange={e => set('email', e.target.value)} placeholder="name@jainuniversity.ac.in" />
        </Field>
        <Field label="Designation">
          <input className="inp" value={form.title} onChange={e => set('title', e.target.value)}
                 placeholder="Assistant Professor, SoCS" />
        </Field>
        <Field label="Role in group">
          <select className="inp" value={form.role} onChange={e => set('role', e.target.value)}>
            {['Coordinator', 'Faculty SPOC', 'Student lead', 'Student', 'Member'].map(r =>
              <option key={r}>{r}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

function EngagementModal({ gid, onClose, onSaved }) {
  const [f, setF] = useState({
    company_name: '', theme: '', industry_personnel: '', industry_spoc: '',
    university_spoc: '', status: 'Prospect', decision: 'Under Discussion',
    start_date: new Date().toISOString().slice(0, 10), target_date: '',
  })
  const [err, setErr] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  async function go() {
    try { await api.addEngagement(gid, f); onSaved() } catch (ex) { setErr(ex.message) }
  }
  return (
    <Modal title="New case file" cap="One industry engagement. Tasks are created against it."
      onClose={onClose}
      actions={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={go} disabled={!f.company_name.trim()}>Create</button></>}>
      {err && <div className="err">{err}</div>}
      <div className="fgrid">
        <Field label="Partner organisation">
          <input className="inp" autoFocus value={f.company_name}
                 onChange={e => set('company_name', e.target.value)} />
        </Field>
        <Field label="Major theme">
          <input className="inp" value={f.theme} onChange={e => set('theme', e.target.value)}
                 placeholder="AgriTech, FinTech…" />
        </Field>
        <Field label="Industry SPOC">
          <input className="inp" value={f.industry_spoc} onChange={e => set('industry_spoc', e.target.value)} />
        </Field>
        <Field label="University SPOC">
          <input className="inp" value={f.university_spoc} onChange={e => set('university_spoc', e.target.value)} />
        </Field>
        <Field label="Stage">
          <select className="inp" value={f.status} onChange={e => set('status', e.target.value)}>
            {ENGAGEMENT_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Decision">
          <select className="inp" value={f.decision} onChange={e => set('decision', e.target.value)}>
            {DECISIONS.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Start date">
          <input className="inp" type="date" value={f.start_date}
                 onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="Target date">
          <input className="inp" type="date" value={f.target_date}
                 onChange={e => set('target_date', e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function TaskModal({ engagements, members, onClose, onSaved }) {
  const [f, setF] = useState({
    engagement_id: engagements[0]?.id || '', title: '', detail: '', assignee_id: '',
    status: 'To do', priority: 'Normal', due_date: '', mentions: [],
  })
  const [err, setErr] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  async function go() {
    try {
      const { engagement_id, ...rest } = f
      await api.addTask(engagement_id, rest); onSaved()
    } catch (ex) { setErr(ex.message) }
  }
  if (!engagements.length) {
    return (
      <Modal title="Create a case file first"
        cap="Tasks belong to an engagement, so there needs to be one to hang them on."
        onClose={onClose} actions={<button className="btn primary" onClick={onClose}>Got it</button>} />
    )
  }
  return (
    <Modal title="New task" cap="Assign it to one person; tag anyone else who needs to see it."
      onClose={onClose}
      actions={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={go} disabled={!f.title.trim()}>Create task</button></>}>
      {err && <div className="err">{err}</div>}
      <div className="fgrid">
        <Field label="Case file" wide>
          <select className="inp" value={f.engagement_id} onChange={e => set('engagement_id', e.target.value)}>
            {engagements.map(e => <option key={e.id} value={e.id}>
              IAE-{String(e.seq).padStart(3, '0')} · {e.company_name}</option>)}
          </select>
        </Field>
        <Field label="Title" wide>
          <input className="inp" autoFocus value={f.title} onChange={e => set('title', e.target.value)}
                 placeholder="Map the 40 collection centres" />
        </Field>
        <Field label="Detail" wide>
          <textarea className="inp" value={f.detail} onChange={e => set('detail', e.target.value)}
                    placeholder="What done looks like" />
        </Field>
        <Field label="Assign to">
          <select className="inp" value={f.assignee_id} onChange={e => set('assignee_id', e.target.value)}>
            <option value="">Unassigned</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name} · {m.email}</option>)}
          </select>
        </Field>
        <Field label="Due date">
          <input className="inp" type="date" value={f.due_date} onChange={e => set('due_date', e.target.value)} />
        </Field>
        <Field label="Priority">
          <select className="inp" value={f.priority} onChange={e => set('priority', e.target.value)}>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="inp" value={f.status} onChange={e => set('status', e.target.value)}>
            {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Also tag (they will see it too)" wide>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {members.filter(m => m.id !== f.assignee_id).map(m => {
              const on = f.mentions.includes(m.id)
              return (
                <button key={m.id} type="button" className="btn sm"
                  onClick={() => set('mentions', on ? f.mentions.filter(x => x !== m.id)
                    : [...f.mentions, m.id])}
                  style={on ? { background: 'var(--accent-bg)', borderColor: 'var(--accent-line)', color: 'var(--accent)' } : undefined}>
                  @{m.email.split('@')[0]}
                </button>
              )
            })}
          </div>
        </Field>
      </div>
    </Modal>
  )
}
