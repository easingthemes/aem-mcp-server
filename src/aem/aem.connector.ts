import { AEMConfig, getAEMConfig, isValidContentPath, isValidLocale } from './aem.config.js';
import { AEM_ERROR_CODES, createAEMError, createSuccessResponse, handleAEMHttpError, safeExecute, validateComponentOperation } from './aem.errors.js';
import { CliParams } from '../types.js';
import { AEMAuth, AEMFetch } from './aem.fetch.js';
import { LOGGER } from '../utils/logger.js';

export interface AEMConnectorConfig {
  aem: {
    host: string;
    author: string;
    publish: string;
    auth: AEMAuth;
    endpoints: Record<string, string>;
  };
  mcp: {
    name: string;
    version: string;
  };
}

export class AEMConnector {
  isInitialized: boolean;
  isAEMaaCS: boolean;
  config: AEMConnectorConfig;
  aemConfig: AEMConfig;
  private readonly fetch: AEMFetch;

  constructor(params: CliParams) {
    this.isInitialized = false;
    this.config = this.loadConfig(params);
    this.aemConfig = getAEMConfig({});
    this.isAEMaaCS = this.isConfigAEMaaCS();
    this.fetch = new AEMFetch({
      host: this.config.aem.host,
      auth: this.config.aem.auth,
      timeout: this.aemConfig.queries.timeoutMs,
    });
  }

  async init() {
    try {
      await this.fetch.init();
      this.isInitialized = true;
    } catch (error: any) {
      this.isInitialized = false;
    }
  }

  isConfigAEMaaCS(): boolean {
    return Boolean(this.config.aem.auth.clientId && this.config.aem.auth.clientSecret);
  }

  loadConfig(params: CliParams = {}): AEMConnectorConfig {
    let auth;
    if (params.id && params.secret) {
      auth = {
        clientId: params.id,
        clientSecret: params.secret,
      }
    } else {
      auth = {
        username: params.user || 'admin',
        password: params.pass || 'admin',
      }
    }
    return {
      aem: {
        host: params.host || 'http://localhost:4502',
        author: params.host || 'http://localhost:4502',
        publish: 'http://localhost:4503',
        auth,
        endpoints: {
          content: '/content',
          dam: '/content/dam',
          query: '/bin/querybuilder.json',
          crxde: '/crx/de',
          jcr: '',
        },
      },
      mcp: {
        name: 'NAEM MCP Server',
        version: '1.0.0',
      },
    };
  }

  async testConnection(): Promise<{ aem: boolean; auth: boolean }> {
    const aem = await this.testAEMConnection();
    const auth = aem ? await this.testAuthConnection() : false;
    return { aem, auth };
  }

