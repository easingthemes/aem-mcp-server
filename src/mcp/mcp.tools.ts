import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: object;
};

// ─── Shared Fields ────────────────────────────────────
const verbosityField = z.enum(['summary', 'standard', 'full']).default('standard').optional()
  .describe('Response detail level: summary (paths/names only), standard (default, minus JCR internals), full (everything)');

// ─── Content & Text ───────────────────────────────────
const contentSchemas = {
  getAllTextContent: z.object({
    pagePath: z.string().describe('Path to the page'),
  }).passthrough(),
  getPageTextContent: z.object({
    pagePath: z.string().describe('Path to the page'),
  }).passthrough(),
  getPageImages: z.object({
    pagePath: z.string().describe('Path to the page'),
  }).passthrough(),
  updateImagePath: z.object({
    componentPath: z.string().describe('Path to the image component'),
    newImagePath: z.string().describe('New image path'),
  }).passthrough(),
  getPageContent: z.object({
    pagePath: z.string().describe('Path to the page'),
    verbosity: verbosityField,
  }).passthrough(),
  getNodeContent: z.object({
    path: z.string().describe('JCR node path'),
    depth: z.number().optional().describe('Depth to traverse'),
    verbosity: verbosityField,
  }).passthrough(),
  listChildren: z.object({
    path: z.string().describe('Parent node path'),
    verbosity: verbosityField,
  }).passthrough(),
  getPageProperties: z.object({
    pagePath: z.string().describe('Path to the page'),
  }).passthrough(),
};

// ─── Sites & Locales ──────────────────────────────────
const siteSchemas = {
  fetchSites: z.object({}).passthrough(),
  fetchLanguageMasters: z.object({
    site: z.string().describe('Site name'),
  }).passthrough(),
  fetchAvailableLocales: z.object({
    site: z.string().describe('Site name'),
  }).passthrough(),
};

// ─── Pages ────────────────────────────────────────────
const pageSchemas = {
  listPages: z.object({
    siteRoot: z.string().optional().describe('Site root path'),
    depth: z.number().optional().describe('Depth to traverse'),
    limit: z.number().optional().describe('Maximum number of results'),
    verbosity: verbosityField,
  }).passthrough(),
  createPage: z.object({
    parentPath: z.string().describe('Parent path'),
    title: z.string().describe('Page title'),
    template: z.string().describe('Template path'),
    resourceType: z.string().optional().describe('Optional: Will be extracted from template if not provided'),
    name: z.string().optional().describe('Page name'),
    properties: z.record(z.unknown()).optional().describe('Additional properties'),
  }).passthrough(),
  deletePage: z.object({
    pagePath: z.string().describe('Path to the page to delete'),
    force: z.boolean().optional().describe('Force deletion'),
  }).passthrough(),
  activatePage: z.object({
    pagePath: z.string().describe('Path to the page'),
    activateTree: z.boolean().optional().describe('Activate entire tree'),
  }).passthrough(),
  deactivatePage: z.object({
    pagePath: z.string().describe('Path to the page'),
    deactivateTree: z.boolean().optional().describe('Deactivate entire tree'),
  }).passthrough(),
  unpublishContent: z.object({
    contentPaths: z.array(z.string()).describe('Paths to unpublish'),
    unpublishTree: z.boolean().optional().describe('Unpublish tree'),
  }).passthrough(),
};

