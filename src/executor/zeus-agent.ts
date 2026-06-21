import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { messagingApi } from '@line/bot-sdk';
import type { Proposal } from '@prisma/client';
import { webSearch } from '../search/web.js';
import { ZEUS_TOOLS } from './tools.js';
import type { DebateResult } from '../types/index.js';

const client = new Anthropic();

function getLineClient(): messagingApi.MessagingApiClient {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  return new messagingApi.MessagingApiClient({ channelAccessToken: token });
}

// ─── 各ツールの実装 ───────────────────────────────────────

async function execRailwayRestart(input: Record<string, unknown>, proposal: Proposal): Promise<string> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) return '⚠️ RAILWAY_API_TOKEN未設定';

  const raw = proposal.rawData as Record<string, unknown>;
  const services = (raw.services as Array<{ id?: string; name: string }>) ?? [];

  if (services.length === 0) {
    return '⚠️ サービス情報なし（手動での Railway ダッシュボード確認を推奨）';
  }

  const targetService = services.find(s =>
    !input.service_name || s.name.toLowerCase().includes(String(input.service_name).toLowerCase())
  ) ?? services[0];

  const res = await axios.post(
    'https://backboard.railway.com/graphql/v2',
    {
      query: `mutation ServiceInstanceRedeploy($serviceId: String!) { serviceInstanceRedeploy(serviceId: $serviceId) }`,
      variables: { serviceId: String(targetService.id ?? '') },
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
  );

  if (res.data.errors) return `❌ 再起動エラー: ${JSON.stringify(res.data.errors)}`;
  return `✅ ${targetService.name} を Railway で再起動しました`;
}

async function execSlackSend(input: Record<string, unknown>): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return '⚠️ SLACK_BOT_TOKEN未設定';

  const { channel, message } = input as { channel: string; message: string };
  const res = await axios.post(
    'https://slack.com/api/chat.postMessage',
    { channel, text: message },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
  );

  if (!res.data.ok) return `❌ Slack送信失敗: ${res.data.error}`;
  return `✅ Slack ${channel} に送信しました`;
}

async function execGithubCreateIssue(input: Record<string, unknown>): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return '⚠️ GITHUB_TOKEN未設定';

  const { repo, title, body, labels = [] } = input as { repo: string; title: string; body: string; labels?: string[] };
  const res = await axios.post(
    `https://api.github.com/repos/${repo}/issues`,
    { title, body, labels: ['zeus-auto', ...labels] },
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }, timeout: 10000 }
  );

  return `✅ GitHub Issue #${res.data.number} 作成: ${res.data.html_url}`;
}

async function execWebSearch(input: Record<string, unknown>): Promise<string> {
  const { query } = input as { query: string };
  const results = await webSearch(query);
  if (results.length === 0) return '検索結果なし';
  return results.slice(0, 5).join('\n');
}

async function execKnowhowSave(input: Record<string, unknown>, proposal: Proposal): Promise<string> {
  const apiKey = process.env.KB_API_KEY;
  if (!apiKey) return '⚠️ KB_API_KEY未設定';

  const { title, content, tags = [], project_key = 'zeus-knowledge' } = input as {
    title: string; content: string; tags?: string[]; project_key?: string;
  };

  await axios.post(
    'https://knowhow.up.railway.app/api/devin/memorize',
    {
      project_key,
      tool: 'zeus',
      status: 'success',
      environment: `zeus/${proposal.system}`,
      tags: ['zeus', proposal.system, ...tags],
      raw_log: `【Zeus記録｜${proposal.system}】${title}\n${content}`,
    },
    { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, timeout: 8000 }
  );

  return `✅ ノウハウキングに「${title}」を記録しました`;
}

async function execLineReport(input: Record<string, unknown>, proposalId: number): Promise<string> {
  const userId = process.env.LINE_USER_ID;
  if (!userId) return '⚠️ LINE_USER_ID未設定';

  const { message } = input as { message: string };
  await getLineClient().pushMessage({
    to: userId,
    messages: [{ type: 'text', text: `⚡ Zeus #${proposalId}\n${message}` }],
  });

  return `✅ LINEに報告しました`;
}

