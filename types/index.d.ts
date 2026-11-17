export type Window = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  requests: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Totals = {
  session: Window
  '7d': Window
  '30d': Window
  all: Window
}

declare module 'claude-code' {
  interface PluginState {
    'stats-bar': { totals: Shaped<Totals | null>; sessionUsd: number | null; limits: Shaped<Limit[]>; isHidden: boolean; lastError: string | null }
  }
}
