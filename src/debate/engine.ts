import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { gatherEvidence } from '../knowhow/evidence.js';
import type { SensorAlert, AIPosition, DebateResult } from '../types/index.js';

function parseJSON(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try { return JSON.parse(match[0]); } catch { return {}; }
}

async function round1(alert: SensorAlert, evidenceSummary: string): Promise<AIPosition[]> {
  const ctx = `
システム: ${alert.system}
問題: ${alert.title}
データ: ${JSON.stringify(alert.rawData)}
${evidenceSummary}
`;

  const [c, g, ge] = await Promise.all([
    generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: 'あなたはゼウスの原因分析担当Claudeです。根拠ある数値で答えてください。',
      prompt: `問題を分析し、主原因と確信度(0-100)をJSONで。\n${ctx}\n例:{"cause":"DB接続タイムアウト","confidence":82,"analysis":"詳細"}`,
    }),
    generateText({
      model: openai('gpt-4o'),
      system: 'あなたはゼウスの修正案担当ChatGPTです。実績に基づく数値で答えてください。',
      prompt: `修正案と成功確率(0-100)をJSONで。過去実績を加味してください。\n${ctx}\n例:{"solution":"接続プール5→20","successRate":91,"analysis":"詳細","estimatedMinutes":15}`,
    }),
    generateText({
      model: google('gemini-2.0-flash'),
      system: 'あなたはゼウスのリスク評価担当Geminiです。定量的に評価してください。',
      prompt: `リスクと損失をJSONで。\n${ctx}\n例:{"stopRisk":2,"dataLossRisk":0,"monthlyLoss":8.5,"reoccurrence30d":73,"analysis":"詳細"}`,
    }),
  ]);

  return [
    { ai: 'claude', analysis: parseJSON(c.text).analysis as string ?? c.text, confidence: Number(parseJSON(c.text).confidence ?? 80), rawData: parseJSON(c.text) },
    { ai: 'chatgpt', analysis: parseJSON(g.text).analysis as string ?? g.text, successRate: Number(parseJSON(g.text).successRate ?? 85), rawData: parseJSON(g.text) },
    { ai: 'gemini', analysis: parseJSON(ge.text).analysis as string ?? ge.text, riskLevel: Number(parseJSON(ge.text).stopRisk ?? 5), estimatedLoss: Number(parseJSON(ge.text).monthlyLoss ?? 0), reoccurrenceRate: Number(parseJSON(ge.text).reoccurrence30d ?? 50), rawData: parseJSON(ge.text) },
  ];
}

async function round2(round1Results: AIPosition[]): Promise<AIPosition[]> {
  const r1 = round1Results.map(p =>
    `【${p.ai.toUpperCase()}】${p.analysis}（${p.ai === 'claude' ? `確信度${p.confidence}%` : p.ai === 'chatgpt' ? `成功率${p.successRate}%` : `損失${p.estimatedLoss}万円・再発${p.reoccurrenceRate}%`}）`
  ).join('\n\n');

  const [c, g, ge] = await Promise.all([
    generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: 'ゼウス原因分析担当Claude。他AIの分析を批判的に検討し確信度を再評価してください。',
      prompt: `Round1結果:\n${r1}\n\n反論・補足を加え確信度を修正してJSONで。\n例:{"confidence":74,"analysis":"GPT案に設定ミス12%の可能性を加味し確信度を下方修正"}`,
    }),
    generateText({
      model: openai('gpt-4o'),
      system: 'ゼウス修正案担当ChatGPT。他AIの意見を踏まえ最終修正案を精査してください。',
      prompt: `Round1結果:\n${r1}\n\n最善案と代替案をJSONで。\n例:{"solution":"案A:プール拡張","successRate":94,"alternative":"案B:タイムアウト延長(成功率78%・再発率67%)","analysis":"案Aを推奨"}`,
    }),
    generateText({
      model: google('gemini-2.0-flash'),
      system: 'ゼウスリスク担当Gemini。全AIの意見を踏まえリスクを精査してください。',
      prompt: `Round1結果:\n${r1}\n\n最終リスク評価をJSONで。\n例:{"stopRisk":2,"dataLossRisk":0,"monthlyLoss":8.5,"reoccurrence30d":67,"recommendation":"案Aを強く推奨・案Bは一時しのぎ"}`,
    }),
  ]);

  return [
    { ai: 'claude', analysis: parseJSON(c.text).analysis as string ?? c.text, confidence: Number(parseJSON(c.text).confidence ?? round1Results[0].confidence), rawData: parseJSON(c.text) },
    { ai: 'chatgpt', analysis: parseJSON(g.text).analysis as string ?? g.text, successRate: Number(parseJSON(g.text).successRate ?? round1Results[1].successRate), rawData: parseJSON(g.text) },
    { ai: 'gemini', analysis: parseJSON(ge.text).analysis as string ?? ge.text, riskLevel: Number(parseJSON(ge.text).stopRisk ?? round1Results[2].riskLevel), estimatedLoss: Number(parseJSON(ge.text).monthlyLoss ?? round1Results[2].estimatedLoss), reoccurrenceRate: Number(parseJSON(ge.text).reoccurrence30d ?? round1Results[2].reoccurrenceRate), rawData: parseJSON(ge.text) },
  ];
}

