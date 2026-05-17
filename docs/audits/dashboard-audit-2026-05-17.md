# ICT Trader Dashboard — Structural Audit
**Date:** 2026-05-17  
**Scope:** `benbaichmankass/ict-trader-dashboard` — full structural review of the operator dashboard as a consumer of the trading pipeline  
**Companion audit:** `benbaichmankass/ict-trading-bot` PR #1356 — `docs/audits/full-pipeline-structural-audit-2026-05-17.md`

---

## 1. Executive Summary

The dashboard repo is a read-only observability layer over the bot's REST API. The core risk here is not execution safety (the dashboard never writes to the bot) but **observability fidelity**: if the dashboard lies or silently fails, the operator may trade on stale or wrong data without knowing it.

Four issues dominate:

1. **Dual API implementation** (`api/widget.py` Python + `functions/api/*.js` JavaScript) with no indication which is actually serving — one is dead code.
2. **Mock-to-live schema mismatch** — `mock_bot_api.py` returns different field names than `api/widget.py` expects. The widget health dots (`execution`, `training`) are silently broken in any staging or CI environment that uses the mock.
3. **Hardcoded production IP** as the default fallback in `api/widget.py` — any deploy without `BOT_API_URL` set hits the live VM directly, bypassing the intended Cloudflare tunnel.
4. **Mock strategy names don't match real strategy names** — the mock surfaces "ICT SMC v2" and "VWAP Reversion" while the bot runs `turtle_soup`, `vwap`, and `ict_scalp_5m`. No UI test exercises real bot output; all integration testing is against fictional data.

`streamlit_app.py` at 51 KB is monolithic but functional and lower priority than the schema issues.

---

## 2. Architecture Map

```
Operator browser / phone
        │
        ├── Vercel (vercel.json)
        │     ├── / → /static/pwa/index.html       (PWA)
        │     ├── /api/widget.json → api/widget.py  (Python serverless)
        │     └── functions/api/widget.js           (JS — purpose unclear)
        │
        └── Streamlit (streamlit_app.py, 51 KB)
              └── HTTP → BOT_API_URL (default: 158.178.210.252:8001)
                              │
                              └── ict-trading-bot web API (src/web/)
```

**Dev mode:** `mock_bot_api.py` (root, 18 KB, stdlib `http.server`) replaces the bot API at `localhost:8001`.

---

## 3. Findings by Severity

### 3.1 CRITICAL

#### C-DASH-01 — Mock health schema mismatches widget consumer

**File:** `mock_bot_api.py:177`, `api/widget.py:45`

`_service_up()` in `api/widget.py` reads `svc.get("active_state") or svc.get("state")` to determine if a service is alive. The mock returns:

```python
# mock_bot_api.py — /api/bot/health/services
{"name": "ict-web-api", "status": "active", "uptime": "45 days"},
```

The key is `"status"`, not `"active_state"` or `"state"`. Result: `_service_up()` always returns `False` against the mock, so the `execution` and `training` health dots are always shown as red/down in any environment running against the mock.

**Impact:** Every staging test, CI run, or local development session shows broken health dots. The operator has no way to validate that health reporting works without hitting the live VM.

**Patch:** Add `"status"` to the fallback chain in `_service_up()`:
```python
state = (svc.get("active_state") or svc.get("state") or svc.get("status") or "").lower()
```
Or align the mock to the live API contract. The live API should be the source of truth.

---

### 3.2 HIGH

#### H-DASH-01 — Duplicate API implementation (Python vs JS)

**Files:** `api/widget.py` (Python FastAPI, 4.2 KB), `functions/api/widget.js` + `functions/api/widget.json.js` (JS, 113 bytes each), `functions/api/_widget-shared.js` (3.1 KB)

`vercel.json` routes `/api/widget.json` → `/api/widget` (the Python function). The JS files in `functions/api/` implement the same endpoint. Vercel's routing means only one can actually respond. The JS files appear to be residue from a prior Cloudflare Pages or Netlify deployment.

**Risk:** Dead code that will confuse future developers; changes to the widget payload require updating two implementations if the JS path were ever inadvertently re-enabled.

**Action:** Confirm which runtime is live (check Vercel deployment logs). Delete the unused implementation.

---

#### H-DASH-02 — Hardcoded production IP as default

**File:** `api/widget.py:22`

```python
BOT_API = os.environ.get("BOT_API_URL", "http://158.178.210.252:8001")
```

The production VM IP is baked in as the fallback. Any Vercel preview deployment without `BOT_API_URL` set will route directly to the live VM over plain HTTP, bypassing the Cloudflare tunnel. This:

