import { z } from 'zod';

import { textResult, errorResult, makeClient, requireWorkspace } from './shared.js';

/** rootr_ask — GraphRAG root-cause-analysis question answering. */
export function registerAskTools(server) {
  server.registerTool(
    'rootr_ask',
    {
      title: 'Ask a question over the Rootr knowledge graph (RCA)',
      description:
        'Ask a natural-language question against a Rootr (루터) workspace\'s knowledge graph (GraphRAG). Good for ' +
        'root-cause-analysis style questions ("why did X happen", "what changed before Y") that need to reason ' +
        'across linked documents and LOG anomalies rather than a single document. Requires the `ask` scope. ' +
        'Returns the answer text plus citations pointing at the source documents/quotes it drew from.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        question: z.string().describe('Natural-language question to ask'),
        workspace: z
          .string()
          .optional()
          .describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ question, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.ask(ws, question);
        const citations = Array.isArray(result.citations) ? result.citations : [];
        const citationLines = citations.map((c) => `- ${c.documentPath}: ${c.quote}`);
        const text = [
          result.text || '(no answer text)',
          '',
          citations.length ? 'Citations:' : '(no citations)',
          ...citationLines,
        ].join('\n');
        return textResult(text);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
