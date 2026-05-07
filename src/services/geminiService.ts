import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

export async function getMarketAnalysis(logs: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are an expert ICT (Inner Circle Trader) analyst. Analyze the following trading bot logs and provide insights on market structure, liquidity levels, and potential trade setups based on ICT concepts.\n\nLogs:\n${logs}\n\nProvide a concise analysis covering:\n1. Current market structure (bullish/bearish)\n2. Key liquidity levels identified\n3. Active ICT patterns detected\n4. Recommended bias for next session`,
          },
        ],
      },
    ],
  });

  return response.text ?? 'Unable to generate analysis.';
}