// ─── Components ───────────────────────────────────────
const componentSchemas = {
  updateComponent: z.object({
    componentPath: z.string().describe('Path to the component'),
    properties: z.record(z.unknown()).describe('Properties to update'),
  }).passthrough(),
  scanPageComponents: z.object({
    pagePath: z.string().describe('Path to the page to scan'),
    verbosity: verbosityField,
  }).passthrough(),
  createComponent: z.object({
    pagePath: z.string().describe('Path to the page'),
    componentType: z.string().describe('Component type'),
    resourceType: z.string().describe('Resource type'),
    properties: z.record(z.unknown()).optional().describe('Component properties'),
    name: z.string().optional().describe('Component name'),
  }).passthrough(),
  addComponent: z.object({
    pagePath: z.string().describe('Path to the existing page (e.g., /content/site/en/page)'),
    resourceType: z.string().describe('Sling resource type of the component (required)'),
    containerPath: z.string().optional().describe('Optional: specific container path (defaults to root/container)'),
    name: z.string().optional().describe('Optional: component node name (auto-generated if not provided)'),
    properties: z.record(z.unknown()).optional().describe('Optional: component properties to set'),
  }).passthrough(),
  deleteComponent: z.object({
    componentPath: z.string().describe('Path to the component to delete'),
    force: z.boolean().optional().describe('Force deletion'),
  }).passthrough(),
  getComponents: z.object({
    path: z.string().optional().describe('Optional: Component root path to fetch components from. If not provided, uses the configured default path.'),
    verbosity: verbosityField,
  }).passthrough(),
  bulkUpdateComponents: z.object({
    updates: z.array(z.object({
      componentPath: z.string(),
      properties: z.record(z.unknown()),
    })).describe('Array of component updates'),
    validateFirst: z.boolean().optional().describe('Validate before updating'),
    continueOnError: z.boolean().optional().describe('Continue on individual failures'),
  }).passthrough(),
  convertComponents: z.object({
    pagePath: z.string().describe('Path to the page containing components to convert'),
    sourceResourceType: z.string().describe('The resource type to search for and convert'),
    targetResourceType: z.string().describe('The resource type to convert to'),
    requiredProperties: z.record(z.unknown()).optional().describe('Optional: Required property values for the target component'),
    continueOnError: z.boolean().optional().describe('Optional: Continue converting even if some fail (default: true)'),
  }).passthrough(),
  bulkConvertComponents: z.object({
    pagePaths: z.array(z.string()).optional().describe('Array of page paths to process'),
    searchPath: z.string().optional().describe('Optional: Base path to search for pages'),
    depth: z.number().optional().describe('Optional: Depth to search when using searchPath (default: 2)'),
    limit: z.number().optional().describe('Optional: Maximum number of pages to process (default: 50)'),
    sourceResourceType: z.string().describe('The resource type to search for and convert'),
    targetResourceType: z.string().describe('The resource type to convert to'),
    requiredProperties: z.record(z.unknown()).optional().describe('Optional: Required property values for the target component'),
    continueOnError: z.boolean().optional().describe('Optional: Continue processing pages even if some fail (default: true)'),
  }).passthrough(),
};

// ─── Assets ───────────────────────────────────────────
const assetSchemas = {
  getAssetMetadata: z.object({
    assetPath: z.string().describe('Path to the asset'),
  }).passthrough(),
  updateAsset: z.object({
    assetPath: z.string().describe('Path to the asset'),
    metadata: z.record(z.unknown()).optional().describe('Metadata to update'),
    fileContent: z.string().optional().describe('File content'),
    mimeType: z.string().optional().describe('MIME type'),
  }).passthrough(),
  deleteAsset: z.object({
    assetPath: z.string().describe('Path to the asset to delete'),
    force: z.boolean().optional().describe('Force deletion'),
  }).passthrough(),
};

// ─── Search ───────────────────────────────────────────
const searchSchemas = {
  searchContent: z.object({
    type: z.string().optional().describe('Content type'),
    fulltext: z.string().optional().describe('Fulltext search term'),
    path: z.string().optional().describe('Search path'),
    limit: z.number().optional().describe('Maximum number of results'),
  }).passthrough(),
  executeJCRQuery: z.object({
    query: z.string().describe('JCR query'),
    limit: z.number().optional().describe('Maximum number of results'),
  }).passthrough(),
  enhancedPageSearch: z.object({
    searchTerm: z.string().describe('Search term'),
    basePath: z.string().describe('Base path for search'),
    includeAlternateLocales: z.boolean().optional().describe('Include alternate locales'),
  }).passthrough(),
};

// ─── Templates ────────────────────────────────────────
const templateSchemas = {
  getTemplates: z.object({
    sitePath: z.string().optional().describe('Site path'),
  }).passthrough(),
  getTemplateStructure: z.object({
    templatePath: z.string().describe('Template path'),
  }).passthrough(),
};

