import { z } from 'zod';

import { jsonResult, errorResult, makeClient, requireWorkspace } from './shared.js';

/**
 * Authoring guide, repeated (shortened) across every tool description so an
 * agent that only sees ONE of these tools still gets the rules: assertion
 * titles, text-spine-carries-meaning, 16:9 canvas, kind for slide role.
 */
const AUTHORING_GUIDE =
  'Authoring guide: give each slide ONE assertion-style title (a claim, e.g. "Latency dropped 40% after the cache fix" — ' +
  'not a topic label like "Latency"), plus blocks[] (bullet-like {id, heading?, body?, icon?} items) and, where useful, ' +
  'a diagram ({type:"mermaid", code}) or images. Canvas is 16:9 (1280x720). Meaning must live in TEXT — ' +
  'title/blocks[].heading/blocks[].body/notes are what auto-connects into the knowledge graph; diagrams/code/html and the ' +
  'image pixels themselves are visual-only and are NOT indexed, so never put facts ONLY in a diagram or picture.\n' +
  'Images: `image` is the single primary/background image (cover, section, full-bleed); `images[]` holds additional ' +
  'inserted images placed on the slide. Each image is {id?, src?, alt?, placement?, prompt?, x?, y?, w?, h?}. ' +
  'Set `src` to an uploaded file URL (upload via POST /v1/attachments/upload, then use /api/v1/attachments/{id}/raw), ' +
  'an https URL, or a data: URI — you cannot upload the file bytes through these MCP tools, only reference the resulting URL. ' +
  'To get a REAL image, call rootr_generate_image with an English prompt (say "no text"), then put the returned `url` ' +
  'into the slide image\'s `src`; rootr_remove_image_background cuts out an image\'s background. ' +
  '`placement` is a layout hint ("full"|"right"|"top"|...); x/y/w/h give freeform PPT-style placement in 1280x720 canvas ' +
  'coords. ALWAYS add an `alt` caption to every image — alt text is part of the graph text spine, so a captioned image ' +
  'connects into the knowledge graph while an uncaptioned one does not.\n' +
  'Use kind to mark each slide\'s role: "cover" (deck title slide), "section" (chapter divider), "content" (body slide, ' +
  'the default), "closing" (last slide / call to action).\n' +
  'Page numbers: "content" and "section" slides automatically show a page number that follows the slide order (it ' +
  're-numbers itself when slides are reordered), so you do NOT set it yourself. "cover"/"closing" have none by design.';

/** Fill in slide/block ids that were omitted, so agents don't have to invent unique ids by hand. */
function ensureSlideIds(slides) {
  if (!Array.isArray(slides)) return slides;
  return slides.map((s, i) => {
    const slide = { ...s, id: s.id || `SLD-${String(i + 1).padStart(3, '0')}` };
    if (Array.isArray(slide.blocks)) {
      slide.blocks = slide.blocks.map((b, bi) => ({ ...b, id: b.id || `${slide.id}-B${bi + 1}` }));
    }
    return slide;
  });
}

const imageShape = z
  .object({
    id: z.string().optional().describe('Stable image id (for multi-image slides). Auto-generated if omitted.'),
    src: z
      .string()
      .optional()
      .describe(
        'Image URL: an uploaded file (/api/v1/attachments/{id}/raw — upload first via POST /v1/attachments/upload), ' +
          'an https URL, or a data: URI. Omit and set `prompt` instead to have it AI-generated later.',
      ),
    alt: z
      .string()
      .optional()
      .describe('Caption / alt text. Part of the knowledge-graph text spine — ALWAYS set this so the image is indexed.'),
    prompt: z.string().optional().describe('English AI-generation prompt, no text baked into the image (used when src is absent)'),
    placement: z.string().optional().describe('Layout hint: "full" | "right" | "top" | ...'),
    x: z.number().optional().describe('Freeform placement X in 1280x720 canvas coords'),
    y: z.number().optional().describe('Freeform placement Y in 1280x720 canvas coords'),
    w: z.number().optional().describe('Freeform placement width in canvas coords'),
    h: z.number().optional().describe('Freeform placement height in canvas coords'),
  })
  .describe('A slide image. Set src (uploaded/https/data: URI) or prompt (AI-generate); always add an alt caption.');

