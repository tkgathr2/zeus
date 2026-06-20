import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import type { SensorAlert, AIPosition, DebateResult } from '../types/index.js';

const CLAUDE_SYSTEM = `あなたはゼウス判断チームの分析担当AIです。
役割：問題の原因分析・確信度算出・司会統合。
出力はJSON形式で返してください。`;

const GPT_SYSTEM = `あなたはゼウス判断チームの修正案担当AIです。
役割：具体的な修正案の提示・成功確率の算出。
出力はJSON形式で返してください。`;

const GEMINI_SYSTEM = `あなたはゼウス判断チームのリスク評価担当AIです。
役割：リスク評価・損失推計・再発確率の算出。
出力はJSON形式で返してください。`;

function parseJSON(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

async function round1Analysis(alert: SensorAlert): Promise<AIPosition[]> {
  const context = `
システム: ${alert.system}
問題: ${alert.title}
データ: ${JSON.stringify(alert.rawData, null, 2)}
検知時刻: ${alert.detectedAt}
`;

  const [claudeRes, gptRes, geminiRes] = await Promise.all([
    generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: CLAUDE_SYSTEM,
      prompt: `以下の問題を分析し、原因と確信度(0-100)をJSONで返してください。\n${context}\n
例: {"cause": "DB接続タイムアウト", "confidence": 82, "analysis": "詳細説明"}`,
    }),
    generateText({
      model: openai('gpt-4o'),
      system: GPT_SYSTEM,
      prompt: `以下の問題に対する修正案と成功確率(0-100)をJSONで返してください。\n${context}\n
例: {"solution": "接続プール5→20に変更", "successRate": 91, "analysis": "詳細説明"}`,
    }),
    generateText({
      model: google('gemini-2.0-flash'),
      system: GEMINI_SYSTEM,
      prompt: `以下の問題のリスクと月次損失（万円）・30日再発確率(0-100)をJSONで返してください。\n${context}\n
例: {"stopRisk": 2, "dataLossRisk": 0, "monthlyLoss": 8.5, "reoccurrence30d": 73, "analysis": "詳細説明"}`,
    }),
  ]);

  const claudeData = parseJSON(claudeRes.text);
  const gptData = parseJSON(gptRes.text);
  const geminiData = parseJSON(geminiRes.text);

  return [
    {
      ai: 'claude',
      analysis: String(claudeData.analysis ?? claudeRes.text),
      confidence: Number(claudeData.confidence ?? 80),
    },
    {
      ai: 'chatgpt',
      analysis: String(gptData.analysis ?? gptRes.text),
      successRate: Number(gptData.successRate ?? 85),
    },
    {
      ai: 'gemini',
      analysis: String(geminiData.analysis ?? geminiRes.text),
      riskLevel: Number(geminiData.stopRisk ?? 5),
      estimatedLoss: Number(geminiData.monthlyLoss ?? 0),
      reoccurrenceRate: Number(geminiData.reoccurrence30d ?? 50),
    },
  ];
}