// ─── Workflows ────────────────────────────────────────
const workflowSchemas = {
  listWorkflowModels: z.object({}).passthrough(),
  startWorkflow: z.object({
    modelId: z.string().describe('Workflow model ID (e.g., "request_for_activation")'),
    payload: z.string().describe('JCR path or URL to process'),
    payloadType: z.string().optional().describe('Type of payload (default: "JCR_PATH")'),
  }).passthrough(),
  listWorkflowInstances: z.object({
    state: z.string().optional().describe('Optional: Filter by state (RUNNING, SUSPENDED, ABORTED, COMPLETED)'),
  }).passthrough(),
  getWorkflowInstance: z.object({
    instanceId: z.string().describe('Workflow instance ID or full path'),
  }).passthrough(),
  updateWorkflowInstanceState: z.object({
    instanceId: z.string().describe('Workflow instance ID or full path'),
    state: z.enum(['RUNNING', 'SUSPENDED', 'ABORTED']).describe('New state for the workflow instance'),
  }).passthrough(),
  getInboxItems: z.object({}).passthrough(),
  completeWorkItem: z.object({
    workItemPath: z.string().describe('Path to the work item'),
    routeId: z.string().optional().describe('Optional: Route ID to advance to'),
    comment: z.string().optional().describe('Optional: Comment for the completion'),
  }).passthrough(),
  delegateWorkItem: z.object({
    workItemPath: z.string().describe('Path to the work item'),
    delegatee: z.string().describe('User or group to delegate to'),
  }).passthrough(),
  getWorkItemRoutes: z.object({
    workItemPath: z.string().describe('Path to the work item'),
  }).passthrough(),
};

// ─── CF Models ────────────────────────────────────────
const contentFragmentModelSchemas = {
  listContentFragmentModels: z.object({
    path: z.string().optional().describe('Root configuration path to search under (default: /conf)'),
    name: z.string().optional().describe('Filter by model title/name (substring match)'),
    status: z.enum(['enabled', 'disabled']).optional().describe('Filter by model status'),
    limit: z.number().optional().describe('Max results (default: 50)'),
  }).passthrough(),
  getContentFragmentModelSchema: z.object({
    modelPath: z.string().describe('Full JCR path to the CF model (e.g., /conf/mysite/settings/dam/cfm/models/article)'),
  }).passthrough(),
  createContentFragmentModel: z.object({
    parentPath: z.string().describe('Parent path where the model will be created (e.g., /conf/mysite/settings/dam/cfm/models)'),
    name: z.string().describe('Node name for the model (lowercase, hyphens allowed)'),
    title: z.string().describe('Human-readable model title'),
    description: z.string().optional().describe('Model description'),
    fields: z.array(z.object({
      name: z.string(),
      type: z.enum(['single-line-text', 'multi-line-text', 'number', 'boolean', 'date-time', 'enumeration', 'content-reference', 'fragment-reference', 'json']),
      label: z.string().optional(),
      required: z.boolean().optional(),
      multiValue: z.boolean().optional(),
      options: z.array(z.string()).optional(),
      maxLength: z.number().optional(),
      minLength: z.number().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
    }).passthrough()).optional().describe('Field definitions for the model'),
    dryRun: z.boolean().optional().describe('Validate without creating (default: false)'),
  }).passthrough(),
  updateContentFragmentModel: z.object({
    modelPath: z.string().describe('Full JCR path to the CF model to update'),
    title: z.string().optional().describe('New title for the model'),
    description: z.string().optional().describe('New description'),
    addFields: z.array(z.object({
      name: z.string(),
      type: z.enum(['single-line-text', 'multi-line-text', 'number', 'boolean', 'date-time', 'enumeration', 'content-reference', 'fragment-reference', 'json']),
      label: z.string().optional(),
      required: z.boolean().optional(),
      multiValue: z.boolean().optional(),
      options: z.array(z.string()).optional(),
      maxLength: z.number().optional(),
    }).passthrough()).optional().describe('New fields to add to the model'),
    removeFields: z.array(z.string()).optional().describe('Field names to remove'),
    updateFields: z.array(z.object({
      name: z.string(),
      type: z.enum(['single-line-text', 'multi-line-text', 'number', 'boolean', 'date-time', 'enumeration', 'content-reference', 'fragment-reference', 'json']),
      label: z.string().optional(),
      required: z.boolean().optional(),
      multiValue: z.boolean().optional(),
      maxLength: z.number().optional(),
    }).passthrough()).optional().describe('Existing fields to modify'),
  }).passthrough(),
  deleteContentFragmentModel: z.object({
    modelPath: z.string().describe('Full JCR path to the CF model to delete'),
    force: z.boolean().optional().describe('Delete even if fragments still use this model (default: false)'),
  }).passthrough(),
  batchManageContentFragmentModels: z.object({
    operations: z.array(z.object({
      action: z.enum(['copy', 'delete', 'patch']),
      modelPath: z.string().describe('Source model path'),
      targetPath: z.string().optional().describe('Target path (required for copy)'),
      patch: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        addFields: z.array(z.object({
          name: z.string(),
          type: z.enum(['single-line-text', 'multi-line-text', 'number', 'boolean', 'date-time', 'enumeration', 'content-reference', 'fragment-reference', 'json']),
        }).passthrough()).optional(),
        removeFields: z.array(z.string()).optional(),
      }).passthrough().optional().describe('Patch payload (required for patch action)'),
    }).passthrough()).describe('List of model operations to execute'),
    continueOnError: z.boolean().optional().describe('Continue processing if one operation fails (default: true)'),
    validateFirst: z.boolean().optional().describe('Validate all operations before executing any (default: false)'),
  }).passthrough(),
  listContentFragmentTemplates: z.object({
    modelPath: z.string().describe('Full JCR path to the CF model whose templates to list'),
  }).passthrough(),
  graphqlIntrospection: z.object({
    endpoint: z.string().optional().describe('GraphQL endpoint path (default: /content/graphql/global/endpoint.gql)'),
  }).passthrough(),
};

