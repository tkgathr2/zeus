import { prisma } from '../db.js';
import { recordResolution } from '../knowhow/evidence.js';
import { sendExecutionResult } from '../line/notify.js';
import { runZeusAgent } from './zeus-agent.js';

export async function executeProposal(proposalId: number): Promise<void> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new Error(`Proposal #${proposalId} が見つかりません`);
  if (proposal.status !== 'approved') throw new Error(`Proposal #${proposalId} は承認済みではありません`);

  await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'executed' } });

  let success = false;
  let summary = '';

  try {
    // Zeus 万能エージェントが problem を読んで自律的にツールを選んで実行
    const result = await runZeusAgent(proposal);
    success = result.success;
    summary = result.summary;

    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: 'executed', executedAt: new Date() },
    });

    const raw = proposal.rawData as Record<string, unknown>;
    await recordResolution(
      {
        system: proposal.system,
        severity: proposal.severity as 'low' | 'medium' | 'high' | 'critical',
        title: proposal.title,
        rawData: raw,
        detectedAt: proposal.createdAt.toISOString(),
      },
      'zeus_agent',
      success,
    );
  } catch (err) {
    summary = err instanceof Error ? err.message : String(err);
    await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'failed' } });

    const raw = proposal.rawData as Record<string, unknown>;
    await recordResolution(
      {
        system: proposal.system,
        severity: proposal.severity as 'low' | 'medium' | 'high' | 'critical',
        title: proposal.title,
        rawData: raw,
        detectedAt: proposal.createdAt.toISOString(),
      },
      'zeus_agent',
      false,
    ).catch(() => {});
  }

  await sendExecutionResult(proposalId, success, summary);
}
