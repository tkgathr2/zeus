import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { gatherEvidence } from '../knowhow/evidence.js';
import { webSearch } from '../search/web.js';
import { recallFeedbackHints } from '../learning/feedback.js';
import type { SensorAlert, AIPosition, DebateResult } from '../types/index.js';

function parseJSON(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try { return JSON.parse(match[0]); } catch { return {}; }
}

function buildContext(alert: SensorAlert, evidenceSummary: string, webResults: string[], feedbackHints: string): string {
  const webCtx = webResults.length > 0
    ? `\n\n【ウェブ調査結果 (${webResults.length}件)】\n${webResults.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : '';
  return `システム: ${alert.system}
問題: ${alert.title}
データ: ${JSON.stringify(alert.rawData)}
${evidenceSummary}${webCtx}${feedbackHints}`;
}

// ── Proposer Round ─────────────────────────────────────
// 孫正義(Claude) / 三木谷(GPT) / マスク(Gemini) が並列で第一見解を出す
async function proposerRound(ctx: string): Promise<AIPosition[]> {
  const [son, mikitani, musk] = await Promise.all([

    // 孫正義型 (Claude) — 10年先視座・ノウハウ+ウェブ統合・自分の意見を明言
    generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: `あなたは孫正義です。10年先を見通す圧倒的な視座でこの問題の本質を見抜き、自分の意見を明言してください。
「私は〜と考えます」と必ず1人称で語る。根拠となる数字を含める。感情を動かす言葉で語れ。
ウェブ調査結果と過去実績を統合して、パターンと本質を読み取れ。`,
      prompt: `以下の問題を分析し、原因・確信度・10年視座の提言をJSONで出力してください。
${ctx}

出力形式:
{"cause":"根本原因","confidence":88,"analysis":"私は〜と考えます（本文・数字含む）","vision":"10年視座の提言","evidence_used":true}`,
    }),

    // 三木谷型 (GPT) — 即断即決・最速解決・実行まで担当
    generateText({
      model: openai('gpt-4o'),
      system: `あなたは三木谷浩史（楽天創業者）です。「即断即決・スピード」が信条。
今日中に解決できる最速の修正案を出してください。「私がCEOなら今日中にこうします」と言い切ること。迷わない。実行まで自分が担当する気概で。`,
      prompt: `修正案・成功確率・実行ステップをJSONで出力してください。
${ctx}

出力形式:
{"solution":"最速修正案","successRate":94,"steps":["Step1","Step2","Step3"],"estimatedMinutes":15,"alternative":"代替案（より根本的）","analysis":"私がCEOなら今日中にこうします（理由）"}`,
    }),

    // マスク型 (Gemini) — 根本から問い直す・やめる判断もする
    generateText({
      model: google('gemini-2.0-flash'),
      system: `あなたはイーロン・マスクです。「First Principles Thinking（第一原理思考）」で全てを問い直す。
「そもそもこのシステムは本当に必要か？」から始めてください。修正ではなく廃止・根本再設計という判断も厭わない。`,
      prompt: `この問題を第一原理で分析し、リスク評価と根本提言をJSONで出力してください。
${ctx}

出力形式:
{"premise":"そもそもの前提への問い","rootCause":"第一原理で見た根本原因","stopRisk":15,"dataLossRisk":5,"monthlyLoss":12,"reoccurrence30d":80,"verdict":"やるべき/廃止/作り直し","alternativeVision":"根本解決のビジョン"}`,
    }).catch(err => {
      console.warn('[Zeus] Gemini(R1)フォールバック:', String(err).slice(0, 80));
      return { text: '{"premise":"API停止中","rootCause":"Gemini APIクォータ超過","stopRisk":5,"dataLossRisk":0,"monthlyLoss":0,"reoccurrence30d":50,"verdict":"やるべき","alternativeVision":"Claude/GPTの分析を参照"}' };
    }),
  ]);

  return [
    {
      ai: 'claude',
      analysis: (parseJSON(son.text).analysis as string) ?? son.text,
      confidence: Number(parseJSON(son.text).confidence ?? 80),
      rawData: parseJSON(son.text),
    },
    {
      ai: 'chatgpt',
      analysis: (parseJSON(mikitani.text).analysis as string) ?? mikitani.text,
      successRate: Number(parseJSON(mikitani.text).successRate ?? 85),
      rawData: parseJSON(mikitani.text),
    },
    {
      ai: 'gemini',
      analysis: (parseJSON(musk.text).verdict as string) ?? (parseJSON(musk.text).rootCause as string) ?? musk.text,
      riskLevel: Number(parseJSON(musk.text).stopRisk ?? 5),
      estimatedLoss: Number(parseJSON(musk.text).monthlyLoss ?? 0),
      reoccurrenceRate: Number(parseJSON(musk.text).reoccurrence30d ?? 50),
      rawData: parseJSON(musk.text),
    },
  ];
}

// ── Cross-review Round ─────────────────────────────────
// 3人が互いの意見を見て見解を更新する
async function crossReviewRound(round1: AIPosition[]): Promise<AIPosition[]> {
  const r1Summary = [
    `【孫正義（Claude）確信度${round1[0].confidence}%】\n${round1[0].analysis}`,
    `【三木谷（GPT）成功率${round1[1].successRate}%】\n${round1[1].analysis}`,
    `【マスク（Gemini）月次損失${round1[2].estimatedLoss}万円・再発${round1[2].reoccurrenceRate}%】\n${round1[2].analysis}`,
  ].join('\n\n');

  const [son2, mikitani2, musk2] = await Promise.all([

    generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: `あなたは孫正義です。他の2人（三木谷・マスク）の意見を聞いて、自分の見解を更新してください。同意する部分・反論する部分を明確に。`,
      prompt: `3人の初期分析:\n${r1Summary}\n\n私の更新見解をJSONで:
{"confidence":85,"analysis":"更新後の見解（同意点・反論・統合）","updatedVision":"3人の議論を踏まえた最終ビジョン"}`,
    }),

    generateText({
      model: openai('gpt-4o'),
      system: `あなたは三木谷浩史です。孫正義の長期視座とマスクの根本問い直しを踏まえ、最速実行案を更新してください。`,
      prompt: `3人の初期分析:\n${r1Summary}\n\n最終実行案をJSONで:
{"solution":"更新後の最優先修正案","successRate":92,"alternative":"代替案（マスク的根本解決）","analysis":"他の2人の意見を踏まえた最終判断"}`,
    }),

    generateText({
      model: google('gemini-2.0-flash'),
      system: `あなたはイーロン・マスクです。孫正義と三木谷の意見を聞いて、リスク評価を更新。「やってはいけないこと」を明確に。`,
      prompt: `3人の初期分析:\n${r1Summary}\n\n最終リスク評価をJSONで:
{"stopRisk":10,"dataLossRisk":2,"monthlyLoss":8,"reoccurrence30d":60,"finalVerdict":"最終判断","doNotDo":"絶対やってはいけないこと"}`,
    }).catch(err => {
      console.warn('[Zeus] Gemini(R2)フォールバック:', String(err).slice(0, 80));
      return { text: '{"stopRisk":5,"dataLossRisk":0,"monthlyLoss":0,"reoccurrence30d":50,"finalVerdict":"Claude/GPT分析を参照","doNotDo":"Gemini APIが一時停止中"}' };
    }),
  ]);

  return [
    {
      ai: 'claude',
      analysis: (parseJSON(son2.text).analysis as string) ?? son2.text,
      confidence: Number(parseJSON(son2.text).confidence ?? round1[0].confidence),
      rawData: parseJSON(son2.text),
    },
    {
      ai: 'chatgpt',
      analysis: (parseJSON(mikitani2.text).analysis as string) ?? mikitani2.text,
      successRate: Number(parseJSON(mikitani2.text).successRate ?? round1[1].successRate),
      rawData: parseJSON(mikitani2.text),
    },
    {
      ai: 'gemini',
      analysis: (parseJSON(musk2.text).finalVerdict as string) ?? musk2.text,
      riskLevel: Number(parseJSON(musk2.text).stopRisk ?? round1[2].riskLevel),
      estimatedLoss: Number(parseJSON(musk2.text).monthlyLoss ?? round1[2].estimatedLoss),
      reoccurrenceRate: Number(parseJSON(musk2.text).reoccurrence30d ?? round1[2].reoccurrenceRate),
      rawData: parseJSON(musk2.text),
    },
  ];
}

// ── Aggregator ─────────────────────────────────────────
// Claude 第2インスタンスが3人の議論を統合して社長への最終提案を生成
async function aggregate(
  alert: SensorAlert,
  r1: AIPosition[],
  r2: AIPosition[],
  evidenceSampleSize: number,
): Promise<DebateResult['consensus']> {
  const summary = `
【孫正義（Claude）の視座】
初回: ${r1[0].analysis}（確信度${r1[0].confidence}%）
更新: ${r2[0].analysis}（確信度${r2[0].confidence}%）
ビジョン: ${(r2[0].rawData?.updatedVision as string) ?? ''}

【三木谷（GPT）の視座】
初回: ${r1[1].analysis}（成功率${r1[1].successRate}%）
更新: ${r2[1].analysis}（成功率${r2[1].successRate}%）
代替案: ${(r2[1].rawData?.alternative as string) ?? ''}

【マスク（Gemini）の視座】
初回: ${r1[2].analysis}（月次損失${r1[2].estimatedLoss}万円）
更新: ${r2[2].analysis}
禁止事項: ${(r2[2].rawData?.doNotDo as string) ?? ''}

過去実績サンプル数: ${evidenceSampleSize}件
`;

  const res = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: `孫正義・三木谷・マスク3人のディベートを統合し、社長への最終提案を作る統合AIです。
3つの視座のベストを組み合わせた、実行可能で戦略的な提案を生成してください。`,
    prompt: `以下の3AI（孫正義/三木谷/マスク）ディベートを統合し、最終提案JSONを生成:

${summary}

{
  "title": "問題タイトル20文字以内",
  "cause": "原因1行（孫正義視点の本質）",
  "solution": "最速修正案1行（三木谷視点）",
  "confidence": 確信度(0-100),
  "successRate": 成功確率(0-100),
  "stopRisk": 停止リスク%(0-100),
  "dataLossRisk": データ損失リスク%(0-100),
  "monthlyLoss": 月次損失(万円),
  "reoccurrence30d": 30日再発確率%(0-100),
  "estimatedMinutes": 修正所要時間(分),
  "executorHint": "railway_restart|github_pr|slack_notify|knowhow_card",
  "alternativeSolution": "代替案1行（マスク視点の根本解決）"
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
    alternativeSolution: String(d.alternativeSolution ?? ''),
  };
}

