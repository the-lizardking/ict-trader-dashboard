# AI Traders Models Roadmap — dashboard pointer

> **Source of truth:** [`benbaichmankass/ict-trading-bot` → `docs/AI-TRADERS-ROADMAP.md`](https://github.com/benbaichmankass/ict-trading-bot/blob/main/docs/AI-TRADERS-ROADMAP.md)
>
> The master AI traders models roadmap and its sprint plans live in the
> trading-bot repo. The bot owns the AI/ML lifecycle (datasets, training,
> model registry, deployment tiers); the dashboard is a pure consumer of
> the data feeds and surfaces those results read-only.

## What lives where

| Artifact | Repo | Path |
|---|---|---|
| Master plan | `ict-trading-bot` | `docs/AI-TRADERS-ROADMAP.md` |
| Workstream sprint plans (WS1–WS10) | `ict-trading-bot` | `docs/sprint-plans/ai-traders/` |
| Roadmap milestone rows (M9 + M10) | `ict-trading-bot` | `ROADMAP.md` |
| Architecture doc (target) | `ict-trading-bot` | `docs/architecture/ai-model-platform.md` (created in WS1) |

## Dashboard repo scope

This repo (`ict-trader-dashboard`) **does not own** any part of the AI
lifecycle. It is the read-only Vercel SPA. When M9 / M10 surfaces require
dashboard work — for example a model registry tab, drift charts, or a
shadow-mode score panel — those will arrive as separate dashboard
sprints that consume Tier-1 endpoints published by the bot.

The bot-side sprint plan WS7 (deployment tiers) is the most likely
trigger for dashboard work. WS8 (monitoring + feedback loops) is the
second most likely.

## Non-negotiable rules (apply to dashboard surfaces too)

When the dashboard eventually renders model status / influence, it must
respect the same rules the bot owns:

- Display only what the bot publishes; never call training / promotion
  endpoints from the SPA.
- Never imply a model is influencing live trading unless its registry
  status is `live-approved`.
- Treat all model output as advisory in the UI until the operator
  explicitly opts the displayed model into live influence.

See the upstream master plan for the full set.
