import { messagingApi } from '@line/bot-sdk';
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
  const sev = result.alert.severity;
  const sevEmoji = { low: '🟡', medium: '🟠', high: '🔴', critical: '🚨' }[sev];
  const evidenceNote = ev.sampleSize > 0
    ? `実績${ev.sampleSize}件ベース`
    : 'AI推定値';

  return [
    `⚡ ゼウスより #${String(proposalId).padStart(3, '0')}`,
    '',
    `${sevEmoji}【${c.title}】`,
    `システム: ${result.alert.system}`,
    '',
    '📊 現状',
    `  ${result.alert.rawData.summary ?? result.alert.title}`,
    '',
    `🔍 原因（確信度 ${c.confidence}%）`,
    `  ${c.cause}`,
    '',
    `🔧 修正案`,
    `  ${c.solution}`,
    `  成功確率 ${c.successRate}%（${evidenceNote}）`,
    `  所要時間 約${c.estimatedMinutes}分`,
    '',
    '⚠️ リスク',
    `  本番停止 ${c.stopRisk}%　データ損失 ${c.dataLossRisk}%`,
    '',
    '📉 放置した場合',
    `  月次損失 約${c.monthlyLoss}万円`,
    `  30日以内再発 ${c.reoccurrence30d}%`,
    '',
    '─────────────────',
    '✅ YES　❌ NO',
    `（#${proposalId}と返信してから YES/NO）`,
  ].join('\n');
}

export async function sendProposal(result: DebateResult, proposalId: number): Promise<void> {
  const userId = process.env.LINE_USER_ID;
  if (!userId) throw new Error('LINE_USER_ID が未設定です');

  await getClient().pushMessage({
    to: userId,
    messages: [{ type: 'text', text: buildMessage(result, proposalId) }],
  });

  console.log(`[Zeus LINE] 送信完了 #${proposalId}: ${result.consensus.title}`);
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
