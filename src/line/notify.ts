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

function buildMessage(result: DebateResult, proposalId: number): string {
  const c = result.consensus;
  const sev = result.alert.severity;
  const sevEmoji = { low: '🟡', medium: '🟠', high: '🔴', critical: '🚨' }[sev];

  return [
    `⚡ ゼウスより #${String(proposalId).padStart(3, '0')}`,
    '',
    `${sevEmoji}【${c.title}】`,
    `システム: ${result.alert.system}`,
    '',
    '📊 現状',
    `  ${result.alert.rawData.summary ?? result.alert.title}`,
    '',
    '🔍 原因',
    `  ${c.cause}`,
    `  確信度 ${c.confidence}%（3AI合意）`,
    '',
    '🔧 修正案',
    `  ${c.solution}`,
    `  成功確率 ${c.successRate}%`,
    '',
    '⚠️ リスク',
    `  本番停止リスク ${c.stopRisk}%`,
    `  データ損失リスク ${c.dataLossRisk}%`,
    '',
    '📉 放置した場合',
    `  月次損失推計 約${c.monthlyLoss}万円`,
    `  30日以内の再発確率 ${c.reoccurrence30d}%`,
    '',
    '─────────────────',
    '✅ YES（実行）　❌ NO（スキップ）',
  ].join('\n');
}

export async function sendProposal(result: DebateResult, proposalId: number): Promise<void> {
  const userId = process.env.LINE_USER_ID;
  if (!userId) throw new Error('LINE_USER_ID が未設定です');

  const text = buildMessage(result, proposalId);

  await getClient().pushMessage({
    to: userId,
    messages: [{ type: 'text', text }],
  });

  console.log(`[Zeus] LINE送信完了 #${proposalId}: ${result.consensus.title}`);
}

export { buildMessage };
