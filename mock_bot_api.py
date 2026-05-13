"""Mock FastAPI server for dashboard preview."""
from datetime import datetime, timedelta
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import random

class MockBotHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Handle GET requests with mock data."""
        if self.path == "/api/bot/stats":
            data = {
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
                }
            }
        elif self.path == "/api/pnl/history?days=30":
            data = []
            for i in range(30):
                date = (datetime.now() - timedelta(days=30-i)).strftime("%Y-%m-%d")
                pnl = random.uniform(500, 3000) + (i * 100)
                data.append({"date": date, "realizedPnl": pnl})
        elif self.path == "/api/bot/positions":
            data = [
                {
                    "symbol": "BTCUSDT",
                    "side": "LONG",
                    "size": 0.5,
                    "entryPrice": 43250.00,
                    "currentPrice": 44100.00,
                    "unrealizedPnl": 427.50,
                    "stopLoss": 42500.00,
                    "takeProfit": 45000.00,
                    "pattern": "ICT Smart Money"
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
                    "pattern": "Order Block Bounce"
                },
            ]
        elif self.path == "/api/bot/signals":
            data = [
                {
                    "symbol": "BNBUSDT",
                    "timestamp": datetime.now().isoformat(),
                    "pattern": "Supply Zone Rejection",
                    "confidence": 0.87,
                    "price": 615.42,
                    "direction": "LONG"
                },
                {
                    "symbol": "XRPUSDT",
                    "timestamp": (datetime.now() - timedelta(minutes=5)).isoformat(),
                    "pattern": "Demand Zone Bounce",
                    "confidence": 0.76,
                    "price": 2.48,
                    "direction": "LONG"
                },
                {
                    "symbol": "ADAUSDT",
                    "timestamp": (datetime.now() - timedelta(minutes=15)).isoformat(),
                    "pattern": None,
                    "confidence": None,
                    "price": 1.02,
                    "direction": "SHORT"
                },
            ]
        elif self.path == "/api/bot/trades/closed?limit=50":
            data = [
                {
                    "tradeId": 1001,
                    "symbol": "SOLUSDT",
                    "side": "LONG",
                    "entryPrice": 182.45,
                    "exitPrice": 189.20,
                    "size": 10.0,
                    "realizedPnl": 678.50,
                    "realizedPnlPct": 3.71,
                    "closeReason": "Take Profit",
                    "pattern": "Fair Value Gap",
                    "duration": "2h 34m"
                },
                {
                    "tradeId": 1000,
                    "symbol": "LTCUSDT",
                    "side": "SHORT",
                    "entryPrice": 98.50,
                    "exitPrice": 96.20,
                    "size": 25.0,
                    "realizedPnl": 57.50,
                    "realizedPnlPct": 2.33,
                    "closeReason": "Stop Loss",
                    "pattern": "Breaker Block",
                    "duration": "1h 12m"
                },
                {
                    "tradeId": 999,
                    "symbol": "DOGEUSDT",
                    "side": "LONG",
                    "entryPrice": 0.38,
                    "exitPrice": 0.41,
                    "size": 5000.0,
                    "realizedPnl": 1500.00,
                    "realizedPnlPct": 7.89,
                    "closeReason": "Take Profit",
                    "pattern": "Order Block",
                    "duration": "4h 21m"
                },
            ]
        elif self.path == "/api/bot/logs":
            data = [
                {"level": "INFO", "timestamp": datetime.now().isoformat(), "message": "Trade closed: BTCUSDT +$427.50"},
                {"level": "INFO", "timestamp": (datetime.now() - timedelta(seconds=30)).isoformat(), "message": "Signal detected on BNBUSDT"},
                {"level": "WARNING", "timestamp": (datetime.now() - timedelta(minutes=2)).isoformat(), "message": "High volatility detected, reducing position size"},
                {"level": "INFO", "timestamp": (datetime.now() - timedelta(minutes=5)).isoformat(), "message": "New position opened: ETHUSDT"},
                {"level": "DEBUG", "timestamp": (datetime.now() - timedelta(minutes=10)).isoformat(), "message": "Market update: 1234 candles processed"},
            ]
        elif self.path == "/api/bot/health/services":
            data = {
                "services": [
                    {"name": "ict-web-api", "status": "active", "uptime": "45 days"},
                    {"name": "redis", "status": "active", "uptime": "45 days"},
                    {"name": "postgres", "status": "active", "uptime": "92 days"},
                    {"name": "nginx", "status": "active", "uptime": "7 days"},
                ]
            }
        elif self.path == "/api/bot/health/latest":
            data = {
                "present": True,
                "snapshot": {
                    "timestamp": datetime.now().isoformat(),
                    "cpu_percent": 38.5,
                    "memory_percent": 42.1,
                    "disk_percent": 54.3,
                    "uptime_seconds": 3888000,
                    "bot_status": "running",
                    "last_trade": "2025-05-13T14:32:00Z",
                }
            }
        elif self.path == "/api/bot/candles/BTCUSDT?limit=100":
            data = []
            base_price = 43000
            for i in range(100):
                ts = datetime.now() - timedelta(hours=100-i)
                open_p = base_price + random.uniform(-200, 200)
                close_p = open_p + random.uniform(-300, 300)
                high_p = max(open_p, close_p) + random.uniform(0, 200)
                low_p = min(open_p, close_p) - random.uniform(0, 200)
                data.append({
                    "timestamp": ts.isoformat(),
                    "open": open_p,
                    "high": high_p,
                    "low": low_p,
                    "close": close_p,
                    "volume": random.uniform(100, 5000)
                })
                base_price = close_p
        else:
            self.send_error(404)
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        pass  # Suppress logs

if __name__ == "__main__":
    server = HTTPServer(("localhost", 8001), MockBotHandler)
    print("Mock bot API running at http://localhost:8001")
    server.serve_forever()
