export interface AEMConfig {
  contentPaths: {
    sitesRoot: string;
    assetsRoot: string;
    templatesRoot: string;
    experienceFragmentsRoot: string;
  };
  replication: {
    publisherUrls: string[];
    defaultReplicationAgent: string;
  };
  components: {
    defaultProperties: Record<string, any>;
    componentPaths?: {
      projectRoot1?: string;
    };
  };
  queries: {
    maxLimit: number;
    defaultLimit: number;
    timeoutMs: number;
  };
  validation: {
    maxDepth: number;
    allowedLocales: string[];
  };
}

export type AEMBaseConfig = {
  AEM_PUBLISHER_URLS?: string;
  AEM_ALLOWED_COMPONENTS?: string;
  AEM_QUERY_MAX_LIMIT?: string;
  AEM_QUERY_DEFAULT_LIMIT?: string;
  AEM_QUERY_TIMEOUT?: string;
  AEM_MAX_DEPTH?: string;
  AEM_ALLOWED_LOCALES?: string;
}

export function getAEMConfig(config: AEMBaseConfig): AEMConfig {
  return {
    contentPaths: {
      sitesRoot: '/content',
      assetsRoot: '/content/dam',
      templatesRoot: '/conf',
      experienceFragmentsRoot: '/content/experience-fragments',
    },
    replication: {
      publisherUrls: config.AEM_PUBLISHER_URLS?.split(',') || ['http://localhost:4503'],
      defaultReplicationAgent: 'publish',
    },
    components: {
      defaultProperties: {
        'jcr:primaryType': 'nt:unstructured',
        'sling:resourceType': 'foundation/components/text'
      },
      componentPaths: {
        projectRoot1: '/apps/aemmcp/base/components'
      }
    },
    queries: {
      maxLimit: parseInt(config.AEM_QUERY_MAX_LIMIT || '100'),
      defaultLimit: parseInt(config.AEM_QUERY_DEFAULT_LIMIT || '20'),
      timeoutMs: parseInt(config.AEM_QUERY_TIMEOUT || '30000'),
    },
    validation: {
      maxDepth: parseInt(config.AEM_MAX_DEPTH || '5'),
      allowedLocales: config.AEM_ALLOWED_LOCALES?.split(',') || ['en'],
    },
  };
}

export function isValidContentPath(path: string, config: AEMConfig): boolean {
  const allowedRoots = Object.values(config.contentPaths);
  return allowedRoots.some(root => path.startsWith(root));
}

export function isValidLocale(locale: string, config: AEMConfig): boolean {
  if (!locale) return false;
  const normalized = locale.toLowerCase();
  return config.validation.allowedLocales.some(l => l.toLowerCase() === normalized ||
    (normalized === 'en' && l.toLowerCase().startsWith('en')));
}
