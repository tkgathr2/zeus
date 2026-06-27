import axios from 'axios';
import { prisma } from '../db.js';
import type { Proposal } from '@prisma/client';
import type { DebateResult } from '../types/index.js';

const KNOWHOW_BASE = 'https://knowhow.up.railway.app';

// 社長のフィードバック種別
export type FeedbackType = 'approved' | 'rejected' | 'alternative_preferred' | 'detail_requested';

// 社長のフィードバックを記録してZeusが成長する
export async function recordFeedback(
  proposal: Proposal,
  feedback: FeedbackType,
): Promise<void> {
  const apiKey = process.env.KB_API_KEY;
  if (!apiKey) return;

  const debateResult = proposal.debateResult as unknown as DebateResult;
  const consensus = debateResult?.consensus;

  const feedbackLabel = {
    approved: '✅ 承認・実行',
    rejected: '⏭️ スキップ（不要と判断）',
    alternative_preferred: '🔄 代替案を選択',
    detail_requested: '🔍 詳細確認',
  }[feedback];

  // 学習ポイント抽出
  const learningPoint = (() => {
    switch (feedback) {
      case 'approved':
        return `このシステム(${proposal.system})・深刻度(${proposal.severity})の提案は承認される傾向。修正案「${consensus?.solution ?? ''}」が有効。`;
      case 'rejected':
        return `このシステム(${proposal.system})の「${proposal.title.slice(0, 50)}」は不要と判断された。同種の提案は次回より低優先度にすること。`;
      case 'alternative_preferred':
        return `「${proposal.title.slice(0, 50)}」に対し、代替案（マスク視点）が好まれた。「${consensus?.alternativeSolution ?? ''}」方向での提案を優先すること。`;
      case 'detail_requested':
        return `「${proposal.title.slice(0, 50)}」は詳細説明が必要だった。同種の問題では初回から詳細情報を含めること。`;
    }
  })();

  try {
    await axios.post(
      `${KNOWHOW_BASE}/api/devin/memorize`,
      {
        project_key: 'zeus-feedback',
        tool: 'zeus',
        status: 'success',
        environment: `zeus-feedback/${proposal.system}`,
        tags: ['zeus', 'feedback', proposal.system, proposal.severity, feedback],
        raw_log: `【Zeus学習フィードバック】${feedbackLabel}\nシステム: ${proposal.system}\n問題: ${proposal.title}\n学習: ${learningPoint}\n確信度: ${consensus?.confidence ?? 0}% / 成功率: ${consensus?.successRate ?? 0}%`,
      },
      { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, timeout: 8000 }
    );
    console.log(`[Zeus Learning] フィードバック記録: ${feedback} → ${proposal.system}`);
  } catch (err) {
    console.warn('[Zeus Learning] フィードバック記録失敗:', err);
  }
}

// 失敗したときの自動しくじり先生カード作成
export async function recordShikujiri(
  proposal: Proposal,
  errorDetail: string,
): Promise<void> {
  const apiKey = process.env.KB_API_KEY;
  if (!apiKey) return;

  const debateResult = proposal.debateResult as unknown as DebateResult;
  const consensus = debateResult?.consensus;

  try {
    await axios.post(
      `${KNOWHOW_BASE}/api/devin/memorize`,
      {
        project_key: 'shikujiri-pdca',
        tool: 'zeus',
        status: 'failure',
        environment: `zeus/${proposal.system}`,
        tags: ['zeus', 'しくじり先生', proposal.system, '自動起票'],
        raw_log: [
          `【しくじり先生｜Zeus自動起票｜${proposal.system}】`,
          `P真因(5なぜ)= ${proposal.title} が発生し、Zeus自動実行が失敗した。原因: ${errorDetail}`,
          `D対策= ${consensus?.solution ?? '未定'} / 代替: ${consensus?.alternativeSolution ?? '未定'}`,
          `C検証= Zeus自動監視で再発を検知し次回試行する`,
          `A横展開= zeus-resolutionsに記録済み・次回runDebate時に参照される`,
        ].join('\n'),
      },
      { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, timeout: 8000 }
    );
    console.log(`[Zeus Learning] しくじり先生カード自動作成: #${proposal.id}`);
  } catch (err) {
    console.warn('[Zeus Learning] しくじり先生記録失敗:', err);
  }
}

// 過去のフィードバックを取得してディベートのヒントにする
export async function recallFeedbackHints(system: string, title: string): Promise<string> {
  const apiKey = process.env.KB_API_KEY;
  if (!apiKey) return '';

  try {
    const res = await axios.post(
      `${KNOWHOW_BASE}/api/devin/recall`,
      {
        project_key: 'zeus-feedback',
        query: `${system} ${title.slice(0, 40)}`,
        top_k: 5,
      },
      { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, timeout: 6000 }
    );

    const results: Array<{ raw_log: string }> = res.data?.results ?? [];
    if (results.length === 0) return '';

    const hints = results
      .map(r => r.raw_log?.split('学習: ')[1]?.split('\n')[0] ?? '')
      .filter(Boolean)
      .slice(0, 3);

    return hints.length > 0 ? `\n\n【過去フィードバックからの学習】\n${hints.join('\n')}` : '';
  } catch {
    return '';
  }
}

// 週次統計の取得
export async function getWeeklyStats(): Promise<{
  total: number;
  approved: number;
  rejected: number;
  executed: number;
  failed: number;
  topSystems: Array<{ system: string; count: number }>;
}> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const proposals = await prisma.proposal.findMany({
    where: { createdAt: { gte: since } },
    select: { system: true, status: true },
  });

  const systemCounts: Record<string, number> = {};
  for (const p of proposals) {
    systemCounts[p.system] = (systemCounts[p.system] ?? 0) + 1;
  }

  const topSystems = Object.entries(systemCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([system, count]) => ({ system, count }));

  return {
    total: proposals.length,
    approved: proposals.filter(p => ['approved', 'executed'].includes(p.status)).length,
    rejected: proposals.filter(p => p.status === 'rejected').length,
    executed: proposals.filter(p => p.status === 'executed').length,
    failed: proposals.filter(p => p.status === 'failed').length,
    topSystems,
  };
}

export interface PeriodStats {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  executed: number;
  failed: number;
  topSystems: Array<{ system: string; count: number }>;
  recent: Array<{ id: number; system: string; title: string; severity: string; status: string; createdAt: Date }>;
}

// 任意期間（既定: 直近 hours 時間）の統計を取得。日報・ダッシュボード共用。
export async function getStatsSince(hours: number): Promise<PeriodStats> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const proposals = await prisma.proposal.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, system: true, title: true, severity: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const systemCounts: Record<string, number> = {};
  for (const p of proposals) {
    systemCounts[p.system] = (systemCounts[p.system] ?? 0) + 1;
  }

  const topSystems = Object.entries(systemCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([system, count]) => ({ system, count }));

  return {
    total: proposals.length,
    approved: proposals.filter(p => ['approved', 'executed'].includes(p.status)).length,
    rejected: proposals.filter(p => p.status === 'rejected').length,
    pending: proposals.filter(p => ['pending', 'awaiting_line_reply'].includes(p.status)).length,
    executed: proposals.filter(p => p.status === 'executed').length,
    failed: proposals.filter(p => p.status === 'failed').length,
    topSystems,
    recent: proposals.slice(0, 10),
  };
}
