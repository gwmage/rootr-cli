import { z } from 'zod';

import { jsonResult, errorResult, makeClient, requireWorkspace } from './shared.js';

const shapeShape = z
  .object({
    id: z.string().describe('Unique shape id, referenced by edges\' from/to'),
    type: z.string().describe('e.g. "rect" | "ellipse" | "text" | "sticky" | "arrow"'),
    x: z.number().describe('X position'),
    y: z.number().describe('Y position'),
    w: z.number().describe('Width'),
    h: z.number().describe('Height'),
    text: z.string().optional().describe('Label/body text — text spine, put facts here'),
    style: z.record(z.unknown()).optional().describe('Free-form style hints (color, fill, etc.)'),
  })
  .describe('A whiteboard shape (node of the diagram).');

const edgeShape = z
  .object({
    id: z.string().describe('Unique edge id'),
    from: z.string().describe('Source shape id'),
    to: z.string().describe('Target shape id'),
    label: z.string().optional().describe('Edge label — text spine'),
    fromHandle: z.string().optional().describe('Connection point on the `from` shape, e.g. "b" (bottom)'),
    toHandle: z.string().optional().describe('Connection point on the `to` shape'),
  })
  .describe('A whiteboard edge (connection between two shapes).');

const sceneShape = z
  .object({
    shapes: z.array(shapeShape).optional(),
    edges: z.array(edgeShape).optional(),
  })
  .describe('Full scene: { shapes[], edges[] }.');

const AUTHORING_GUIDE =
  'Authoring guide: a scene is { shapes: [{id,type,x,y,w,h,text?,style?}], edges: [{id,from,to,label?}] } — shapes ' +
  'are the nodes of a lightweight diagram (flow diagrams, brainstorming, journey maps), edges connect them by id. ' +
  'Meaning must live in shape/edge TEXT (text/label) — that is what gets indexed into the knowledge graph; x/y/w/h ' +
  'and style are visual-only layout. Read the board first (rootr_read_whiteboard) before updating so you know the ' +
  'existing shape ids edges refer to.';

/** WHITEBOARD node tools: create/read/update the freeform diagram scene. */
export function registerWhiteboardTools(server) {
  server.registerTool(
    'rootr_create_whiteboard',
    {
      title: 'Create a Rootr whiteboard',
      description:
        'Create a new WHITEBOARD node (a freeform visual canvas) in a Rootr (루터) workspace, optionally seeded ' +
        'with an initial scene. Use WHITEBOARD for flow diagrams, brainstorming, journey maps — not for anything ' +
        'that needs typed/trackable rows (use DATABASE) or calculation (use SPREADSHEET). ' +
        AUTHORING_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        name: z.string().optional().describe('Whiteboard name/title'),
        parentId: z.string().optional().describe('Parent folder/node id to create it under'),
        icon: z.string().optional().describe('Emoji icon for the node'),
        scene: sceneShape.optional().describe('Initial scene; defaults to an empty board'),
        config: z.record(z.unknown()).optional().describe('Free-form whiteboard config object'),
        workspace: z.string().optional().describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ name, parentId, icon, scene, config, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.createWhiteboard(ws, { name, parentId, icon, scene, config });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_read_whiteboard',
    {
      title: 'Read a Rootr whiteboard',
      description:
        'Read a Rootr (루터) WHITEBOARD node — its full scene (shapes[] and edges[]). Call this before ' +
        'rootr_update_whiteboard so you know the current shape/edge ids and content.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        whiteboardId: z.string().describe('WHITEBOARD node id'),
      },
    },
    async ({ whiteboardId }) => {
      try {
        const client = makeClient();
        const result = await client.getWhiteboard(whiteboardId);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_update_whiteboard',
    {
      title: 'Update a Rootr whiteboard (replace the scene, or config/icon)',
      description:
        'Merge-patch a Rootr (루터) WHITEBOARD: update config/icon, or REPLACE THE WHOLE scene (if you pass ' +
        '`scene`, it replaces every existing shape/edge — call rootr_read_whiteboard first and resend the shapes/' +
        'edges you want to keep so you don\'t lose existing content). ' +
        AUTHORING_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        whiteboardId: z.string().describe('WHITEBOARD node id'),
        scene: sceneShape.optional().describe('COMPLETE scene to set — omitted existing shapes/edges will be dropped'),
        config: z.record(z.unknown()).optional().describe('Free-form whiteboard config object'),
        icon: z.string().optional().describe('Emoji icon for the node'),
      },
    },
    async ({ whiteboardId, scene, config, icon }) => {
      try {
        const client = makeClient();
        const result = await client.updateWhiteboard(whiteboardId, { scene, config, icon });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
