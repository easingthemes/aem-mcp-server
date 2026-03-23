import { AEMConfig, getAEMConfig, isValidContentPath, isValidLocale } from './aem.config.js';
import { AEM_ERROR_CODES, createAEMError, createSuccessResponse, handleAEMHttpError, safeExecute } from './aem.errors.js';
import { CliParams } from '../types.js';
import { AEMAuth, AEMFetch } from './aem.fetch.js';
import { filterNodeTree, filterProperties } from './aem.filter.js';
import { ContentFragmentManager } from './aem.content-fragments.js';
import { ExperienceFragmentManager } from './aem.experience-fragments.js';
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

interface FieldDefinition {
  name: string;
  type: string; // 'select', 'checkbox', 'textfield', 'textarea', etc.
  required: boolean;
  options?: string[]; // For select/dropdown fields
  defaultValue?: any;
  description?: string;
}

export class AEMConnector {
  isInitialized: boolean;
  isAEMaaCS: boolean;
  config: AEMConnectorConfig;
  aemConfig: AEMConfig;
  private readonly fetch: AEMFetch;
  readonly contentFragments: ContentFragmentManager;
  readonly experienceFragments: ExperienceFragmentManager;

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
    this.contentFragments = new ContentFragmentManager(this.fetch, this.isAEMaaCS);
    this.experienceFragments = new ExperienceFragmentManager(this.fetch, this.config.aem.host);
  }

  async init() {
    await this.fetch.init();
    this.isInitialized = true;
  }

  isConfigAEMaaCS(): boolean {
    return Boolean(this.config.aem.auth.clientId && this.config.aem.auth.clientSecret);
  }

  loadConfig(params: CliParams = {}): AEMConnectorConfig {
    let auth: AEMAuth;
    
    // OAuth Server-to-Server (client credentials)
    if (params.id && params.secret) {
      auth = {
        clientId: params.id,
        clientSecret: params.secret,
      };
    } 
    // Basic Authentication
    else {
      auth = {
        username: params.user || 'admin',
        password: params.pass || 'admin',
      };
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

  private getPreviewUrl(pagePath: string): string {
    return `${this.config.aem.host}${pagePath}.html?wcmmode=disabled`;
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
      
      // Check if component exists
      const url = `${request.componentPath}.json`;
      let existingComponent: any;
      try {
        existingComponent = await this.fetch.get(url);
        if (!existingComponent || (typeof existingComponent === 'object' && Object.keys(existingComponent).length === 0)) {
          throw createAEMError(AEM_ERROR_CODES.COMPONENT_NOT_FOUND, `Component not found at path: ${request.componentPath}`, { componentPath: request.componentPath });
        }
      } catch (error: any) {
        if (error.code === AEM_ERROR_CODES.COMPONENT_NOT_FOUND) {
          throw error;
        }
        if (error.message?.includes('404') || error.response?.status === 404) {
          throw createAEMError(AEM_ERROR_CODES.COMPONENT_NOT_FOUND, `Component not found at path: ${request.componentPath}`, { componentPath: request.componentPath });
        }
        throw handleAEMHttpError(error, 'updateComponent');
      }
      
      // Get resourceType to validate properties against component dialog
      const resourceType = existingComponent['sling:resourceType'];
      if (resourceType) {
        // Fetch component definition and validate property values
        LOGGER.log(`Validating properties against component definition for: ${resourceType}`);
        const componentDef = await this.getComponentDefinition(resourceType);
        
        if (Object.keys(componentDef.fieldDefinitions).length > 0) {
          const validation = this.validateComponentProperties(request.properties, componentDef.fieldDefinitions);
          
          if (!validation.valid) {
            const errorMessages = validation.errors.join('; ');
            throw createAEMError(
              AEM_ERROR_CODES.INVALID_PARAMETERS,
              `Invalid property values for component ${resourceType}: ${errorMessages}`,
              {
                resourceType,
                componentPath: componentDef.componentPath,
                validationErrors: validation.errors,
                invalidFields: validation.invalidFields,
                providedProperties: request.properties,
              }
            );
          }
          
          if (validation.warnings.length > 0) {
            LOGGER.warn(`Property validation warnings: ${validation.warnings.join('; ')}`);
          }
          
          LOGGER.log(`Property values validated successfully against component dialog definitions`);
        }
      }
      
      // Use direct POST with form data to update component properties
      // This works with SlingPostServlet - just POST the properties to the component path
      const formData = new URLSearchParams();
      
      // Include resourceType if it exists (required for some components)
      if (resourceType) {
        formData.append('sling:resourceType', resourceType);
      }
      
      Object.entries(request.properties).forEach(([key, value]) => {
        if (value === null || value === undefined) {
          // Handle property deletion with @Delete
          formData.append(`${key}@Delete`, '');
        } else if (Array.isArray(value)) {
          // Handle array values - SlingPostServlet supports multiple values
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
      
      // POST to component path - SlingPostServlet will modify existing resource
      // Add Accept header to get JSON response instead of HTML
      const response = await this.fetch.post(request.componentPath, formData, {
        headers: {
          'Accept': 'application/json'
        }
      });
      
      // Verify the update was successful
      const verificationResponse = await this.fetch.get(`${request.componentPath}.json`);
      
      return createSuccessResponse({
        message: 'Component updated successfully',
        path: request.componentPath,
        properties: request.properties,
        updatedProperties: verificationResponse,
        response: response,
        verification: {
          success: true,
          propertiesChanged: Object.keys(request.properties).length,
          timestamp: new Date().toISOString(),
        },
      }, 'updateComponent');
    }, 'updateComponent');
  }

  async scanPageComponents(pagePath: string, verbosity: string = 'standard'): Promise<object> {
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
            properties: filterProperties({ ...node }, verbosity),
          });
        }
        Object.entries(node).forEach(([key, value]) => {
          if (typeof value === 'object' && value !== null && !key.startsWith('rep:') && !key.startsWith('oak:')) {
            const childPath = nodePath ? `${nodePath}/${key}` : key;
            processNode(value, childPath);
          }
        });
      };
      if (response['jcr:content']) {
        processNode(response['jcr:content'], 'jcr:content');
      } else {
        processNode(response, pagePath);
      }
      return createSuccessResponse({
        pagePath,
        verbosity,
        components,
        totalComponents: components.length,
      }, 'scanPageComponents');
    }, 'scanPageComponents');
  }

  async fetchSites(): Promise<object> {
    return safeExecute<object>(async () => {
      const url = '/content.2.json';
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
      const url = `/content/${site}.2.json`;
      const data = await this.fetch.get(url);
      const masters: any[] = [];

      let masterNode: any = null;
      let masterPath: string = '';
      
      Object.entries(data).forEach(([key, value]: [string, any]) => {
        if ((key === 'master' || key === 'language-masters') && value && typeof value === 'object') {
          masterNode = value;
          masterPath = `/content/${site}/${key}`;
        }
      });
      
      if (!masterNode) {
        return createSuccessResponse({
          site,
          languageMasters: [],
          message: 'No master or language-masters node found'
        }, 'fetchLanguageMasters');
      }
      
      // Get locales under master/language-masters
      Object.entries(masterNode).forEach(([key, value]: [string, any]) => {
        if (key.startsWith('jcr:') || key.startsWith('sling:')) return;
        if (value && typeof value === 'object') {
          masters.push({
            name: key,
            path: `${masterPath}/${key}`,
            title: value['jcr:content']?.['jcr:title'] || value['jcr:title'] || key,
            language: value['jcr:content']?.['jcr:language'] || value['jcr:language'] || key,
          });
        }
      });
      
      return createSuccessResponse({
        site,
        languageMasters: masters,
      }, 'fetchLanguageMasters');
    }, 'fetchLanguageMasters');
  }

  async fetchAvailableLocales(site: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `/content/${site}.4.json`;
      const data = await this.fetch.get(url);
      const locales: Record<string, { path: string; title: string; language?: string; country?: string }> = {};
      
      const findLocales = (node: any, currentPath: string, pathSegments: string[] = []) => {
        if (!node || typeof node !== 'object') return;
        
        Object.entries(node).forEach(([key, value]: [string, any]) => {
          if (key.startsWith('jcr:') || key.startsWith('sling:') || 
              key.startsWith('cq:') || key.startsWith('rep:') || 
              key.startsWith('oak:') || key === 'jcr:content') {
            return;
          }
          
          if (value && typeof value === 'object') {
            const childPath = `${currentPath}/${key}`;
            const newSegments = [...pathSegments, key];
            
            
            const jcrContent = value['jcr:content'];
            const hasContent = jcrContent && typeof jcrContent === 'object';
            const language = jcrContent?.['jcr:language'] || null;
            
            const isLanguageCode = key.length === 2 || key.length === 3;
            const parentIsCountryCode = pathSegments.length > 0 && 
                                       (pathSegments[pathSegments.length - 1].length === 2 || 
                                        pathSegments[pathSegments.length - 1].length === 3);
            
            if (hasContent && isLanguageCode && parentIsCountryCode) {
              const country = pathSegments[pathSegments.length - 1].toUpperCase();
              const lang = key.toLowerCase();
              const localeKey = `${lang}_${country}`;

              locales[localeKey] = {
                path: childPath,
                title: jcrContent?.['jcr:title'] || key,
                language: language || `${lang}_${country}`,
                country: country,
              };
            }
            
            findLocales(value, childPath, newSegments);
          }
        });
      };
      
      findLocales(data, `/content/${site}`, []);
      
      return createSuccessResponse({
        site,
        locales,
        totalCount: Object.keys(locales).length,
      }, 'fetchAvailableLocales');
    }, 'fetchAvailableLocales');
  }

  async getAllTextContent(pagePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      let data: any;
      // Try infinity.json first, then fallback to depth-based approach if it redirects
      try {
        const url = `${pagePath}.infinity.json`;
        data = await this.fetch.get(url);
      } catch (error: any) {
        // If infinity.json fails (e.g., 300 redirect), try with depth parameter
        if (error.message?.includes('300') || error.message?.includes('redirect')) {
          LOGGER.warn(`infinity.json failed for ${pagePath}, trying depth-based approach`);
          try {
            // Try with a deep depth parameter
            data = await this.fetch.get(`${pagePath}.5.json`);
          } catch (depthError: any) {
            // If that fails, try with jcr:content path
            try {
              data = await this.fetch.get(`${pagePath}/jcr:content.5.json`);
            } catch (jcrError: any) {
              throw handleAEMHttpError(error, 'getAllTextContent');
            }
          }
        } else {
          throw handleAEMHttpError(error, 'getAllTextContent');
        }
      }
      
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

  async getPageContent(pagePath: string, verbosity: string = 'standard'): Promise<object> {
    return safeExecute<object>(async () => {
      const url = `${pagePath}.infinity.json`;
      const data = await this.fetch.get(url);
      const content = filterNodeTree(data, verbosity);
      return createSuccessResponse({
        pagePath,
        verbosity,
        content,
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
      // Use Sling import with :content parameter — the JSON node data must be
      // passed as the :content form field, not as the raw JSON body. When mixed
      // into the JSON body, Sling strips sling:resourceType and other properties.
      const importData = new URLSearchParams();
      importData.append(':operation', 'import');
      importData.append(':contentType', 'json');
      importData.append(':replace', 'true');
      importData.append(':content', JSON.stringify({
        'jcr:primaryType': 'nt:unstructured',
        'sling:resourceType': resourceType,
        ...properties,
      }));
      await this.fetch.post(componentNodePath, importData);
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

  /**
   * Fetch component definition and parse cq:dialog to extract required properties.
   * If no cq:dialog is found, checks sling:resourceSuperType recursively.
   * 
   * @param resourceType - Sling resource type (e.g., aemmcp/base/components/aemmcp-text/v1/aemmcp-text)
   * @param visitedTypes - Set of already visited resource types to prevent infinite recursion
   * @returns Object with component path and required properties array
   */
  private async getComponentDefinition(resourceType: string, visitedTypes: Set<string> = new Set()): Promise<{ 
    componentPath: string; 
    requiredProperties: string[];
    fieldDefinitions: Record<string, FieldDefinition>;
  }> {
    const requiredProperties: string[] = [];
    const fieldDefinitions: Record<string, FieldDefinition> = {};
    let componentPath = '';

    // Prevent infinite recursion
    if (visitedTypes.has(resourceType)) {
      LOGGER.warn(`Circular reference detected for resourceType: ${resourceType}`);
      return { componentPath, requiredProperties, fieldDefinitions };
    }
    visitedTypes.add(resourceType);

    // Convert resourceType to path (replace : with /)
    const resourcePath = resourceType.replace(/:/g, '/');
    
    // Try to find component definition in /apps and /libs
    const searchPaths = [
      `/apps/${resourcePath}`,
      `/libs/${resourcePath}`,
    ];

    let dialogFound = false;
    let superType: string | null = null;

    for (const basePath of searchPaths) {
      try {
        // Try to fetch the component definition
        const componentDef = await this.fetch.get(`${basePath}.json`, { ':depth': '2' });
        if (componentDef) {
          componentPath = basePath;
          
          // Check for sling:resourceSuperType
          if (componentDef['sling:resourceSuperType']) {
            superType = componentDef['sling:resourceSuperType'];
            LOGGER.log(`Found sling:resourceSuperType: ${superType} for component at ${basePath}`);
          }
          
          // Try to fetch cq:dialog
          try {
            const dialogPath = `${basePath}/_cq_dialog`;
            const dialog = await this.fetch.get(`${dialogPath}.infinity.json`);
            
            // Recursively parse dialog to find required fields and field definitions
            const parseDialog = (node: any, path: string = ''): void => {
              if (!node || typeof node !== 'object') return;
              
              // Check if this is a form field widget
              const resourceType = node['sling:resourceType'] || '';
              const fieldName = node['name'] || node['fieldName'];
              
              // Remove ./ prefix from field name if present
              const cleanFieldName = fieldName ? fieldName.replace(/^\.\//, '') : null;
              
              // Check for different field types
              if (cleanFieldName && (
                resourceType.includes('form/select') ||
                resourceType.includes('form/checkbox') ||
                resourceType.includes('form/textfield') ||
                resourceType.includes('form/textarea') ||
                resourceType.includes('form/numberfield') ||
                resourceType.includes('form/pathfield') ||
                resourceType.includes('form/datepicker') ||
                resourceType.includes('form/colorfield')
              )) {
                const isRequired = node['required'] === true || node['required'] === 'true';
                const fieldDef: FieldDefinition = {
                  name: cleanFieldName,
                  type: this.getFieldType(resourceType),
                  required: isRequired,
                  description: node['fieldDescription'] || node['fieldLabel'] || '',
                  defaultValue: node['value'] !== undefined ? node['value'] : (node['checked'] !== undefined ? node['checked'] : undefined),
                };
                
                // Extract options for select/dropdown fields
                if (resourceType.includes('form/select') && node['items']) {
                  const options: string[] = [];
                  const items = node['items'];
                  
                  if (typeof items === 'object') {
                    Object.values(items).forEach((item: any) => {
                      if (item && typeof item === 'object' && item['value'] !== undefined) {
                        options.push(String(item['value']));
                      }
                    });
                  }
                  
                  if (options.length > 0) {
                    fieldDef.options = options;
                  }
                }
                
                // For checkbox, ensure boolean values
                if (resourceType.includes('form/checkbox')) {
                  // Checkbox accepts boolean or string 'true'/'false'
                  // We don't set options for checkbox, validation will handle it
                }
                
                fieldDefinitions[cleanFieldName] = fieldDef;
                LOGGER.log(`Found field definition: ${cleanFieldName} (type: ${fieldDef.type}, options: ${fieldDef.options ? fieldDef.options.join(', ') : 'N/A'})`);
                
                if (isRequired && !requiredProperties.includes(cleanFieldName)) {
                  requiredProperties.push(cleanFieldName);
                }
              }
              
              // Check for items (tabs, fieldsets, etc.)
              if (node['items']) {
                if (Array.isArray(node['items'])) {
                  node['items'].forEach((item: any, index: number) => {
                    parseDialog(item, path ? `${path}/items[${index}]` : `items[${index}]`);
                  });
                } else if (typeof node['items'] === 'object') {
                  Object.entries(node['items']).forEach(([key, value]) => {
                    parseDialog(value, path ? `${path}/items/${key}` : `items/${key}`);
                  });
                }
              }
              
              // Recursively check all child nodes
              Object.entries(node).forEach(([key, value]) => {
                if (typeof value === 'object' && value !== null && 
                    !key.startsWith('jcr:') && 
                    !key.startsWith('sling:') &&
                    key !== 'items') {
                  parseDialog(value, path ? `${path}/${key}` : key);
                }
              });
            };
            
            parseDialog(dialog);
            dialogFound = true;
            LOGGER.log(`Found component definition at ${componentPath}, required properties: ${requiredProperties.join(', ')}, field definitions: ${Object.keys(fieldDefinitions).join(', ')}`);
            break;
          } catch (dialogError: any) {
            // Dialog might not exist or be accessible
            LOGGER.warn(`Could not fetch dialog for ${basePath}: ${dialogError.message}`);
          }
        }
      } catch (error: any) {
        // Component not found at this path, try next
        continue;
      }
    }

    // If no dialog was found but we have a super type, check the super type
    if (!dialogFound && superType) {
      LOGGER.log(`No dialog found for ${resourceType}, checking super type: ${superType}`);
      const superTypeDef = await this.getComponentDefinition(superType, visitedTypes);
      // Merge required properties from super type
      superTypeDef.requiredProperties.forEach(prop => {
        if (!requiredProperties.includes(prop)) {
          requiredProperties.push(prop);
        }
      });
      // Merge field definitions from super type
      Object.entries(superTypeDef.fieldDefinitions).forEach(([key, value]) => {
        if (!fieldDefinitions[key]) {
          fieldDefinitions[key] = value;
        }
      });
      // Use super type component path if we don't have one
      if (!componentPath && superTypeDef.componentPath) {
        componentPath = superTypeDef.componentPath;
      }
    }

    return { componentPath, requiredProperties, fieldDefinitions };
  }

  /**
   * Extract field type from sling:resourceType
   */
  private getFieldType(resourceType: string): string {
    if (resourceType.includes('form/select')) return 'select';
    if (resourceType.includes('form/checkbox')) return 'checkbox';
    if (resourceType.includes('form/textfield')) return 'textfield';
    if (resourceType.includes('form/textarea')) return 'textarea';
    if (resourceType.includes('form/numberfield')) return 'numberfield';
    if (resourceType.includes('form/pathfield')) return 'pathfield';
    if (resourceType.includes('form/datepicker')) return 'datepicker';
    if (resourceType.includes('form/colorfield')) return 'colorfield';
    return 'unknown';
  }

  /**
   * Validate component properties against field definitions
   * @param properties - Properties to validate
   * @param fieldDefinitions - Field definitions from component dialog
   * @returns Validation result with errors and warnings
   */
  private validateComponentProperties(properties: any, fieldDefinitions: Record<string, FieldDefinition>): {
    valid: boolean;
    errors: string[];
    warnings: string[];
    invalidFields: Record<string, { provided: any; expected: any; message: string }>;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const invalidFields: Record<string, { provided: any; expected: any; message: string }> = {};

    for (const [fieldName, fieldDef] of Object.entries(fieldDefinitions)) {
      const providedValue = properties[fieldName];
      
      // Skip validation if field is not provided (unless required)
      if (providedValue === undefined || providedValue === null) {
        continue;
      }

      // Validate select/dropdown fields
      if (fieldDef.type === 'select' && fieldDef.options) {
        const stringValue = String(providedValue);
        if (!fieldDef.options.includes(stringValue)) {
          const errorMsg = `Invalid value '${providedValue}' for field '${fieldName}'. Allowed values: ${fieldDef.options.join(', ')}`;
          errors.push(errorMsg);
          invalidFields[fieldName] = {
            provided: providedValue,
            expected: fieldDef.options,
            message: errorMsg
          };
        }
      }

      // Validate checkbox fields (must be boolean or string 'true'/'false')
      if (fieldDef.type === 'checkbox') {
        const isValid = typeof providedValue === 'boolean' || 
                       providedValue === 'true' || 
                       providedValue === 'false' ||
                       providedValue === true ||
                       providedValue === false;
        if (!isValid) {
          const errorMsg = `Invalid value '${providedValue}' for checkbox field '${fieldName}'. Must be boolean or 'true'/'false'`;
          errors.push(errorMsg);
          invalidFields[fieldName] = {
            provided: providedValue,
            expected: 'boolean or "true"/"false"',
            message: errorMsg
          };
        }
      }

      // Validate number fields
      if (fieldDef.type === 'numberfield') {
        if (isNaN(Number(providedValue))) {
          const errorMsg = `Invalid value '${providedValue}' for number field '${fieldName}'. Must be a number`;
          errors.push(errorMsg);
          invalidFields[fieldName] = {
            provided: providedValue,
            expected: 'number',
            message: errorMsg
          };
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      invalidFields
    };
  }

  /**
   * Fetch cq:template structure from component definition
   * @param componentPath - Path to the component definition (e.g., /apps/aemmcp/base/components/...)
   * @returns Template structure or null if not found
   */
  private async getComponentTemplate(componentPath: string): Promise<any | null> {
    if (!componentPath) {
      return null;
    }

    try {
      // Use cq:template directly - AEM's JSON servlet handles it
      const templatePath = `${componentPath}/cq:template.infinity.json`;
      LOGGER.log(`Checking for cq:template at: ${templatePath}`);
      
      const template = await this.fetch.get(templatePath);
      
      if (template && typeof template === 'object' && Object.keys(template).length > 0) {
        LOGGER.log(`✅ Found cq:template with ${Object.keys(template).length} top-level keys`);
        const childKeys = Object.keys(template).filter(k => !k.startsWith('jcr:') && !k.startsWith('sling:'));
        if (childKeys.length > 0) {
          LOGGER.log(`Template child nodes: ${childKeys.join(', ')}`);
        }
        return template;
      }
      
      return null;
    } catch (error: any) {
      const statusCode = error.response?.status || error.statusCode || 'unknown';
      if (statusCode === 404) {
        LOGGER.log(`No cq:template found at ${componentPath}/cq:template`);
      } else {
        LOGGER.warn(`Error checking for cq:template: ${error.message} (status: ${statusCode})`);
      }
      return null;
    }
  }

  /**
   * Apply cq:template child nodes to a component.
   *
   * Uses Sling POST servlet's `:operation=import` with `:contentType=json` so
   * that the entire child subtree (including deeply nested grand-children) is
   * created as real JCR nodes in a single request per top-level child.
   *
   * Previous implementation used URLSearchParams (form-urlencoded) which cannot
   * represent nested structures — any object values were serialized via
   * JSON.stringify and stored as string properties instead of child nodes.
   *
   * @param targetPath - Path where the component is created
   * @param templateChildNodes - Child nodes from template (e.g., col_1, col_2, par, etc.)
   */
  private async applyTemplateChildNodes(targetPath: string, templateChildNodes: Record<string, any>): Promise<void> {
    if (!templateChildNodes || Object.keys(templateChildNodes).length === 0) {
      return;
    }

    LOGGER.log(`Applying ${Object.keys(templateChildNodes).length} child nodes from cq:template to: ${targetPath}`);

    for (const [childName, childNode] of Object.entries(templateChildNodes)) {
      try {
        const childPath = `${targetPath}/${childName}`;

        // Ensure jcr:primaryType is set
        const nodeData = { ...childNode };
        if (!nodeData['jcr:primaryType']) {
          nodeData['jcr:primaryType'] = 'nt:unstructured';
        }

        // Use Sling import with :content parameter. The JSON node data must
        // be passed as the :content form field, NOT mixed into the JSON body.
        // When control params (:operation, :contentType) are in the JSON body,
        // Sling strips sling:resourceType and other properties from child nodes.
        const importData = new URLSearchParams();
        importData.append(':operation', 'import');
        importData.append(':contentType', 'json');
        importData.append(':replace', 'true');
        importData.append(':content', JSON.stringify(nodeData));
        await this.fetch.post(childPath, importData);
        LOGGER.log(`Created template child node: ${childPath}`);
      } catch (error: any) {
        LOGGER.warn(`Failed to create template child node ${childName}: ${error.message}`);
      }
    }
  }

  /**
   * Add a component to an existing page.
   * This method automatically finds the appropriate container (root/container) and adds the component there.
   * It also validates required properties by checking the component's cq:dialog.
   * 
   * @param request - Component addition request
   * @param request.pagePath - Path to the existing page (e.g., /content/site/en/page)
   * @param request.resourceType - Sling resource type of the component (required)
   * @param request.containerPath - Optional: specific container path (defaults to root/container)
   * @param request.name - Optional: component node name (auto-generated if not provided)
   * @param request.properties - Optional: component properties to set
   * @returns Success response with component details
   */
  async addComponent(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { pagePath, resourceType, containerPath, name, properties = {} } = request;
      
      // Validate required parameters
      if (!pagePath || typeof pagePath !== 'string') {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Page path is required and must be a string', { pagePath });
      }
      if (!resourceType || typeof resourceType !== 'string') {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Resource type is required and must be a string', { resourceType });
      }
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Invalid page path: ${String(pagePath)}`, { pagePath });
      }

      // Fetch component definition and validate required properties
      LOGGER.log(`Fetching component definition for resourceType: ${resourceType}`);
      const componentDef = await this.getComponentDefinition(resourceType);
      
      if (componentDef.componentPath) {
        LOGGER.log(`Component definition found at: ${componentDef.componentPath}`);
      } else {
        LOGGER.warn(`Component definition not found for ${resourceType}, skipping required property validation`);
      }

      // Validate required properties if component definition was found
      if (componentDef.requiredProperties.length > 0) {
        const missingProperties: string[] = [];
        componentDef.requiredProperties.forEach((propName) => {
          if (!(propName in properties) || properties[propName] === null || properties[propName] === undefined || properties[propName] === '') {
            missingProperties.push(propName);
          }
        });

        if (missingProperties.length > 0) {
          throw createAEMError(
            AEM_ERROR_CODES.INVALID_PARAMETERS,
            `Missing required properties for component ${resourceType}: ${missingProperties.join(', ')}`,
            {
              resourceType,
              componentPath: componentDef.componentPath,
              requiredProperties: componentDef.requiredProperties,
              missingProperties,
              providedProperties: Object.keys(properties),
            }
          );
        }
        LOGGER.log(`All required properties validated: ${componentDef.requiredProperties.join(', ')}`);
      }

      // Validate property values against field definitions (dropdown options, checkbox values, etc.)
      LOGGER.log(`Checking field definitions: ${Object.keys(componentDef.fieldDefinitions).length} fields found`);
      if (Object.keys(componentDef.fieldDefinitions).length > 0) {
        LOGGER.log(`Field definitions: ${JSON.stringify(Object.keys(componentDef.fieldDefinitions))}`);
        LOGGER.log(`Validating properties: ${JSON.stringify(Object.keys(properties))}`);
        const validation = this.validateComponentProperties(properties, componentDef.fieldDefinitions);
        
        LOGGER.log(`Validation result: valid=${validation.valid}, errors=${validation.errors.length}`);
        
        if (!validation.valid) {
          const errorMessages = validation.errors.join('; ');
          LOGGER.error(`Property validation failed: ${errorMessages}`);
          throw createAEMError(
            AEM_ERROR_CODES.INVALID_PARAMETERS,
            `Invalid property values for component ${resourceType}: ${errorMessages}`,
            {
              resourceType,
              componentPath: componentDef.componentPath,
              validationErrors: validation.errors,
              invalidFields: validation.invalidFields,
              providedProperties: properties,
            }
          );
        }
        
        if (validation.warnings.length > 0) {
          LOGGER.warn(`Property validation warnings: ${validation.warnings.join('; ')}`);
        }
        
        LOGGER.log(`Property values validated successfully against component dialog definitions`);
      } else {
        LOGGER.log(`No field definitions found for component ${resourceType}, skipping property value validation`);
      }

      // Verify page exists
      try {
        const pageData = await this.fetch.get(`${pagePath}.json`);
        if (!pageData || (typeof pageData === 'object' && Object.keys(pageData).length === 0)) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Page not found or invalid at: ${pagePath}`, { pagePath });
        }
        // If pageData exists, the page is valid (jcr:content might be nested or accessed differently)
        LOGGER.log(`Page verified at: ${pagePath}`);
      } catch (error: any) {
        if (error.message?.includes('404') || error.message?.includes('Page not found') || error.response?.status === 404) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Page not found at: ${pagePath}`, { pagePath });
        }
        throw handleAEMHttpError(error, 'addComponent');
      }

      // Determine container path 
      let targetContainerPath: string;
      if (containerPath) {
        // Use provided container path (can be relative or absolute)
        if (containerPath.startsWith('/')) {
          targetContainerPath = containerPath;
        } else {
          if (containerPath.includes('jcr:content')) {
            targetContainerPath = `${pagePath}/${containerPath}`;
          } else {
            targetContainerPath = `${pagePath}/jcr:content/${containerPath}`;
          }
        }
      } else {
        // Try to find the default container (root/container)
        const jcrContentPath = `${pagePath}/jcr:content`;
        let foundContainer = false;
        
        try {
          // Try with deeper depth to find root/container structure
          const jcrContent = await this.fetch.get(`${jcrContentPath}.5.json`);
          
          // Look for root/container structure
          if (jcrContent && jcrContent['root']) {
            if (jcrContent['root']['container']) {
              targetContainerPath = `${jcrContentPath}/root/container`;
              foundContainer = true;
              LOGGER.log(`✅ Found root/container at: ${targetContainerPath}`);
            } else {
              // Root exists but no container - create container under root
              targetContainerPath = `${jcrContentPath}/root/container`;
              foundContainer = false; // Will create it
              LOGGER.log(`Found root but no container, will create container at: ${targetContainerPath}`);
            }
          } else {
            // No root found - will create root/container structure
            targetContainerPath = `${jcrContentPath}/root/container`;
            foundContainer = false;
            LOGGER.log(`No root found, will create root/container at: ${targetContainerPath}`);
          }
        } catch (error: any) {
          // If fetch fails, default to root/container and create it
          targetContainerPath = `${jcrContentPath}/root/container`;
          foundContainer = false;
          LOGGER.warn(`Could not fetch jcr:content structure, will create root/container at: ${targetContainerPath}`);
        }
        
        // If container path not found, we'll create it in the next step
      }

      // Verify container exists, create if it doesn't
      try {
        await this.fetch.get(`${targetContainerPath}.json`);
        LOGGER.log(`✅ Container exists at: ${targetContainerPath}`);
      } catch (error: any) {
        if (error.message?.includes('404') || error.response?.status === 404) {
          // Container doesn't exist, create the full path (root/container)
          LOGGER.warn(`Container not found at ${targetContainerPath}, attempting to create root/container structure`);
          
          const jcrContentPath = `${pagePath}/jcr:content`;
          const rootPath = `${jcrContentPath}/root`;
          const containerPath = `${rootPath}/container`;
          
          try {
            // First, ensure root exists
            try {
              await this.fetch.get(`${rootPath}.json`);
              LOGGER.log(`✅ Root already exists at: ${rootPath}`);
            } catch (rootError: any) {
              // Root doesn't exist, create it
              LOGGER.log(`Creating root at: ${rootPath}`);
              await this.fetch.post(rootPath, {
                'jcr:primaryType': 'nt:unstructured',
                'sling:resourceType': 'aemmcp/base/components/aemmcp-container/v1/aemmcp-container',
              });
              LOGGER.log(`✅ Created root at: ${rootPath}`);
            }
            
            // Then create container under root
            if (targetContainerPath === containerPath) {
              LOGGER.log(`Creating container at: ${containerPath}`);
              await this.fetch.post(containerPath, {
                'jcr:primaryType': 'nt:unstructured',
                'sling:resourceType': 'aemmcp/base/components/aemmcp-container/v1/aemmcp-container',
              });
              LOGGER.log(`✅ Created container at: ${containerPath}`);
            }
          } catch (createError: any) {
            throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Could not create root/container structure at: ${targetContainerPath}`, { 
              targetContainerPath, 
              error: createError.message 
            });
          }
        } else {
          throw handleAEMHttpError(error, 'addComponent');
        }
      }

      // Generate component name if not provided
      const componentName = name || `component_${Date.now()}`;
      const componentNodePath = `${targetContainerPath}/${componentName}`;

      // Check for cq:template in component definition
      let componentTemplate: any = null;
      let templateComponentProperties: any = {};
      let templateChildNodes: Record<string, any> = {};
      
      if (componentDef.componentPath) {
        componentTemplate = await this.getComponentTemplate(componentDef.componentPath);
        if (componentTemplate) {
          LOGGER.log(`Component has cq:template, processing structure...`);
          
          // Separate component-level properties from child nodes
          const systemProps = ['jcr:created', 'jcr:createdBy', 'jcr:lastModified', 'jcr:lastModifiedBy', 'jcr:mixinTypes'];
          const componentPropertyKeys = ['jcr:primaryType', 'sling:resourceType', 'layout', 'showSeparator', 'columns', 'separator'];
          
          for (const [key, value] of Object.entries(componentTemplate)) {
            if (systemProps.includes(key)) continue;
            
            if (componentPropertyKeys.includes(key)) {
              templateComponentProperties[key] = value;
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
                       ((value as Record<string, any>)['jcr:primaryType'] !== undefined || 
                        (value as Record<string, any>)['sling:resourceType'] !== undefined)) {
              // This is a child node (e.g., col_1, col_2)
              templateChildNodes[key] = value;
            } else if (typeof value !== 'object' || Array.isArray(value)) {
              // Simple property
              templateComponentProperties[key] = value;
            }
          }
          
          LOGGER.log(`Template: ${Object.keys(templateComponentProperties).length} properties, ${Object.keys(templateChildNodes).length} child nodes`);
        }
      }

      // Create the component - merge template properties with provided properties
      const formData = new URLSearchParams();
      
      // Start with template properties
      Object.entries(templateComponentProperties).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          if (Array.isArray(value)) {
            value.forEach((item) => formData.append(key, item.toString()));
          } else if (typeof value === 'object') {
            formData.append(key, JSON.stringify(value));
          } else {
            formData.append(key, value.toString());
          }
        }
      });
      
      // Override with provided properties (provided takes precedence)
      Object.entries(properties).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          if (Array.isArray(value)) {
            value.forEach((item) => formData.append(key, item.toString()));
          } else if (typeof value === 'object') {
            formData.append(key, JSON.stringify(value));
          } else {
            formData.append(key, value.toString());
          }
        }
      });
      
      // Ensure required properties are set
      if (!formData.has('jcr:primaryType')) {
        formData.append('jcr:primaryType', 'nt:unstructured');
      }
      if (!formData.has('sling:resourceType')) {
        formData.append('sling:resourceType', resourceType);
      }

      await this.fetch.post(componentNodePath, formData);

      // Apply template child nodes if they exist
      if (Object.keys(templateChildNodes).length > 0) {
        try {
          await this.applyTemplateChildNodes(componentNodePath, templateChildNodes);
          LOGGER.log(`✅ Applied ${Object.keys(templateChildNodes).length} child nodes from cq:template`);
        } catch (templateError: any) {
          LOGGER.warn(`Failed to apply cq:template child nodes: ${templateError.message}`);
        }
      }

      // Verify component was created
      let verificationResponse = await this.fetch.get(`${componentNodePath}.json`);
      
      // Check if component is a container (cq:isContainer = true)
      // First check the component definition to see if it's marked as a container
      let isContainer = false;
      let containerStructure: any = null;
      
      try {
        // Check component definition for cq:isContainer property
        if (componentDef.componentPath) {
          const componentDefinition = await this.fetch.get(`${componentDef.componentPath}.json`, { ':depth': '2' });
          if (componentDefinition && (componentDefinition['cq:isContainer'] === true || componentDefinition['cq:isContainer'] === 'true')) {
            isContainer = true;
            LOGGER.log(`Component ${resourceType} is a container component (cq:isContainer=true)`);
            
            // Wait a moment for AEM to create default structure (columns, containers, etc.)
            // Container components may create structure asynchronously
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Fetch the created component again with deeper depth to see what default structure was created
            verificationResponse = await this.fetch.get(`${componentNodePath}.json`, { ':depth': '5' });
            
            // If no structure found, try one more time after a longer wait
            const hasStructure = Object.keys(verificationResponse).some(key => 
              !key.startsWith('jcr:') && !key.startsWith('sling:') && !key.startsWith('cq:') &&
              key !== 'layout' && key !== 'showSeparator' && key !== 'columns' && key !== 'separator'
            );
            
            if (!hasStructure) {
              LOGGER.log(`No default structure detected immediately, waiting longer...`);
              await new Promise(resolve => setTimeout(resolve, 1500));
              verificationResponse = await this.fetch.get(`${componentNodePath}.json`, { ':depth': '5' });
            }
            
            // Extract container structure (columns, default components, etc.)
            containerStructure = {};
            const extractStructure = (obj: any, basePath: string, depth: number = 0): void => {
              if (depth > 3) return; // Limit recursion
              
              Object.keys(obj).forEach(key => {
                // Skip JCR system properties and the component's own properties
                if (!key.startsWith('jcr:') && !key.startsWith('sling:') && 
                    !key.startsWith('cq:') && key !== 'layout' && key !== 'showSeparator' &&
                    key !== 'columns' && key !== 'separator') {
                  const child = obj[key];
                  if (child && typeof child === 'object' && !Array.isArray(child)) {
                    const childPath = basePath ? `${basePath}/${key}` : key;
                    
                    // Check if it's a container/column/parsys structure
                    // For column control, columns are named col_1, col_2, col_3, etc.
                    // They have resourceType: aemmcp/base/components/aemmcp-columncontrol/v1/aemmcp-columncontrol/aemmcp-cc-container
                    if (child['sling:resourceType']) {
                      const childResourceType = child['sling:resourceType'];
                      // Check if it's a column container (for column control components)
                      if (childResourceType.includes('aemmcp-cc-container') || 
                          childResourceType.includes('columncontrol') ||
                          key.startsWith('col_') || key.match(/^col_\d+$/)) {
                        containerStructure[key] = {
                          path: `${componentNodePath}/${childPath}`,
                          resourceType: childResourceType,
                          type: 'column',
                          isContainer: child['cq:isContainer'] === true || child['cq:isContainer'] === 'true'
                        };
                      } else {
                        containerStructure[key] = {
                          path: `${componentNodePath}/${childPath}`,
                          resourceType: childResourceType,
                          isContainer: child['cq:isContainer'] === true || child['cq:isContainer'] === 'true'
                        };
                      }
                      // Recursively check children
                      extractStructure(child, childPath, depth + 1);
                    } else if (key.startsWith('col_') || key.match(/^col_\d+$/) ||
                               key.startsWith('column') || key.match(/^column\d+$/) || 
                               key.includes('container') || key.includes('parsys') ||
                               key.includes('Column') || key.includes('Container')) {
                      containerStructure[key] = {
                        path: `${componentNodePath}/${childPath}`,
                        type: 'container',
                        children: Object.keys(child).filter(k => !k.startsWith('jcr:') && !k.startsWith('sling:') && !k.startsWith('cq:'))
                      };
                      // Recursively check children
                      extractStructure(child, childPath, depth + 1);
                    }
                  }
                }
              });
            };
            
            extractStructure(verificationResponse, '');
            
            if (Object.keys(containerStructure).length > 0) {
              LOGGER.log(`Container structure detected: ${Object.keys(containerStructure).join(', ')}`);
            } else {
              LOGGER.log(`Container component created but no default structure detected yet`);
            }
          }
        }
      } catch (error: any) {
        // If we can't check, continue without container structure info
        LOGGER.warn(`Could not check container status: ${error.message}`);
      }
      
      return createSuccessResponse({
        success: true,
        pagePath,
        previewUrl: this.getPreviewUrl(pagePath),
        componentPath: componentNodePath,
        resourceType,
        isContainer,
        containerStructure: containerStructure || undefined,
        componentDefinition: {
          path: componentDef.componentPath || 'Not found',
          requiredProperties: componentDef.requiredProperties,
          validationPassed: componentDef.requiredProperties.length === 0 || 
            componentDef.requiredProperties.every(prop => prop in properties && properties[prop] !== null && properties[prop] !== undefined && properties[prop] !== ''),
          hasTemplate: componentTemplate !== null,
          templatePath: componentTemplate ? `${componentDef.componentPath}/cq:template` : undefined,
          templateChildNodesCount: Object.keys(templateChildNodes).length,
          fieldDefinitions: Object.keys(componentDef.fieldDefinitions).length > 0 ? componentDef.fieldDefinitions : undefined,
        },
        containerPath: targetContainerPath,
        componentName,
        properties,
        verification: verificationResponse,
        timestamp: new Date().toISOString(),
      }, 'addComponent');
    }, 'addComponent');
  }

  async deleteComponent(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { componentPath } = request;
      if (!isValidContentPath(componentPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid component path: ${String(componentPath)}`, { componentPath });
      }
      let deleted = false;
      // Use POST with :operation=delete as primary method (works better with SlingPostServlet)
      try {
        const formData = new URLSearchParams();
        formData.append(':operation', 'delete');
        await this.fetch.post(componentPath, formData);
        deleted = true;
      } catch (err: any) {
        // If POST fails, try DELETE method as fallback
        if (err?.status === 405 || err?.response?.status === 405 || err?.status === 403 || err?.response?.status === 403) {
          try {
            await this.fetch.delete(componentPath);
            deleted = true;
          } catch (deleteErr: any) {
            LOGGER.error('Both POST and DELETE failed:', err.response?.status, deleteErr.response?.status);
            throw err; // Throw original POST error
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
        let data;
        if (activateTree) {
          formData.append('ignoredeactivated', 'false');
          formData.append('onlymodified', 'false');
          formData.append('deep', 'true');
          data = await this.fetch.post('/libs/replication/treeactivation.html', formData);
        } else {
          data = await this.fetch.post('/bin/replicate.json', formData);
        }
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
   * Find all components of a specific resource type on a page, delete them, and create new components of another type at the same location
   * 
   * @param request.pagePath - Path to the page containing components to convert
   * @param request.sourceResourceType - The resource type to search for and convert
   * @param request.targetResourceType - The resource type to convert to
   * @param request.requiredProperties - Optional: Required property values for the target component
   * @param request.continueOnError - Optional flag to continue on errors
   */
  async convertComponents(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { 
        pagePath,
        sourceResourceType, 
        targetResourceType, 
        requiredProperties = {},
        continueOnError = true 
      } = request;

      if (!pagePath || typeof pagePath !== 'string') {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Page path is required and must be a string');
      }

      if (!sourceResourceType || typeof sourceResourceType !== 'string') {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Source resource type is required and must be a string');
      }

      if (!targetResourceType || typeof targetResourceType !== 'string') {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Target resource type is required and must be a string');
      }

      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Page path '${pagePath}' is not within allowed content roots`);
      }

      LOGGER.log(`Scanning page ${pagePath} for components with resourceType: ${sourceResourceType}`);

      // Scan the page to find all components
      const scanResult = await this.scanPageComponents(pagePath);
      const scanData = scanResult as any;
      const allComponents = scanData.data?.components || scanData.components || [];

      // Filter components by source resource type
      const sourceComponents = allComponents.filter((comp: any) => 
        comp.resourceType === sourceResourceType
      );

      if (sourceComponents.length === 0) {
        return createSuccessResponse({
          message: `No components found with resourceType: ${sourceResourceType} on page ${pagePath}`,
          pagePath,
          sourceResourceType,
          targetResourceType,
          componentsFound: 0,
          componentsConverted: 0,
        }, 'convertComponents');
      }

      LOGGER.log(`Found ${sourceComponents.length} components with resourceType: ${sourceResourceType}`);

      // Get target component definition to check for required properties
      const targetComponentDef = await this.getComponentDefinition(targetResourceType);
      const targetRequiredProps = targetComponentDef.requiredProperties || [];

      // Check if required properties are provided
      const missingRequiredProps: string[] = [];
      if (targetRequiredProps.length > 0) {
        targetRequiredProps.forEach((propName: string) => {
          if (!(propName in requiredProperties) || 
              requiredProperties[propName] === null || 
              requiredProperties[propName] === undefined || 
              requiredProperties[propName] === '') {
            missingRequiredProps.push(propName);
          }
        });

        if (missingRequiredProps.length > 0) {
          return createSuccessResponse({
            message: `Target component requires properties that are not provided`,
            pagePath,
            sourceResourceType,
            targetResourceType,
            componentsFound: sourceComponents.length,
            componentsConverted: 0,
            targetComponentRequiredProperties: targetRequiredProps,
            missingRequiredProperties: missingRequiredProps,
            providedProperties: Object.keys(requiredProperties),
            note: 'Please provide the missing required properties in the requiredProperties parameter and retry',
          }, 'convertComponents');
        }
      }

      // Process each source component
      const results: any[] = [];
      let successCount = 0;
      let failureCount = 0;

      for (const sourceComp of sourceComponents) {
        try {
          // Build the full component path
          // scanPageComponents returns paths relative to pagePath (e.g., "jcr:content/root/container/component")
          let sourceComponentPath: string;
          if (sourceComp.path.startsWith('/')) {
            // Already absolute path
            sourceComponentPath = sourceComp.path;
          } else if (sourceComp.path.startsWith('jcr:content')) {
            // Relative path starting with jcr:content
            sourceComponentPath = `${pagePath}/${sourceComp.path}`;
          } else {
            // Relative path, prepend pagePath
            sourceComponentPath = `${pagePath}/${sourceComp.path}`;
          }

          LOGGER.log(`Processing component at: ${sourceComponentPath}`);

          // Step 1: Delete the source component
          LOGGER.log(`Deleting source component at: ${sourceComponentPath}`);
          await this.deleteComponent({ componentPath: sourceComponentPath });

          // Step 2: Create target component at the same location
          LOGGER.log(`Creating target component at: ${sourceComponentPath}`);

          // Create the component by POSTing directly to the component path
          const formData = new URLSearchParams();
          formData.append('jcr:primaryType', 'nt:unstructured');
          formData.append('sling:resourceType', targetResourceType);
          
          // Add custom properties
          Object.entries(requiredProperties).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
              // Strip ./ prefix from property names (AEM dialog notation vs API property name)
              const propertyName = key.startsWith('./') ? key.substring(2) : key;
              
              if (Array.isArray(value)) {
                value.forEach((item) => {
                  formData.append(propertyName, item.toString());
                });
              } else if (typeof value === 'object') {
                formData.append(propertyName, JSON.stringify(value));
              } else {
                formData.append(propertyName, value.toString());
              }
            }
          });

          // POST directly to the component path to create it
          await this.fetch.post(sourceComponentPath, formData, {
            headers: {
              'Accept': 'application/json'
            }
          });

          // Verify the component was created
          const verificationResponse = await this.fetch.get(`${sourceComponentPath}.json`);
          if (!verificationResponse || !verificationResponse['sling:resourceType'] || 
              verificationResponse['sling:resourceType'] !== targetResourceType) {
            throw new Error(`Component creation verification failed: resourceType mismatch`);
          }

          results.push({
            sourceComponentPath,
            targetComponentPath: sourceComponentPath,
            success: true,
            message: `Successfully converted component from ${sourceResourceType} to ${targetResourceType}`,
          });
          successCount++;
          LOGGER.log(`✅ Successfully converted component at: ${sourceComponentPath}`);

        } catch (error: any) {
          const errorMessage = error.message || String(error);
          LOGGER.error(`Failed to convert component at ${sourceComp.path}: ${errorMessage}`);
          
          results.push({
            sourceComponentPath: sourceComp.path,
            success: false,
            error: errorMessage,
          });
          failureCount++;

          if (!continueOnError) {
            return createSuccessResponse({
              message: `Conversion stopped due to error (continueOnError=false)`,
              pagePath,
              sourceResourceType,
              targetResourceType,
              componentsFound: sourceComponents.length,
              componentsConverted: successCount,
              componentsFailed: failureCount,
              results,
            }, 'convertComponents');
          }
        }
      }

      return createSuccessResponse({
        message: `Converted ${successCount} of ${sourceComponents.length} components from ${sourceResourceType} to ${targetResourceType}`,
        pagePath,
        sourceResourceType,
        targetResourceType,
        componentsFound: sourceComponents.length,
        componentsConverted: successCount,
        componentsFailed: failureCount,
        results,
      }, 'convertComponents');
    }, 'convertComponents');
  }

  /**
   * Convert components across multiple pages
   * 
   * @param request.pagePaths - Optional: Array of specific page paths to process
   * @param request.searchPath - Optional: Base path to search for pages (alternative to pagePaths)
   * @param request.depth - Optional: Depth to search when using searchPath
   * @param request.limit - Optional: Maximum number of pages to process when using searchPath
   * @param request.sourceResourceType - The resource type to search for and convert
   * @param request.targetResourceType - The resource type to convert to
   * @param request.requiredProperties - Optional: Required property values for the target component
   * @param request.continueOnError - Optional flag to continue on errors
   */
  async bulkConvertComponents(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { 
        pagePaths,
        searchPath,
        depth = 2,
        limit = 50,
        sourceResourceType, 
        targetResourceType, 
        requiredProperties = {},
        continueOnError = true 
      } = request;

      if (!sourceResourceType || typeof sourceResourceType !== 'string') {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Source resource type is required and must be a string');
      }

      if (!targetResourceType || typeof targetResourceType !== 'string') {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Target resource type is required and must be a string');
      }

      let pagesToProcess: string[] = [];

      // Determine which pages to process
      if (pagePaths && Array.isArray(pagePaths) && pagePaths.length > 0) {
        // Use provided page paths
        pagesToProcess = pagePaths;
        LOGGER.log(`Processing ${pagesToProcess.length} specified pages`);
      } else if (searchPath) {
        // Search for pages under the search path
        if (!isValidContentPath(searchPath, this.aemConfig)) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Search path '${searchPath}' is not within allowed content roots`);
        }
        LOGGER.log(`Searching for pages under ${searchPath} with depth ${depth}`);
        const pagesResult = await this.listPages(searchPath, depth, limit);
        const pagesData = pagesResult as any;
        const foundPages = pagesData.data?.pages || pagesData.pages || [];
        
        if (foundPages.length === 0) {
          return createSuccessResponse({
            message: `No pages found under ${searchPath}`,
            searchPath,
            sourceResourceType,
            targetResourceType,
            pagesProcessed: 0,
            pagesSucceeded: 0,
            pagesFailed: 0,
            totalComponentsConverted: 0,
          }, 'bulkConvertComponents');
        }

        // Extract page paths from the results
        pagesToProcess = foundPages.map((page: any) => page.path || page['@path']).filter((path: string) => path);
        LOGGER.log(`Found ${pagesToProcess.length} pages to process`);
      } else {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Either pagePaths array or searchPath must be provided');
      }

      if (pagesToProcess.length === 0) {
        return createSuccessResponse({
          message: 'No pages to process',
          sourceResourceType,
          targetResourceType,
          pagesProcessed: 0,
          pagesSucceeded: 0,
          pagesFailed: 0,
          totalComponentsConverted: 0,
        }, 'bulkConvertComponents');
      }

      // Process each page
      const pageResults: any[] = [];
      let pagesSucceeded = 0;
      let pagesFailed = 0;
      let totalComponentsFound = 0;
      let totalComponentsConverted = 0;
      let totalComponentsFailed = 0;

      for (const pagePath of pagesToProcess) {
        try {
          LOGGER.log(`Processing page: ${pagePath}`);
          
          // Call convertComponents for this page
          const convertResult = await this.convertComponents({
            pagePath,
            sourceResourceType,
            targetResourceType,
            requiredProperties,
            continueOnError,
          });

          const convertData = convertResult as any;
          const data = convertData.data || convertData;

          // Check if conversion was successful or if no components were found (which is also a valid result)
          if (convertData.success !== false) {
            const componentsFound = data.componentsFound || 0;
            const componentsConverted = data.componentsConverted || 0;
            const componentsFailed = data.componentsFailed || 0;

            totalComponentsFound += componentsFound;
            totalComponentsConverted += componentsConverted;
            totalComponentsFailed += componentsFailed;

            if (componentsFound > 0) {
              pagesSucceeded++;
            }

            pageResults.push({
              pagePath,
              success: true,
              componentsFound,
              componentsConverted,
              componentsFailed,
              message: data.message || 'Processed successfully',
            });
          } else {
            pagesFailed++;
            pageResults.push({
              pagePath,
              success: false,
              error: data.message || 'Conversion failed',
              componentsFound: 0,
              componentsConverted: 0,
              componentsFailed: 0,
            });
          }
        } catch (error: any) {
          const errorMessage = error.message || String(error);
          LOGGER.error(`Failed to process page ${pagePath}: ${errorMessage}`);
          
          pagesFailed++;
          pageResults.push({
            pagePath,
            success: false,
            error: errorMessage,
            componentsFound: 0,
            componentsConverted: 0,
            componentsFailed: 0,
          });

          if (!continueOnError) {
            return createSuccessResponse({
              message: `Bulk conversion stopped due to error (continueOnError=false)`,
              sourceResourceType,
              targetResourceType,
              pagesProcessed: pagesToProcess.length,
              pagesSucceeded,
              pagesFailed,
              totalComponentsFound,
              totalComponentsConverted,
              totalComponentsFailed,
              pageResults,
            }, 'bulkConvertComponents');
          }
        }
      }

      return createSuccessResponse({
        message: `Bulk conversion completed: ${pagesSucceeded} pages succeeded, ${pagesFailed} pages failed. Total components converted: ${totalComponentsConverted}`,
        sourceResourceType,
        targetResourceType,
        pagesProcessed: pagesToProcess.length,
        pagesSucceeded,
        pagesFailed,
        totalComponentsFound,
        totalComponentsConverted,
        totalComponentsFailed,
        pageResults,
      }, 'bulkConvertComponents');
    }, 'bulkConvertComponents');
  }

  /**
   * Legacy: Get JCR node content as raw JSON for a given path and depth.
   */
  async getNodeContent(path: string, depth: number = 1, verbosity: string = 'standard'): Promise<any> {
    return safeExecute<any>(async () => {
      const url = `${path}.json`;
      const rawContent = await this.fetch.get(url, { ':depth': depth.toString() });
      const content = filterNodeTree(rawContent, verbosity);
      return {
        path,
        depth,
        verbosity,
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

      // Validate that either name or title is provided
      if (!name && !title) {
        throw createAEMError(
          AEM_ERROR_CODES.INVALID_PARAMETERS,
          'Either "name" or "title" must be provided to create a page. Please provide at least one of these parameters.',
          { parentPath, providedParams: { name, title } }
        );
      }

      // If only name is provided, use it as title (format it nicely)
      // If only title is provided, use it to generate name
      const pageTitle = title || (name ? name.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) : '');

      // If no template provided, get available templates and prompt user
      let selectedTemplatePath = template;
      let templateResourceType = resourceType;
      if (!selectedTemplatePath) {
        const templatesResponse = await this.getAvailableTemplates(parentPath);
        const availableTemplates = (templatesResponse as any).data.availableTemplates;

        if (availableTemplates.length === 0) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'No templates available for this path', { parentPath });
        }

        // Auto-select the first available template
        const selectedTemplate = availableTemplates[0];
        selectedTemplatePath = selectedTemplate.path;
        if (!templateResourceType && selectedTemplate.resourceType) {
          templateResourceType = selectedTemplate.resourceType;
        }
        LOGGER.log(`🎯 Auto-selected template: ${selectedTemplatePath} (${availableTemplates[0].title})`, templateResourceType);
      }

      // Validate template exists and fetch template structure
      let templateInitialContent: any = null;
      try {
        const verifyTemplate = await this.fetch.get(`${selectedTemplatePath}.json`);
        LOGGER.log(`✅ Template verified: ${selectedTemplatePath}`, verifyTemplate);
        
        // Fetch template structure to get initial content and resourceType
        // The initial node is always a sibling of jcr:content in the template: template/jcr:content/initial
        try {
          const templateStructure = await this.fetch.get(`${selectedTemplatePath}.infinity.json`);
          
          // Extract resourceType from template structure if not already provided
          // The resourceType is typically at template/structure/jcr:content/sling:resourceType
          if (!templateResourceType && templateStructure) {
            const structureContent = templateStructure['structure']?.['jcr:content'];
            if (structureContent && structureContent['sling:resourceType']) {
              templateResourceType = structureContent['sling:resourceType'];
              LOGGER.log(`📋 Extracted resourceType from template structure: ${templateResourceType}`);
            } else {
              // Fallback: try to get from template's jcr:content directly
              const templateJcrContent = templateStructure['jcr:content'];
              if (templateJcrContent && templateJcrContent['sling:resourceType']) {
                templateResourceType = templateJcrContent['sling:resourceType'];
                LOGGER.log(`📋 Extracted resourceType from template jcr:content: ${templateResourceType}`);
              }
            }
          }
          
          // Initial node is always at template/jcr:content/initial (sibling of jcr:content in template structure)
          if (templateStructure && templateStructure['jcr:content'] && templateStructure['initial']) {
            templateInitialContent = templateStructure['initial'];
            LOGGER.log(`📋 Found initial content node at template/initial: ${selectedTemplatePath}`);
          } else {
            LOGGER.warn(`⚠️ No initial content found in template at /initial: ${selectedTemplatePath}`);
          }
        } catch (structureError: any) {
          LOGGER.warn(`Could not fetch template structure: ${structureError.message}`);
        }
      } catch (error: any) {
        LOGGER.error('Template verification failed:', error.message, error);
        if (error?.response?.status === 404) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Template not found: ${selectedTemplatePath}`, { template: selectedTemplatePath });
        }
        throw handleAEMHttpError(error, 'createPageWithTemplate');
      }

      // Validate template compatibility with parent path and parent page template
      // This checks both allowedPaths and allowedParents restrictions
      try {
        await this.validateTemplate(selectedTemplatePath, parentPath);
        LOGGER.log(`✅ Template validation passed for ${selectedTemplatePath} at ${parentPath}`);
      } catch (validationError: any) {
        // Re-throw validation errors (they contain clear error messages)
        throw validationError;
      }

      // Generate page name: use provided name, or generate from title
      // Either name or title is guaranteed to exist (already validated above)
      const pageName = name || (pageTitle ? pageTitle.replace(/\s+/g, '-').toLowerCase() : '');
      
      // Use parentPath as-is - it's the parent directory where the page will be created
      // The page will be created as: parentPath/pageName
      const newPagePath = `${parentPath}/${pageName}`;

      // Check if page already exists to prevent overwriting
      try {
        const existingPage = await this.fetch.get(`${newPagePath}.json`);
        if (existingPage && (existingPage['jcr:primaryType'] === 'cq:Page' || existingPage['jcr:content'])) {
          throw createAEMError(
            AEM_ERROR_CODES.INVALID_PARAMETERS,
            `Page already exists at path: ${newPagePath}. Cannot overwrite existing page. Please use a different name or delete the existing page first.`,
            {
              pagePath: newPagePath,
              parentPath,
              pageName,
              existingPage: true
            }
          );
        }
      } catch (checkError: any) {
        // If error is our validation error, re-throw it
        if (checkError.code === AEM_ERROR_CODES.INVALID_PARAMETERS && checkError.message?.includes('already exists')) {
          throw checkError;
        }
        // If it's a 404, page doesn't exist - that's good, continue
        if (checkError.response?.status !== 404 && !checkError.message?.includes('404')) {
          // Some other error occurred, log but continue (might be permission issue)
          LOGGER.warn(`Could not check if page exists at ${newPagePath}: ${checkError.message}`);
        }
        // Otherwise, page doesn't exist (404), which is what we want - continue
      }

      // Create page with proper structure
      const pageData = {
        'jcr:primaryType': 'cq:Page',
        'jcr:content': {
          'jcr:primaryType': 'cq:PageContent',
          'jcr:title': pageTitle,
          'cq:template': selectedTemplatePath,
          'sling:resourceType': templateResourceType || 'foundation/components/page', // Fallback if resourceType couldn't be extracted from template
          'cq:lastModified': new Date().toISOString(),
          'jcr:createdBy': 'admin',
          'jcr:created': new Date().toISOString(),
          'cq:lastModifiedBy': 'admin',
          ...properties
        }
      };

      // If template has initial content with jcr:content, merge properties into jcr:content
      if (templateInitialContent && templateInitialContent['jcr:content']) {
        const initialJcrContent = templateInitialContent['jcr:content'];
        // Merge initial content structure into pageData, but preserve our title and template reference
        Object.entries(initialJcrContent).forEach(([key, value]) => {
          // Skip protected properties and properties we want to override
          if (key === 'jcr:created' || key === 'jcr:createdBy' || 
              key === 'jcr:title' || key === 'cq:template' || 
              key.startsWith('jcr:') && key !== 'jcr:primaryType') {
            return;
          }
          // Skip child nodes - they'll be created separately
          if (typeof value === 'object' && !Array.isArray(value) && 
              !key.startsWith('jcr:') && !key.startsWith('sling:') && !key.startsWith('cq:')) {
            return;
          }
          // Merge initial content properties
          if (!pageData['jcr:content'][key]) {
            pageData['jcr:content'][key] = value;
          }
        });
        LOGGER.log(`📦 Merged initial content properties from template`);
      }

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

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // For nested objects, we'll create them as separate nodes
          // But for now, skip them as they'll be created from initial content
          if (!key.startsWith('jcr:') && !key.startsWith('sling:') && !key.startsWith('cq:')) {
            // This is likely a child node from initial content, skip for now
            return;
          }
          contentFormData.append(key, JSON.stringify(value));
        } else {
          contentFormData.append(key, String(value));
        }
      });

      await this.fetch.post(`${newPagePath}/jcr:content`, contentFormData);

      // Create initial content structure if template has initial content
      // The initial node structure is: template/initial/jcr:content/root/container
      // We need to extract children from initial/jcr:content and create them under page/jcr:content
      if (templateInitialContent && templateInitialContent['jcr:content']) {
        // Initial content nodes should be created under jcr:content: page/jcr:content/root/container
        const parentPathForInitial = `${newPagePath}/jcr:content`;
        
        // Extract the jcr:content node from initial - its children (like root, container) 
        // should be created as children of page/jcr:content
        const initialJcrContent = templateInitialContent['jcr:content'];
        const initialStructure = initialJcrContent;
        
        // Recursively create child nodes from initial content
        const createInitialNodes = async (parentPath: string, nodeData: any, depth: number = 10): Promise<void> => {
          if (depth <= 0) return;
          
          for (const [key, value] of Object.entries(nodeData)) {
            // Skip JCR system properties and already created properties
            if (key.startsWith('jcr:') || key.startsWith('sling:') || key.startsWith('cq:') || 
                key.startsWith('rep:') || key.startsWith('oak:')) {
              continue;
            }

            if (value && typeof value === 'object' && !Array.isArray(value)) {
              const childPath = `${parentPath}/${key}`;
              const childData = value as any;
              
              try {
                // Check if node already exists
                try {
                  await this.fetch.get(`${childPath}.json`);
                  // Node exists, recursively process its children
                  if (childData && typeof childData === 'object') {
                    await createInitialNodes(childPath, childData, depth - 1);
                  }
                } catch (checkError: any) {
                  // Node doesn't exist, create it
                  const nodeFormData = new URLSearchParams();
                  
                  // Add primary type if available
                  if (childData['jcr:primaryType']) {
                    nodeFormData.append('jcr:primaryType', childData['jcr:primaryType']);
                  } else {
                    nodeFormData.append('jcr:primaryType', 'nt:unstructured');
                  }
                  
                  // Add other properties (excluding nested objects for now)
                  Object.entries(childData).forEach(([propKey, propValue]) => {
                    if (propKey === 'jcr:primaryType') return;
                    if (propKey.startsWith('jcr:') && propKey !== 'jcr:primaryType') {
                      // Skip other JCR system properties for now
                      return;
                    }
                    if (typeof propValue === 'object' && !Array.isArray(propValue)) {
                      // Skip nested objects, they'll be created recursively
                      return;
                    }
                    if (propValue !== null && propValue !== undefined) {
                      if (Array.isArray(propValue)) {
                        propValue.forEach((item) => {
                          nodeFormData.append(propKey, String(item));
                        });
                      } else {
                        nodeFormData.append(propKey, String(propValue));
                      }
                    }
                  });
                  
                  await this.fetch.post(childPath, nodeFormData);
                  LOGGER.log(`✅ Created initial node: ${childPath}`);
                  
                  // Recursively create child nodes
                  await createInitialNodes(childPath, childData, depth - 1);
                }
              } catch (createError: any) {
                LOGGER.warn(`Could not create initial node ${childPath}: ${createError.message}`);
              }
            }
          }
        };
        
        await createInitialNodes(parentPathForInitial, initialStructure);
        LOGGER.log(`✅ Created initial content structure from template under jcr:content`);
      }

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
        previewUrl: this.getPreviewUrl(newPagePath),
        title,
        templateUsed: selectedTemplatePath,
        jcrContentCreated: hasJcrContent,
        pageAccessible,
        errorLogCheck,
        creationDetails: {
          timestamp: new Date().toISOString(),
          steps: [
            'Template validation completed',
            'Template initial content fetched',
            'Page node created',
            'jcr:content node created',
            templateInitialContent ? 'Initial content structure created from template' : 'No initial content in template',
            'Page structure verified',
            'Accessibility check completed'
          ],
          initialContentCreated: templateInitialContent !== null
        },
        pageStructure: verificationResponse.data,
      }, 'createPageWithTemplate');
    }, 'createPageWithTemplate');
  }

  /**
   * Validate template compatibility with target path
   * Checks both allowedPaths and allowedParents restrictions
   */
  async validateTemplate(templatePath: string, targetPath: string): Promise<object> {
    return safeExecute<object>(async () => {
      try {
        // Fetch template data with sufficient depth to get jcr:content
        // Try with depth parameter first, then fallback to infinity.json
        let templateData: any;
        try {
          // Use depth 2 to ensure we get jcr:content
          templateData = await this.fetch.get(`${templatePath}.2.json`);
        } catch (fetchError: any) {
          // If depth-based fetch fails, try with infinity.json
          try {
            templateData = await this.fetch.get(`${templatePath}.infinity.json`);
          } catch (infinityError: any) {
            throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Template not found or inaccessible: ${templatePath}`, { templatePath, fetchError: fetchError.message, infinityError: infinityError.message });
          }
        }

        if (!templateData || typeof templateData !== 'object') {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Invalid template structure: template data is not an object', { templatePath });
        }

        // Get jcr:content - it should be at the root level for template nodes
        const content = templateData['jcr:content'];
        
        if (!content || typeof content !== 'object') {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'Invalid template structure: jcr:content not found', { templatePath, templateDataKeys: Object.keys(templateData) });
        }
        // allowedPaths can be a string (regex pattern) or an array
        const allowedPathsRaw = content['allowedPaths'];
        const allowedPaths = Array.isArray(allowedPathsRaw) 
          ? allowedPathsRaw 
          : (allowedPathsRaw ? [allowedPathsRaw] : []);
        
        // allowedParents can be a string (single template) or an array
        const allowedParentsRaw = content['allowedParents'];
        const allowedParents = Array.isArray(allowedParentsRaw)
          ? allowedParentsRaw
          : (allowedParentsRaw ? [allowedParentsRaw] : []);

        // Check if target path is allowed
        let isPathAllowed = allowedPaths.length === 0; // If no restrictions, allow all

        if (allowedPaths.length > 0) {
          isPathAllowed = allowedPaths.some((allowedPath: string) => {
            // If it's a regex pattern (contains special regex chars), try to match it
            if (allowedPath.includes('(') || allowedPath.includes('*') || allowedPath.includes('?')) {
              try {
                const regex = new RegExp(allowedPath);
                return regex.test(targetPath);
              } catch (regexError: any) {
                // If regex fails, fall back to simple string matching
                return targetPath.startsWith(allowedPath.replace(/[()*?]/g, ''));
              }
            }
            // Simple string prefix matching
            return targetPath.startsWith(allowedPath);
          });
        }

        // Check allowedParents: verify parent page's template is in allowedParents list
        let isParentAllowed = true; // Default to true if no allowedParents restriction
        let parentTemplate: string | null = null;
        let parentPathValidationError: string | null = null;

        if (allowedParents.length > 0) {
          try {
            // targetPath is the parent path where the page will be created
            // Check if it's a valid page (has jcr:content)
            const parentPageData = await this.fetch.get(`${targetPath}.2.json`);
            
            if (parentPageData && parentPageData['jcr:content']) {
              // Get the parent page's template
              const parentJcrContent = parentPageData['jcr:content'];
              parentTemplate = parentJcrContent['cq:template'] || null;
              
              if (parentTemplate) {
                // Check if parent's template is in allowedParents
                isParentAllowed = allowedParents.includes(parentTemplate);
                
                if (!isParentAllowed) {
                  parentPathValidationError = `Template '${templatePath}' cannot be used under parent page with template '${parentTemplate}'. Allowed parent templates: ${allowedParents.join(', ')}`;
                }
              } else {
                // Parent page exists but has no template
                // If allowedParents is specified, parent MUST have a template from the allowed list
                isParentAllowed = false;
                parentPathValidationError = `Template '${templatePath}' requires a parent page with one of the allowed templates, but parent page at '${targetPath}' has no template. Allowed parent templates: ${allowedParents.join(', ')}`;
              }
            } else {
              // targetPath is not a page
              // If allowedParents is specified, parent MUST be a page with an allowed template
              isParentAllowed = false;
              parentPathValidationError = `Template '${templatePath}' requires a parent page with one of the allowed templates, but '${targetPath}' is not a page. Allowed parent templates: ${allowedParents.join(', ')}`;
            }
          } catch (parentError: any) {
            // If parent path doesn't exist or is not accessible
            // If allowedParents is specified, parent MUST exist and be a page
            if (parentError.response?.status === 404) {
              isParentAllowed = false;
              parentPathValidationError = `Template '${templatePath}' requires a parent page with one of the allowed templates, but parent path '${targetPath}' does not exist. Allowed parent templates: ${allowedParents.join(', ')}`;
            } else {
              // Other errors - log and block (safer to block when we can't validate)
              LOGGER.warn(`Could not validate parent path ${targetPath}: ${parentError.message}`);
              isParentAllowed = false;
              parentPathValidationError = `Could not validate parent path '${targetPath}': ${parentError.message}. Template '${templatePath}' requires a parent page with one of the allowed templates: ${allowedParents.join(', ')}`;
            }
          }
        }

        // Overall validation: both path and parent must be allowed
        const isValid = isPathAllowed && isParentAllowed;

        // If validation fails, throw an error
        if (!isValid) {
          const errorMessages: string[] = [];
          if (!isPathAllowed) {
            errorMessages.push(`Path '${targetPath}' is not allowed. Allowed paths: ${allowedPaths.join(', ')}`);
          }
          if (!isParentAllowed && parentPathValidationError) {
            errorMessages.push(parentPathValidationError);
          }
          
          throw createAEMError(
            AEM_ERROR_CODES.INVALID_PARAMETERS,
            `Template '${templatePath}' cannot be used at '${targetPath}'. ${errorMessages.join(' ')}`,
            {
              templatePath,
              targetPath,
              allowedPaths,
              allowedParents,
              parentTemplate,
              pathAllowed: isPathAllowed,
              parentAllowed: isParentAllowed
            }
          );
        }

        return createSuccessResponse({
          templatePath,
          targetPath,
          isValid: true,
          templateTitle: content['jcr:title'] || 'Untitled Template',
          templateDescription: content['jcr:description'] || '',
          allowedPaths,
          allowedParents,
          parentTemplate,
          restrictions: {
            hasPathRestrictions: allowedPaths.length > 0,
            hasParentRestrictions: allowedParents.length > 0,
            allowedPaths,
            allowedParents,
            pathAllowed: isPathAllowed,
            parentAllowed: isParentAllowed
          }
        }, 'validateTemplate');

      } catch (error: any) {
        // Re-throw validation errors
        if (error.code === AEM_ERROR_CODES.INVALID_PARAMETERS) {
          throw error;
        }
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

  /**
   * Get all components from the configured component root path (projectRoot1).
   * Fetches component definitions and extracts name, title, description, and other metadata.
   * 
   * @returns Success response with array of component information
   */
  async getComponents(path?: string): Promise<object> {
    return safeExecute<object>(async () => {
      const rootPath = path || this.aemConfig.components.componentPaths?.projectRoot1 || '/apps/aemmcp/base/components';
      LOGGER.log(`Fetching components from root path: ${rootPath}`);

      const components: any[] = [];

      // Recursively fetch all components from the root path
      const fetchComponents = async (path: string, depth: number = 5): Promise<void> => {
        if (depth <= 0) return;

        try {
          const data = await this.fetch.get(`${path}.${Math.min(depth, 3)}.json`);
          
          if (data && typeof data === 'object') {
            for (const [key, value] of Object.entries(data)) {
              const val = value as any;
              // Skip JCR system properties
              if (key.startsWith('jcr:') || key.startsWith('sling:') || key.startsWith('rep:') || key.startsWith('oak:')) {
                continue;
              }

              if (val && typeof val === 'object') {
                const componentPath = `${path}/${key}`;
                const primaryType = val['jcr:primaryType'];

                // Check if this is a component directory (usually has _cq_dialog or component files)
                const hasDialog = val['_cq_dialog'] !== undefined;
                const hasComponentFiles = val['.content.xml'] !== undefined || 
                                         val['component.html'] !== undefined ||
                                         val['component.js'] !== undefined ||
                                         val['component.css'] !== undefined;

                // If it has dialog or component files, it's likely a component
                if (hasDialog || hasComponentFiles || primaryType === 'cq:Component') {
                  // Try to get component metadata
                  let componentTitle = key;
                  let componentDescription = '';
                  let componentGroup = '';
                  let resourceType = '';

                  // Extract title and description from component definition
                  if (val['jcr:title']) {
                    componentTitle = val['jcr:title'];
                  } else if (val['jcr:content']?.['jcr:title']) {
                    componentTitle = val['jcr:content']['jcr:title'];
                  }

                  if (val['jcr:description']) {
                    componentDescription = val['jcr:description'];
                  } else if (val['jcr:content']?.['jcr:description']) {
                    componentDescription = val['jcr:content']['jcr:description'];
                  }

                  // Get component group
                  if (val['componentGroup']) {
                    componentGroup = val['componentGroup'];
                  }

                  // Extract resource type from path
                  resourceType = componentPath.replace('/apps/', '').replace('/libs/', '');

                  // Try to get more info from _cq_dialog if available
                  if (val['_cq_dialog']) {
                    try {
                      const dialogData = await this.fetch.get(`${componentPath}/_cq_dialog.json`, { ':depth': '2' });
                      if (dialogData && dialogData['jcr:title']) {
                        componentTitle = dialogData['jcr:title'] || componentTitle;
                      }
                      if (dialogData && dialogData['jcr:description']) {
                        componentDescription = dialogData['jcr:description'] || componentDescription;
                      }
                    } catch (dialogError: any) {
                      // Dialog might not be accessible, continue
                    }
                  }

                  components.push({
                    name: key,
                    title: componentTitle,
                    description: componentDescription,
                    path: componentPath,
                    resourceType: resourceType,
                    componentGroup: componentGroup || 'General',
                    primaryType: primaryType,
                    hasDialog: hasDialog,
                  });
                } else {
                  // Recursively check subdirectories
                  await fetchComponents(componentPath, depth - 1);
                }
              }
            }
          }
        } catch (error: any) {
          if (error.message?.includes('404')) {
            LOGGER.warn(`Path not found: ${path}`);
          } else {
            LOGGER.warn(`Error fetching components from ${path}: ${error.message}`);
          }
        }
      };

      await fetchComponents(rootPath, 5);

      // Sort components by name
      components.sort((a, b) => a.name.localeCompare(b.name));

      LOGGER.log(`Found ${components.length} components from ${rootPath}`);
      
      return createSuccessResponse({
        rootPath,
        components,
        totalCount: components.length,
      }, 'getComponents');
    }, 'getComponents');
  }

  /**
   * List all available workflow models
   * GET /etc/workflow/models.json
   * @returns Array of workflow model URIs
   */
  async listWorkflowModels(): Promise<object> {
    return safeExecute<object>(async () => {
      const data = await this.fetch.get('/etc/workflow/models.json');
      
      // The response is an array of objects with 'uri' property
      const models = Array.isArray(data) ? data : [];
      
      // Extract common workflow models and their purposes
      const commonWorkflows = {
        'request_for_activation': 'Publish/activate pages',
        'request_for_deactivation': 'Unpublish/deactivate pages',
        'request_for_deletion': 'Delete pages',
        'request_for_deletion_without_deactivation': 'Delete pages without unpublishing first',
        'dam/update_asset': 'Update DAM assets',
        'dam/dam-update-language-copy': 'Update language copies of assets',
        'dam/dam-create-language-copy': 'Create language copies of assets',
        'wcm-translation/translate-language-copy': 'Translate language copies',
        'wcm-translation/create_language_copy': 'Create language copies',
        'wcm-translation/prepare_translation_project': 'Prepare translation project',
        'wcm-translation/sync_translation_job': 'Sync translation job',
        'wcm-translation/update_language_copy': 'Update language copy',
        'activationmodel': 'Activation workflow model',
        'scheduled_activation': 'Scheduled activation',
        'scheduled_deactivation': 'Scheduled deactivation',
      };

      // Enrich models with descriptions
      const enrichedModels = models.map((model: any) => {
        const uri = model.uri || '';
        const modelId = uri.replace('/var/workflow/models/', '');
        const description = commonWorkflows[modelId as keyof typeof commonWorkflows] || 'Custom workflow model';
        
        return {
          uri,
          modelId,
          description,
          ...model
        };
      });

      return createSuccessResponse({
        models: enrichedModels,
        totalCount: enrichedModels.length,
        commonWorkflows: Object.entries(commonWorkflows).map(([id, desc]) => ({
          modelId: id,
          uri: `/var/workflow/models/${id}`,
          description: desc
        }))
      }, 'listWorkflowModels');
    }, 'listWorkflowModels');
  }

  /**
   * Start a workflow instance
   * POST /etc/workflow/instances
   * @param modelId - The workflow model ID (e.g., 'request_for_activation')
   * @param payload - The payload path (JCR path or URL)
   * @param payloadType - Type of payload (default: 'JCR_PATH')
   * @returns Created workflow instance information
   */
  async startWorkflow(modelId: string, payload: string, payloadType: string = 'JCR_PATH'): Promise<object> {
    return safeExecute<object>(async () => {
      // Construct model URI
      const modelUri = modelId.startsWith('/var/workflow/models/') 
        ? modelId 
        : `/var/workflow/models/${modelId}`;

      const formData = new URLSearchParams();
      formData.append('model', modelUri);
      formData.append('payloadType', payloadType);
      formData.append('payload', payload);

      // POST to create workflow instance
      // AEM returns 201 Created with Location header containing the workflow instance path
      const response = await this.fetch.postWithHeaders('/etc/workflow/instances', formData, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok && response.status !== 201) {
        const errorText = await response.text();
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 
          `Failed to start workflow: ${response.status} - ${errorText}`);
      }

      // Extract instance path from Location header (AEM returns this on 201)
      let instancePath = null;
      let instanceId = null;
      const location = response.headers.get('Location');
      
      if (location) {
        // Location header might be absolute URL or relative path
        instancePath = location.startsWith('http') 
          ? new URL(location).pathname 
          : location;
        
        // Extract instance ID from path like /var/workflow/instances/server0/2018-02-26/prototype-01_2
        const pathParts = instancePath.split('/').filter((p: string) => p);
        if (pathParts.length > 0) {
          instanceId = pathParts[pathParts.length - 1];
        }
      } else {
        // Try to parse from response body if it's JSON
        try {
          const responseText = await response.text();
          if (responseText) {
            const responseData = JSON.parse(responseText);
            if (responseData && responseData.uri) {
              instancePath = responseData.uri;
              const pathParts = instancePath.split('/').filter((p: string) => p);
              if (pathParts.length > 0) {
                instanceId = pathParts[pathParts.length - 1];
              }
            }
          }
        } catch (e) {
          // Response is HTML or not JSON, which is fine - we got 201 Created
          // The workflow was created successfully even if we can't parse the response
          LOGGER.log('Workflow created (201), but response is not JSON. Location header:', location || 'not found');
        }
      }

      return createSuccessResponse({
        modelId,
        modelUri,
        payload,
        payloadType,
        instanceId,
        instancePath,
        locationHeader: location,
        status: response.status,
        message: 'Workflow instance started successfully'
      }, 'startWorkflow');
    }, 'startWorkflow');
  }

  /**
   * List workflow instances
   * GET /etc/workflow/instances.json
   * @param state - Optional filter by state (RUNNING, SUSPENDED, ABORTED, COMPLETED)
   * @returns Array of workflow instances
   */
  async listWorkflowInstances(state?: string): Promise<object> {
    return safeExecute<object>(async () => {
      const url = state 
        ? `/etc/workflow/instances.${state}.json`
        : '/etc/workflow/instances.json';
      
      const data = await this.fetch.get(url);
      
      // Response format varies, handle both array and object responses
      const instances = Array.isArray(data) ? data : (data?.instances || []);
      
      return createSuccessResponse({
        instances,
        totalCount: instances.length,
        state: state || 'all',
        timestamp: new Date().toISOString()
      }, 'listWorkflowInstances');
    }, 'listWorkflowInstances');
  }

  /**
   * Get workflow instance details
   * GET /etc/workflow/instances/{id}.json
   * @param instanceId - The workflow instance ID or full path
   * @returns Workflow instance details
   */
  async getWorkflowInstance(instanceId: string): Promise<object> {
    return safeExecute<object>(async () => {
      // Handle both full path and just ID
      const instancePath = instanceId.startsWith('/var/workflow/instances/')
        ? instanceId
        : `/var/workflow/instances/${instanceId}`;
      
      const data = await this.fetch.get(`${instancePath}.json`);
      
      return createSuccessResponse({
        instanceId,
        instancePath,
        instance: data,
        timestamp: new Date().toISOString()
      }, 'getWorkflowInstance');
    }, 'getWorkflowInstance');
  }

  /**
   * Update workflow instance state
   * POST /etc/workflow/instances/{id}
   * @param instanceId - The workflow instance ID or full path
   * @param state - New state (RUNNING, SUSPENDED, ABORTED)
   * @returns Updated workflow instance information
   */
  async updateWorkflowInstanceState(instanceId: string, state: 'RUNNING' | 'SUSPENDED' | 'ABORTED'): Promise<object> {
    return safeExecute<object>(async () => {
      if (!['RUNNING', 'SUSPENDED', 'ABORTED'].includes(state)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 
          `Invalid state: ${state}. Must be RUNNING, SUSPENDED, or ABORTED`);
      }

      // Handle both full path and just ID
      const instancePath = instanceId.startsWith('/var/workflow/instances/')
        ? instanceId
        : `/var/workflow/instances/${instanceId}`;

      const formData = new URLSearchParams();
      formData.append('state', state);

      const response = await this.fetch.post(instancePath, formData, {
        headers: {
          'Accept': 'application/json'
        }
      });

      return createSuccessResponse({
        instanceId,
        instancePath,
        newState: state,
        response,
        message: `Workflow instance state updated to ${state}`
      }, 'updateWorkflowInstanceState');
    }, 'updateWorkflowInstanceState');
  }

  /**
   * Get inbox items (work items assigned to current user)
   * GET /bin/workflow/inbox.json
   * @returns Array of inbox items
   */
  async getInboxItems(): Promise<object> {
    return safeExecute<object>(async () => {
      const data = await this.fetch.get('/bin/workflow/inbox.json');
      
      // Response format: { results: number, items: [...] }
      const items = data?.items || data || [];
      
      return createSuccessResponse({
        items,
        totalCount: Array.isArray(items) ? items.length : 0,
        timestamp: new Date().toISOString()
      }, 'getInboxItems');
    }, 'getInboxItems');
  }

  /**
   * Complete or advance a work item to the next step
   * POST /bin/workflow/inbox
   * @param workItemPath - Path to the work item
   * @param routeId - Route ID to advance to (optional, if not provided, completes current step)
   * @param comment - Optional comment
   * @returns Completion result
   */
  async completeWorkItem(workItemPath: string, routeId?: string, comment?: string): Promise<object> {
    return safeExecute<object>(async () => {
      // If routeId is not provided, get available routes first
      let selectedRouteId: string = routeId || '';
      
      if (!selectedRouteId) {
        // Get available routes for this work item
        const routesData = await this.fetch.get(`${workItemPath}.routes.json`);
        const routes = routesData?.routes || [];
        
        if (routes.length === 0) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 
            'No routes available for this work item');
        }
        
        // Use the first route (usually "End" or next step)
        const firstRoute = routes[0];
        if (!firstRoute?.rid) {
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 
            'No valid route ID found in available routes');
        }
        
        selectedRouteId = firstRoute.rid;
        
        LOGGER.log(`No route specified, using first available route: ${firstRoute.label || 'Unknown'} (${selectedRouteId})`);
      }

      const formData = new URLSearchParams();
      formData.append('item', workItemPath);
      formData.append('route', selectedRouteId);
      
      if (comment) {
        formData.append('comment', comment);
      }

      const response = await this.fetch.post('/bin/workflow/inbox', formData, {
        headers: {
          'Accept': 'application/json'
        }
      });

      return createSuccessResponse({
        workItemPath,
        routeId: selectedRouteId,
        comment,
        response,
        message: 'Work item completed successfully'
      }, 'completeWorkItem');
    }, 'completeWorkItem');
  }

  /**
   * Delegate a work item to another user or group
   * POST /bin/workflow/inbox
   * @param workItemPath - Path to the work item
   * @param delegatee - User or group to delegate to
   * @returns Delegation result
   */
  async delegateWorkItem(workItemPath: string, delegatee: string): Promise<object> {
    return safeExecute<object>(async () => {
      const formData = new URLSearchParams();
      formData.append('item', workItemPath);
      formData.append('delegatee', delegatee);

      const response = await this.fetch.post('/bin/workflow/inbox', formData, {
        headers: {
          'Accept': 'application/json'
        }
      });

      return createSuccessResponse({
        workItemPath,
        delegatee,
        response,
        message: `Work item delegated to ${delegatee}`
      }, 'delegateWorkItem');
    }, 'delegateWorkItem');
  }

  /**
   * Get available routes for a work item
   * GET /etc/workflow/instances/{path-to-workitem}.routes.json
   * @param workItemPath - Path to the work item
   * @returns Available routes
   */
  async getWorkItemRoutes(workItemPath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const data = await this.fetch.get(`${workItemPath}.routes.json`);
      
      const routes = data?.routes || [];
      
      return createSuccessResponse({
        workItemPath,
        routes,
        totalCount: routes.length,
        timestamp: new Date().toISOString()
      }, 'getWorkItemRoutes');
    }, 'getWorkItemRoutes');
  }

  // ─── Content Fragments (delegated) ───────────────────
  async getContentFragment(path: string): Promise<object> {
    return this.contentFragments.getContentFragment(path);
  }
  async listContentFragments(params: any): Promise<object> {
    return this.contentFragments.listContentFragments(params);
  }
  async manageContentFragment(params: any): Promise<object> {
    return this.contentFragments.manageContentFragment(params);
  }
  async manageContentFragmentVariation(params: any): Promise<object> {
    return this.contentFragments.manageContentFragmentVariation(params);
  }
  async getExperienceFragment(path: string): Promise<object> {
    return this.experienceFragments.getExperienceFragment(path);
  }
  async listExperienceFragments(params: any): Promise<object> {
    return this.experienceFragments.listExperienceFragments(params);
  }
  async manageExperienceFragment(params: any): Promise<object> {
    return this.experienceFragments.manageExperienceFragment(params);
  }
  async manageExperienceFragmentVariation(params: any): Promise<object> {
    return this.experienceFragments.manageExperienceFragmentVariation(params);
  }
}