// ─── Content Fragments ────────────────────────────────
const contentFragmentSchemas = {
  getContentFragment: z.object({
    path: z.string().describe('Path to the content fragment in DAM (e.g., /content/dam/site/cf/my-article)'),
  }).passthrough(),
  listContentFragments: z.object({
    path: z.string().describe('Parent path to search under (e.g., /content/dam/site/cf)'),
    model: z.string().optional().describe('Filter by CF model path'),
    limit: z.number().optional().describe('Max results (default: 20)'),
    offset: z.number().optional().describe('Pagination offset (default: 0)'),
  }).passthrough(),
  manageContentFragment: z.object({
    action: z.enum(['create', 'update', 'delete', 'mergeJsonField']).describe('Action to perform'),
    fragmentPath: z.string().optional().describe('Path to existing CF (required for update/delete/mergeJsonField)'),
    parentPath: z.string().optional().describe('Parent folder in DAM (required for create)'),
    title: z.string().optional().describe('Fragment title (required for create)'),
    name: z.string().optional().describe('Node name (auto-generated from title if omitted)'),
    model: z.string().optional().describe('CF model path (required for create)'),
    fields: z.record(z.unknown()).optional().describe('Field values as { fieldName: value } (create/update)'),
    description: z.string().optional().describe('Fragment description'),
    force: z.boolean().optional().describe('Force delete even if referenced'),
    variation: z.string().optional().describe('Variation name to target (default: "master"); applies to update and mergeJsonField'),
    field: z.string().optional().describe('mergeJsonField: name of the field that holds a JSON-encoded string to patch'),
    jsonPointer: z.string().optional().describe('mergeJsonField: RFC-6901 pointer to the object to merge into (e.g. "/0/content/0/value"); default "" = field root'),
    merge: z.record(z.unknown()).optional().describe('mergeJsonField: keys to upsert into the resolved object (deep-merged; existing keys overwritten, untouched keys preserved)'),
  }).passthrough(),
  manageContentFragmentVariation: z.object({
    action: z.enum(['create', 'update', 'delete']).describe('Action to perform'),
    fragmentPath: z.string().describe('Path to the parent content fragment'),
    variationName: z.string().describe('Variation identifier'),
    title: z.string().optional().describe('Variation title (required for create)'),
    fields: z.record(z.unknown()).optional().describe('Field overrides as { fieldName: value }'),
  }).passthrough(),
};

