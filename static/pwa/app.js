const POLL_MS = 10_000;
const $ = (sel, root = document) => root.querySelector(sel);

const fmtUsd = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

function systemCell(label, up) {
  const cls = up === true ? "up" : up === false ? "down" : "unk";
  return `<span class="cell ${cls}" title="${label}">● ${label}</span>`;
}

function renderSystems(systems) {
  const host = $("[data-bind=systems]");
  if (!host) return;
  const cells = [];
  for (const s of systems.strategies || []) {
    cells.push(systemCell(s.name || "?", s.up));
  }
  cells.push(systemCell("Execution", systems.execution));
  cells.push(systemCell("Training", systems.training));
  host.innerHTML = cells.join("");
}

function renderTrades(rows) {
  const body = $("[data-bind=trades]");
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">No closed trades in last 24h</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((t) => {
    const pnl = typeof t.pnl === "number" ? t.pnl : 0;
    const cls = pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat";
    return `<tr class="${cls}">
      <td>${fmtTime(t.time)}</td>
      <td>${t.symbol ?? "—"}</td>
      <td>${(t.side ?? "—").toString().toUpperCase()}</td>
      <td>${t.size ?? "—"}</td>
      <td>${fmtUsd(t.pnl)}</td>
    </tr>`;
  }).join("");
}

function render(data) {
  const widget = $("#widget");
  widget.classList.remove("loading");

  const pnl = data.pnl24h;
  const pnlBox = $("[data-bind=pnl]");
  $("[data-bind=pnl] span").textContent = fmtUsd(pnl);
  pnlBox.classList.toggle("pos", typeof pnl === "number" && pnl > 0);
  pnlBox.classList.toggle("neg", typeof pnl === "number" && pnl < 0);

  const status = (data.status || "UNKNOWN").toString();
  const s = $("[data-bind=status]");
  s.textContent = status;
  s.dataset.state = status.toLowerCase();

  renderSystems(data.systems || {});
  renderTrades(Array.isArray(data.trades24h) ? data.trades24h : []);

  $("[data-bind=updated]").textContent = `Updated ${fmtTime(data.generatedAt)}`;
  $("[data-bind=liveDot]").classList.add("alive");
}

async function tick() {
  try {
    const res = await fetch("/api/widget.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
  } catch (_err) {
    $("[data-bind=updated]").textContent = "Offline — retrying";
    $("[data-bind=liveDot]").classList.remove("alive");
  }
}

tick();
setInterval(tick, POLL_MS);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});
