import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: object;
  callback?: (args: {}, extra: any) => (CallToolResult | Promise<CallToolResult>);
};

export const tools: ToolDefinition[] = [
  {
    name: 'updateComponent',
    description: 'Update component properties in AEM',
    inputSchema: {
      type: 'object',
      properties: {
        componentPath: { type: 'string' },
        properties: { type: 'object' },
      },
      required: ['componentPath', 'properties'],
    },
  },
  {
    name: 'scanPageComponents',
    description: 'Scan a page to discover all components and their properties',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: { type: 'string' },
      },
      required: ['pagePath'],
    },
  },
  {
    name: 'fetchSites',
    description: 'Get all available sites in AEM',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'fetchLanguageMasters',
    description: 'Get language masters for a specific site',
    inputSchema: {
      type: 'object',
      properties: { site: { type: 'string' } },
      required: ['site'],
    },
  },
  {
    name: 'fetchAvailableLocales',
    description: 'Get available locales for a site',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string' },
      },
      required: ['site'],
    },
  },
  {
    name: 'getAllTextContent',
    description: 'Get all text content from a page including titles, text components, and descriptions',
    inputSchema: {
      type: 'object',
      properties: { pagePath: { type: 'string' } },
      required: ['pagePath'],
    },
  },
  {
    name: 'getPageTextContent',
    description: 'Get text content from a specific page',
    inputSchema: {
      type: 'object',
      properties: { pagePath: { type: 'string' } },
      required: ['pagePath'],
    },
  },
  {
    name: 'getPageImages',
    description: 'Get all images from a page, including those within Experience Fragments',
    inputSchema: {
      type: 'object',
      properties: { pagePath: { type: 'string' } },
      required: ['pagePath'],
    },
  },
  {
    name: 'updateImagePath',
    description: 'Update the image path for an image component and verify the update',
    inputSchema: {
      type: 'object',
      properties: {
        componentPath: { type: 'string' },
        newImagePath: { type: 'string' },
      },
      required: ['componentPath', 'newImagePath'],
    },
  },
  {
    name: 'getPageContent',
    description: 'Get all content from a page including Experience Fragments and Content Fragments',
    inputSchema: {
      type: 'object',
      properties: { pagePath: { type: 'string' } },
      required: ['pagePath'],
    },
  },
  {
    name: 'listPages',
    description: 'List all pages under a site root',
    inputSchema: {
      type: 'object',
      properties: {
        siteRoot: { type: 'string' },
        depth: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getNodeContent',
    description: 'Legacy: Get JCR node content',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        depth: { type: 'number' },
      },
      required: ['path'],
    },
  },
  {
    name: 'listChildren',
    description: 'Legacy: List child nodes',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'getPageProperties',
    description: 'Get page properties',
    inputSchema: {
      type: 'object',
      properties: { pagePath: { type: 'string' } },
      required: ['pagePath'],
    },
  },
  {
    name: 'searchContent',
    description: 'Search content using Query Builder',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        fulltext: { type: 'string' },
        path: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'executeJCRQuery',
    description: 'Execute JCR query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'getAssetMetadata',
    description: 'Get asset metadata',
    inputSchema: {
      type: 'object',
      properties: { assetPath: { type: 'string' } },
      required: ['assetPath'],
    },
  },
  {
    name: 'enhancedPageSearch',
    description: 'Intelligent page search with comprehensive fallback strategies and cross-section search',
    inputSchema: {
      type: 'object',
      properties: {
        searchTerm: { type: 'string' },
        basePath: { type: 'string' },
        includeAlternateLocales: { type: 'boolean' },
      },
      required: ['searchTerm', 'basePath'],
    },
  },
  {
    name: 'createPage',
    description: 'Create a new page in AEM. The resourceType will be automatically extracted from the template structure if not provided.',
    inputSchema: {
      type: 'object',
      properties: {
        parentPath: { type: 'string' },
        title: { type: 'string' },
        template: { type: 'string' },
        resourceType: { type: 'string', description: 'Optional: Will be extracted from template if not provided' },
        name: { type: 'string' },
        properties: { type: 'object' },
      },
      required: ['parentPath', 'title', 'template'],
    },
  },
  {
    name: 'deletePage',
    description: 'Delete a page from AEM',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: { type: 'string' },
        force: { type: 'boolean' },
      },
      required: ['pagePath'],
    },
  },
  {
    name: 'createComponent',
    description: 'Create a new component on a page',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: { type: 'string' },
        componentType: { type: 'string' },
        resourceType: { type: 'string' },
        properties: { type: 'object' },
        name: { type: 'string' },
      },
      required: ['pagePath', 'componentType', 'resourceType'],
    },
  },
  {
    name: 'addComponent',
    description: 'Add a component to an existing page. Automatically finds the appropriate container (root/container) and adds the component there.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: { type: 'string', description: 'Path to the existing page (e.g., /content/site/en/page)' },
        resourceType: { type: 'string', description: 'Sling resource type of the component (required)' },
        containerPath: { type: 'string', description: 'Optional: specific container path (defaults to root/container)' },
        name: { type: 'string', description: 'Optional: component node name (auto-generated if not provided)' },
        properties: { type: 'object', description: 'Optional: component properties to set' },
      },
      required: ['pagePath', 'resourceType'],
    },
  },
  {
    name: 'deleteComponent',
    description: 'Delete a component from AEM',
    inputSchema: {
      type: 'object',
      properties: {
        componentPath: { type: 'string' },
        force: { type: 'boolean' },
      },
      required: ['componentPath'],
    },
  },
  {
    name: 'unpublishContent',
    description: 'Unpublish content from the publish environment',
    inputSchema: {
      type: 'object',
      properties: {
        contentPaths: { type: 'array', items: { type: 'string' } },
        unpublishTree: { type: 'boolean' },
      },
      required: ['contentPaths'],
    },
  },
  {
    name: 'activatePage',
    description: 'Activate (publish) a single page',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: { type: 'string' },
        activateTree: { type: 'boolean' },
      },
      required: ['pagePath'],
    },
  },
  {
    name: 'deactivatePage',
    description: 'Deactivate (unpublish) a single page',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: { type: 'string' },
        deactivateTree: { type: 'boolean' },
      },
      required: ['pagePath'],
    },
  },
  {
    name: 'updateAsset',
    description: 'Update an existing asset in AEM DAM',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string' },
        metadata: { type: 'object' },
        fileContent: { type: 'string' },
        mimeType: { type: 'string' },
      },
      required: ['assetPath'],
    },
  },
  {
    name: 'deleteAsset',
    description: 'Delete an asset from AEM DAM',
    inputSchema: {
      type: 'object',
      properties: {
        assetPath: { type: 'string' },
        force: { type: 'boolean' },
      },
      required: ['assetPath'],
    },
  },
  {
    name: 'getTemplates',
    description: 'Get available page templates',
    inputSchema: {
      type: 'object',
      properties: { sitePath: { type: 'string' } },
    },
  },
  {
    name: 'getTemplateStructure',
    description: 'Get detailed structure of a specific template',
    inputSchema: {
      type: 'object',
      properties: { templatePath: { type: 'string' } },
      required: ['templatePath'],
    },
  },
  {
    name: 'getComponents',
    description: 'Get all components from the configured component root path (projectRoot1) or a specified path. Shows component name, title, description, resource type, and other metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional: Component root path to fetch components from (e.g., /apps/<project>/components). If not provided, uses the configured default path.'
        },
      },
    },
  },
  {
    name: 'bulkUpdateComponents',
    description: 'Update multiple components in a single operation with validation and rollback support',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              componentPath: { type: 'string' },
              properties: { type: 'object' }
            },
            required: ['componentPath', 'properties']
          }
        },
        validateFirst: { type: 'boolean' },
        continueOnError: { type: 'boolean' }
      },
      required: ['updates'],
    },
  },
  {
    name: 'convertComponents',
    description: 'Find all components of a specific resource type on a page, delete them, and create new components of another type at the same location. Returns required properties if target component needs them.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: { 
          type: 'string', 
          description: 'Path to the page containing components to convert (e.g., /content/mysite/en/page)' 
        },
        sourceResourceType: { 
          type: 'string', 
          description: 'The resource type to search for and convert (e.g., foundation/components/text)' 
        },
        targetResourceType: { 
          type: 'string', 
          description: 'The resource type to convert to (e.g., aemmcp/base/components/text/v1/text)' 
        },
        requiredProperties: { 
          type: 'object', 
          description: 'Optional: Required property values for the target component. If not provided and target component has required properties, they will be listed in the response.' 
        },
        continueOnError: { 
          type: 'boolean', 
          description: 'Optional: Continue converting even if some fail (default: true)' 
        },
      },
      required: ['pagePath', 'sourceResourceType', 'targetResourceType'],
    },
  },
  {
    name: 'bulkConvertComponents',
    description: 'Convert components across multiple pages. Find all components of a specific resource type on multiple pages, delete them, and create new components of another type at the same location.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePaths: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'Array of page paths to process (e.g., ["/content/site/en/page1", "/content/site/en/page2"])' 
        },
        searchPath: { 
          type: 'string', 
          description: 'Optional: Base path to search for pages (e.g., /content/mysite/en). If provided, will find all pages under this path instead of using pagePaths.' 
        },
        depth: { 
          type: 'number', 
          description: 'Optional: Depth to search when using searchPath (default: 2)' 
        },
        limit: { 
          type: 'number', 
          description: 'Optional: Maximum number of pages to process when using searchPath (default: 50)' 
        },
        sourceResourceType: { 
          type: 'string', 
          description: 'The resource type to search for and convert (e.g., foundation/components/text)' 
        },
        targetResourceType: { 
          type: 'string', 
          description: 'The resource type to convert to (e.g., aemmcp/base/components/text/v1/text)' 
        },
        requiredProperties: { 
          type: 'object', 
          description: 'Optional: Required property values for the target component. If not provided and target component has required properties, they will be listed in the response.' 
        },
        continueOnError: { 
          type: 'boolean', 
          description: 'Optional: Continue processing pages even if some fail (default: true)' 
        },
      },
      required: ['sourceResourceType', 'targetResourceType'],
    },
  },
  {
    name: 'listWorkflowModels',
    description: 'List all available workflow models in AEM. Returns common workflows like request_for_activation (publish), request_for_deactivation (unpublish), request_for_deletion (delete pages), and others.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'startWorkflow',
    description: 'Start a workflow instance. Common workflows: request_for_activation (publish pages), request_for_deactivation (unpublish pages), request_for_deletion (delete pages).',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { 
          type: 'string', 
          description: 'Workflow model ID (e.g., "request_for_activation", "request_for_deactivation", "request_for_deletion")' 
        },
        payload: { 
          type: 'string', 
          description: 'JCR path or URL to process (e.g., "/content/site/en/page")' 
        },
        payloadType: { 
          type: 'string', 
          description: 'Type of payload (default: "JCR_PATH")' 
        },
      },
      required: ['modelId', 'payload'],
    },
  },
  {
    name: 'listWorkflowInstances',
    description: 'List workflow instances, optionally filtered by state (RUNNING, SUSPENDED, ABORTED, COMPLETED)',
    inputSchema: {
      type: 'object',
      properties: {
        state: { 
          type: 'string', 
          description: 'Optional: Filter by state (RUNNING, SUSPENDED, ABORTED, COMPLETED)' 
        },
      },
    },
  },
  {
    name: 'getWorkflowInstance',
    description: 'Get details of a specific workflow instance by ID',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: { 
          type: 'string', 
          description: 'Workflow instance ID or full path' 
        },
      },
      required: ['instanceId'],
    },
  },
  {
    name: 'updateWorkflowInstanceState',
    description: 'Update workflow instance state (RUNNING, SUSPENDED, ABORTED)',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: { 
          type: 'string', 
          description: 'Workflow instance ID or full path' 
        },
        state: { 
          type: 'string', 
          enum: ['RUNNING', 'SUSPENDED', 'ABORTED'],
          description: 'New state for the workflow instance' 
        },
      },
      required: ['instanceId', 'state'],
    },
  },
  {
    name: 'getInboxItems',
    description: 'Get all work items in the inbox (work items assigned to current user)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'completeWorkItem',
    description: 'Complete or advance a work item to the next step in the workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workItemPath: { 
          type: 'string', 
          description: 'Path to the work item (e.g., "/var/workflow/instances/server0/2018-02-26/prototype-01_2/workItems/node2_...")' 
        },
        routeId: { 
          type: 'string', 
          description: 'Optional: Route ID to advance to. If not provided, uses first available route.' 
        },
        comment: { 
          type: 'string', 
          description: 'Optional: Comment for the completion' 
        },
      },
      required: ['workItemPath'],
    },
  },
  {
    name: 'delegateWorkItem',
    description: 'Delegate a work item to another user or group',
    inputSchema: {
      type: 'object',
      properties: {
        workItemPath: { 
          type: 'string', 
          description: 'Path to the work item' 
        },
        delegatee: { 
          type: 'string', 
          description: 'User or group to delegate to (e.g., "administrators", "content-authors")' 
        },
      },
      required: ['workItemPath', 'delegatee'],
    },
  },
  {
    name: 'getWorkItemRoutes',
    description: 'Get available routes for a work item (to see what steps are available)',
    inputSchema: {
      type: 'object',
      properties: {
        workItemPath: { 
          type: 'string', 
          description: 'Path to the work item' 
        },
      },
      required: ['workItemPath'],
    },
  },
];