// ─── Experience Fragments ─────────────────────────────
const experienceFragmentSchemas = {
  getExperienceFragment: z.object({
    path: z.string().describe('Path to the experience fragment page'),
  }).passthrough(),
  listExperienceFragments: z.object({
    path: z.string().optional().describe('Root path (default: /content/experience-fragments)'),
    template: z.string().optional().describe('Filter by template path'),
    limit: z.number().optional().describe('Max results (default: 20)'),
    offset: z.number().optional().describe('Pagination offset (default: 0)'),
  }).passthrough(),
  manageExperienceFragment: z.object({
    action: z.enum(['create', 'update', 'delete']).describe('Action to perform'),
    xfPath: z.string().optional().describe('Existing XF path (required for update/delete)'),
    parentPath: z.string().optional().describe('Parent path for new XF (required for create)'),
    name: z.string().optional().describe('Node name (auto-generated from title if omitted)'),
    title: z.string().optional().describe('XF title (required for create)'),
    template: z.string().optional().describe('XF template path (required for create)'),
    description: z.string().optional().describe('XF description'),
    tags: z.array(z.string()).optional().describe('Tags to apply'),
    force: z.boolean().optional().describe('Force delete even if referenced'),
  }).passthrough(),
  manageExperienceFragmentVariation: z.object({
    action: z.enum(['create', 'update', 'delete']).describe('Action to perform'),
    xfPath: z.string().describe('Parent experience fragment path'),
    variationName: z.string().describe('Variation identifier'),
    variationType: z.enum(['web', 'email', 'social', 'custom']).optional().describe('Variation type (default: web)'),
    title: z.string().optional().describe('Variation title (required for create)'),
    template: z.string().optional().describe('Template for the variation'),
    force: z.boolean().optional().describe('Force deletion'),
  }).passthrough(),
};

// ─── Combined Schemas ─────────────────────────────────
export const toolSchemas = {
  ...contentSchemas,
  ...siteSchemas,
  ...pageSchemas,
  ...componentSchemas,
  ...assetSchemas,
  ...searchSchemas,
  ...templateSchemas,
  ...workflowSchemas,
  ...contentFragmentModelSchemas,
  ...contentFragmentSchemas,
  ...experienceFragmentSchemas,
} as const;

export type ToolName = keyof typeof toolSchemas;