- Exposes the VM's direct IP to Vercel's edge network
- Bypasses any Cloudflare access rules
- Fails if the VM IP changes without a code deploy

**Patch:** Remove the hardcoded fallback. Let the function fail loudly if `BOT_API_URL` is not set:
```python
BOT_API = os.environ["BOT_API_URL"]  # fail fast, don't silently hit production
```
Set `BOT_API_URL` as a Vercel environment variable (already presumably done for production; the issue is preview environments inheriting a wrong default).

---

#### H-DASH-03 — Mock strategy names don't match real strategy names

**File:** `mock_bot_api.py:145`

Mock returns:
```python
{"name": "ICT SMC v2", "enabled": True, ...}
{"name": "VWAP Reversion", "enabled": False, ...}
```

Real bot strategies (from `config/strategies.yaml` in the bot repo):
- `turtle_soup` — 15m MTF sweep-reversal, active
- `vwap` — 5m mean-reversion, active  
- `ict_scalp_5m` — 5m FVG/liquidity, effectively disabled

The mock simulates a completely different system. Any dashboard UI that renders strategy names, filters by name, or uses strategy identity for routing will produce correct-looking but meaningless output during local development.

**Action:** Update mock strategy payloads to match the real bot's strategy names and state.

---

#### H-DASH-04 — `mock_bot_api.py` at repo root

**File:** `mock_bot_api.py` (18 KB, repo root)

A development-only file is at the repository root alongside `vercel.json`, `streamlit_app.py`, and `requirements.txt`. It uses Python stdlib `http.server` rather than FastAPI/Starlette, so it diverges from the actual bot API server (which uses FastAPI with Pydantic response models).

This is a repository hygiene issue that compounds the schema mismatch risk: the mock's stdlib implementation will never catch serialization differences that FastAPI/Pydantic enforce.

**Action:** Move to `scripts/mock_bot_api.py` or `dev/mock_bot_api.py`. Add a Makefile/justfile target.

---

### 3.3 MEDIUM

#### M-DASH-01 — Mock health service names don't match real services

**File:** `mock_bot_api.py:177`

Mock returns: `ict-web-api`, `redis`, `postgres`, `nginx`  
Real services (from `deploy/` in bot repo): `ict-trader-live.service`, `ict-web-api.service`, `ict-trainer.service`, `ict-claude-bridge.service`, `ict-git-sync.service`, `ict-heartbeat.service`, etc.

The mock includes `redis`, `postgres`, and `nginx` — none of which are deployed. The real system uses SQLite (not postgres/redis). The widget's `_EXEC_HINTS` and `_TRAIN_HINTS` matching logic would never match these mock names anyway (see C-DASH-01).

**Action:** Update mock to return real systemd unit names with `active_state` field.

---

#### M-DASH-02 — Mock ML build errors reflect unfixed production bugs

**File:** `mock_bot_api.py:248`

The mock's `/api/bot/ml/builds` response contains real production error traces frozen as the "simulated state":

```python
"stderr_tail": "if risk_pct <= 0: TypeError: '<=' not supported between instances of 'str' and 'int'"
"stderr_tail": "if not comms_root.is_dir(): AttributeError: 'str' object has no attribute 'is_dir'"
"stderr_tail": "DatasetBuilder.build() got multiple values for keyword argument 'timeframe'"
```

These bugs remain unfixed in the bot repo's ML dataset builder. The mock accurately reflects the broken training pipeline.

**Cross-reference:** Bot audit §4.3 (shadow model infrastructure). These bugs block the ML training pipeline from ever completing a successful cycle.

---

#### M-DASH-03 — Mock pulls wrong DB path

**File:** `mock_bot_api.py:306`

```python
"src": "ubuntu@158.178.210.252:/home/ubuntu/ict-trading-bot/trade_journal.db"
```