async function synthesize(alert: SensorAlert, r1: AIPosition[], r2: AIPosition[], evidenceSampleSize: number): Promise<DebateResult['consensus']> {
  const summary = `
【Round1】
Claude: ${r1[0].analysis}（確信度${r1[0].confidence}%）
ChatGPT: ${r1[1].analysis}（成功率${r1[1].successRate}%）
Gemini: ${r1[2].analysis}（月次損失${r1[2].estimatedLoss}万円・再発率${r1[2].reoccurrenceRate}%）

【Round2 - 反論・精査後】
Claude: ${r2[0].analysis}（確信度${r2[0].confidence}%）
ChatGPT: ${r2[1].analysis}（成功率${r2[1].successRate}%）
Gemini: ${r2[2].analysis}
過去実績サンプル数: ${evidenceSampleSize}件
`;

  const res = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: '3AIディベートを統合して社長への最終提案を生成する統合Claudeです。',
    prompt: `以下のディベート結果を統合しJSONで最終提案を生成してください。\n\n${summary}\n
{
  "title": "問題タイトル20文字以内",
  "cause": "原因1行",
  "solution": "最優先修正案1行",
  "confidence": 確信度(0-100),
  "successRate": 成功確率(0-100),
  "stopRisk": 停止リスク%(0-100),
  "dataLossRisk": データ損失リスク%(0-100),
  "monthlyLoss": 月次損失(万円),
  "reoccurrence30d": 30日再発確率%(0-100),
  "estimatedMinutes": 修正所要時間(分),
  "executorHint": "自動実行のためのヒント(railway_restart|github_pr|slack_notify|knowhow_card)"
}`,
  });

  const d = parseJSON(res.text);
  return {
    title: String(d.title ?? alert.title),
    cause: String(d.cause ?? '調査中'),
    solution: String(d.solution ?? '検討中'),
    confidence: Number(d.confidence ?? 75),
    successRate: Number(d.successRate ?? 85),
    stopRisk: Number(d.stopRisk ?? 5),
    dataLossRisk: Number(d.dataLossRisk ?? 0),
    monthlyLoss: Number(d.monthlyLoss ?? 0),
    reoccurrence30d: Number(d.reoccurrence30d ?? 50),
    estimatedMinutes: Number(d.estimatedMinutes ?? 30),
    executorHint: String(d.executorHint ?? 'github_pr'),
  };
}

export async function runDebate(alert: SensorAlert): Promise<DebateResult> {
  console.log(`[Zeus] ディベート開始: ${alert.title}`);

  // 実績データ収集（数値根拠）
  const evidence = await gatherEvidence(alert);
  const evidenceSummary = evidence.sampleSize > 0
    ? `\n【過去実績】${evidence.sampleSize}件 / 成功率${evidence.successRate}% / 平均${evidence.avgDurationMin}分（${evidence.source === 'historical' ? '実績ベース' : 'AI推定'}）`
    : `\n【過去実績】なし（AI推定値を使用）`;

  const r1 = await round1(alert, evidenceSummary);
  console.log('[Zeus] Round1完了');

  const r2 = await round2(r1);
  console.log('[Zeus] Round2完了');

  const consensus = await synthesize(alert, r1, r2, evidence.sampleSize);
  console.log('[Zeus] 最終合意完了');

  return { alert, round1: r1, round2: r2, consensus, evidence };
}