export const toolDescriptions: Record<ToolName, string> = {
  updateComponent: 'Update component properties in AEM',
  scanPageComponents: 'Scan a page to discover all components and their properties',
  fetchSites: 'Get all top-level AEM site roots under /content. Returns site name, path, and language root structure.',
  fetchLanguageMasters: 'Get language masters for a specific site',
  fetchAvailableLocales: 'Get available locales for a site',
  getAllTextContent: 'Get all text content from a page including titles, text components, and descriptions',
  getPageTextContent: 'Get text content from a specific page',
  getPageImages: 'Get all images from a page, including those within Experience Fragments',
  updateImagePath: 'Update the image path for an image component and verify the update',
  getPageContent: 'Get complete page content including resolved Experience Fragments and Content Fragments. Returns full content tree. For text-only extraction, use getPageTextContent. For raw JCR nodes, use getNodeContent.',
  listPages: 'List child pages directly under a path (non-recursive, structural). For finding pages by content or name, use enhancedPageSearch instead.',
  getNodeContent: 'Get raw JCR node properties at a specific path and depth. Low-level tool — use getPageContent for pages or scanPageComponents for component discovery.',
  listChildren: 'Legacy: List child nodes',
  getPageProperties: 'Get page properties',
  searchContent: 'Structured content search with filters (type, property values, path scope, fulltext). More flexible than executeJCRQuery. Use for finding nodes by property values or content type.',
  executeJCRQuery: 'Execute fulltext search on cq:Page nodes under /content. Uses QueryBuilder internally, NOT raw JCR-SQL2. For structured property-based queries, use searchContent instead.',
  getAssetMetadata: 'Get DAM asset metadata including title, description, dimensions, format, tags, and custom properties. Path must be under /content/dam.',
  enhancedPageSearch: 'Intelligent page search with comprehensive fallback strategies and cross-section search',
  createPage: 'Create a new page in AEM. The resourceType will be automatically extracted from the template structure if not provided.',
  deletePage: 'Delete a page from AEM',
  createComponent: 'Create a component at a specific JCR path (you must know the exact container path). For automatic container detection and cq:template application, use addComponent instead.',
  addComponent: 'Add a component to a page with automatic parsys/container detection and cq:template application. Preferred over createComponent for most use cases.',
  deleteComponent: 'Delete a component from AEM',
  unpublishContent: 'Unpublish content from the publish environment',
  activatePage: 'Publish a page immediately via direct replication (synchronous). For approval-based publishing workflows, use startWorkflow with the request_for_activation model.',
  deactivatePage: 'Deactivate (unpublish) a single page',
  updateAsset: 'Update an existing asset in AEM DAM',
  deleteAsset: 'Delete an asset from AEM DAM',
  getTemplates: 'Get available page templates',
  getTemplateStructure: 'Get detailed structure of a specific template',
  getComponents: 'Get all components from the configured component root path (projectRoot1) or a specified path. Shows component name, title, description, resource type, and other metadata.',
  bulkUpdateComponents: 'Update multiple components in a single operation with validation and rollback support',
  convertComponents: 'Find all components of a specific resource type on a page, delete them, and create new components of another type at the same location. Returns required properties if target component needs them.',
  bulkConvertComponents: 'Convert components across multiple pages. Find all components of a specific resource type on multiple pages, delete them, and create new components of another type at the same location.',
  listWorkflowModels: 'List all available workflow models in AEM. Returns common workflows like request_for_activation (publish), request_for_deactivation (unpublish), request_for_deletion (delete pages), and others.',
  startWorkflow: 'Start a workflow instance. Common workflows: request_for_activation (publish pages), request_for_deactivation (unpublish pages), request_for_deletion (delete pages).',
  listWorkflowInstances: 'List workflow instances, optionally filtered by state',
  getWorkflowInstance: 'Get details of a specific workflow instance by ID',
  updateWorkflowInstanceState: 'Update workflow instance state (RUNNING, SUSPENDED, ABORTED)',
  getInboxItems: 'Get all work items in the inbox (work items assigned to current user)',
  completeWorkItem: 'Complete or advance a work item to the next step in the workflow',
  delegateWorkItem: 'Delegate a work item to another user or group',
  getWorkItemRoutes: 'Get available routes for a work item (to see what steps are available)',
  getContentFragment: 'Get a content fragment with all fields, variations, and metadata',
  listContentFragments: 'List content fragments under a path with optional model filter',
  manageContentFragment: 'Create, update, or delete a content fragment, or merge keys into a JSON-encoded-string field (action "mergeJsonField"). mergeJsonField reads the current blob, deep-merges your keys at an optional RFC-6901 jsonPointer, and writes it back server-side — use it to upsert a few keys into a field that stores a whole key→value map as one JSON string, without round-tripping the entire blob. Use action param to specify operation.',
  manageContentFragmentVariation: 'Create, update, or delete a variation within a content fragment',
  listContentFragmentModels: 'List all CF models under a configuration path. Filter by name substring, status (enabled/disabled), or folder. Returns model path, title, field count, and last modified date.',
  getContentFragmentModelSchema: 'Get the full field schema for a CF model — field names, types (single-line-text, multi-line-text, number, boolean, date-time, enumeration, content-reference, fragment-reference, json), required flag, multi-value flag, and constraints. Use this before creating fragments to discover required fields.',
  createContentFragmentModel: 'Create a new CF model with field definitions. Use dryRun=true to validate field types and names without persisting. Supports all AEM field types.',
  updateContentFragmentModel: 'Add, remove, or modify fields on an existing CF model. Use addFields to append new fields, removeFields with field names to drop, updateFields to modify existing field properties.',
  deleteContentFragmentModel: 'Delete a CF model. Blocked if any fragments still reference the model unless force=true is passed.',
  batchManageContentFragmentModels: 'Copy, patch, or delete multiple CF models in one call. Use continueOnError=true (default) to process all even if some fail. Use validateFirst=true to check all operations before executing any.',
  listContentFragmentTemplates: 'List all templates defined under a CF model path.',
  graphqlIntrospection: 'Execute a GraphQL __schema introspection query against the AEM GraphQL endpoint. Returns all content types, available query fields, and field types. Useful for discovering fragment models exposed via headless GraphQL.',
  getExperienceFragment: 'Get an experience fragment with all variations, components, and metadata',
  listExperienceFragments: 'List experience fragments under a path with optional template filter',
  manageExperienceFragment: 'Create, update, or delete an experience fragment. Auto-creates master variation on create.',
  manageExperienceFragmentVariation: 'Create, update, or delete a variation within an experience fragment',
};

