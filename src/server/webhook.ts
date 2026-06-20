import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { prisma } from '../db.js';
import { executeProposal } from '../executor/index.js';
import {
  sendDetailReply,
  sendAlternativeReply,
  sendExecutionResult,
} from '../line/notify.js';
import type { DebateResult } from '../types/index.js';

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET ?? '';
  const hash = crypto.createHmac('SHA256', secret).update(body).digest('base64');
  return hash === signature;
}

// コマンド種別
type Command = 'ok' | 'detail' | 'skip' | 'alternative';

interface ParsedCommand {
  proposalId: number;
  command: Command;
}

// メッセージパターン:
//   #041 OK / #041 詳しく / #041 スキップ / #041 別の方法
//   OK #041 / 詳しく #041  (逆順も対応)
function parseCommand(text: string): ParsedCommand | null {
  const t = text.trim();

  // 数字部分を抽出
  const idMatch = t.match(/#(\d+)/);
  if (!idMatch) return null;
  const proposalId = parseInt(idMatch[1], 10);
  if (isNaN(proposalId)) return null;

  const upper = t.toUpperCase();

  // OK / YES / はい / 実行
  if (/\b(OK|YES)\b/.test(upper) || /はい|実行/.test(t)) {
    return { proposalId, command: 'ok' };
  }

  // 詳しく / 詳細 / もっと / 教えて
  if (/詳しく|詳細|もっと|教えて/.test(t)) {
    return { proposalId, command: 'detail' };
  }

  // スキップ / NO / いいえ / 保留 / 見送り
  if (/\bNO\b/.test(upper) || /スキップ|いいえ|保留|見送り/.test(t)) {
    return { proposalId, command: 'skip' };
  }

  // 別の方法 / 代替 / 他の案 / 違う
  if (/別の方法|代替|他の案|違う方法/.test(t)) {
    return { proposalId, command: 'alternative' };
  }

  return null;
}

async function handleCommand(parsed: ParsedCommand): Promise<void> {
  const { proposalId, command } = parsed;
  console.log(`[Zeus Webhook] #${proposalId} → ${command}`);

  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) {
    console.log(`[Zeus Webhook] #${proposalId} が存在しません`);
    return;
  }

  // 返信受付できるステータス
  const acceptableStatuses = ['pending', 'awaiting_line_reply'];
  if (!acceptableStatuses.includes(proposal.status)) {
    console.log(`[Zeus Webhook] #${proposalId} は処理済み (status=${proposal.status})`);
    return;
  }

  const debateResult = proposal.debateResult as unknown as DebateResult;

  switch (command) {
    case 'ok':
      await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'approved' } });
      executeProposal(proposalId).catch(err =>
        console.error(`[Zeus Executor] #${proposalId} 実行エラー:`, err)
      );
      break;

    case 'detail':
      // ステータスは変えずに詳細メッセージを送信
      await sendDetailReply(proposalId, debateResult);
      console.log(`[Zeus] #${proposalId} 詳細分析を送信しました`);
      break;

    case 'skip':
      await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'rejected' } });
      await sendExecutionResult(proposalId, true, '保留にしました。15分後のチェックで再評価します。');
      console.log(`[Zeus] #${proposalId} をスキップしました`);
      break;

    case 'alternative':
      // ステータスは変えずに代替案を送信
      await sendAlternativeReply(proposalId, debateResult);
      console.log(`[Zeus] #${proposalId} 代替案を送信しました`);
      break;
  }
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
    const parsed = parseCommand(text);
    if (!parsed) {
      console.log(`[Zeus Webhook] 未認識メッセージ: ${text.slice(0, 50)}`);
      continue;
    }

    await handleCommand(parsed).catch(err =>
      console.error(`[Zeus Webhook] コマンド処理エラー:`, err)
    );
  }
}