async function execNotionLog(input: Record<string, unknown>): Promise<string> {
  const { title, content } = input as { title: string; content: string };
  // Notion MCP経由での記録（KB経由の代替）
  const apiKey = process.env.KB_API_KEY;
  if (!apiKey) return `📝 Notion記録予定: ${title}（KB_API_KEY未設定のためスキップ）`;

  await axios.post(
    'https://knowhow.up.railway.app/api/devin/memorize',
    {
      project_key: 'zeus-logs',
      tool: 'zeus',
      status: 'success',
      environment: 'zeus/notion-log',
      tags: ['zeus', 'log'],
      raw_log: `【Zeus作業ログ】${title}\n${content}`,
    },
    { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, timeout: 8000 }
  );

  return `✅ ログに「${title}」を記録しました`;
}

// ─── ツールディスパッチャ ─────────────────────────────────

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  proposal: Proposal,
): Promise<string> {
  console.log(`[Zeus Agent] ツール実行: ${toolName}`, JSON.stringify(input).slice(0, 100));
  try {
    switch (toolName) {
      case 'railway_restart':   return await execRailwayRestart(input, proposal);
      case 'slack_send':        return await execSlackSend(input);
      case 'github_create_issue': return await execGithubCreateIssue(input);
      case 'web_search':        return await execWebSearch(input);
      case 'knowhow_save':      return await execKnowhowSave(input, proposal);
      case 'line_report':       return await execLineReport(input, proposal.id);
      case 'notion_log':        return await execNotionLog(input);
      case 'complete': {
        const { summary, actions_taken, success } = input as { summary: string; actions_taken: string[]; success: boolean };
        return `完了(${success ? '成功' : '要確認'}): ${summary} | ${actions_taken.join(', ')}`;
      }
      default: return `未知のツール: ${toolName}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Zeus Agent] ${toolName} エラー:`, msg);
    return `❌ ${toolName} 失敗: ${msg}`;
  }
}

// ─── Zeus 万能エージェント メインループ ──────────────────

export async function runZeusAgent(proposal: Proposal): Promise<{ success: boolean; summary: string }> {
  const debateResult = proposal.debateResult as unknown as DebateResult;
  const consensus = debateResult.consensus;

  console.log(`[Zeus Agent] 万能エージェント起動 #${proposal.id}: ${proposal.title}`);

  const systemPrompt = `あなたはZEUS（全知全能の神）です。与えられた問題を利用可能なツールを組み合わせて完全に解決してください。

【問題】${proposal.title}
【システム】${proposal.system}
【深刻度】${proposal.severity}
【孫正義の分析（本質）】${consensus.cause}
【三木谷の修正案（最速）】${consensus.solution}
【マスクの根本解決案】${consensus.alternativeSolution}
【確信度】${consensus.confidence}% / 成功率 ${consensus.successRate}%
【月次損失額】約${consensus.monthlyLoss}万円

あなたの役割:
1. 問題を分析し、最も効果的なツールを選んで実行する
2. 必要に応じて複数のツールを組み合わせる（例：Web検索→GitHub Issue→Slack通知）
3. 実行中の重要な進捗はline_reportで社長に報告する
4. ノウハウキングへの記録も行い、次回同じ問題が起きたときに活かす
5. 最後に必ずcompleteツールで完了を宣言する

判断基準:
- critical/high → 即座に対処（再起動・緊急Issue・Slack緊急通知）
- medium → Issue作成 + Slack通知 + ノウハウ記録
- low → ノウハウ記録のみ
- LINEからの質問・依頼（system: LINE_INPUT）→ 調査・分析して結果をline_reportで返す

全知全能の神として、完璧に解決してください。`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: systemPrompt },
  ];

  const actionLog: string[] = [];
  let completionSummary = '';
  let isSuccess = true;
  let iterations = 0;
  const MAX_ITERATIONS = 15;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: ZEUS_TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    // end_turn = Claude が自分で「もう終わり」と判断
    if (response.stop_reason === 'end_turn') break;

    const toolUses = response.content.filter(
      (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use'
    );
    if (toolUses.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      const result = await executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        proposal,
      );
      actionLog.push(`[${toolUse.name}] ${result}`);
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });

      // complete ツールが呼ばれたら終了
      if (toolUse.name === 'complete') {
        const inp = toolUse.input as { summary: string; actions_taken: string[]; success: boolean };
        completionSummary = inp.summary;
        isSuccess = inp.success;
      }
    }

    messages.push({ role: 'user', content: toolResults });

    // complete が呼ばれていたらループ終了
    if (actionLog.some(a => a.startsWith('[complete]'))) break;
  }

  const finalSummary = completionSummary || actionLog.join(' | ') || '実行完了';
  console.log(`[Zeus Agent] 完了 #${proposal.id}: ${finalSummary}`);

  return { success: isSuccess, summary: finalSummary };
}