const slideShape = z
  .object({
    id: z.string().optional().describe('Unique slide id, e.g. "SLD-001". Auto-generated if omitted.'),
    kind: z.string().optional().describe('cover | section | content | closing'),
    layout: z.string().optional().describe('Layout hint, e.g. "2-col" | "kpi-grid" | "timeline"'),
    title: z.string().optional().describe('Assertion-style title (the claim this slide makes) — text spine'),
    blocks: z
      .array(
        z.object({
          id: z.string().optional().describe('Unique block id. Auto-generated if omitted.'),
          heading: z.string().optional(),
          body: z.string().optional(),
          icon: z.string().optional().describe('Semantic hint, e.g. "shield" | "calendar" | "chip"'),
        }),
      )
      .optional()
      .describe('Bullet-like items — text spine'),
    diagram: z
      .object({ type: z.literal('mermaid').optional(), code: z.string() })
      .optional()
      .describe('Mermaid diagram; visual only, not indexed — keep the facts in title/blocks too'),
    image: imageShape
      .optional()
      .describe('Single primary/background image (cover, section, full-bleed). See imageShape fields.'),
    images: z
      .array(imageShape)
      .optional()
      .describe('Additional inserted/uploaded images placed on the slide (up to 50). Each should carry an alt caption.'),
    code: z.string().optional().describe('Code-first React slide source (max design freedom, advanced use)'),
    html: z.string().optional().describe('Rendered self-contained slide HTML (usually machine-produced, not hand-authored)'),
    notes: z.string().optional().describe('Speaker notes — text spine'),
  })
  .describe('A single slide. See tool description for the authoring guide.');

const themeShape = z
  .object({
    colors: z
      .object({
        primary: z.string().optional(),
        secondary: z.string().optional(),
        accent: z.string().optional(),
        bg: z.string().optional(),
        text: z.string().optional(),
        muted: z.string().optional(),
      })
      .optional(),
    fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).optional(),
    keyVisualStyle: z.string().optional(),
  })
  .optional()
  .describe('Deck theme; missing keys fall back to sane defaults');

