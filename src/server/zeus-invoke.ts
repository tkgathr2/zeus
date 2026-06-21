import type { Prisma } from '@prisma/client';
import { runDebate } from '../debate/engine.js';
import { sendProposal, buildMessage } from '../line/notify.js';
import { prisma } from '../db.js';
import type { SensorAlert } from '../types/index.js';

// Zeus を発動する共通エントリポイント
// センサー・Sentry webhook・LINE直接入力・GitHub・Railwayなど全ソースから呼ばれる
export async function invokeZeus(alert: SensorAlert): Promise<{ proposalId: number; skipped: boolean }> {
  // 24h以内に同一タイトル・システムで未処理の提案があればスキップ
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const exists = await prisma.proposal.findFirst({
    where: {
      system: alert.system,
      title: alert.title,
      status: { in: ['pending', 'awaiting_line_reply', 'approved', 'executed'] },
      createdAt: { gte: since24h },
    },
  });
  if (exists) {
    console.log(`[Zeus] 重複スキップ: ${alert.title} (#${exists.id})`);
    return { proposalId: exists.id, skipped: true };
  }

  console.log(`[Zeus] 発動: ${alert.system} / ${alert.title}`);
  const result = await runDebate(alert);
  const lineMsg = buildMessage(result, 0);

  const proposal = await prisma.proposal.create({
    data: {
      system: alert.system,
      title: alert.title,
      severity: alert.severity,
      rawData: alert.rawData as unknown as Prisma.InputJsonValue,
      debateResult: result as unknown as Prisma.InputJsonValue,
      lineMessage: lineMsg,
      status: 'awaiting_line_reply',
    },
  });

  await sendProposal(result, proposal.id);
  console.log(`[Zeus] 提案 #${proposal.id} → LINE送信完了`);
  return { proposalId: proposal.id, skipped: false };
}
