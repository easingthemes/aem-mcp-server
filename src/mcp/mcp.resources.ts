import { AEMConnector } from '../aem/aem.connector.js';
import { LOGGER } from '../utils/logger.js';

type ResourceDefinition = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

const RESOURCE_CATALOG = [
  {
    key: 'components',
    name: 'AEM Components',
    description: 'All components (name, resourceType, title, group)',
  },
  {
    key: 'sites',
    name: 'AEM Sites',
    description: 'Site roots and language structure under /content',
  },
  {
    key: 'templates',
    name: 'AEM Templates',
    description: 'Available page templates (path, title)',
  },
  {
    key: 'workflow-models',
    name: 'AEM Workflow Models',
    description: 'Workflow models (ID, title, description)',
  },
] as const;

export function getResourceDefinitions(instanceName: string): ResourceDefinition[] {
  return RESOURCE_CATALOG.map((r) => ({
    uri: `aem://${instanceName}/${r.key}`,
    name: `${r.name} [${instanceName}]`,
    description: r.description,
    mimeType: 'application/json',
  }));
}

function extractSummary(result: any, resourceKey: string): object {
  // All connector methods wrap in createSuccessResponse — extract the data payload
  const data = result?.data ?? result;

  switch (resourceKey) {
    case 'components': {
      const components = data?.components ?? [];
      return {
        totalCount: components.length,
        components: components.map((c: any) => ({
          name: c.name,
          title: c.title,
          resourceType: c.resourceType,
          group: c.componentGroup || c.group,
        })),
      };
    }
    case 'sites': {
      const sites = data?.sites ?? [];
      return {
        totalCount: sites.length,
        sites: sites.map((s: any) => ({
          name: s.name,
          path: s.path,
          title: s.title,
        })),
      };
    }
    case 'templates': {
      const templates = data?.templates ?? [];
      return {
        totalCount: templates.length,
        templates: templates.map((t: any) => ({
          name: t.name,
          path: t.path,
          title: t.title,
        })),
      };
    }
    case 'workflow-models': {
      const models = data?.models ?? data?.commonWorkflows ?? [];
      return {
        totalCount: models.length,
        models: models.map((m: any) => ({
          modelId: m.modelId,
          uri: m.uri,
          description: m.description,
        })),
      };
    }
    default:
      return data;
  }
}

export async function readResource(
  uri: string,
  connector: AEMConnector,
): Promise<{ uri: string; mimeType: string; text: string }> {
  // Parse aem://{instance}/{resourceKey}
  const match = uri.match(/^aem:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    return { uri, mimeType: 'application/json', text: JSON.stringify({ error: `Invalid resource URI: ${uri}` }) };
  }

  const [, , resourceKey] = match;

  try {
    let result: any;
    switch (resourceKey) {
      case 'components':
        result = await connector.getComponents();
        break;
      case 'sites':
        result = await connector.fetchSites();
        break;
      case 'templates':
        result = await connector.getTemplates();
        break;
      case 'workflow-models':
        result = await connector.listWorkflowModels();
        break;
      default:
        return { uri, mimeType: 'application/json', text: JSON.stringify({ error: `Unknown resource: ${resourceKey}` }) };
    }

    const summary = extractSummary(result, resourceKey);
    return { uri, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) };
  } catch (error: any) {
    LOGGER.error(`Resource read failed for ${uri}:`, error.message);
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: error.message, uri }),
    };
  }
}