/**
 * Convert Zod schemas to the ToolDefinition[] format consumed by mcp.server.ts.
 * This is the ONLY place where Zod → JSON Schema conversion happens.
 */
function buildToolDefinitions(): ToolDefinition[] {
  return (Object.keys(toolSchemas) as ToolName[]).map((name) => {
    const { $schema, ...schema } = zodToJsonSchema(toolSchemas[name], { target: 'jsonSchema7' }) as Record<string, unknown>;
    return {
      name,
      description: toolDescriptions[name],
      inputSchema: schema,
    };
  });
}

export const tools: ToolDefinition[] = buildToolDefinitions();

/**
 * Inject an optional "instance" parameter into every tool's inputSchema.
 * Called only when multiple AEM instances are configured.
 */
export function injectInstanceParam(
  toolDefs: ToolDefinition[],
  instanceNames: string[],
  defaultName: string,
): ToolDefinition[] {
  return toolDefs.map((tool) => {
    const schema = tool.inputSchema as Record<string, any>;
    return {
      ...tool,
      inputSchema: {
        ...schema,
        properties: {
          ...(schema.properties || {}),
          instance: {
            type: 'string',
            description: `Target AEM instance. Available: ${instanceNames.join(', ')}. Default: "${defaultName}"`,
            enum: instanceNames,
          },
        },
      },
    };
  });
}

