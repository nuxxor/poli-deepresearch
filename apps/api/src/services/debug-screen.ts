export function renderDebugScreenHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Deep Research Debug</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: #fffdf8;
        --border: #d8cdbb;
        --ink: #1f1c17;
        --muted: #6f685a;
        --accent: #9b4a28;
        --ok: #16643f;
        --danger: #a32020;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: linear-gradient(180deg, #f9f3e9 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: Georgia, "Times New Roman", serif;
      }
      main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 20px;
        display: grid;
        gap: 16px;
      }
      .hero, .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: 380px 1fr;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      h1, h2, h3, p, pre { margin: 0; }
      button {
        border: 1px solid var(--border);
        background: #f0dbcc;
        color: var(--accent);
        border-radius: 999px;
        padding: 8px 12px;
        cursor: pointer;
        font: inherit;
      }
      ul { margin: 0; padding-left: 18px; }
      li { margin-bottom: 10px; }
      a { color: var(--accent); }
      .muted { color: var(--muted); }
      .pill {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 12px;
        background: #ece4d8;
        color: var(--muted);
      }
      .ok { color: var(--ok); }
      .danger { color: var(--danger); }
      .mono {
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .run-item {
        cursor: pointer;
        padding: 10px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: #fffaf2;
      }
      .run-item:hover {
        border-color: var(--accent);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      td, th {
        padding: 8px;
        border-top: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
      }
      @media (max-width: 960px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="row">
          <div>
            <p class="muted">Deep Research Debug</p>
            <h1>Replay, health, and recent runs</h1>
          </div>
          <div>
            <button id="refresh">Refresh</button>
          </div>
        </div>
      </section>
      <section class="grid">
        <section class="panel">
          <div class="row">
            <h2>Recent Runs</h2>
            <span class="pill" id="run-count">0</span>
          </div>
          <ul id="runs"></ul>
        </section>
        <section class="panel">
          <div class="row">
            <div>
              <h2>Run Detail</h2>
              <p class="muted" id="selected-run">No run selected</p>
            </div>
            <button id="replay" disabled>Replay Selected</button>
          </div>
          <pre class="mono" id="detail">Select a recent run.</pre>
        </section>
      </section>
      <section class="panel">
        <div class="row">
          <h2>Provider Health</h2>
          <span class="pill" id="health-count">0</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Success</th>
              <th>Avg ms</th>
              <th>Consecutive Failures</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody id="health"></tbody>
        </table>
      </section>
    </main>
    <script>
      let selectedRunId = null;

      async function fetchJson(path, init) {
        const response = await fetch(path, init);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || ('HTTP ' + response.status));
        }
        return payload;
      }

      async function loadRuns() {
        const payload = await fetchJson('/v1/research/runs/recent?limit=20');
        const root = document.querySelector('#runs');
        const count = document.querySelector('#run-count');
        root.innerHTML = '';
        count.textContent = String(payload.runs.length);

        for (const run of payload.runs) {
          const li = document.createElement('li');
          const card = document.createElement('div');
          card.className = 'run-item';
          card.innerHTML = '<strong>' + (run.lean || '-') + '</strong> ' + (run.title || '') + '<br><span class="muted mono">' + run.runId + '</span><br><span class="muted">' + Math.round((run.leanConfidence || 0) * 100) + '% | ' + (run.resolutionStatus || '-') + ' | ' + run.totalUsd.toFixed(4) + ' USD | ' + run.totalMs + ' ms | cache=' + run.cacheHit + '</span>';
          card.addEventListener('click', () => loadRun(run.runId));
          li.append(card);
          root.append(li);
        }
      }

      async function loadRun(runId) {
        selectedRunId = runId;
        document.querySelector('#selected-run').textContent = runId;
        document.querySelector('#replay').disabled = false;
        const payload = await fetchJson('/v1/research/run/' + encodeURIComponent(runId));
        document.querySelector('#detail').textContent = JSON.stringify({
          run: payload.response.run,
          market: payload.response.market.canonicalMarket,
          queryPlan: payload.response.queryPlan,
          localPlanner: payload.response.localPlanner,
          strategy: payload.response.strategy,
          final: payload.response.final,
          researchView: payload.response.researchView,
          macroOfficialContext: payload.response.macroOfficialContext,
          crossMarketContext: payload.response.crossMarketContext,
          probabilisticForecast: payload.response.probabilisticForecast,
          adversarialReview: payload.response.adversarialReview,
          calibrationSummary: payload.response.calibrationSummary,
          offlineSummary: payload.response.offlineSummary,
          costs: payload.response.costs,
          latencies: payload.response.latencies,
          sourceSummary: payload.response.sourceSummary,
          claims: payload.response.claims?.slice(0, 5),
          citations: payload.response.citations?.slice(0, 5)
        }, null, 2);
      }

      async function replaySelected() {
        if (!selectedRunId) return;
        const payload = await fetchJson('/v1/research/run/' + encodeURIComponent(selectedRunId) + '/replay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        document.querySelector('#detail').textContent = JSON.stringify({
          replayedFrom: selectedRunId,
          newRun: payload.run,
          final: payload.final,
          costs: payload.costs,
          latencies: payload.latencies
        }, null, 2);
        await loadRuns();
      }

      async function loadHealth() {
        const payload = await fetchJson('/v1/providers/health');
        const root = document.querySelector('#health');
        const count = document.querySelector('#health-count');
        root.innerHTML = '';
        count.textContent = String(payload.providers.length);

        for (const item of payload.providers) {
          const row = document.createElement('tr');
          row.innerHTML =
            '<td><strong>' + item.provider + '</strong></td>' +
            '<td>' + Math.round(item.successRate * 100) + '% (' + item.successes + '/' + item.total + ')</td>' +
            '<td>' + Math.round(item.averageDurationMs) + '</td>' +
            '<td>' + item.consecutiveFailures + '</td>' +
            '<td>' + (item.lastStatus || '-') + (item.lastHttpStatus ? ' / ' + item.lastHttpStatus : '') + (item.lastError ? '<br><span class="danger">' + item.lastError + '</span>' : '') + '</td>';
          root.append(row);
        }
      }

      async function refreshAll() {
        await Promise.all([loadRuns(), loadHealth()]);
      }

      document.querySelector('#refresh').addEventListener('click', () => refreshAll());
      document.querySelector('#replay').addEventListener('click', () => replaySelected());
      refreshAll().catch((error) => {
        document.querySelector('#detail').textContent = error.message;
      });
    </script>
  </body>
</html>`;
}