// ── メインエントリポイント ─────────────────────────────
export async function runDebate(alert: SensorAlert): Promise<DebateResult> {
  console.log(`[Zeus] MoAディベート開始: ${alert.title}`);

  // 並列でコンテキスト収集（実績 + ウェブ2クエリ + 過去フィードバック学習）
  const [evidence, web1, web2, feedbackHints] = await Promise.all([
    gatherEvidence(alert),
    webSearch(alert.title),
    webSearch(`${alert.system} ${alert.title} 解決策 ベストプラクティス`),
    recallFeedbackHints(alert.system, alert.title),
  ]);

  const webResults = [...new Set([...web1, ...web2])].slice(0, 6);
  const evidenceSummary = evidence.sampleSize > 0
    ? `\n【過去実績】${evidence.sampleSize}件 / 成功率${evidence.successRate}% / 平均${evidence.avgDurationMin}分（${evidence.source === 'historical' ? '実績ベース' : 'AI推定'}）\n事例: ${evidence.relatedCases.slice(0, 2).join(' / ')}`
    : `\n【過去実績】なし（AI推定値を使用）`;

  if (feedbackHints) {
    console.log(`[Zeus] 過去フィードバック学習を取得（${alert.system}）`);
  }

  const ctx = buildContext(alert, evidenceSummary, webResults, feedbackHints);
  console.log(`[Zeus] コンテキスト確保（ウェブ${webResults.length}件 / 実績${evidence.sampleSize}件）`);

  const r1 = await proposerRound(ctx);
  console.log('[Zeus] Proposer Round完了（孫正義 / 三木谷 / マスク）');

  const r2 = await crossReviewRound(r1);
  console.log('[Zeus] Cross-review Round完了');

  const consensus = await aggregate(alert, r1, r2, evidence.sampleSize);
  console.log('[Zeus] Aggregator統合完了');

  return { alert, round1: r1, round2: r2, consensus, evidence };
}
