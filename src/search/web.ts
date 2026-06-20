import axios from 'axios';

const TAVILY_BASE = 'https://api.tavily.com';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilyResult[];
}

export async function webSearch(query: string): Promise<string[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.log('[Zeus Search] TAVILY_API_KEY 未設定 → スキップ');
    return [];
  }

  try {
    const res = await axios.post<TavilyResponse>(
      `${TAVILY_BASE}/search`,
      {
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
      },
      { timeout: 10000 }
    );

    const results = res.data.results ?? [];
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(r => `[${r.title}] ${r.content.slice(0, 200)}`);
  } catch (err) {
    console.warn('[Zeus Search] ウェブ検索失敗:', err instanceof Error ? err.message : String(err));
    return [];
  }
}
