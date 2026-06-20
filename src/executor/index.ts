import axios from 'axios';
import { prisma } from '../db.js';
import { recordResolution } from '../knowhow/evidence.js';
import { sendExecutionResult } from '../line/notify.js';
import type { Proposal } from '@prisma/client';

async function execRailwayRestart(proposal: Proposal): Promise<string> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) throw new Error('RAILWAY_API_TOKEN未設定');

  const raw = proposal.rawData as Record<string, unknown>;
  const projectName = String(raw.projectName ?? '');
  const services = (raw.services as Array<{ name: string }>) ?? [];

  // Railway GraphQL でサービス再起動
  const res = await axios.post(
    'https://backboard.railway.com/graphql/v2',
    {
      query: `mutation ServiceInstanceRedeploy($serviceId: String!) {
        serviceInstanceRedeploy(serviceId: $serviceId)
      }`,
      variables: { serviceId: String((services[0] as { id?: string })?.id ?? '') },
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
  );

  if (res.data.errors) throw new Error(JSON.stringify(res.data.errors));
  return `${projectName} の ${services.map((s: { name: string }) => s.name).join(', ')} を再起動しました`;
}

async function execGitHubPR(proposal: Proposal): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN未設定');

  const consensus = proposal.debateResult as { consensus?: { solution?: string; cause?: string } };
  const solution = consensus?.consensus?.solution ?? '修正案';
  const cause = consensus?.consensus?.cause ?? '原因不明';

  // Issue作成（PRは実際のコード変更が必要なためIssueで代替）
  const res = await axios.post(
    'https://api.github.com/repos/tkgathr2/zeus/issues',
    {
      title: `[Zeus自動検知] ${proposal.title}`,
      body: `## 原因\n${cause}\n\n## 修正案\n${solution}\n\n## 検知時刻\n${proposal.createdAt.toISOString()}\n\n*Zeusが自動検知・提案しました*`,
      labels: ['zeus-auto', 'bug'],
    },
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      timeout: 10000,
    }
  );

  return `GitHub Issue #${res.data.number} を作成しました: ${res.data.html_url}`;
}

async function execSlackNotify(proposal: Proposal): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN未設定');

  const consensus = proposal.debateResult as { consensus?: { solution?: string } };

  await axios.post(
    'https://slack.com/api/chat.postMessage',
    {
      channel: '#aidx-room',
      text: `⚡ *Zeus自動検知* - ${proposal.title}\n対処: ${consensus?.consensus?.solution ?? '手動対応が必要です'}`,
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
  );

  return '#aidx-roomにSlack通知を送信しました';
}

async function execKnowhowCard(proposal: Proposal): Promise<string> {
  const apiKey = process.env.KB_API_KEY;
  if (!apiKey) throw new Error('KB_API_KEY未設定');

  const consensus = proposal.debateResult as { consensus?: { cause?: string; solution?: string } };

  await axios.post(
    'https://knowhow.up.railway.app/api/devin/memorize',
    {
      project_key: 'shikujiri-pdca',
      tool: 'zeus',
      status: 'success',
      environment: `zeus/${proposal.system}`,
      tags: ['zeus', 'しくじり先生', proposal.system],
      raw_log: `【しくじり先生・Zeus自動起票】${proposal.system}: ${proposal.title} / P真因=${consensus?.consensus?.cause} / D対策=${consensus?.consensus?.solution} / C検証=Zeus自動監視中 / A横展開=全幹部共有済`,
    },
    { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, timeout: 8000 }
  );

  return 'ノウハウキングにしくじり先生カードを記録しました';
}

export async function executeProposal(proposalId: number): Promise<void> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new Error(`Proposal #${proposalId} が見つかりません`);
  if (proposal.status !== 'approved') throw new Error(`Proposal #${proposalId} は承認済みではありません`);

  await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'executed' } });

  const raw = proposal.rawData as Record<string, unknown>;
  const consensus = proposal.debateResult as { consensus?: { executorHint?: string } };
  const hint = consensus?.consensus?.executorHint ?? 'github_pr';

  let detail = '';
  let success = false;

  try {
    if (hint === 'railway_restart') {
      detail = await execRailwayRestart(proposal);
    } else if (hint === 'slack_notify') {
      detail = await execSlackNotify(proposal);
    } else if (hint === 'knowhow_card') {
      detail = await execKnowhowCard(proposal);
    } else {
      detail = await execGitHubPR(proposal);
    }
    success = true;

    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: 'executed', executedAt: new Date() },
    });

    // 解決記録をノウハウキングに保存
    const alert = {
      system: proposal.system,
      severity: proposal.severity as 'low' | 'medium' | 'high' | 'critical',
      title: proposal.title,
      rawData: raw,
      detectedAt: proposal.createdAt.toISOString(),
    };
    await recordResolution(alert, hint, true);

  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
    await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'failed' } });
    await recordResolution(
      { system: proposal.system, severity: proposal.severity as 'low' | 'medium' | 'high' | 'critical', title: proposal.title, rawData: raw, detectedAt: proposal.createdAt.toISOString() },
      hint,
      false
    );
  }

  await sendExecutionResult(proposalId, success, detail);
}