export const toolAnnotations: Record<string, { group: string; readOnly: boolean; complexity: 'low' | 'medium' | 'high' }> = {
  // Content & Text
  getAllTextContent: { group: 'content', readOnly: true, complexity: 'low' },
  getPageTextContent: { group: 'content', readOnly: true, complexity: 'low' },
  getPageImages: { group: 'content', readOnly: true, complexity: 'low' },
  updateImagePath: { group: 'content', readOnly: false, complexity: 'medium' },
  getPageContent: { group: 'content', readOnly: true, complexity: 'low' },
  getPageProperties: { group: 'content', readOnly: true, complexity: 'low' },
  // Sites
  fetchSites: { group: 'sites', readOnly: true, complexity: 'low' },
  fetchLanguageMasters: { group: 'sites', readOnly: true, complexity: 'low' },
  fetchAvailableLocales: { group: 'sites', readOnly: true, complexity: 'low' },
  // Pages
  listPages: { group: 'pages', readOnly: true, complexity: 'low' },
  createPage: { group: 'pages', readOnly: false, complexity: 'medium' },
  deletePage: { group: 'pages', readOnly: false, complexity: 'high' },
  activatePage: { group: 'pages', readOnly: false, complexity: 'medium' },
  deactivatePage: { group: 'pages', readOnly: false, complexity: 'medium' },
  unpublishContent: { group: 'pages', readOnly: false, complexity: 'medium' },
  enhancedPageSearch: { group: 'search', readOnly: true, complexity: 'low' },
  getNodeContent: { group: 'content', readOnly: true, complexity: 'low' },
  listChildren: { group: 'content', readOnly: true, complexity: 'low' },
  // Components
  updateComponent: { group: 'components', readOnly: false, complexity: 'medium' },
  scanPageComponents: { group: 'components', readOnly: true, complexity: 'low' },
  createComponent: { group: 'components', readOnly: false, complexity: 'high' },
  addComponent: { group: 'components', readOnly: false, complexity: 'medium' },
  deleteComponent: { group: 'components', readOnly: false, complexity: 'high' },
  getComponents: { group: 'components', readOnly: true, complexity: 'low' },
  bulkUpdateComponents: { group: 'components', readOnly: false, complexity: 'high' },
  convertComponents: { group: 'components', readOnly: false, complexity: 'high' },
  bulkConvertComponents: { group: 'components', readOnly: false, complexity: 'high' },
  // Assets
  getAssetMetadata: { group: 'assets', readOnly: true, complexity: 'low' },
  updateAsset: { group: 'assets', readOnly: false, complexity: 'medium' },
  deleteAsset: { group: 'assets', readOnly: false, complexity: 'high' },
  // Search
  searchContent: { group: 'search', readOnly: true, complexity: 'low' },
  executeJCRQuery: { group: 'search', readOnly: true, complexity: 'medium' },
  // Templates
  getTemplates: { group: 'templates', readOnly: true, complexity: 'low' },
  getTemplateStructure: { group: 'templates', readOnly: true, complexity: 'low' },
  // Workflows
  listWorkflowModels: { group: 'workflows', readOnly: true, complexity: 'low' },
  startWorkflow: { group: 'workflows', readOnly: false, complexity: 'medium' },
  listWorkflowInstances: { group: 'workflows', readOnly: true, complexity: 'low' },
  getWorkflowInstance: { group: 'workflows', readOnly: true, complexity: 'low' },
  updateWorkflowInstanceState: { group: 'workflows', readOnly: false, complexity: 'medium' },
  getInboxItems: { group: 'workflows', readOnly: true, complexity: 'low' },
  completeWorkItem: { group: 'workflows', readOnly: false, complexity: 'medium' },
  delegateWorkItem: { group: 'workflows', readOnly: false, complexity: 'medium' },
  getWorkItemRoutes: { group: 'workflows', readOnly: true, complexity: 'low' },
  // Content Fragments
  getContentFragment: { group: 'fragments-content', readOnly: true, complexity: 'low' },
  listContentFragments: { group: 'fragments-content', readOnly: true, complexity: 'low' },
  manageContentFragment: { group: 'fragments-content', readOnly: false, complexity: 'medium' },
  manageContentFragmentVariation: { group: 'fragments-content', readOnly: false, complexity: 'medium' },
  // CF Models
  listContentFragmentModels: { group: 'fragments-models', readOnly: true, complexity: 'low' },
  getContentFragmentModelSchema: { group: 'fragments-models', readOnly: true, complexity: 'low' },
  createContentFragmentModel: { group: 'fragments-models', readOnly: false, complexity: 'high' },
  updateContentFragmentModel: { group: 'fragments-models', readOnly: false, complexity: 'high' },
  deleteContentFragmentModel: { group: 'fragments-models', readOnly: false, complexity: 'high' },
  batchManageContentFragmentModels: { group: 'fragments-models', readOnly: false, complexity: 'high' },
  listContentFragmentTemplates: { group: 'fragments-models', readOnly: true, complexity: 'low' },
  graphqlIntrospection: { group: 'fragments-models', readOnly: true, complexity: 'medium' },
  // Experience Fragments
  getExperienceFragment: { group: 'fragments-experience', readOnly: true, complexity: 'low' },
  listExperienceFragments: { group: 'fragments-experience', readOnly: true, complexity: 'low' },
  manageExperienceFragment: { group: 'fragments-experience', readOnly: false, complexity: 'medium' },
  manageExperienceFragmentVariation: { group: 'fragments-experience', readOnly: false, complexity: 'medium' },
};
