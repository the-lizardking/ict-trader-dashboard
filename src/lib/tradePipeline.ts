// Fetcher + parser for the bot repo's TRADE-PIPELINE.md.
//
// The doc on the bot repo follows a strict per-stage format
// (## Stage N: Name + **Files:** / **Inputs:** / **Outputs:** /
// **Description:** / **Failure modes:** / **Last verified:**) so the
// Trade Process tab can render each stage as a card without a markdown
// renderer. If the doc structure changes there, this parser must be
// updated in lockstep.

const PIPELINE_DOC_URL =
  'https://raw.githubusercontent.com/benbaichmankass/ict-trading-bot/main/docs/TRADE-PIPELINE.md';

const SOURCE_PAGE_URL =
  'https://github.com/benbaichmankass/ict-trading-bot/blob/main/docs/TRADE-PIPELINE.md';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface PipelineStage {
  number: number;
  name: string;
  files: string[];
  inputs: string;
  outputs: string;
  description: string;
  failureModes: string[];
  lastVerified: string | null;
}

export interface PipelineDoc {
  stages: PipelineStage[];
  fetchedAt: Date;
  sourceUrl: string;
  rawUrl: string;
}

let cache: { doc: PipelineDoc; expiresAt: number } | null = null;

export async function fetchPipeline(force = false): Promise<PipelineDoc> {
  if (!force && cache && cache.expiresAt > Date.now()) {
    return cache.doc;
  }
  const res = await fetch(PIPELINE_DOC_URL, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch pipeline doc (HTTP ${res.status})`);
  }
  const text = await res.text();
  const stages = parsePipeline(text);
  if (stages.length === 0) {
    throw new Error('Pipeline doc fetched but no stages were parsed.');
  }
  const doc: PipelineDoc = {
    stages,
    fetchedAt: new Date(),
    sourceUrl: SOURCE_PAGE_URL,
    rawUrl: PIPELINE_DOC_URL,
  };
  cache = { doc, expiresAt: Date.now() + CACHE_TTL_MS };
  return doc;
}

export function parsePipeline(markdown: string): PipelineStage[] {
  const headingRe = /^## Stage (\d+):\s*(.+?)\s*$/gm;
  const heads: Array<{ number: number; name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(markdown)) !== null) {
    heads.push({ number: parseInt(m[1], 10), name: m[2].trim(), index: m.index });
  }

  const stages: PipelineStage[] = [];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index;
    const end = i + 1 < heads.length ? heads[i + 1].index : markdown.length;
    const block = markdown.slice(start, end);
    stages.push({
      number: heads[i].number,
      name: heads[i].name,
      files: extractFiles(block),
      inputs: extractField(block, 'Inputs'),
      outputs: extractField(block, 'Outputs'),
      description: extractField(block, 'Description'),
      failureModes: extractList(block, 'Failure modes'),
      lastVerified: extractField(block, 'Last verified') || null,
    });
  }
  return stages;
}

// Match a labeled block: **Label:** ... up to the next bold-label
// block, the next `## ` heading, an `---` separator, or end of input.
function extractField(block: string, label: string): string {
  const re = new RegExp(
    `\\*\\*${escapeRegExp(label)}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Z][^*\\n]*\\*\\*|\\n## |\\n---|$)`,
    'i',
  );
  const match = block.match(re);
  if (!match) return '';
  return match[1].trim().replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s+/g, ' ');
}

function extractFiles(block: string): string[] {
  const raw = extractField(block, 'Files');
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/`([^`]+)`/);
      return m ? m[1] : part;
    });
}

function extractList(block: string, label: string): string[] {
  const re = new RegExp(
    `\\*\\*${escapeRegExp(label)}:\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*[A-Z][^*\\n]*\\*\\*|\\n## |\\n---|$)`,
    'i',
  );
  const match = block.match(re);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
