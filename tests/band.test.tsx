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