The active DB is at `/data/bot-data/trade_journal.db` (confirmed in bot repo PR #974 health review). The mock perpetuates the wrong path. Any dashboard UI displaying DB source path shows incorrect information.

---

#### M-DASH-04 — `streamlit_app.py` is a 51 KB monolith

**File:** `streamlit_app.py` (51 KB)

All dashboard pages, data fetching, chart rendering, and state management are in one file. Not a safety risk but reduces maintainability. The `claude/dashboard-code-split-2tvH5` branch exists, suggesting this was already planned.

**Action:** Defer until schema/mock issues above are resolved. Resume the code-split branch.

---

#### M-DASH-05 — `_redirects` file alongside `vercel.json`

**File:** `_redirects` (475 bytes)

`_redirects` is a Netlify/Cloudflare Pages routing file. It coexists with `vercel.json`. Since the deployment target is Vercel, `_redirects` is likely dead config from a prior platform migration.

**Action:** Delete if Netlify/CF Pages is not deployed in parallel.

---

### 3.4 LOW

#### L-DASH-01 — No API contract document

**File:** `docs/` (contains only `AI-TRADERS-ROADMAP.md`)

The dashboard consumes ~12 bot API endpoints. None have a documented contract (expected fields, types, null handling). The mock and widget diverge silently because there is no reference spec.

**Action:** Create `docs/api-contract.md` from the live API schema. This is the root cause of C-DASH-01 and H-DASH-03.

---

#### L-DASH-02 — `requirements.txt` omits `fastapi`

**File:** `requirements.txt`

```
streamlit
requests
```

`api/widget.py` imports `fastapi`, but `fastapi` is absent from the root `requirements.txt`. Vercel installs from `api/requirements.txt` (which presumably has it), but a fresh local `pip install -r requirements.txt && python api/widget.py` will fail with `ModuleNotFoundError`.

---

## 4. Mock-to-Live Schema Comparison

| Endpoint | Mock field | Widget consumer reads | Match? |
|---|---|---|---|
| `/api/bot/health/services` | `status` | `active_state` or `state` | **NO** |
| `/api/bot/strategies` | `name: "ICT SMC v2"` | matches any string | Schema OK, data wrong |
| `/api/bot/trades/closed` | `closedAt` / `closeTime` | both supported | Yes |
| `/api/bot/stats` | `pnl24h`, `totalPnL`, `status` | same | Yes |

---

## 5. Repository Hygiene

| Item | Status |
|---|---|
| Dev mock at repo root | `mock_bot_api.py` — should move to `scripts/` |
| Duplicate routing config | `_redirects` + `vercel.json` — one is dead |
| Dead API implementation | `functions/api/` JS vs `api/widget.py` Python |
| Test coverage | No tests visible for dashboard components |
| CI | `claude/vitest-contract-suite` branch exists — status unknown |

---

## 6. Recommended Workplan

### Sprint DA (no dependencies — start immediately)
- **DA-1:** Fix `_service_up()` to accept `"status"` key (C-DASH-01) — 15 min
- **DA-2:** Remove hardcoded IP fallback in `api/widget.py` (H-DASH-02) — 5 min
- **DA-3:** Confirm which API implementation is live (H-DASH-01) — check Vercel deployment logs

### Sprint DB (depends on DA-3 result)
- **DB-1:** Delete the dead API implementation (Python or JS)
- **DB-2:** Delete `_redirects` if Netlify/CF Pages not in use
- **DB-3:** Update mock strategy names to match real bot strategies (H-DASH-03)
- **DB-4:** Update mock health service names and `active_state` field (M-DASH-01)

### Sprint DC (after DB)
- **DC-1:** Move `mock_bot_api.py` to `scripts/` (H-DASH-04)
- **DC-2:** Write `docs/api-contract.md` from live API schema (L-DASH-01)
- **DC-3:** Fix ML dataset builder bugs in bot repo (M-DASH-02)

### Sprint DD (maintenance)
- **DD-1:** Code-split `streamlit_app.py` (M-DASH-04) — resume `claude/dashboard-code-split-2tvH5`
- **DD-2:** Add contract tests against mock — resume `claude/vitest-contract-suite`

---

## 7. Risks and Unknowns

| Risk | Likelihood | Impact |
|---|---|---|
| Vercel preview env hitting live VM directly (H-DASH-02) | High — no `BOT_API_URL` on preview | Medium — operator data in preview builds |
| Operator trusts mock-based staging test (C-DASH-01) | High — health always red in mock | Medium — missed real health regression |
| JS edge functions activated by routing change | Low | High — two widget implementations race |
| `streamlit_app.py` API field assumption breaks on bot update | Medium | Medium — silent empty panels |

---

## 8. Open Questions

1. Is `functions/api/` (JS) ever deployed, or safe to delete?
2. Is Cloudflare Pages deployed in parallel with Vercel (explaining `_redirects`)?
3. What is `BOT_API_URL` set to on Vercel production — Cloudflare tunnel URL or direct IP?
4. Is `claude/vitest-contract-suite` branch ready to merge, or blocked on schema issues?
5. Does the dashboard alert the operator if the bot API is unreachable (vs. silently showing stale data)?

---

*Generated as part of full-pipeline structural audit. See bot repo PR #1356 for execution-side findings.*
