"""Mock FastAPI server for local dashboard development.

Run with: python mock_bot_api.py
Then set BOT_API_URL=http://localhost:8001 when running Streamlit.
"""
import json
import random
from datetime import datetime, date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class MockBotHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        data = self._route(path, qs)
        if data is None:
            self.send_error(404)
            return

        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _route(self, path: str, qs: dict) -> object:
        if path == "/api/bot/stats":
            return {
                "status": "running",
                "datasource": "Bybit",
                "pnl24h": random.uniform(500, 2500),
                "totalPnL": random.uniform(15000, 45000),
                "openTrades": random.randint(3, 12),
                "winRate": random.uniform(55, 72),
                "vmHealth": {
                    "cpu": random.uniform(20, 60),
                    "memory": random.uniform(30, 55),
                    "disk": random.uniform(40, 70),
                },
            }

        if path == "/api/pnl/history":
            return [
                {
                    "date": (datetime.now() - timedelta(days=30 - i)).strftime("%Y-%m-%d"),
                    "realizedPnl": random.uniform(500, 3000) + i * 100,
                }
                for i in range(30)
            ]

        if path == "/api/bot/positions":
            return [
                {
                    "symbol": "BTCUSDT",
                    "side": "LONG",
                    "size": 0.5,
                    "entryPrice": 43250.00,
                    "currentPrice": 44100.00,
                    "unrealizedPnl": 427.50,
                    "stopLoss": 42500.00,
                    "takeProfit": 45000.00,
                    "pattern": "ICT Smart Money",
                },
                {
                    "symbol": "ETHUSDT",
                    "side": "LONG",
                    "size": 5.0,
                    "entryPrice": 2300.50,
                    "currentPrice": 2340.00,
                    "unrealizedPnl": 197.50,
                    "stopLoss": 2280.00,
                    "takeProfit": 2400.00,
                    "pattern": "Order Block Bounce",
                },
            ]

        if path == "/api/bot/signals":
            now = datetime.now()
            return [
                {
                    "symbol": "BTCUSDT",
                    "timestamp": (now - timedelta(minutes=2)).isoformat(),
                    "pattern": "Supply Zone Rejection",
                    "confidence": 0.87,
                    "price": 43800.00,
                    "direction": "LONG",
                },
                {
                    "symbol": "BTCUSDT",
                    "timestamp": (now - timedelta(minutes=45)).isoformat(),
                    "pattern": "Breaker Block",
                    "confidence": 0.72,
                    "price": 43200.00,
                    "direction": "SHORT",
                },
                {
                    "symbol": "ETHUSDT",
                    "timestamp": (now - timedelta(minutes=5)).isoformat(),
                    "pattern": "Demand Zone Bounce",
                    "confidence": 0.76,
                    "price": 2320.00,
                    "direction": "LONG",
                },
            ]

        if path == "/api/bot/trades/closed":
            now = datetime.now()
            return [
                {
                    "tradeId": 1001,
                    "symbol": "BTCUSDT",
                    "side": "LONG",
                    "entryPrice": 43100.00,
                    "exitPrice": 44200.00,
                    "size": 0.5,
                    "realizedPnl": 550.00,
                    "realizedPnlPct": 2.55,
                    "closeReason": "Take Profit",
                    "pattern": "Fair Value Gap",
                    "duration": "2h 34m",
                    "openTime": (now - timedelta(hours=5)).isoformat(),
                    "closeTime": (now - timedelta(hours=2, minutes=26)).isoformat(),
                },
                {
                    "tradeId": 1000,
                    "symbol": "BTCUSDT",
                    "side": "SHORT",
                    "entryPrice": 44500.00,
                    "exitPrice": 44100.00,
                    "size": 0.3,
                    "realizedPnl": 120.00,
                    "realizedPnlPct": 0.90,
                    "closeReason": "Take Profit",
                    "pattern": "Order Block",
                    "duration": "1h 12m",
                    "openTime": (now - timedelta(hours=9)).isoformat(),
                    "closeTime": (now - timedelta(hours=7, minutes=48)).isoformat(),
                },
                {
                    "tradeId": 999,
                    "symbol": "ETHUSDT",
                    "side": "LONG",
                    "entryPrice": 2280.00,
                    "exitPrice": 2250.00,
                    "size": 3.0,
                    "realizedPnl": -90.00,
                    "realizedPnlPct": -1.32,
                    "closeReason": "Stop Loss",
                    "pattern": "Breaker Block",
                    "duration": "4h 21m",
                    "openTime": (now - timedelta(hours=12)).isoformat(),
                    "closeTime": (now - timedelta(hours=7, minutes=39)).isoformat(),
                },
            ]

        if path == "/api/bot/logs":
            return [
                {"level": "INFO", "timestamp": datetime.now().isoformat(), "message": "Trade closed: BTCUSDT +$550.00"},
                {"level": "INFO", "timestamp": (datetime.now() - timedelta(seconds=30)).isoformat(), "message": "Signal detected on BTCUSDT"},
                {"level": "WARNING", "timestamp": (datetime.now() - timedelta(minutes=2)).isoformat(), "message": "High volatility detected, reducing position size"},
                {"level": "INFO", "timestamp": (datetime.now() - timedelta(minutes=5)).isoformat(), "message": "New position opened: ETHUSDT"},
                {"level": "DEBUG", "timestamp": (datetime.now() - timedelta(minutes=10)).isoformat(), "message": "Market update: 1234 candles processed"},
            ]

        if path == "/api/bot/health/services":
            return {
                "services": [
                    {"name": "ict-web-api", "status": "active", "uptime": "45 days"},
                    {"name": "redis", "status": "active", "uptime": "45 days"},
                    {"name": "postgres", "status": "active", "uptime": "92 days"},
                    {"name": "nginx", "status": "active", "uptime": "7 days"},
                ]
            }

        if path == "/api/bot/health/latest":
            return {
                "present": True,
                "snapshot": {
                    "timestamp": datetime.now().isoformat(),
                    "cpu_percent": 38.5,
                    "memory_percent": 42.1,
                    "disk_percent": 54.3,
                    "uptime_seconds": 3888000,
                    "bot_status": "running",
                    "last_trade": "2025-05-13T14:32:00Z",
                },
            }

        if path == "/api/bot/strategies":
            return {
                "strategies": [
                    {
                        "name": "ICT SMC v2",
                        "enabled": True,
                        "risk_pct": 1.0,
                        "timeframe": "15m",
                        "symbols": ["BTCUSDT", "ETHUSDT"],
                        "description": {
                            "short": "Smart Money Concepts with order block + FVG confluence",
                            "how_it_works": "Identifies institutional order blocks and fair value gaps...",
                        },
                        "stats": {
                            "total_trades": 142,
                            "win_rate_pct": 63.4,
                            "total_pnl": 8420.50,
                            "exit_reasons": {"tp": 90, "sl": 52},
                        },
                        "config": {"ob_lookback": 20, "fvg_min_size": 0.002},
                        "changelog": [
                            {"date": "2025-04-01", "note": "Added FVG filter"},
                            {"date": "2025-03-15", "note": "Initial release"},
                        ],
                    },
                    {
                        "name": "VWAP Reversion",
                        "enabled": False,
                        "risk_pct": 0.5,
                        "timeframe": "15m",
                        "symbols": ["BTCUSDT"],
                        "description": {"short": "Liquidity sweep + reversal, 15m setup / 1m entry"},
                        "stats": {
                            "total_trades": 0,
                            "win_rate_pct": 0.0,
                            "total_pnl": 0.0,
                            "exit_reasons": {},
                        },
                        "config": {"vwap_bands": 2.0},
                        "changelog": [
                            {"date": "2025-04-10", "note": "Added liquidity sweep filter"},
                            {"date": "2025-03-20", "note": "Initial release"},
                        ],
                    },
                ]
            }

        if path == "/api/bot/backtests":
            limit = int(qs.get("limit", ["50"])[0])
            strategy_filter = qs.get("strategy", [None])[0]
            strategies = ["ict-v1", "ict-v2", "vwap-rev"]
            runs = []
            for i in range(min(limit, 20)):
                run_date = (date.today() - timedelta(days=i * 3)).isoformat()
                strat = strategies[i % len(strategies)]
                if strategy_filter and strat != strategy_filter:
                    continue
                runs.append({
                    "id": str(20 - i),
                    "strategy": strat,
                    "runDate": run_date,
                    "startDate": "2024-01-01",
                    "endDate": "2024-12-31",
                    "totalTrades": random.randint(80, 200),
                    "winningTrades": random.randint(45, 130),
                    "losingTrades": random.randint(30, 80),
                    "winRate": round(random.uniform(52, 70), 2),
                    "profitFactor": round(random.uniform(1.1, 2.4), 2),
                    "expectancy": round(random.uniform(15, 80), 2),
                    "sharpeRatio": round(random.uniform(0.8, 2.2), 2),
                    "maxDrawdownPct": round(random.uniform(5, 18), 2),
                    "totalPnl": round(random.uniform(-500, 4500), 2),
                    "createdAt": f"{run_date} 12:00:00",
                })
            return runs

        if path == "/api/bot/ml/sessions":
            return {
                "sessions": [
                    {
                        "session_id": "sess-001",
                        "model_id": "ict-entry-clf-v3",
                        "trainer": "ml.trainers.gradient_boost.train",
                        "dataset": "candles/BTCUSDT/15m/v4",
                        "target_stage": "candidate",
                        "status": "running",
                        "elapsed_seconds": 1847,
                        "current_epoch": 42,
                        "total_epochs": 100,
                        "started_at": datetime.now().isoformat(),
                    },
                    {
                        "session_id": "sess-000",
                        "model_id": "ict-entry-clf-v2",
                        "trainer": "ml.trainers.gradient_boost.train",
                        "dataset": "candles/BTCUSDT/15m/v3",
                        "target_stage": "backtest_approved",
                        "status": "completed",
                        "elapsed_seconds": 5400,
                        "started_at": (datetime.now() - timedelta(hours=3)).isoformat(),
                        "eval_accuracy": 0.674,
                        "eval_f1": 0.651,
                    },
                ]
            }

        if path == "/api/bot/ml/registry":
            return {
                "models": [
                    {
                        "model_id": "ict-entry-clf-v2",
                        "model_family": "gradient_boost",
                        "trainer": "ml.trainers.gradient_boost.train",
                        "evaluator": "ml.evaluators.classification.evaluate",
                        "target_deployment_stage": "shadow",
                        "dataset": {
                            "family": "candles",
                            "symbol_scope": "BTCUSDT",
                            "timeframe": "15m",
                            "version": "v3",
                        },
                        "trainer_config": {"n_estimators": 500, "max_depth": 6, "learning_rate": 0.05},
                        "notes": "Best candidate so far; 67.4% accuracy on holdout.",
                    },
                    {
                        "model_id": "ict-entry-clf-v1",
                        "model_family": "logistic_regression",
                        "trainer": "ml.trainers.logistic.train",
                        "evaluator": "ml.evaluators.classification.evaluate",
                        "target_deployment_stage": "research_only",
                        "dataset": {
                            "family": "candles",
                            "symbol_scope": "BTCUSDT",
                            "timeframe": "15m",
                            "version": "v2",
                        },
                        "trainer_config": {"C": 1.0, "max_iter": 1000},
                        "notes": "Baseline model; superseded by v2.",
                    },
                ]
            }

        return None

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    server = HTTPServer(("localhost", 8001), MockBotHandler)
    print("Mock bot API running at http://localhost:8001")
    server.serve_forever()
