import { expect, test } from 'claude-code/testing'

const W = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5, requests: 1 }
const TOTALS = { session: W, '7d': W, '30d': W, all: W }
const LIMITS = [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2030-01-01T00:00:00Z' }]

const BAND = {
  plugin: 'stats-bar',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 200,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the band draws stored totals and limits', async ($, on) => {
  on('state.get', (_, e) => {
    const key = (e as { key: string }).key
    const value =
      key === 'totals' ? { shape: 'totals-1', value: TOTALS }
      : key === 'limits' ? { shape: 'limits-1', value: LIMITS }
      : key === 'sessionUsd' ? 0.98
      : key === 'lastError' ? null
      : false
    return { value: { value, version: 1 } }
  })

  on('clock.now', () => ({ value: Date.parse('2029-12-31T22:00:00Z') }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const line = await ui.find({ type: 'Text', text: /session/ })
    expect(line?.text).toContain('5h 23%')
    expect(line?.text).toContain('session $0.98')
    await ui.unmount()
  }
})

// Stands for the engine beneath a session: usage.py answers TOTALS.
function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  on('command.register', () => ({ value: { command: 'stats-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: Date.parse('2029-12-31T22:00:00Z') }))
  on('env.get', () => ({ value: '/home' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(TOTALS), stderr: '' } }))
}

async function bandText($: Parameters<Parameters<typeof test>[1]>[0]) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await new Promise(r => setTimeout(r, 0))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = (await ui.find({ type: 'Text', text: /session/ }))?.text
  await ui.unmount()
  return text
}

test('a measurement keeps the plan limits and saves them', async ($, on) => {
  engine(on)
  const saved: unknown[] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => (saved.push((e as { value: unknown }).value), { value: undefined }))

  const measure = (rateLimits: unknown[]) =>
    $.session.measure({ context: {} as never, rateLimits: rateLimits as never, changed: ['rateLimits'] })
  await measure([...LIMITS, { kind: 'spend_limit', percentUsed: 5 }])
  // A later reading with no windows leaves the last one shown.
  await measure([])

  expect(await bandText($)).toContain('5h 23%')
  expect(saved).toEqual([LIMITS])
})

test('a new session shows the saved limits until they reset', async ($, on) => {
  engine(on)
  on('store.get', () => ({
    value: [...LIMITS, { kind: 'seven_day', percentUsed: 40, resetsAt: '2029-12-30T00:00:00Z' }],
  }))

  const text = await bandText($)
  expect(text).toContain('5h 23%')
  expect(text).not.toContain('wk')
})