/** PRESENTATION (slide deck) node tools: create/read/update deck, append + reorder + patch slides. */
export function registerPresentationTools(server) {
  server.registerTool(
    'rootr_create_presentation',
    {
      title: 'Create a Rootr presentation (slide deck)',
      description:
        'Create a new PRESENTATION node (a slide deck) in a Rootr (루터) workspace, optionally seeded with an ' +
        'initial theme and slides. ' +
        AUTHORING_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        name: z.string().optional().describe('Deck name/title'),
        parentId: z.string().optional().describe('Parent folder/node id to create the deck under'),
        theme: themeShape,
        slides: z.array(slideShape).optional().describe('Initial slides, in order'),
        config: z.record(z.unknown()).optional().describe('Free-form deck config/settings object'),
        icon: z.string().optional().describe('Emoji icon for the deck node'),
        workspace: z
          .string()
          .optional()
          .describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ name, parentId, theme, slides, config, icon, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.createPresentation(ws, {
          name,
          parentId,
          theme,
          slides: ensureSlideIds(slides),
          config,
          icon,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_read_presentation',
    {
      title: 'Read a Rootr presentation',
      description:
        'Read a Rootr (루터) PRESENTATION node — its theme and full slides array. Read this before ' +
        'rootr_update_presentation / rootr_append_presentation_slides / rootr_reorder_presentation_slides so you ' +
        'know the current slide ids and content.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        presentationId: z.string().describe('PRESENTATION node id'),
      },
    },
    async ({ presentationId }) => {
      try {
        const client = makeClient();
        const result = await client.getPresentation(presentationId);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_update_presentation',
    {
      title: 'Update a Rootr presentation (theme/slides/config)',
      description:
        'Merge-patch a Rootr (루터) PRESENTATION: update theme and/or config, or REPLACE THE WHOLE slides array ' +
        '(if you pass `slides`, it replaces every existing slide — call rootr_read_presentation first and resend ' +
        'slides you want to keep, or use rootr_append_presentation_slides / rootr_update_presentation_slide instead ' +
        'for incremental changes). ' +
        AUTHORING_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        presentationId: z.string().describe('PRESENTATION node id'),
        theme: themeShape,
        slides: z
          .array(slideShape)
          .optional()
          .describe('COMPLETE slides array to set — omitted existing slides will be dropped'),
        config: z.record(z.unknown()).optional().describe('Free-form deck config/settings object'),
        icon: z.string().optional().describe('Emoji icon for the deck node'),
      },
    },
    async ({ presentationId, theme, slides, config, icon }) => {
      try {
        const client = makeClient();
        const result = await client.updatePresentation(presentationId, {
          theme,
          slides: ensureSlideIds(slides),
          config,
          icon,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_append_presentation_slides',
    {
      title: 'Append slides to a Rootr presentation (preferred way to add slides)',
      description:
        'Append one or more slides to the END of a Rootr (루터) PRESENTATION, without touching existing slides. ' +
        'PREFER this over rootr_update_presentation when you are only adding new slides. ' +
        AUTHORING_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        presentationId: z.string().describe('PRESENTATION node id'),
        slides: z.array(slideShape).describe('Slides to append, in order'),
      },
    },
    async ({ presentationId, slides }) => {
      try {
        const client = makeClient();
        const result = await client.appendPresentationSlides(presentationId, ensureSlideIds(slides));
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_update_presentation_slide',
    {
      title: 'Update ONE slide of a Rootr presentation',
      description:
        'Merge-patch a single slide by slideId, without touching the rest of the deck. Good for a precise, ' +
        'targeted edit (e.g. rewrite one slide\'s title/blocks); use rootr_append_presentation_slides instead when ' +
        'you are only adding new slides. Call rootr_read_presentation first to get the exact slideId. ' +
        AUTHORING_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        presentationId: z.string().describe('PRESENTATION node id'),
        slideId: z.string().describe('Slide id to update (must belong to the deck)'),
        slide: slideShape.describe('Partial slide fields to merge into the existing slide'),
      },
    },
    async ({ presentationId, slideId, slide }) => {
      try {
        const client = makeClient();
        const result = await client.updatePresentationSlide(presentationId, slideId, slide);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_reorder_presentation_slides',
    {
      title: 'Reorder the slides of a Rootr presentation',
      description:
        'Reorder a Rootr (루터) PRESENTATION\'s slides. `order` must be the FULL list of the deck\'s slide ids, ' +
        'in the new desired order — call rootr_read_presentation first to get the current ids.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        presentationId: z.string().describe('PRESENTATION node id'),
        order: z.array(z.string()).describe('Complete ordered array of slide ids'),
      },
    },
    async ({ presentationId, order }) => {
      try {
        const client = makeClient();
        const result = await client.reorderPresentationSlides(presentationId, order);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_generate_image',
    {
      title: 'Generate an image from a text prompt (for a slide)',
      description:
        'Generate an image from a text prompt with AI (Gemini) and store it as a workspace attachment. Use this ' +
        'when building a Rootr (루터) presentation so slides get real, on-brand visuals instead of empty image ' +
        'placeholders — generate the image, then put the returned `url` into a slide image\'s `src` via ' +
        'rootr_update_presentation_slide (image or images[]). Returns { id, url, filename, mimeType, size }.\n' +
        'Prompt tips: describe a clean, flat, presentation-ready illustration; specify colors to match the deck ' +
        'theme; and say "no text" — baked-in text is not indexed and often renders wrong (put the meaning in the ' +
        'slide title/blocks instead, and always give the image an `alt` caption). Consumes AI credits.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        prompt: z.string().describe('English image description; ask for "no text" in the image'),
        nodeId: z.string().optional().describe('Presentation/node id to attach the image to (permission-checked)'),
        workspace: z.string().optional().describe('Workspace id; defaults to ROOTR_WORKSPACE/config'),
      },
    },
    async ({ prompt, nodeId, workspace }) => {
      try {
        const client = makeClient();
        const ws = requireWorkspace(workspace);
        const result = await client.generateImage(ws, { prompt, nodeId });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_remove_image_background',
    {
      title: 'Remove the background of an image',
      description:
        'Remove the background of an existing Rootr (루터) workspace attachment (e.g. a generated or uploaded image) ' +
        'and store the result as a new transparent PNG. Pass the source attachment id; returns { id, url, ... } for ' +
        'the cut-out image, which you can then place on a slide. Useful for product shots / logos / subjects that ' +
        'should sit on the slide without a boxed background.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        attachmentId: z.string().describe('Source attachment id (from rootr_generate_image or an upload)'),
        nodeId: z.string().optional().describe('Presentation/node id to attach the result to (permission-checked)'),
        workspace: z.string().optional().describe('Workspace id; defaults to ROOTR_WORKSPACE/config'),
      },
    },
    async ({ attachmentId, nodeId, workspace }) => {
      try {
        const client = makeClient();
        const ws = requireWorkspace(workspace);
        const result = await client.removeImageBackground(ws, { attachmentId, nodeId });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
