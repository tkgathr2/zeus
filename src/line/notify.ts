import { messagingApi } from '@line/bot-sdk';
import { prisma } from '../db.js';
import type { DebateResult } from '../types/index.js';

let client: messagingApi.MessagingApiClient | null = null;

function getClient(): messagingApi.MessagingApiClient {
  if (!client) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
    client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
  }
  return client;
}

export function buildMessage(result: DebateResult, proposalId: number): string {
  const c = result.consensus;
  const ev = result.evidence;
  const r1 = result.round1;
  const sev = result.alert.severity;
  const sevEmoji = { low: '🟡', medium: '🟠', high: '🔴', critical: '🚨' }[sev];
  const evidenceNote = ev.sampleSize > 0
    ? `実績${ev.sampleSize}件ベース`
    : 'AI推定値';

  // 3AI視座の要約（各40文字以内）
  const sonAnalysis = (r1[0].analysis ?? '').slice(0, 60);
  const mikitaniAnalysis = (r1[1].analysis ?? '').slice(0, 60);
  const muskAnalysis = (r1[2].analysis ?? '').slice(0, 60);

  const id = String(proposalId).padStart(3, '0');

  return [
    `⚡ ゼウスより #${id}`,
    '',
    `${sevEmoji}【${c.title}】`,
    `システム: ${result.alert.system}`,
    '',
    '📊 現状',
    `  ${result.alert.rawData.summary ?? result.alert.title}`,
    '',
    '🧠 3AI分析',
    `  孫正義: ${sonAnalysis}`,
    `  三木谷: ${mikitaniAnalysis}`,
    `  マスク: ${muskAnalysis}`,
    '',
    `🔍 原因（確信度 ${c.confidence}%）`,
    `  ${c.cause}`,
    '',
    `🔧 統合提案`,
    `  ${c.solution}`,
    `  成功確率 ${c.successRate}%（${evidenceNote}）　所要 約${c.estimatedMinutes}分`,
    '',
    '⚠️ リスク',
    `  本番停止 ${c.stopRisk}%　データ損失 ${c.dataLossRisk}%`,
    '',
    '📉 放置した場合',
    `  月次損失 約${c.monthlyLoss}万円　30日再発 ${c.reoccurrence30d}%`,
    '',
    '─────────────────',
    `#${id}と返信:`,
    '✅ OK → 実行',
    '🔍 詳しく → 3AI詳細分析',
    '⏭️ スキップ → 保留',
    '🔄 別の方法 → 代替案',
  ].join('\n');
}

export function buildDetailMessage(result: DebateResult, proposalId: number): string {
  const r2 = result.round2;
  const id = String(proposalId).padStart(3, '0');

  return [
    `🔍 #${id} 詳細分析`,
    '',
    `【孫正義（Claude）確信度${r2[0].confidence}%】`,
    r2[0].analysis,
    (r2[0].rawData?.updatedVision as string) ? `ビジョン: ${(r2[0].rawData?.updatedVision as string).slice(0, 80)}` : '',
    '',
    `【三木谷（GPT）成功率${r2[1].successRate}%】`,
    r2[1].analysis,
    (r2[1].rawData?.alternative as string) ? `代替案: ${(r2[1].rawData?.alternative as string).slice(0, 80)}` : '',
    '',
    `【マスク（Gemini）月次損失${r2[2].estimatedLoss}万円】`,
    r2[2].analysis,
    (r2[2].rawData?.doNotDo as string) ? `禁止: ${(r2[2].rawData?.doNotDo as string).slice(0, 80)}` : '',
    '',
    '─────────────────',
    `引き続き #${id}と返信:`,
    '✅ OK　⏭️ スキップ　🔄 別の方法',
  ].filter(l => l !== '').join('\n');
}

export function buildAlternativeMessage(result: DebateResult, proposalId: number): string {
  const c = result.consensus;
  const id = String(proposalId).padStart(3, '0');
  const alt = c.alternativeSolution || (result.round2[1].rawData?.alternative as string) || '代替案なし';

  return [
    `🔄 #${id} 代替案`,
    '',
    `マスク（第一原理）の提言:`,
    `  ${alt}`,
    '',
    `三木谷の代替案:`,
    `  ${(result.round2[1].rawData?.alternative as string) ?? '検討中'}`,
    '',
    '─────────────────',
    `#${id}と返信:`,
    '✅ OK → 代替案を実行',
    '⏭️ スキップ → 見送り',
  ].join('\n');
}

async function sendSlackFallback(text: string, proposalId: number): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_ADMIN_USER_ID || 'UPFSHKUAW';
  if (!token) {
    console.error('[Zeus] SLACK_BOT_TOKEN 未設定 → Slackフォールバック失敗');
    return;
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, text: `📱 LINE上限中（Slackへ転送）\n\n${text}` }),
  });
  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) {
    console.error('[Zeus] Slackフォールバック失敗:', data.error);
  } else {
    console.log(`[Zeus Slack] フォールバック送信完了 #${proposalId}`);
  }
}

export async function sendProposal(result: DebateResult, proposalId: number): Promise<void> {
  const userId = process.env.LINE_USER_ID;
  if (!userId) throw new Error('LINE_USER_ID が未設定です');

  try {
    await getClient().pushMessage({
      to: userId,
      messages: [{ type: 'text', text: buildMessage(result, proposalId) }],
    });
    console.log(`[Zeus LINE] 送信完了 #${proposalId}: ${result.consensus.title}`);
  } catch (err: any) {
    if (err.status === 429) {
      console.log(`[Zeus] LINE月間上限 → Slackフォールバック #${proposalId}`);
      await sendSlackFallback(buildMessage(result, proposalId), proposalId);
    } else {
      throw err;
    }
  }

  // 送信完了後 → awaiting_line_reply に更新（LINE/Slack どちら経由でも）
  await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: 'awaiting_line_reply' },
  });
}

export async function sendDetailReply(proposalId: number, result: DebateResult): Promise<void> {
  const userId = process.env.LINE_USER_ID;
  if (!userId) return;

  await getClient().pushMessage({
    to: userId,
    messages: [{ type: 'text', text: buildDetailMessage(result, proposalId) }],
  });
}

export async function sendAlternativeReply(proposalId: number, result: DebateResult): Promise<void> {
  const userId = process.env.LINE_USER_ID;
  if (!userId) return;

  await getClient().pushMessage({
    to: userId,
    messages: [{ type: 'text', text: buildAlternativeMessage(result, proposalId) }],
  });
}

export async function sendExecutionResult(proposalId: number, success: boolean, detail: string): Promise<void> {
  const userId = process.env.LINE_USER_ID;
  if (!userId) return;

  const text = success
    ? `✅ #${proposalId} 実行完了\n${detail}`
    : `❌ #${proposalId} 実行失敗\n${detail}\n\n真田が手動対応します。`;

  await getClient().pushMessage({
    to: userId,
    messages: [{ type: 'text', text }],
  });
}