async function round2Debate(alert: SensorAlert, round1: AIPosition[]): Promise<AIPosition[]> {
  const r1Summary = round1.map(p => `【${p.ai}】${p.analysis}`).join('\n\n');

  const [claudeRes, gptRes, geminiRes] = await Promise.all([
    generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: CLAUDE_SYSTEM,
      prompt: `Round1の分析結果を踏まえ、確信度を再評価してください。\n\n${r1Summary}\n\n
JSONで返してください: {"confidence": 数値, "analysis": "反論・補足・確信度修正理由"}`,
    }),
    generateText({
      model: openai('gpt-4o'),
      system: GPT_SYSTEM,
      prompt: `Round1の分析結果を踏まえ、修正案を精査してください。\n\n${r1Summary}\n\n
JSONで返してください: {"solution": "最終案", "successRate": 数値, "analysis": "補足・代替案検討"}`,
    }),
    generateText({
      model: google('gemini-2.0-flash'),
      system: GEMINI_SYSTEM,
      prompt: `Round1の分析結果を踏まえ、リスク評価を精査してください。\n\n${r1Summary}\n\n
JSONで返してください: {"stopRisk": 数値, "dataLossRisk": 数値, "monthlyLoss": 数値, "reoccurrence30d": 数値, "analysis": "推奨・補足"}`,
    }),
  ]);

  const claudeData = parseJSON(claudeRes.text);
  const gptData = parseJSON(gptRes.text);
  const geminiData = parseJSON(geminiRes.text);

  return [
    {
      ai: 'claude',
      analysis: String(claudeData.analysis ?? claudeRes.text),
      confidence: Number(claudeData.confidence ?? round1[0].confidence),
    },
    {
      ai: 'chatgpt',
      analysis: String(gptData.analysis ?? gptRes.text),
      successRate: Number(gptData.successRate ?? round1[1].successRate),
    },
    {
      ai: 'gemini',
      analysis: String(geminiData.analysis ?? geminiRes.text),
      riskLevel: Number(geminiData.stopRisk ?? round1[2].riskLevel),
      estimatedLoss: Number(geminiData.monthlyLoss ?? round1[2].estimatedLoss),
      reoccurrenceRate: Number(geminiData.reoccurrence30d ?? round1[2].reoccurrenceRate),
    },
  ];
}

async function synthesize(alert: SensorAlert, round1: AIPosition[], round2: AIPosition[]): Promise<DebateResult['consensus']> {
  const summary = `
【Round1】
Claude: ${round1[0].analysis}（確信度${round1[0].confidence}%）
ChatGPT: ${round1[1].analysis}（成功率${round1[1].successRate}%）
Gemini: ${round1[2].analysis}（月次損失${round1[2].estimatedLoss}万円・再発率${round1[2].reoccurrenceRate}%）

【Round2】
Claude: ${round2[0].analysis}（確信度${round2[0].confidence}%）
ChatGPT: ${round2[1].analysis}（成功率${round2[1].successRate}%）
Gemini: ${round2[2].analysis}
`;

  const res = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: '3AIのディベート結果を統合して最終提案を生成する統合AIです。',
    prompt: `以下の3AIディベート結果を統合し、社長への最終提案をJSONで返してください。\n\n${summary}\n
JSON形式:
{
  "title": "問題タイトル（20文字以内）",
  "cause": "原因1行",
  "solution": "修正案1行",
  "confidence": 確信度(0-100),
  "successRate": 成功確率(0-100),
  "stopRisk": 停止リスク%(0-100),
  "dataLossRisk": データ損失リスク%(0-100),
  "monthlyLoss": 月次損失(万円・数値),
  "reoccurrence30d": 30日再発確率%(0-100)
}`,
  });

  const data = parseJSON(res.text);
  return {
    title: String(data.title ?? alert.title),
    cause: String(data.cause ?? '原因調査中'),
    solution: String(data.solution ?? '修正案検討中'),
    confidence: Number(data.confidence ?? 75),
    successRate: Number(data.successRate ?? 85),
    stopRisk: Number(data.stopRisk ?? 5),
    dataLossRisk: Number(data.dataLossRisk ?? 0),
    monthlyLoss: Number(data.monthlyLoss ?? 0),
    reoccurrence30d: Number(data.reoccurrence30d ?? 50),
  };
}

export async function runDebate(alert: SensorAlert): Promise<DebateResult> {
  console.log(`[Zeus] ディベート開始: ${alert.title}`);

  const round1 = await round1Analysis(alert);
  console.log('[Zeus] Round1完了');

  const round2 = await round2Debate(alert, round1);
  console.log('[Zeus] Round2完了');

  const consensus = await synthesize(alert, round1, round2);
  console.log('[Zeus] 最終合意完了');

  return { alert, round1, round2, consensus };
}
