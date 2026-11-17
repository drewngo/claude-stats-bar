import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Totals, Window } from '../types'

const totals = atom({ plugin: 'stats-bar', key: 'totals' } as const, null, {
  shape: 'totals-1',
})
const sessionUsd = atom({ plugin: 'stats-bar', key: 'sessionUsd' } as const, null)
const limits = atom({ plugin: 'stats-bar', key: 'limits' } as const, [], {
  shape: 'limits-1',
})
const isHidden = atom({ plugin: 'stats-bar', key: 'isHidden' } as const, false)
const lastError = atom({ plugin: 'stats-bar', key: 'lastError' } as const, null)

const ROWS: [keyof Totals, string][] = [
  ['session', 'session'],
  ['7d', '7d'],
  ['30d', '30d'],
  ['all', 'all'],
]

const tokens = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B`
  : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k`
  : `${n}`

const usd = (n: number) => `$${n >= 100 ? n.toFixed(0) : n.toFixed(2)}`

const total = (w: Window) => w.input + w.output + w.cacheRead + w.cacheWrite

type Segment = { text: string; isDim: boolean; color?: string }

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'wk',
}

const segment = (label: string, w: Window, cost: number) =>
  `${label} ${usd(cost)} ${tokens(total(w))}`

const until = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  return days > 0 ? `${days}d${hours}h` : `${hours}h${minutes % 60}m`
}

const limitSegment = (limit: Limit, now: number): Segment => ({
  text:
    `${LIMIT_LABELS[limit.kind] ?? limit.kind} ${limit.percentUsed}%` +
    (limit.resetsAt ? ` (${until(limit.resetsAt, now)})` : ''),
  isDim: false,
  color: limit.percentUsed >= 90 ? 'red' : limit.percentUsed >= 75 ? 'yellow' : 'green',
})

const SEP = ' · '

let isRefreshing = false

async function refresh($: EngineInterface) {
  if (isRefreshing) {
    return
  }
  isRefreshing = true
  try {
    const home = await $.env.get('HOME')
    const id = await $.session.id()
    const { exitCode, stdout, stderr } = await $.process.run([
      'python3',
      '-I',
      `${$.plugin.root}/scripts/usage.py`,
      id,
      `${home}/.claude/stats-bar-cache.json`,
    ], { timeoutMs: 120_000 })
    if (exitCode !== 0) {
      throw new Error(`usage.py exited ${exitCode}: ${stderr.trim().split('\n').pop()}`)
    }
    const parsed: Totals = JSON.parse(stdout)
    await update($, totals, () => parsed)
    await update($, lastError, () => null)
    const { cost } = await $.session.usage()
    await update($, sessionUsd, () => cost?.usd ?? null)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    $.ui.log(`stats-bar refresh failed: ${message}`, { to: 'debug' })
    await update($, lastError, () => message)
  } finally {
    isRefreshing = false
  }
}

// The engine has no rate-limit reading until the session's first API response,
// so the last one is kept across sessions and shown until a fresh one arrives.
async function storeLimits($: EngineInterface, rateLimits: Limit[]) {
  const shown = rateLimits
    .filter(r => r.kind in LIMIT_LABELS)
    .map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
  if (shown.length === 0) {
    return
  }
  await update($, limits, () => shown)
  await $.store.set('limits', shown)
}

async function restoreLimits($: EngineInterface) {
  if ((await read($, limits)).length > 0) {
    return
  }
  const saved = await $.store.get('limits')
  if (!Array.isArray(saved)) {
    return
  }
  const now = await $.clock.now()
  // A window that has reset since the reading no longer has that usage.
  const live = (saved as Limit[]).filter(l => !l.resetsAt || Date.parse(l.resetsAt) > now)
  await update($, limits, () => live)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'stats-bar',
      description: 'Show or hide the stats bar above the prompt',
    })
    await restoreLimits($)
    void refresh($)
    $.clock.every(60_000, () => void refresh($))

    return started
  })

  on('session.measure', async ($, e, next) => {
    await storeLimits($, e.rateLimits)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refresh($)

    return done
  })

  on('command.run', { command: 'stats-bar' }, async $ => {
    const hidden = await update($, isHidden, was => !was)
    if (!hidden) {
      void refresh($)
    }

    return { text: hidden ? 'Stats bar hidden.' : 'Stats bar shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const data = await read($, totals)
    const error = await read($, lastError)
    if (data === null) {
      return (
        <Box>
          <Text dimColor wrap="truncate-end">
            {error ? `stats-bar: ${error}` : 'stats-bar: loading…'}
          </Text>
        </Box>
      )
    }
    const live = await read($, sessionUsd)
    // The engine's ledger is exact for this session; the rest are list-price estimates.
    const costOf = (key: keyof Totals) =>
      key === 'session' && live !== null ? live : data[key].cost
    const now = await $.clock.now()
    const segments: Segment[] = [
      ...(await read($, limits)).map(limit => limitSegment(limit, now)),
      ...ROWS.map(([key, label]) => ({
        text: segment(label, data[key], costOf(key)),
        isDim: key !== 'session',
      })),
    ]

    // Always one line: whatever doesn't fit is cut at the right edge.
    return (
      <Box>
        <Text wrap="truncate-end">
          {segments.map((s, n) => (
            <Text dimColor={s.isDim}>
              {n > 0 ? SEP : ''}
              <Text color={s.color} dimColor={s.isDim}>{s.text}</Text>
            </Text>
          ))}
        </Text>
      </Box>
    )
  })
}