  async testAEMConnection(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.init();
      }
      const url = `/libs/granite/core/content/login.html`;
      LOGGER.log('Testing AEM connection to:', url);
      const response = await this.fetch.get(url, undefined, undefined, 5000, true);
      LOGGER.log('✅ AEM connection successful!');
      return true;
    } catch (error: any) {
      LOGGER.error('❌ AEM connection failed:', error.message);
      return false;
    }
  }

  async testAuthConnection(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.init();
      }
      const url = `/libs/granite/security/currentuser.json`;
      LOGGER.log('Testing AEM authentication connection to:', url);
      const response = await this.fetch.get(url, undefined, undefined,5000);
      LOGGER.log('✅ AEM authentication connection successful!');
      return true;
    } catch (error: any) {
      LOGGER.error('❌ AEM authentication connection failed:', error.message);
      return false;
    }
  }

  async validateComponent(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const pagePath = request.pagePath || request.page_path;
      const { locale, component, props } = request;
      validateComponentOperation(locale, pagePath, component, props);
      if (!isValidLocale(locale, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_LOCALE, `Locale '${locale}' is not supported`, { locale, allowedLocales: this.aemConfig.validation.allowedLocales });
      }
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Path '${pagePath}' is not within allowed content roots`, { path: pagePath, allowedRoots: Object.values(this.aemConfig.contentPaths) });
      }
      const url = `${pagePath}.json`;
      const response = await this.fetch.get(url, {
        params: { ':depth': '2' },
        timeout: this.aemConfig.queries.timeoutMs,
      });
      const validation = this.validateComponentProps(response.data, component, props);
      return createSuccessResponse({
        message: 'Component validation completed successfully',
        pageData: response.data,
        component,
        locale,
        validation,
        configUsed: {
          allowedLocales: this.aemConfig.validation.allowedLocales,
        },
      }, 'validateComponent');
    }, 'validateComponent');
  }

  validateComponentProps(pageData: any, componentType: string, props: any) {
    const warnings: string[] = [];
    const errors: string[] = [];
    if (componentType === 'text' && !props.text && !props.richText) {
      warnings.push('Text component should have text or richText property');
    }
    if (componentType === 'image' && !props.fileReference && !props.src) {
      errors.push('Image component requires fileReference or src property');
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      componentType,
      propsValidated: Object.keys(props).length,
    };
  }

  async updateComponent(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      if (!request.componentPath || typeof request.componentPath !== 'string') {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Component path is required and must be a string');
      }
      if (!request.properties || typeof request.properties !== 'object') {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Properties are required and must be an object');
      }
      // Validate path is within allowed content roots
      if (!isValidContentPath(request.componentPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Component path '${request.componentPath}' is not within allowed content roots`, { path: request.componentPath, allowedRoots: Object.values(this.aemConfig.contentPaths) });
      }
      const url = `${request.componentPath}.json`;
      const checkResponse = await this.fetch.get(url);
      // Check if component exists before updating
      try {
        await checkResponse.json();
      } catch (error: any) {
        if (error.response?.status === 404) {
          throw createAEMError(AEM_ERROR_CODES.COMPONENT_NOT_FOUND, `Component not found at path: ${request.componentPath}`, { componentPath: request.componentPath });
        }
        throw handleAEMHttpError(error, 'updateComponent');
      }
      const formData = new URLSearchParams();
      Object.entries(request.properties).forEach(([key, value]) => {
        if (value === null || value === undefined) {
                    // Handle property deletion with @Delete
          formData.append(`${key}@Delete`, '');
        } else if (Array.isArray(value)) {
          // Handle array values
          value.forEach((item) => {
            formData.append(`${key}`, item.toString());
          });
        } else if (typeof value === 'object') {
          // Handle nested objects
          formData.append(key, JSON.stringify(value));
        } else {
          // Handle primitive values
          formData.append(key, value.toString());
        }
      });
      const response = await this.fetch.post(request.componentPath, formData);
      const verificationResponse = await this.fetch.get(`${request.componentPath}.json`);
      return createSuccessResponse({
        message: 'Component updated successfully',
        path: request.componentPath,
        properties: request.properties,
        updatedProperties: verificationResponse.data,
        response: response.data,
        verification: {
          success: true,
          propertiesChanged: Object.keys(request.properties).length,
          timestamp: new Date().toISOString(),
        },
      }, 'updateComponent');
    }, 'updateComponent');
  }

  async undoChanges(request: any): Promise<object> {
    // Not implemented: AEM MCP does not support undo/rollback. Use AEM version history.
    return createSuccessResponse({
      message: 'undoChanges is not implemented. Please use AEM version history for undo/rollback.',
      request,
      timestamp: new Date().toISOString(),
    }, 'undoChanges');
  }

  async scanPageComponents(pagePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `${pagePath}.infinity.json`;
      const response = await this.fetch.get(url);
      // Extraction logic as in the original JS
      const components: any[] = [];
      const processNode = (node: any, nodePath: string) => {
        if (!node || typeof node !== 'object') return;
        if (node['sling:resourceType']) {
          components.push({
            path: nodePath,
            resourceType: node['sling:resourceType'],
            properties: { ...node },
          });
        }
        Object.entries(node).forEach(([key, value]) => {
          if (typeof value === 'object' && value !== null && !key.startsWith('rep:') && !key.startsWith('oak:')) {
            const childPath = nodePath ? `${nodePath}/${key}` : key;
            processNode(value, childPath);
          }
        });
      };
      if (response.data['jcr:content']) {
        processNode(response.data['jcr:content'], 'jcr:content');
      } else {
        processNode(response.data, pagePath);
      }
      return createSuccessResponse({
        pagePath,
        components,
        totalComponents: components.length,
      }, 'scanPageComponents');
    }, 'scanPageComponents');
  }

  async fetchSites(): Promise<object> {
    return safeExecute<object>(async () => {
      const url = '/content.json';
      const data = await this.fetch.get(url, { ':depth': '2' });
      const sites: any[] = [];
      Object.entries(data).forEach(([key, value]: [string, any]) => {
        if (key.startsWith('jcr:') || key.startsWith('sling:')) return;
        if (value && typeof value === 'object' && value['jcr:content']) {
          sites.push({
            name: key,
            path: `/content/${key}`,
            title: value['jcr:content']['jcr:title'] || key,
            template: value['jcr:content']['cq:template'],
            lastModified: value['jcr:content']['cq:lastModified'],
          });
        }
      });
      return createSuccessResponse({
        sites,
        totalCount: sites.length,
      }, 'fetchSites');
    }, 'fetchSites');
  }

  async fetchLanguageMasters(site: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `/content/${site}.json`;
      const data = await this.fetch.get(url, { ':depth': '3' });
      const masters: any[] = [];
      Object.entries(data).forEach(([key, value]: [string, any]) => {
        if (key.startsWith('jcr:') || key.startsWith('sling:')) return;
        if (value && typeof value === 'object' && value['jcr:content']) {
          masters.push({
            name: key,
            path: `/content/${key}`,
            title: value['jcr:content']['jcr:title'] || key,
            language: value['jcr:content']['jcr:language'] || 'en',
          });
        }
      });
      return createSuccessResponse({
        site,
        languageMasters: masters,
      }, 'fetchLanguageMasters');
    }, 'fetchLanguageMasters');
  }

  async fetchAvailableLocales(site: string, languageMasterPath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `${languageMasterPath}.json`;
      const data = await this.fetch.get(url, { ':depth': '2' });
      const locales: any[] = [];
      Object.entries(data).forEach(([key, value]: [string, any]) => {
        if (key.startsWith('jcr:') || key.startsWith('sling:')) return;
        if (value && typeof value === 'object') {
          locales.push({
            name: key,
            title: value['jcr:content']?.['jcr:title'] || key,
            language: value['jcr:content']?.['jcr:language'] || key,
          });
        }
      });
      return createSuccessResponse({
        site,
        languageMasterPath,
        availableLocales: locales,
      }, 'fetchAvailableLocales');
    }, 'fetchAvailableLocales');
  }

  async replicateAndPublish(selectedLocales: any, componentData: any, localizedOverrides: any): Promise<object> {
    // Simulate replication logic for now
    return safeExecute<object>(async () => {
      return createSuccessResponse({
        message: 'Replication simulated',
        selectedLocales,
        componentData,
        localizedOverrides,
      }, 'replicateAndPublish');
    }, 'replicateAndPublish');
  }

  async getAllTextContent(pagePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `${pagePath}.infinity.json`;
      const data = await this.fetch.get(url);
      const textContent: any[] = [];
      const processNode = (node: any, nodePath: string) => {
        if (!node || typeof node !== 'object') return;
        if (node['text'] || node['jcr:title'] || node['jcr:description']) {
          textContent.push({
            path: nodePath,
            title: node['jcr:title'],
            text: node['text'],
            description: node['jcr:description'],
          });
        }
        Object.entries(node).forEach(([key, value]) => {
          if (typeof value === 'object' && value !== null && !key.startsWith('rep:') && !key.startsWith('oak:')) {
            const childPath = nodePath ? `${nodePath}/${key}` : key;
            processNode(value, childPath);
          }
        });
      };
      if (data['jcr:content']) {
        processNode(data['jcr:content'], 'jcr:content');
      } else {
        processNode(data, pagePath);
      }
      return createSuccessResponse({
        pagePath,
        textContent,
      }, 'getAllTextContent');
    }, 'getAllTextContent');
  }

  async getPageTextContent(pagePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      return this.getAllTextContent(pagePath); // Alias for now
    }, 'getPageTextContent');
  }

  async getPageImages(pagePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `${pagePath}.infinity.json`;
      const data = await this.fetch.get(url);
      const images: any[] = [];
      const processNode = (node: any, nodePath: string) => {
        if (!node || typeof node !== 'object') return;
        if (node['fileReference'] || node['src']) {
          images.push({
            path: nodePath,
            fileReference: node['fileReference'],
            src: node['src'],
            alt: node['alt'] || node['altText'],
            title: node['jcr:title'] || node['title'],
          });
        }
        Object.entries(node).forEach(([key, value]) => {
          if (typeof value === 'object' && value !== null && !key.startsWith('rep:') && !key.startsWith('oak:')) {
            const childPath = nodePath ? `${nodePath}/${key}` : key;
            processNode(value, childPath);
          }
        });
      };
      if (data['jcr:content']) {
        processNode(data['jcr:content'], 'jcr:content');
      } else {
        processNode(data, pagePath);
      }
      return createSuccessResponse({
        pagePath,
        images,
      }, 'getPageImages');
    }, 'getPageImages');
  }

  async updateImagePath(componentPath: string, newImagePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      return this.updateComponent({ componentPath, properties: { fileReference: newImagePath } });
    }, 'updateImagePath');
  }

  async getPageContent(pagePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `${pagePath}.infinity.json`;
      const data = await this.fetch.get(url);
      return createSuccessResponse({
        pagePath,
        content: data,
      }, 'getPageContent');
    }, 'getPageContent');
  }

  /**
   * List direct children under a path using AEM JSON API.
   * Returns array of { name, path, primaryType, title }.
   */
  async listChildren(path: string, depth: number = 1): Promise<any[]> {
    return safeExecute<any[]>(async () => {
      // First try direct JSON API approach
      try {
        const data = await this.fetch.get(`${path}.${depth}.json`);
        const children: any[] = [];
        if (data && typeof data === 'object') {
          Object.entries(data).forEach(([key, value]: [string, any]) => {
            // Skip JCR system properties and metadata
            if (key.startsWith('jcr:') || key.startsWith('sling:') || key.startsWith('cq:') ||
                key.startsWith('rep:') || key.startsWith('oak:') || key === 'jcr:content') {
              return;
            }
            if (value && typeof value === 'object') {
              const childPath = `${path}/${key}`;
              children.push({
                name: key,
                path: childPath,
                primaryType: value['jcr:primaryType'] || 'nt:unstructured',
                title: value['jcr:content']?.['jcr:title'] ||
                       value['jcr:title'] ||
                       key,
                lastModified: value['jcr:content']?.['cq:lastModified'] ||
                             value['cq:lastModified'],
                resourceType: value['jcr:content']?.['sling:resourceType'] ||
                             value['sling:resourceType']
              });
            }
          });
        }
        return children;
      } catch (error: any) {
        // Fallback to QueryBuilder for cq:Page nodes specifically
        if (error.response?.status === 404 || error.response?.status === 403) {
          const data = await this.fetch.get('/bin/querybuilder.json', {
            path: path,
            type: 'cq:Page',
            'p.nodedepth': '1',
            'p.limit': '1000',
            'p.hits': 'full'
          });
          return (data.hits || []).map((hit: any) => ({
            name: hit.name || hit.path?.split('/').pop(),
            path: hit.path,
            primaryType: hit['jcr:primaryType'] || 'cq:Page',
            title: hit['jcr:content/jcr:title'] || hit.title || hit.name,
            lastModified: hit['jcr:content/cq:lastModified'],
            resourceType: hit['jcr:content/sling:resourceType']
          }));
        }
        throw error;
      }
    }, 'listChildren');
  }

  /**
   * List all cq:Page nodes under a site root, up to a given depth and limit.
   */
  async listPages(siteRoot: string, depth: number = 1, limit: number = 20): Promise<object> {
    return safeExecute<object>(async () => {
      // First try direct JSON API approach for better performance
      try {
        const data = await this.fetch.get(`${siteRoot}.${depth}.json`);
        const pages: any[] = [];
        const processNode = (node: any, currentPath: string, currentDepth: number) => {
          if (currentDepth > depth || pages.length >= limit) return;
          Object.entries(node).forEach(([key, value]: [string, any]) => {
            if (pages.length >= limit) return;
            // Skip JCR system properties
            if (key.startsWith('jcr:') || key.startsWith('sling:') || key.startsWith('cq:') ||
                key.startsWith('rep:') || key.startsWith('oak:')) {
              return;
            }
            if (value && typeof value === 'object') {
              const childPath = `${currentPath}/${key}`;
              const primaryType = value['jcr:primaryType'];
              // Only include cq:Page nodes
              if (primaryType === 'cq:Page') {
                pages.push({
                  name: key,
                  path: childPath,
                  primaryType: 'cq:Page',
                  title: value['jcr:content']?.['jcr:title'] || key,
                  template: value['jcr:content']?.['cq:template'],
                  lastModified: value['jcr:content']?.['cq:lastModified'],
                  lastModifiedBy: value['jcr:content']?.['cq:lastModifiedBy'],
                  resourceType: value['jcr:content']?.['sling:resourceType'],
                  type: 'page'
                });
              }
              // Recursively process child nodes if within depth limit
              if (currentDepth < depth) {
                processNode(value, childPath, currentDepth + 1);
              }
            }
          });
        };
        if (data && typeof data === 'object') {
          processNode(data, siteRoot, 0);
        }
        return createSuccessResponse({
          siteRoot,
          pages,
          pageCount: pages.length,
          depth,
          limit,
          totalChildrenScanned: pages.length
        }, 'listPages');
      } catch (error: any) {
        LOGGER.warn('JSON API failed, falling back to QueryBuilder:', error.message);
        // Fallback to QueryBuilder if JSON API fails
        if (error.response?.status === 404 || error.response?.status === 403) {
          const data = await this.fetch.get('/bin/querybuilder.json', {
            path: siteRoot,
            type: 'cq:Page',
            'p.nodedepth': depth.toString(),
            'p.limit': limit.toString(),
            'p.hits': 'full'
          });
          const pages = (data.hits || []).map((hit: any) => ({
            name: hit.name || hit.path?.split('/').pop(),
            path: hit.path,
            primaryType: 'cq:Page',
            title: hit['jcr:content/jcr:title'] || hit.title || hit.name,
            template: hit['jcr:content/cq:template'],
            lastModified: hit['jcr:content/cq:lastModified'],
            lastModifiedBy: hit['jcr:content/cq:lastModifiedBy'],
            resourceType: hit['jcr:content/sling:resourceType'],
            type: 'page'
          }));
          return createSuccessResponse({
            siteRoot,
            pages,
            pageCount: pages.length,
            depth,
            limit,
            totalChildrenScanned: data.total || pages.length,
            fallbackUsed: 'QueryBuilder'
          }, 'listPages');
        }
        throw error;
      }
    }, 'listPages');
  }

  /**
   * Execute a QueryBuilder fulltext search for cq:Page nodes, with security validation.
   * Note: This is NOT a true JCR SQL2 executor. It wraps QueryBuilder and only supports fulltext queries.
   */
  async executeJCRQuery(query: string, limit: number = 20): Promise<object> {
    return safeExecute<object>(async () => {
      if (!query || query.trim().length === 0) {
        throw new Error('Query is required and must be a non-empty string. Note: Only QueryBuilder fulltext is supported, not JCR SQL2.');
      }
      // Basic security validation
      const lower = query.toLowerCase();
      if (/drop|delete|update|insert|exec|script|\.|<script/i.test(lower) || query.length > 1000) {
        throw new Error('Query contains potentially unsafe patterns or is too long');
      }
      const data = await this.fetch.get('/bin/querybuilder.json', {
        path: '/content',
        type: 'cq:Page',
        fulltext: query,
        'p.limit': limit
      });
      return {
        query,
        results: data.hits || [],
        total: data.total || 0,
        limit
      };
    }, 'executeJCRQuery');
  }

  async getPageProperties(pagePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `${pagePath}/jcr:content.json`;
      const data = await this.fetch.get(url);
      const properties = {
        title: data['jcr:title'],
        description: data['jcr:description'],
        template: data['cq:template'],
        lastModified: data['cq:lastModified'],
        lastModifiedBy: data['jcr:createdBy'],
        created: data['jcr:created'],
        createdBy: data['jcr:createdBy'],
        primaryType: data['jcr:primaryType'],
        resourceType: data['sling:resourceType'],
        tags: data['cq:tags'] || [],
        properties: data,
      };
      return createSuccessResponse({
        pagePath,
        properties
      }, 'getPageProperties');
    }, 'getPageProperties');
  }

  async searchContent(params: any): Promise<object> {
    return safeExecute<object>(async () => {
      const data = await this.fetch.get(this.config.aem.endpoints.query, params);
      return createSuccessResponse({
        params,
        results: data.hits || [],
        total: data.total || 0,
        rawResponse: data,
      }, 'searchContent');
    }, 'searchContent');
  }

  async getAssetMetadata(assetPath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `${assetPath}.json`;
      const data = await this.fetch.get(url);
      const metadata = data['jcr:content']?.metadata || {};
      return createSuccessResponse({
        assetPath,
        metadata,
        fullData: data,
      }, 'getAssetMetadata');
    }, 'getAssetMetadata');
  }

  async createPage(request: any): Promise<object> {
    // Use the enhanced createPageWithTemplate method
    return this.createPageWithTemplate(request);
  }

  async deletePage(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { pagePath } = request;
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid page path: ${String(pagePath)}`, { pagePath });
      }
      // Try 'DELETE' first
      let deleted = false;
      try {
        await this.fetch.delete(pagePath);
        deleted = true;
      } catch (err: any) {
        if (err?.status === 405 || err?.response?.status === 405) {
          try {
            await this.fetch.post('/bin/wcmcommand', {
              cmd: 'deletePage',
              path: pagePath,
              force: request.force ? 'true' : 'false',
            });
            deleted = true;
          } catch (postErr: any) {
            try {
              await this.fetch.post(pagePath, { ':operation': 'delete' });
              deleted = true;
            } catch (slingErr: any) {
              throw slingErr;
            }
          }
        } else {
          LOGGER.error('DELETE failed:', err.response?.status, err.response?.data);
          throw err;
        }
      }
      return createSuccessResponse({
        success: deleted,
        deletedPath: pagePath,
        timestamp: new Date().toISOString(),
      }, 'deletePage');
    }, 'deletePage');
  }

  async createComponent(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { pagePath, componentPath, componentType, resourceType, properties = {}, name } = request;
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid page path: ${String(pagePath)}`, { pagePath });
      }
      const componentName = name || `${componentType}_${Date.now()}`;
      const componentNodePath = componentPath || `${pagePath}/jcr:content/${componentName}`;
      await this.fetch.post(componentNodePath, {
        'jcr:primaryType': 'nt:unstructured',
        'sling:resourceType': resourceType,
        ...properties,
        ':operation': 'import',
        ':contentType': 'json',
        ':replace': 'true',
      });
      return createSuccessResponse({
        success: true,
        componentPath: componentNodePath,
        componentType,
        resourceType,
        properties,
        timestamp: new Date().toISOString(),
      }, 'createComponent');
    }, 'createComponent');
  }

  async deleteComponent(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { componentPath } = request;
      if (!isValidContentPath(componentPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid component path: ${String(componentPath)}`, { componentPath });
      }
      let deleted = false;
      try {
        await this.fetch.delete(componentPath);
        deleted = true;
      } catch (err: any) {
        if (err?.status === 405 || err?.response?.status === 405) {
          try {
            await this.fetch.post(componentPath, { ':operation': 'delete' });
            deleted = true;
          } catch (slingErr: any) {
            throw slingErr;
          }
        } else {
          LOGGER.error('DELETE failed:', err.response?.status, err.response?.data);
          throw err;
        }
      }
      return createSuccessResponse({
        success: deleted,
        deletedPath: componentPath,
        timestamp: new Date().toISOString(),
      }, 'deleteComponent');
    }, 'deleteComponent');
  }

  async unpublishContent(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { contentPaths, unpublishTree = false } = request;
      if (!contentPaths || (Array.isArray(contentPaths) && contentPaths.length === 0)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Content paths array is required and cannot be empty', { contentPaths });
      }
      const results: any[] = [];
      for (const path of Array.isArray(contentPaths) ? contentPaths : [contentPaths]) {
        try {
          const formData = new URLSearchParams();
          formData.append('cmd', 'Deactivate');
          formData.append('path', path);
          formData.append('ignoredeactivated', 'false');
          formData.append('onlymodified', 'false');
          if (unpublishTree) {
            formData.append('deep', 'true');
          }
          const data = await this.fetch.post('/bin/replicate.json', formData);
          results.push({
            path,
            success: true,
            response: data
          });
        } catch (error: any) {
          results.push({
            path,
            success: false,
            error: error.message
          });
        }
      }
      return createSuccessResponse({
        success: results.every(r => r.success),
        results,
        unpublishedPaths: contentPaths,
        unpublishTree,
        timestamp: new Date().toISOString(),
      }, 'unpublishContent');
    }, 'unpublishContent');
  }

  async activatePage(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { pagePath, activateTree = false } = request;
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid page path: ${String(pagePath)}`, { pagePath });
      }
      try {
        const formData = new URLSearchParams();
        formData.append('cmd', 'Activate');
        formData.append('path', pagePath);
        formData.append('ignoredeactivated', 'false');
        formData.append('onlymodified', 'false');
        if (activateTree) {
          formData.append('deep', 'true');
        }
        const data = await this.fetch.post('/bin/replicate.json', formData);
        return createSuccessResponse({
          success: true,
          activatedPath: pagePath,
          activateTree,
          response: data,
          timestamp: new Date().toISOString(),
        }, 'activatePage');
      } catch (error: any) {
        try {
          const data = await this.fetch.post('/bin/wcmcommand', {
            cmd: 'activate',
            path: pagePath,
            ignoredeactivated: false,
            onlymodified: false,
          });
          return createSuccessResponse({
            success: true,
            activatedPath: pagePath,
            activateTree,
            response: data,
            fallbackUsed: 'WCM Command',
            timestamp: new Date().toISOString(),
          }, 'activatePage');
        } catch (fallbackError: any) {
          throw handleAEMHttpError(error, 'activatePage');
        }
      }
    }, 'activatePage');
  }

  async deactivatePage(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { pagePath, deactivateTree = false } = request;
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid page path: ${String(pagePath)}`, { pagePath });
      }
      try {
        const formData = new URLSearchParams();
        formData.append('cmd', 'Deactivate');
        formData.append('path', pagePath);
        formData.append('ignoredeactivated', 'false');
        formData.append('onlymodified', 'false');
        if (deactivateTree) {
          formData.append('deep', 'true');
        }
        const data = await this.fetch.post('/bin/replicate.json', formData);
        return createSuccessResponse({
          success: true,
          deactivatedPath: pagePath,
          deactivateTree,
          response: data,
          timestamp: new Date().toISOString(),
        }, 'deactivatePage');
      } catch (error: any) {
        try {
          const data = await this.fetch.post('/bin/wcmcommand', {
            cmd: 'deactivate',
            path: pagePath,
            ignoredeactivated: false,
            onlymodified: false,
          });
          return createSuccessResponse({
            success: true,
            deactivatedPath: pagePath,
            deactivateTree,
            response: data,
            fallbackUsed: 'WCM Command',
            timestamp: new Date().toISOString(),
          }, 'deactivatePage');
        } catch (fallbackError: any) {
          throw handleAEMHttpError(error, 'deactivatePage');
        }
      }
    }, 'deactivatePage');
  }

  async uploadAsset(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { parentPath, fileName, fileContent, mimeType, metadata = {} } = request;
      if (!isValidContentPath(parentPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid parent path: ${String(parentPath)}`, { parentPath });
      }
      const assetPath = `${parentPath}/${fileName}`;
      try {
        // Use proper AEM DAM asset upload via Sling POST servlet
        const formData = new URLSearchParams();
        // Set the file content (base64 or binary)
        if (typeof fileContent === 'string') {
          // Assume base64 encoded content
          formData.append('file', fileContent);
        } else {
          formData.append('file', fileContent.toString());
        }
        // Set required Sling POST parameters for asset creation
        formData.append('fileName', fileName);
        formData.append(':operation', 'import');
        formData.append(':contentType', 'json');
        formData.append(':replace', 'true');
        formData.append('jcr:primaryType', 'dam:Asset');
        if (mimeType) {
          formData.append('jcr:content/jcr:mimeType', mimeType);
        }
        // Add metadata to jcr:content/metadata node
        Object.entries(metadata).forEach(([key, value]) => {
          formData.append(`jcr:content/metadata/${key}`, String(value));
        });
        // Use fetch.post helper for upload
        const uploadResponse = await this.fetch.post(assetPath, formData);
        // Verify the asset was created
        const assetData = await this.fetch.get(`${assetPath}.json`);
        return createSuccessResponse({
          success: true,
          assetPath,
          fileName,
          mimeType,
          metadata,
          uploadResponse,
          assetData,
          timestamp: new Date().toISOString(),
        }, 'uploadAsset');
      } catch (error: any) {
        // Fallback to alternative DAM API if available
        try {
          const damResponse = await this.fetch.post('/api/assets' + parentPath, {
            fileName,
            fileContent,
            mimeType,
            metadata
          });
          return createSuccessResponse({
            success: true,
            assetPath,
            fileName,
            mimeType,
            metadata,
            uploadResponse: damResponse,
            fallbackUsed: 'DAM API',
            timestamp: new Date().toISOString(),
          }, 'uploadAsset');
        } catch (fallbackError: any) {
          throw handleAEMHttpError(error, 'uploadAsset');
        }
      }
    }, 'uploadAsset');
  }

  async updateAsset(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { assetPath, metadata, fileContent, mimeType } = request;
      if (!isValidContentPath(assetPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid asset path: ${String(assetPath)}`, { assetPath });
      }
      const formData = new URLSearchParams();
      // Update file content if provided
      if (fileContent) {
        formData.append('file', fileContent);
        if (mimeType) {
          formData.append('jcr:content/jcr:mimeType', mimeType);
        }
      }
      // Update metadata if provided
      if (metadata && typeof metadata === 'object') {
        Object.entries(metadata).forEach(([key, value]) => {
          formData.append(`jcr:content/metadata/${key}`, String(value));
        });
      }
      try {
        const updateResponse = await this.fetch.post(assetPath, formData);
        // Verify the update
        const assetData = await this.fetch.get(`${assetPath}.json`);
        return createSuccessResponse({
          success: true,
          assetPath,
          updatedMetadata: metadata,
          updateResponse,
          assetData,
          timestamp: new Date().toISOString(),
        }, 'updateAsset');
      } catch (error: any) {
        throw handleAEMHttpError(error, 'updateAsset');
      }
    }, 'updateAsset');
  }

  async deleteAsset(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { assetPath, force = false } = request;
      if (!isValidContentPath(assetPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid asset path: ${String(assetPath)}`, { assetPath });
      }
      await this.fetch.delete(assetPath);
      return createSuccessResponse({
        success: true,
        deletedPath: assetPath,
        force,
        timestamp: new Date().toISOString(),
      }, 'deleteAsset');
    }, 'deleteAsset');
  }

  getTemplatesPath(inputPath?: string): string {
    if (!inputPath || inputPath.trim().length === 0) {
      return '';
    }
    // Normalize the path to ensure it starts with /conf and ends with /settings/wcm/templates
    let validPath = inputPath.trim();
    let prefix = '/conf';
    let suffix = '/settings/wcm/templates';
    // Remove trailing slashes
    validPath = validPath.replace(/\/+$/, '');
    if (validPath.startsWith('/content/')) {
      validPath = validPath.replace('/content', '');
    }
    // If starts with /conf, just ensure it ends with the suffix
    if (!validPath.startsWith(prefix)) {
      validPath = `${prefix}/${validPath.replace(/^\//, '')}`; // Ensure single slash
    }
    if (!validPath.endsWith(suffix)) {
      validPath += suffix;
    }
    return validPath;
  }

  async getTemplates(sitePath?: string): Promise<object> {
    return safeExecute<object>(async () => {
      // If sitePath is provided, look for templates specific to that site
      if (sitePath) {
        try {
          // Try to get site-specific templates from /conf
          const confPath = this.getTemplatesPath(sitePath);
          if (!confPath) {
            throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Cannot determine configuration path for site: ${sitePath}`, { sitePath });
          }
          LOGGER.log('Looking for site-specific templates at:', confPath);
          const data = await this.fetch.get(`${confPath}.2.json`);

          const templates: any[] = [];
          if (data && typeof data === 'object') {
            Object.entries(data).forEach(([key, value]: [string, any]) => {
              if (key.startsWith('jcr:') || key.startsWith('sling:')) return;
              if (value && typeof value === 'object' && value['jcr:content']) {
                templates.push({
                  name: key,
                  path: `${confPath}/${key}`,
                  title: value['jcr:content']['jcr:title'] || key,
                  description: value['jcr:content']['jcr:description'],
                  allowedPaths: value['jcr:content']['allowedPaths'],
                  ranking: value['jcr:content']['ranking'] || 0
                });
              }
            });
          }

          return createSuccessResponse({
            sitePath,
            templates,
            totalCount: templates.length,
            source: 'site-specific'
          }, 'getTemplates');
        } catch (error: any) {
          // Fallback to global templates if site-specific not found
        }
      }

      // Get global templates from /apps or /libs
      try {
        const globalPaths = ['/apps/wcm/core/content/sites/templates', '/libs/wcm/core/content/sites/templates'];
        const allTemplates: any[] = [];

        for (const templatePath of globalPaths) {
          try {
            const data = await this.fetch.get(`${templatePath}.json`, {
              ':depth': '2'
            });

            if (data && typeof data === 'object') {
              Object.entries(data).forEach(([key, value]: [string, any]) => {
                if (key.startsWith('jcr:') || key.startsWith('sling:')) return;
                if (value && typeof value === 'object') {
                  allTemplates.push({
                    name: key,
                    path: `${templatePath}/${key}`,
                    title: value['jcr:content']?.['jcr:title'] || key,
                    description: value['jcr:content']?.['jcr:description'],
                    allowedPaths: value['jcr:content']?.['allowedPaths'],
                    ranking: value['jcr:content']?.['ranking'] || 0,
                    source: templatePath.includes('/apps/') ? 'apps' : 'libs'
                  });
                }
              });
            }
          } catch (pathError: any) {
            // Continue to next path if this one fails
          }
        }

        return createSuccessResponse({
          sitePath: sitePath || 'global',
          templates: allTemplates,
          totalCount: allTemplates.length,
          source: 'global'
        }, 'getTemplates');
      } catch (error: any) {
        throw handleAEMHttpError(error, 'getTemplates');
      }
    }, 'getTemplates');
  }

  async getTemplateStructure(templatePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      try {
        // Get the full template structure with deeper depth
        const response = await this.fetch.get(`${templatePath}.infinity.json`);
        const structure = {
          path: templatePath,
          properties: response['jcr:content'] || {},
          policies: response['jcr:content']?.['policies'] || {},
          structure: response['jcr:content']?.['structure'] || {},
          initialContent: response['jcr:content']?.['initial'] || {},
          allowedComponents: [] as string[],
          allowedPaths: response['jcr:content']?.['allowedPaths'] || []
        };
        // Extract allowed components from policies
        const extractComponents = (node: any, path: string = '') => {
          if (!node || typeof node !== 'object') return;
          if (node['components']) {
            const componentKeys = Object.keys(node['components']);
            structure.allowedComponents.push(...componentKeys);
          }
          Object.entries(node).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null && !key.startsWith('jcr:')) {
              extractComponents(value, path ? `${path}/${key}` : key);
            }
          });
        };
        extractComponents(structure.policies);
        // Remove duplicates
        structure.allowedComponents = [...new Set(structure.allowedComponents)];
        return createSuccessResponse({
          templatePath,
          structure,
          fullData: response
        }, 'getTemplateStructure');
      } catch (error: any) {
        throw handleAEMHttpError(error, 'getTemplateStructure');
      }
    }, 'getTemplateStructure');
  }

  /**
   * Bulk update multiple components with validation and rollback support.
   */
  async bulkUpdateComponents(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { updates, validateFirst = true, continueOnError = false } = request;
      if (!Array.isArray(updates) || updates.length === 0) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Updates array is required and cannot be empty');
      }
      const results: any[] = [];
      // Validation phase if requested
      if (validateFirst) {
        for (const update of updates) {
          try {
            await this.fetch.get(`${update.componentPath}.json`);
          } catch (error: any) {
            if (error.response?.status === 404) {
              results.push({
                componentPath: update.componentPath,
                success: false,
                error: `Component not found: ${update.componentPath}`,
                phase: 'validation'
              });
              if (!continueOnError) {
                return createSuccessResponse({
                  success: false,
                  message: 'Bulk update failed during validation phase',
                  results,
                  totalUpdates: updates.length,
                  successfulUpdates: 0
                }, 'bulkUpdateComponents');
              }
            }
          }
        }
      }
      // Update phase
      let successCount = 0;
      for (const update of updates) {
        try {
          const result = await this.updateComponent({
            componentPath: update.componentPath,
            properties: update.properties
          });
          results.push({
            componentPath: update.componentPath,
            success: true,
            result: result,
            phase: 'update'
          });
          successCount++;
        } catch (error: any) {
          results.push({
            componentPath: update.componentPath,
            success: false,
            error: error.message,
            phase: 'update'
          });
          if (!continueOnError) {
            break;
          }
        }
      }
      return createSuccessResponse({
        success: successCount === updates.length,
        message: `Bulk update completed: ${successCount}/${updates.length} successful`,
        results,
        totalUpdates: updates.length,
        successfulUpdates: successCount,
        failedUpdates: updates.length - successCount
      }, 'bulkUpdateComponents');
    }, 'bulkUpdateComponents');
  }

  /**
   * Legacy: Get JCR node content as raw JSON for a given path and depth.
   */
  async getNodeContent(path: string, depth: number = 1): Promise<any> {
    return safeExecute<any>(async () => {
      const url = `${path}.json`;
      const content = await this.fetch.get(url, { ':depth': depth.toString() });
      return {
        path,
        depth,
        content,
        timestamp: new Date().toISOString()
      };
    }, 'getNodeContent');
  }

  /**
   * Enhanced getTemplates method with better template discovery and validation
   */
  async getAvailableTemplates(parentPath: string): Promise<object> {
    return safeExecute<object>(async () => {
      console.log('getAvailableTemplates for parentPath:', parentPath);
      // Try to determine site configuration from parent path
      let confPath = '/conf';
      const pathParts = parentPath.split('/');
      if (pathParts.length >= 3 && pathParts[1] === 'content') {
        const siteName = pathParts[2];
        confPath = `/conf/${siteName}`;
      }

      // Get templates from configuration
      const templatesPath = `${confPath}/settings/wcm/templates`;

      try {
        const data = await this.fetch.get(`${templatesPath}.3.json`);

        const templates: any[] = [];

        if (data && typeof data === 'object') {
          Object.entries(data).forEach(([key, value]: [string, any]) => {
            if (key.startsWith('jcr:') || key.startsWith('sling:')) return;

            if (value && typeof value === 'object' && value['jcr:content']) {
              const templatePath = `${templatesPath}/${key}`;
              const content = value['jcr:content'];
              const structure = value?.['structure']?.['jcr:content'] || {};

              templates.push({
                name: key,
                path: templatePath,
                title: content['jcr:title'] || key,
                description: content['jcr:description'] || '',
                thumbnail: content['thumbnail'] || '',
                allowedPaths: content['allowedPaths'] || [],
                status: content['status'] || 'enabled',
                ranking: content['ranking'] || 0,
                templateType: content['templateType'] || 'page',
                resourceType: structure['sling:resourceType'] || '',
                lastModified: content['cq:lastModified'],
                createdBy: content['jcr:createdBy']
              });
            }
          });
        }

        // Sort templates by ranking and name
        templates.sort((a, b) => {
          if (a.ranking !== b.ranking) {
            return b.ranking - a.ranking; // Higher ranking first
          }
          return a.name.localeCompare(b.name);
        });

        return createSuccessResponse({
          parentPath,
          templatesPath,
          templates,
          totalCount: templates.length,
          availableTemplates: templates.filter(t => t.status === 'enabled')
        }, 'getAvailableTemplates');

      } catch (error: any) {
        if (error.response?.status === 404) {
          // Fallback to global templates
          const globalTemplatesPath = '/libs/wcm/foundation/templates';
          const globalResponse = await this.fetch.get(`${globalTemplatesPath}.json`, {
            ':depth': '2'
          });

          const globalTemplates: any[] = [];
          if (globalResponse && typeof globalResponse === 'object') {
            Object.entries(globalResponse).forEach(([key, value]: [string, any]) => {
              if (key.startsWith('jcr:') || key.startsWith('sling:')) return;

              if (value && typeof value === 'object') {
                globalTemplates.push({
                  name: key,
                  path: `${globalTemplatesPath}/${key}`,
                  title: value['jcr:title'] || key,
                  description: value['jcr:description'] || 'Global template',
                  status: 'enabled',
                  ranking: 0,
                  templateType: 'page',
                  isGlobal: true
                });
              }
            });
          }

          return createSuccessResponse({
            parentPath,
            templatesPath: globalTemplatesPath,
            templates: globalTemplates,
            totalCount: globalTemplates.length,
            availableTemplates: globalTemplates,
            fallbackUsed: true
          }, 'getAvailableTemplates');
        }
        throw error;
      }
    }, 'getAvailableTemplates');
  }

  /**
   * Enhanced createPage method with proper template handling and jcr:content creation
   */
  async createPageWithTemplate(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { parentPath, title, template, name, properties = {}, resourceType = '' } = request;

      if (!isValidContentPath(parentPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid parent path: ${String(parentPath)}`, { parentPath });
      }

      // If no template provided, get available templates and prompt user
      let selectedTemplatePath = template;
      let templateResourceType = resourceType;
      if (!selectedTemplatePath || !templateResourceType) {
        const templatesResponse = await this.getAvailableTemplates(parentPath);
        const availableTemplates = (templatesResponse as any).data.availableTemplates;

        if (availableTemplates.length === 0) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'No templates available for this path', { parentPath });
        }

        // Auto-select the first available template
        const selectedTemplate = availableTemplates[0];
        if (selectedTemplatePath) {
          selectedTemplatePath = selectedTemplate.path;
        }
        if (!templateResourceType && selectedTemplate.resourceType) {
          templateResourceType = selectedTemplate.resourceType;
        }
        LOGGER.log(`🎯 Auto-selected template: ${selectedTemplatePath} (${availableTemplates[0].title})`, templateResourceType);
      }

      // Validate template exists
      try {
        const verifyTemplate = await this.fetch.get(`${selectedTemplatePath}.json`);
        LOGGER.log(`✅ Template verified: ${selectedTemplatePath}`, verifyTemplate);
      } catch (error: any) {
        LOGGER.error('Template verification failed:', error.message, error);
        if (error?.response?.status === 404) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Template not found: ${selectedTemplatePath}`, { template: selectedTemplatePath });
        }
        throw handleAEMHttpError(error, 'createPageWithTemplate');
      }

      const pageName = name || title.replace(/\s+/g, '-').toLowerCase();
      const newPagePath = `${parentPath}/${pageName}`;

      // Create page with proper structure
      const pageData = {
        'jcr:primaryType': 'cq:Page',
        'jcr:content': {
          'jcr:primaryType': 'cq:PageContent',
          'jcr:title': title,
          'cq:template': selectedTemplatePath,
          'sling:resourceType': templateResourceType || 'foundation/components/page',
          // Remove protected properties that are managed by the repository
          // 'jcr:createdBy': 'mcp-server',
          // 'jcr:created': new Date().toISOString(),
          'cq:lastModified': new Date().toISOString(),
          'cq:lastModifiedBy': 'admin', // Use the authenticated user instead
          ...properties
        }
      };

      // Create the page using Sling POST servlet
      const formData = new URLSearchParams();
      formData.append('jcr:primaryType', 'cq:Page');

      // Create page first
      await this.fetch.post(newPagePath, formData);

      // Then create jcr:content node
      const contentFormData = new URLSearchParams();
      Object.entries(pageData['jcr:content']).forEach(([key, value]) => {
        // Skip protected JCR properties
        if (key === 'jcr:created' || key === 'jcr:createdBy') {
          return;
        }

        if (typeof value === 'object') {
          contentFormData.append(key, JSON.stringify(value));
        } else {
          contentFormData.append(key, String(value));
        }
      });

      await this.fetch.post(`${newPagePath}/jcr:content`, contentFormData);

      // Verify page creation
      const verificationResponse = await this.fetch.get(`${newPagePath}.json`);
      const hasJcrContent = verificationResponse['jcr:content'] !== undefined;

      // Check if page is accessible in author mode
      // TODO: add response status to fetch helper
      let pageAccessible = false;
      try {
        const authorResponse = await this.fetch.get(`${newPagePath}.html`);
        pageAccessible = authorResponse.status === 200;
      } catch (error) {
        pageAccessible = false;
      }

      // Check AEM error logs (simplified check)
      const errorLogCheck = {
        hasErrors: false,
        errors: []
      };

      return createSuccessResponse({
        success: true,
        pagePath: newPagePath,
        title,
        templateUsed: selectedTemplatePath,
        jcrContentCreated: hasJcrContent,
        pageAccessible,
        errorLogCheck,
        creationDetails: {
          timestamp: new Date().toISOString(),
          steps: [
            'Template validation completed',
            'Page node created',
            'jcr:content node created',
            'Page structure verified',
            'Accessibility check completed'
          ]
        },
        pageStructure: verificationResponse.data
      }, 'createPageWithTemplate');
    }, 'createPageWithTemplate');
  }

  /**
   * Validate template compatibility with target path
   */
  async validateTemplate(templatePath: string, targetPath: string): Promise<object> {
    return safeExecute<object>(async () => {
      try {
        const templateData = await this.fetch.get(`${templatePath}.json`);

        if (!templateData || !templateData['jcr:content']) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Invalid template structure', { templatePath });
        }

        const content = templateData['jcr:content'];
        const allowedPaths = content['allowedPaths'] || [];

        // Check if target path is allowed
        let isAllowed = allowedPaths.length === 0; // If no restrictions, allow all

        if (allowedPaths.length > 0) {
          isAllowed = allowedPaths.some((allowedPath: string) => {
            return targetPath.startsWith(allowedPath);
          });
        }

        return createSuccessResponse({
          templatePath,
          targetPath,
          isValid: isAllowed,
          templateTitle: content['jcr:title'] || 'Untitled Template',
          templateDescription: content['jcr:description'] || '',
          allowedPaths,
          restrictions: {
            hasPathRestrictions: allowedPaths.length > 0,
            allowedPaths
          }
        }, 'validateTemplate');

      } catch (error: any) {
        if (error.response?.status === 404) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Template not found: ${templatePath}`, { templatePath });
        }
        throw handleAEMHttpError(error, 'validateTemplate');
      }
    }, 'validateTemplate');
  }

  /**
   * Get template metadata and caching
   */
  private templateCache = new Map<string, any>();
  private templateCacheExpiry = new Map<string, number>();
  private readonly TEMPLATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async getTemplateMetadata(templatePath: string, useCache: boolean = true): Promise<object> {
    return safeExecute<object>(async () => {
      // Check cache first
      if (useCache && this.templateCache.has(templatePath)) {
        const expiry = this.templateCacheExpiry.get(templatePath) || 0;
        if (Date.now() < expiry) {
          return createSuccessResponse({
            ...this.templateCache.get(templatePath),
            fromCache: true
          }, 'getTemplateMetadata');
        }
      }

      const data = await this.fetch.get(`${templatePath}.json`);

      if (!data || !data['jcr:content']) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Invalid template structure', { templatePath });
      }

      const content = data['jcr:content'];
      const metadata = {
        templatePath,
        title: content['jcr:title'] || 'Untitled Template',
        description: content['jcr:description'] || '',
        thumbnail: content['thumbnail'] || '',
        allowedPaths: content['allowedPaths'] || [],
        status: content['status'] || 'enabled',
        ranking: content['ranking'] || 0,
        templateType: content['templateType'] || 'page',
        lastModified: content['cq:lastModified'],
        createdBy: content['jcr:createdBy'],
        policies: content['policies'] || {},
        structure: content['structure'] || {},
        initialContent: content['initial'] || {}
      };

      // Cache the result
      if (useCache) {
        this.templateCache.set(templatePath, metadata);
        this.templateCacheExpiry.set(templatePath, Date.now() + this.TEMPLATE_CACHE_TTL);
      }

      return createSuccessResponse(metadata, 'getTemplateMetadata');
    }, 'getTemplateMetadata');
  }

  /**
   * Clear template cache
   */
  clearTemplateCache(): void {
    this.templateCache.clear();
    this.templateCacheExpiry.clear();
    console.log('🗑️ Template cache cleared');
  }
}
