import cron from 'node-cron';
import axios from 'axios';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getStatsSince, type PeriodStats } from '../learning/feedback.js';

const KNOWHOW_BASE = 'https://knowhow.up.railway.app';

// JSTの「YYYY-MM-DD」を返す（Railwayは UTC 稼働なので明示変換）
function todayJST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// 当日（JST）の0時からの経過時間（時間）。日報は「今日1日」を対象にする。
function hoursSinceJstMidnight(): number {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const elapsedMs = jstNow.getHours() * 3600_000 + jstNow.getMinutes() * 60_000 + jstNow.getSeconds() * 1000;
  // 最低1時間ぶんは見る（0時台に走っても直近を拾えるように）
  return Math.max(1, elapsedMs / 3600_000);
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '検知',
  awaiting_line_reply: 'LINE返信待ち',
  approved: '承認',
  rejected: 'スキップ',
  executed: '実行完了',
  failed: '失敗',
};

async function buildInsight(stats: PeriodStats): Promise<string> {
  if (stats.total === 0) {
    return '本日は異常検知ゼロ。全システム平常運転でした。明日も監視を継続します⚡';
  }
  try {
    const topText = stats.topSystems.map(s => `${s.system}(${s.count})`).join('、') || 'なし';
    const { text } = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system:
        'あなたはZEUS（AI最高顧問）の日次振り返りAIです。今日のデータを見て、社長向けに簡潔な洞察と明日の打ち手を3行以内・素人語・数字ありで返してください。前置き不要、本文のみ。',
      prompt: `今日のZeusデータ:
検知: ${stats.total}件 / 承認・実行: ${stats.approved}件 / スキップ: ${stats.rejected}件
実行完了: ${stats.executed}件 / 失敗: ${stats.failed}件 / 未処理: ${stats.pending}件
問題が多かったシステム: ${topText}`,
    });
    return text.trim();
  } catch {
    return `本日 ${stats.total}件を検知（実行 ${stats.executed} / 失敗 ${stats.failed}）。明日も監視を継続します。`;
  }
}

function buildBodyMd(stats: PeriodStats, insight: string): string {
  const lines: string[] = [];
  lines.push('## ⚡ Zeus 日次レポート');
  lines.push('');
  lines.push('### 📊 本日のサマリー');
  lines.push('');
  lines.push('| 指標 | 件数 |');
  lines.push('|---|---|');
  lines.push(`| 検知 | ${stats.total} |`);
  lines.push(`| 承認・実行 | ${stats.approved} |`);
  lines.push(`| 実行完了 | ${stats.executed} |`);
  lines.push(`| スキップ | ${stats.rejected} |`);
  lines.push(`| 失敗 | ${stats.failed} |`);
  lines.push(`| 未処理 | ${stats.pending} |`);
  lines.push('');

  if (stats.topSystems.length > 0) {
    lines.push('### 🔥 問題が多かったシステム');
    lines.push('');
    stats.topSystems.forEach((s, i) => lines.push(`${i + 1}. ${s.system}（${s.count}件）`));
    lines.push('');
  }

  if (stats.recent.length > 0) {
    lines.push('### 🕑 本日の検知・対応');
    lines.push('');
    for (const p of stats.recent) {
      const sev = SEVERITY_EMOJI[p.severity] ?? '⚪';
      const st = STATUS_LABEL[p.status] ?? p.status;
      lines.push(`- ${sev} [#${p.id}] ${p.system}: ${p.title} — **${st}**`);
    }
    lines.push('');
  }

  lines.push('### 💡 Zeusからの洞察');
  lines.push('');
  lines.push(insight);
  lines.push('');
  lines.push('---');
  lines.push('_⚡ Zeus（AI最高顧問・自律監視層）が自動生成・自動投稿_');
  return lines.join('\n');
}

export interface NippouResult {
  ok: boolean;
  date: string;
  total: number;
  message?: string;
  error?: string;
}

// 日報を1件 build して knowhow へ upsert する（手動トリガーからも呼べる）
export async function runDailyNippou(): Promise<NippouResult> {
  const date = todayJST();
  const apiKey = process.env.KB_API_KEY;

  try {
    const stats = await getStatsSince(hoursSinceJstMidnight());
    const insight = await buildInsight(stats);
    const bodyMd = buildBodyMd(stats, insight);

    const summary =
      stats.total === 0
        ? '本日は異常検知ゼロ。全システム平常運転。'
        : `検知${stats.total}件（実行${stats.executed}・失敗${stats.failed}・未処理${stats.pending}）。`;

    if (!apiKey) {
      console.warn('[Zeus 日報] KB_API_KEY 未設定のため knowhow 投稿をスキップ');
      return { ok: false, date, total: stats.total, error: 'KB_API_KEY missing' };
    }

    const res = await axios.post(
      `${KNOWHOW_BASE}/api/nippou`,
      {
        department: 'zeus',
        report_date: date,
        bucho: '⚡ Zeus',
        title: `Zeus日報 ${date}`,
        summary,
        body_md: bodyMd,
        metrics: {
          検知: stats.total,
          実行完了: stats.executed,
          失敗: stats.failed,
          スキップ: stats.rejected,
          未処理: stats.pending,
        },
      },
      { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, timeout: 12000 }
    );

    console.log(`[Zeus 日報] ${date} を投稿: ${res.data?.message ?? 'ok'}`);
    return { ok: true, date, total: stats.total, message: res.data?.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Zeus 日報] 投稿エラー:', msg);
    return { ok: false, date, total: 0, error: msg };
  }
}

export function startDailyNippou(): void {
  // 毎日 JST 21:00 にその日の日報を knowhow ダッシュボードへ自動投稿
  const expr = process.env.ZEUS_NIPPOU_CRON ?? '0 21 * * *';
  cron.schedule(
    expr,
    () => {
      console.log('[Zeus 日報] 生成開始...');
      runDailyNippou().catch(err => console.error('[Zeus 日報 cron] エラー:', err));
    },
    { timezone: 'Asia/Tokyo' }
  );
  console.log(`[Zeus 日報] 毎日 ${expr} (JST) に knowhow へ自動投稿`);
}
