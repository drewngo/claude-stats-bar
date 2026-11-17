# stats-bar

A one-line bar above the Claude Code prompt showing your usage:

```
5h 12% (3h05m) · wk 30% (4d2h) · session $1.20 1.1M · 7d $40.50 60.2M · 30d $150 380.0M · all $410 2.10B
```

- **5h / wk**: your plan's session and weekly limit usage, with time until reset.
- **session / 7d / 30d / all**: cost and total tokens. Tokens are summed from your local transcripts in `~/.claude/projects` the same way `/stats` counts them. Session cost is Claude Code's own `/cost` figure; the other costs are estimates at API list price.

It refreshes after every turn and once a minute. Type `/stats-bar` to hide or show it. Requires `python3` on your PATH.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install stats-bar --marketplace drewngo/claude-stats-bar
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install stats-bar --marketplace drewngo/claude-stats-bar
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `drewngo/claude-stats-bar`, then Add plugin.
