import { getStatsSince } from '../learning/feedback.js';

// 8センサーの env プレゼンス（未設定なら自動的に空配列を返す＝安全側）
const SENSORS: Array<{ key: string; label: string; env: string[] }> = [
  { key: 'railway', label: 'Railway', env: ['RAILWAY_API_TOKEN'] },
  { key: 'sentry', label: 'Sentry', env: ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG'] },
  { key: 'slack', label: 'Slack', env: ['SLACK_BOT_TOKEN'] },
  { key: 'knowhow', label: 'KnowHow', env: ['KB_API_KEY'] },
  { key: 'mf', label: 'MF Kessai', env: ['MF_ACCESS_TOKEN'] },
  { key: 'sterepo', label: 'Sterepo', env: ['STEREPO_API_KEY', 'STEREPO_URL'] },
  { key: 'backlog', label: 'Backlog', env: ['BACKLOG_API_KEY'] },
  { key: 'calendar', label: 'Calendar', env: ['GOOGLE_CALENDAR_ACCESS_TOKEN'] },
];

const AI = [
  { key: 'claude', label: '孫正義(Claude)', env: 'ANTHROPIC_API_KEY' },
  { key: 'gpt', label: '三木谷(GPT)', env: 'OPENAI_API_KEY' },
  { key: 'gemini', label: 'マスク(Gemini)', env: 'GOOGLE_GENERATIVE_AI_API_KEY' },
];

export async function buildDashboardStats() {
  const [today, week] = await Promise.all([getStatsSince(24), getStatsSince(24 * 7)]);

  const schedulerEnabled = process.env.ZEUS_SCHEDULER_ENABLED !== 'false';

  return {
    time: new Date().toISOString(),
    mode: '全知全能モード（イベントドリブン + 15分自律監視）',
    scheduler: {
      enabled: schedulerEnabled,
      interval: schedulerEnabled ? '15分ごと' : '無効',
    },
    sensors: SENSORS.map(s => ({
      key: s.key,
      label: s.label,
      configured: s.env.every(e => !!process.env[e]),
    })),
    ai: AI.map(a => ({ key: a.key, label: a.label, configured: !!process.env[a.env] })),
    nippou: {
      cron: process.env.ZEUS_NIPPOU_CRON ?? '0 21 * * *',
      tz: 'Asia/Tokyo',
    },
    today: {
      total: today.total,
      approved: today.approved,
      rejected: today.rejected,
      executed: today.executed,
      failed: today.failed,
      pending: today.pending,
      topSystems: today.topSystems,
    },
    week: {
      total: week.total,
      approved: week.approved,
      rejected: week.rejected,
      executed: week.executed,
      failed: week.failed,
      pending: week.pending,
      topSystems: week.topSystems,
    },
    recent: today.recent.concat(week.recent).reduce((acc, p) => {
      if (!acc.some(x => x.id === p.id)) acc.push(p);
      return acc;
    }, [] as typeof today.recent).slice(0, 15),
  };
}

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>⚡ Zeus ダッシュボード</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { background: #0b1020; color: #e5e7eb; }
  .card { background: #151c33; border: 1px solid #1f2a4a; }
  .glow { box-shadow: 0 0 24px rgba(99,102,241,.25); }
</style>
</head>
<body class="min-h-screen">
<div class="max-w-6xl mx-auto px-4 py-6">
  <header class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold">⚡ Zeus ダッシュボード</h1>
      <p id="mode" class="text-sm text-indigo-300 mt-1">読み込み中...</p>
    </div>
    <div class="text-right text-xs text-gray-400">
      <div id="time"></div>
      <button onclick="load()" class="mt-2 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white">更新</button>
    </div>
  </header>

  <section class="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
    <div class="card glow rounded-xl p-4"><div class="text-xs text-gray-400">本日 検知</div><div id="k-total" class="text-3xl font-bold">-</div></div>
    <div class="card rounded-xl p-4"><div class="text-xs text-gray-400">承認・実行</div><div id="k-approved" class="text-3xl font-bold text-emerald-400">-</div></div>
    <div class="card rounded-xl p-4"><div class="text-xs text-gray-400">実行完了</div><div id="k-executed" class="text-3xl font-bold text-sky-400">-</div></div>
    <div class="card rounded-xl p-4"><div class="text-xs text-gray-400">スキップ</div><div id="k-rejected" class="text-3xl font-bold text-gray-300">-</div></div>
    <div class="card rounded-xl p-4"><div class="text-xs text-gray-400">失敗</div><div id="k-failed" class="text-3xl font-bold text-rose-400">-</div></div>
    <div class="card rounded-xl p-4"><div class="text-xs text-gray-400">未処理</div><div id="k-pending" class="text-3xl font-bold text-amber-400">-</div></div>
  </section>

  <div class="grid md:grid-cols-2 gap-6">
    <section class="card rounded-xl p-4">
      <h2 class="font-semibold mb-3">📡 8センサー稼働状況</h2>
      <div id="sensors" class="grid grid-cols-2 gap-2 text-sm"></div>
      <h2 class="font-semibold mt-5 mb-3">🤖 3AI合議</h2>
      <div id="ai" class="grid grid-cols-1 gap-2 text-sm"></div>
      <div id="sched" class="mt-5 text-sm text-gray-300"></div>
      <div id="nippou" class="mt-2 text-sm text-gray-300"></div>
    </section>

    <section class="card rounded-xl p-4">
      <h2 class="font-semibold mb-3">📅 今週（7日）</h2>
      <div id="week" class="text-sm text-gray-300 mb-4"></div>
      <h2 class="font-semibold mb-2">🔥 問題が多かったシステム（本日）</h2>
      <div id="top" class="text-sm text-gray-300"></div>
    </section>
  </div>

  <section class="card rounded-xl p-4 mt-6">
    <h2 class="font-semibold mb-3">🕑 最近の検知・対応</h2>
    <div id="recent" class="text-sm divide-y divide-gray-800"></div>
  </section>

  <footer class="text-center text-xs text-gray-500 mt-8">
    ⚡ Zeus（AI最高顧問・自律監視層） · 社長直下で専務と並列 · 全幹部へ直接ディスパッチ
  </footer>
</div>

<script>
const SEV = { critical:'🔴', high:'🟠', medium:'🟡', low:'🟢' };
const ST = { pending:'検知', awaiting_line_reply:'LINE返信待ち', approved:'承認', rejected:'スキップ', executed:'実行完了', failed:'失敗' };
function dot(ok){ return '<span class="inline-block w-2 h-2 rounded-full '+(ok?'bg-emerald-400':'bg-gray-600')+'"></span>'; }
function esc(s){ return String(s??'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

async function load(){
  try {
    const r = await fetch('/api/stats'); const d = await r.json();
    document.getElementById('mode').textContent = d.mode;
    document.getElementById('time').textContent = new Date(d.time).toLocaleString('ja-JP');
    const t = d.today;
    document.getElementById('k-total').textContent = t.total;
    document.getElementById('k-approved').textContent = t.approved;
    document.getElementById('k-executed').textContent = t.executed;
    document.getElementById('k-rejected').textContent = t.rejected;
    document.getElementById('k-failed').textContent = t.failed;
    document.getElementById('k-pending').textContent = t.pending;

    document.getElementById('sensors').innerHTML = d.sensors.map(s =>
      '<div class="flex items-center gap-2">'+dot(s.configured)+'<span>'+esc(s.label)+'</span></div>').join('');
    document.getElementById('ai').innerHTML = d.ai.map(s =>
      '<div class="flex items-center gap-2">'+dot(s.configured)+'<span>'+esc(s.label)+'</span></div>').join('');

    document.getElementById('sched').innerHTML = '⏱️ 自律監視: <b class="'+(d.scheduler.enabled?'text-emerald-400':'text-gray-400')+'">'+esc(d.scheduler.interval)+'</b>';
    document.getElementById('nippou').innerHTML = '📝 日報: 毎日 '+esc(d.nippou.cron)+' ('+esc(d.nippou.tz)+') → ノウハウキング';

    const w = d.week;
    document.getElementById('week').innerHTML =
      '検知 <b>'+w.total+'</b> / 承認・実行 <b class="text-emerald-400">'+w.approved+'</b> / 実行完了 <b class="text-sky-400">'+w.executed+'</b> / スキップ '+w.rejected+' / 失敗 <b class="text-rose-400">'+w.failed+'</b>';

    document.getElementById('top').innerHTML = (t.topSystems||[]).length
      ? t.topSystems.map((s,i)=>(i+1)+'. '+esc(s.system)+'（'+s.count+'件）').join('<br>')
      : '<span class="text-gray-500">本日はなし</span>';

    document.getElementById('recent').innerHTML = (d.recent||[]).length
      ? d.recent.map(p =>
        '<div class="py-2 flex items-center gap-2">'+(SEV[p.severity]||'⚪')+
        ' <span class="text-gray-500">#'+p.id+'</span> <b>'+esc(p.system)+'</b>'+
        ' <span class="text-gray-300">'+esc(p.title)+'</span>'+
        ' <span class="ml-auto text-xs px-2 py-0.5 rounded bg-gray-800">'+(ST[p.status]||esc(p.status))+'</span></div>').join('')
      : '<div class="py-3 text-gray-500">まだ検知はありません</div>';
  } catch(e){
    document.getElementById('mode').textContent = '読み込み失敗: '+e;
  }
}
load();
setInterval(load, 60000);
</script>
</body>
</html>`;
