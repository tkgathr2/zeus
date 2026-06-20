import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { prisma } from '../db.js';
import { executeProposal } from '../executor/index.js';

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET ?? '';
  const hash = crypto.createHmac('SHA256', secret).update(body).digest('base64');
  return hash === signature;
}

// 社長のメッセージパターン: "#041 YES" or "YES #041" or "#041YES"
function parseReply(text: string): { proposalId: number; answer: 'yes' | 'no' } | null {
  const clean = text.trim().toUpperCase().replace(/\s+/g, ' ');

  const match =
    clean.match(/#(\d+)\s*(YES|NO)/) ||
    clean.match(/(YES|NO)\s*#(\d+)/) ||
    clean.match(/#(\d+)(YES|NO)/);

  if (!match) return null;

  const numStr = match[1].match(/^\d+$/) ? match[1] : match[2];
  const ansStr = match[1].match(/YES|NO/) ? match[1] : match[2];

  return {
    proposalId: parseInt(numStr, 10),
    answer: ansStr === 'YES' ? 'yes' : 'no',
  };
}

export async function lineWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-line-signature'] as string;
  const rawBody = JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    res.status(401).send('Invalid signature');
    return;
  }

  res.status(200).send('OK');

  const events = req.body?.events ?? [];
  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const text: string = event.message.text ?? '';
    const parsed = parseReply(text);
    if (!parsed) continue;

    const { proposalId, answer } = parsed;
    console.log(`[Zeus Webhook] #${proposalId} → ${answer.toUpperCase()}`);

    const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.status !== 'pending') {
      console.log(`[Zeus Webhook] #${proposalId} は処理済みまたは存在しません`);
      continue;
    }

    if (answer === 'yes') {
      await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'approved' } });
      executeProposal(proposalId).catch(err =>
        console.error(`[Zeus Executor] #${proposalId} 実行エラー:`, err)
      );
    } else {
      await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'rejected' } });
      console.log(`[Zeus] #${proposalId} をスキップしました`);
    }
  }
}
