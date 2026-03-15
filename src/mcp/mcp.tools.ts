import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: object;
};

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
  }).passthrough(),
  getNodeContent: z.object({
    path: z.string().describe('JCR node path'),
    depth: z.number().optional().describe('Depth to traverse'),
  }).passthrough(),
  listChildren: z.object({
    path: z.string().describe('Parent node path'),
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
} as const;

export type ToolName = keyof typeof toolSchemas;

export const toolDescriptions: Record<ToolName, string> = {
  updateComponent: 'Update component properties in AEM',
  scanPageComponents: 'Scan a page to discover all components and their properties',
  fetchSites: 'Get all available sites in AEM',
  fetchLanguageMasters: 'Get language masters for a specific site',
  fetchAvailableLocales: 'Get available locales for a site',
  getAllTextContent: 'Get all text content from a page including titles, text components, and descriptions',
  getPageTextContent: 'Get text content from a specific page',
  getPageImages: 'Get all images from a page, including those within Experience Fragments',
  updateImagePath: 'Update the image path for an image component and verify the update',
  getPageContent: 'Get all content from a page including Experience Fragments and Content Fragments',
  listPages: 'List all pages under a site root',
  getNodeContent: 'Legacy: Get JCR node content',
  listChildren: 'Legacy: List child nodes',
  getPageProperties: 'Get page properties',
  searchContent: 'Search content using Query Builder',
  executeJCRQuery: 'Execute JCR query',
  getAssetMetadata: 'Get asset metadata',
  enhancedPageSearch: 'Intelligent page search with comprehensive fallback strategies and cross-section search',
  createPage: 'Create a new page in AEM. The resourceType will be automatically extracted from the template structure if not provided.',
  deletePage: 'Delete a page from AEM',
  createComponent: 'Create a new component on a page',
  addComponent: 'Add a component to an existing page. Automatically finds the appropriate container (root/container) and adds the component there.',
  deleteComponent: 'Delete a component from AEM',
  unpublishContent: 'Unpublish content from the publish environment',
  activatePage: 'Activate (publish) a single page',
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
