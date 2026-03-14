import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: object;
  callback?: (args: {}, extra: any) => (CallToolResult | Promise<CallToolResult>);
};

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

export const tools: ToolDefinition[] = [
  {
    name: 'validateComponent',
    description: 'Validate component changes before applying them',
    inputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string' },
        pagePath: { type: 'string' },
        component: { type: 'string' },
        props: { type: 'object' },
      },
      required: ['locale', 'pagePath', 'component', 'props'],
    },
  },
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
    name: 'undoChanges',
    description: 'Undo the last component changes',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
      },
      required: ['jobId'],
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
    description: 'Get available locales for a site and language master',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string' },
        languageMasterPath: { type: 'string' },
      },
      required: ['site', 'languageMasterPath'],
    },
  },
  {
    name: 'replicateAndPublish',
    description: 'Replicate and publish content to selected locales',
    inputSchema: {
      type: 'object',
      properties: {
        selectedLocales: { type: 'array', items: { type: 'string' } },
        componentData: { type: 'object' },
        localizedOverrides: { type: 'object' },
      },
      required: ['selectedLocales', 'componentData'],
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
    name: 'getStatus',
    description: 'Get workflow status by ID',
    inputSchema: {
      type: 'object',
      properties: { workflowId: { type: 'string' } },
      required: ['workflowId'],
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
    description: 'Create a new page in AEM',
    inputSchema: {
      type: 'object',
      properties: {
        parentPath: { type: 'string' },
        title: { type: 'string' },
        template: { type: 'string' },
        resourceType: { type: 'string' },
        name: { type: 'string' },
        properties: { type: 'object' },
      },
      required: ['parentPath', 'title', 'template', 'resourceType'],
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
    name: 'uploadAsset',
    description: 'Upload a new asset to AEM DAM',
    inputSchema: {
      type: 'object',
      properties: {
        parentPath: { type: 'string' },
        fileName: { type: 'string' },
        fileContent: { type: 'string' },
        mimeType: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['parentPath', 'fileName', 'fileContent'],
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
];
