const BASE = '/api'

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  get:   p => call('GET', p),
  post:  (p, b) => call('POST', p, b || {}),
  patch: (p, b) => call('PATCH', p, b || {}),
  del:   p => call('DELETE', p),

  // auth
  me:       () => call('GET', '/auth/me'),
  login:    (email, password) => call('POST', '/auth/login', { email, password }),
  register: (name, email, password) => call('POST', '/auth/register', { name, email, password }),
  join:     token => call('POST', '/auth/join', { token }),
  logout:   () => call('POST', '/auth/logout'),

  // groups
  groups:      () => call('GET', '/groups'),
  createGroup: b => call('POST', '/groups', b),
  patchGroup:  (id, b) => call('PATCH', `/groups/${id}`, b),
  deleteGroup: id => call('DELETE', `/groups/${id}`),

  // members
  members:    gid => call('GET', `/groups/${gid}/members`),
  addMember:  (gid, b) => call('POST', `/groups/${gid}/members`, b),
  patchMember:(id, b) => call('PATCH', `/members/${id}`, b),
  delMember:  id => call('DELETE', `/members/${id}`),
  rotateLink: id => call('POST', `/members/${id}/rotate`, {}),

  // engagements
  engagements:   gid => call('GET', `/groups/${gid}/engagements`),
  addEngagement: (gid, b) => call('POST', `/groups/${gid}/engagements`, b),
  patchEngagement:(id, b) => call('PATCH', `/engagements/${id}`, b),
  delEngagement: id => call('DELETE', `/engagements/${id}`),

  // tasks
  tasks:     (gid, q = '') => call('GET', `/groups/${gid}/tasks${q}`),
  addTask:   (eid, b) => call('POST', `/engagements/${eid}/tasks`, b),
  patchTask: (id, b) => call('PATCH', `/tasks/${id}`, b),
  delTask:   id => call('DELETE', `/tasks/${id}`),

  comments:  tid => call('GET', `/tasks/${tid}/comments`),
  addComment:(tid, text) => call('POST', `/tasks/${tid}/comments`, { text }),

  activity:  gid => call('GET', `/groups/${gid}/activity`),
  myBoard:   () => call('GET', '/me/board'),
}

export const TASK_STATUSES = ['To do', 'In progress', 'Blocked', 'In review', 'Done']
export const ENGAGEMENT_STATUSES = ['Prospect', 'Scoping', 'Active', 'On Hold', 'Completed', 'Discontinued']
export const DECISIONS = ['Under Discussion', 'Pending Approval', 'Approved', 'Pivoted', 'Rejected']
export const PRIORITIES = ['Low', 'Normal', 'High']
export const STAGES = [
  { k: 'input',   n: 'Input',   sh: 'IN', d: 'Briefs, data and problem statements the team receives to begin.' },
  { k: 'process', n: 'Process', sh: 'PR', d: 'Methods, research and iterations the team runs.' },
  { k: 'output',  n: 'Output',  sh: 'OU', d: 'The tangible deliverable — prototype, report, tool, pilot.' },
  { k: 'outcome', n: 'Outcome', sh: 'OC', d: 'The measurable change the output produced for the partner.' },
  { k: 'impact',  n: 'Impact',  sh: 'IM', d: 'Longer-term value for the company, the university, or the founder.' },
]

export const STATUS_COLOR = {
  'To do':       ['var(--muted)', 'var(--muted-bg)'],
  'In progress': ['var(--info)',  'var(--info-bg)'],
  'Blocked':     ['var(--bad)',   'var(--bad-bg)'],
  'In review':   ['var(--warn)',  'var(--warn-bg)'],
  'Done':        ['var(--ok)',    'var(--ok-bg)'],
  'Prospect':    ['var(--info)',  'var(--info-bg)'],
  'Scoping':     ['var(--accent)','var(--accent-bg)'],
  'Active':      ['var(--ok)',    'var(--ok-bg)'],
  'On Hold':     ['var(--warn)',  'var(--warn-bg)'],
  'Completed':   ['var(--muted)', 'var(--muted-bg)'],
  'Discontinued':['var(--muted)', 'var(--muted-bg)'],
}
