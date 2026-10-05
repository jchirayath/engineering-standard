// semgrep --test fixture for web.yml
// ruleid: std.web.icons-direct
import { Trash2 } from 'lucide-react'
// ruleid: std.web.icons-direct
import { TrashIcon } from '@heroicons/react/24/outline'
// ok: std.web.icons-direct
import { Icon } from '@/design/build/ts/icons'

export function Row({ user, logger, db, id }: any) {
  // ruleid: std.web.raw-color
  const style = { color: '#ff0000' }
  // ruleid: std.web.raw-color
  const bg = { background: 'rgba(0, 0, 0, 0.5)' }
  // ok: std.web.raw-color
  const tok = { color: 'var(--color-status-danger)' }
  // ok: std.web.raw-color
  const anchor = <a href="#add">Add</a>

  // ruleid: std.web.console
  console.log('row', id)
  // ok: std.web.console
  logger.info('row.render', { id })
  // ruleid: std.web.secret-in-log
  logger.info('login', { pw: user.password })

  // ruleid: std.web.process-env
  const url = process.env.API_URL
  // ruleid: std.web.raw-http
  fetch('/api/things')
  // ok: std.web.raw-http
  api.get('/things')

  // ruleid: std.web.eval
  eval(code)
  // ruleid: std.web.sql-template
  db.query(`select * from users where id = ${id}`)
  // ok: std.web.sql-template
  db.query('select * from users where id = $1', [id])
  // ruleid: std.web.token-in-localstorage
  localStorage.setItem('access_token', t)
  // ok: std.web.token-in-localstorage
  localStorage.setItem('theme', 'dark')

  // ruleid: std.web.empty-catch
  try {
    work()
  } catch (e) {}
  // ok: std.web.empty-catch
  try {
    work()
  } catch (e) { logger.error('work.failed', { e }) }

  // ruleid: std.web.tailwind-palette
  const c1 = "bg-red-500 p-2"
  // ruleid: std.web.tailwind-palette
  const c2 = "hover:text-gray-700/50"
  // ruleid: std.web.tailwind-palette
  const c3 = "bg-[#123456]"
  // ok: std.web.tailwind-palette
  const c4 = "bg-status-danger text-status-on-danger"
  // ok: std.web.icons-direct
  const i = <Icon name="action.delete" />
  // ruleid: std.web.dangerous-html
  const h = <div dangerouslySetInnerHTML={{ __html: html }} />
  return <span className={c4}>{i}{h}</span>

}

export function pitfalls(req: any, res: any, fs: any, crypto: any, password: string) {
  // ruleid: std.web.insecure-random
  const resetToken = Math.random().toString(36)
  // ok: std.web.insecure-random
  const jitter = Math.random() * 100
  // ruleid: std.web.weak-password-hash
  const h = crypto.createHash('sha256').update(salt + password)
  // ok: std.web.weak-password-hash
  const etag = crypto.createHash('sha256').update(body)
  // ruleid: std.web.jwt-decode-unverified
  const claims = jwt.decode(token)
  // ok: std.web.jwt-decode-unverified
  const ok = jwt.verify(token, key, { algorithms: ['RS256'], issuer, audience })
  // ruleid: std.web.open-redirect
  res.redirect(req.query.next)
  // ok: std.web.open-redirect
  res.redirect(safeNext(req.query.next) ? '/home' : '/')
  // ruleid: std.web.path-from-request
  fs.readFile('/data/' + req.params.name, cb)
}

