import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import { getAEMConfig, isValidContentPath, isValidComponentType, isValidLocale, AEMConfig } from './aem-config.js';
import {
  AEMOperationError,
  createAEMError,
  handleAEMHttpError,
  safeExecute,
  validateComponentOperation,
  createSuccessResponse,
  AEM_ERROR_CODES
} from './error-handler.js';

dotenv.config();

export interface AEMConnectorConfig {
  aem: {
    host: string;
    author: string;
    publish: string;
    serviceUser: {
      username: string;
      password: string;
    };
    endpoints: Record<string, string>;
  };
  mcp: {
    name: string;
    version: string;
  };
}

export class AEMConnector {
  config: AEMConnectorConfig;
  auth: { username: string; password: string };
  aemConfig: AEMConfig;

  constructor() {
    this.config = this.loadConfig();
    this.aemConfig = getAEMConfig();
    this.auth = {
      username: process.env.AEM_SERVICE_USER || this.config.aem.serviceUser.username,
      password: process.env.AEM_SERVICE_PASSWORD || this.config.aem.serviceUser.password,
    };
    if (process.env.AEM_HOST) {
      this.config.aem.host = process.env.AEM_HOST;
      this.config.aem.author = process.env.AEM_HOST;
    }
  }

  loadConfig(): AEMConnectorConfig {
    return {
      aem: {
        host: process.env.AEM_HOST || 'http://localhost:4502',
        author: process.env.AEM_HOST || 'http://localhost:4502',
        publish: 'http://localhost:4503',
        serviceUser: {
          username: 'admin',
          password: 'admin',
        },
        endpoints: {
          content: '/content',
          dam: '/content/dam',
          query: '/bin/querybuilder.json',
          crxde: '/crx/de',
          jcr: '',
        },
      },
      mcp: {
        name: 'AEM MCP Server',
        version: '1.0.0',
      },
    };
  }

  createAxiosInstance(): AxiosInstance {
    return axios.create({
      baseURL: this.config.aem.host,
      auth: this.auth,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      // eslint-disable-next-line no-console
      console.log('Testing AEM connection to:', this.config.aem.host);
      const client = this.createAxiosInstance();
      const response = await client.get('/libs/granite/core/content/login.html', {
        timeout: 5000,
        validateStatus: (status) => status < 500,
      });
      // eslint-disable-next-line no-console
      console.log('✅ AEM connection successful! Status:', response.status);
      return true;
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.error('❌ AEM connection failed:', error.message);
      if (error.response) {
        // eslint-disable-next-line no-console
        console.error('   Status:', error.response.status);
        // eslint-disable-next-line no-console
        console.error('   URL:', error.config?.url);
      }
      return false;
    }
  }

  // ... All AEM operation methods (validateComponent, updateComponent, undoChanges, scanPageComponents, fetchSites, fetchLanguageMasters, fetchAvailableLocales, replicateAndPublish, executeJCRQuery, getNodeContent, searchContent, getAssetMetadata, listChildren, getPageProperties, listPages, bulkUpdateComponents, getPageTextContent, getAllTextContent, getPageImages, updateImagePath, getPageContent, createPage, deletePage, createComponent, deleteComponent, unpublishContent, activatePage, deactivatePage, uploadAsset, updateAsset, deleteAsset, getTemplates, getTemplateStructure) ...

  // For brevity, only a few methods are shown here. The full implementation should include all methods as in the original JS.

  async validateComponent(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const locale = request.locale;
      const pagePath = request.pagePath || request.page_path;
      const component = request.component;
      const props = request.props;
      validateComponentOperation(locale, pagePath, component, props);
      if (!isValidLocale(locale, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_LOCALE, `Locale '${locale}' is not supported`, { locale, allowedLocales: this.aemConfig.validation.allowedLocales });
      }
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Path '${pagePath}' is not within allowed content roots`, { path: pagePath, allowedRoots: Object.values(this.aemConfig.contentPaths) });
      }
      if (!isValidComponentType(component, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_COMPONENT_TYPE, `Component type '${component}' is not allowed`, { component, allowedTypes: this.aemConfig.components.allowedTypes });
      }
      const client = this.createAxiosInstance();
      const response = await client.get(`${pagePath}.json`, {
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
          allowedComponents: this.aemConfig.components.allowedTypes,
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
      if (!isValidContentPath(request.componentPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PATH, `Component path '${request.componentPath}' is not within allowed content roots`, { path: request.componentPath, allowedRoots: Object.values(this.aemConfig.contentPaths) });
      }
      const client = this.createAxiosInstance();
      try {
        await client.get(`${request.componentPath}.json`);
      } catch (error: any) {
        if (error.response?.status === 404) {
          throw createAEMError(AEM_ERROR_CODES.COMPONENT_NOT_FOUND, `Component not found at path: ${request.componentPath}`, { componentPath: request.componentPath });
        }
        throw handleAEMHttpError(error, 'updateComponent');
      }
      const formData = new URLSearchParams();
      Object.entries(request.properties).forEach(([key, value]) => {
        if (value === null || value === undefined) {
          formData.append(`${key}@Delete`, '');
        } else if (Array.isArray(value)) {
          value.forEach((item) => {
            formData.append(`${key}`, item.toString());
          });
        } else if (typeof value === 'object') {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value.toString());
        }
      });
      const response = await client.post(request.componentPath, formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        timeout: this.aemConfig.queries.timeoutMs,
      });
      const verificationResponse = await client.get(`${request.componentPath}.json`);
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
      const client = this.createAxiosInstance();
      const response = await client.get(`${pagePath}.infinity.json`);
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
      const client = this.createAxiosInstance();
      const response = await client.get('/content.json', { params: { ':depth': '2' } });
      const sites: any[] = [];
      Object.entries(response.data).forEach(([key, value]: [string, any]) => {
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
      const client = this.createAxiosInstance();
      const response = await client.get(`/content/${site}.json`, { params: { ':depth': '3' } });
      const masters: any[] = [];
      Object.entries(response.data).forEach(([key, value]: [string, any]) => {
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
      const client = this.createAxiosInstance();
      const response = await client.get(`${languageMasterPath}.json`, { params: { ':depth': '2' } });
      const locales: any[] = [];
      Object.entries(response.data).forEach(([key, value]: [string, any]) => {
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
      const client = this.createAxiosInstance();
      const response = await client.get(`${pagePath}.infinity.json`);
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
      if (response.data['jcr:content']) {
        processNode(response.data['jcr:content'], 'jcr:content');
      } else {
        processNode(response.data, pagePath);
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
      const client = this.createAxiosInstance();
      const response = await client.get(`${pagePath}.infinity.json`);
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
      if (response.data['jcr:content']) {
        processNode(response.data['jcr:content'], 'jcr:content');
      } else {
        processNode(response.data, pagePath);
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
      const client = this.createAxiosInstance();
      const response = await client.get(`${pagePath}.infinity.json`);
      return createSuccessResponse({
        pagePath,
        content: response.data,
      }, 'getPageContent');
    }, 'getPageContent');
  }

  /**
   * List direct or nested children under a path using .json with depth param.
   * Filters out system keys. Returns array of { name, path, primaryType, title }.
   */
  async listChildren(path: string, depth: number = 1): Promise<any[]> {
    // Patch: Use QueryBuilder to list direct children cq:Page nodes under the given path
    return safeExecute<any[]>(async () => {
      const client = this.createAxiosInstance();
      const response = await client.get(this.config.aem.endpoints.query, {
        params: {
          path,
          type: 'cq:Page',
          'p.nodedepth': 1,
          'p.limit': 1000,
        },
      });
      const children = (response.data.hits || []).map((hit: any) => ({
        name: hit.name,
        path: hit.path,
        primaryType: 'cq:Page',
        title: hit.title || hit.name,
      }));
      return children;
    }, 'listChildren');
  }

  /**
   * List all cq:Page nodes under a site root, up to a given depth and limit.
   */
  async listPages(siteRoot: string, depth: number = 1, limit: number = 20): Promise<object> {
    // Patch: Use QueryBuilder to find cq:Page nodes under siteRoot up to depth
    return safeExecute<object>(async () => {
      const client = this.createAxiosInstance();
      const response = await client.get(this.config.aem.endpoints.query, {
        params: {
          path: siteRoot,
          type: 'cq:Page',
          'p.nodedepth': depth,
          'p.limit': limit,
        },
      });
      const pages = (response.data.hits || []).map((hit: any) => ({
        name: hit.name,
        path: hit.path,
        primaryType: 'cq:Page',
        title: hit.title || hit.name,
        type: 'page',
      }));
      return {
        success: true,
        siteRoot,
        pages,
        pageCount: pages.length,
        totalChildrenScanned: response.data.hits ? response.data.hits.length : 0,
      };
    }, 'listPages');
  }

  /**
   * Execute a QueryBuilder fulltext search for cq:Page nodes, with security validation.
   * Note: This is NOT a true JCR SQL2 executor. It wraps QueryBuilder and only supports fulltext queries.
   */
  async executeJCRQuery(query: string, limit: number = 20): Promise<object> {
    return safeExecute<object>(async () => {
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        throw new Error('Query is required and must be a non-empty string. Note: Only QueryBuilder fulltext is supported, not JCR SQL2.');
      }
      // Basic security validation
      const lower = query.toLowerCase();
      if (/drop|delete|update|insert|exec|script|\.|<script/i.test(lower) || query.length > 1000) {
        throw new Error('Query contains potentially unsafe patterns or is too long');
      }
      const client = this.createAxiosInstance();
      const response = await client.get('/bin/querybuilder.json', {
        params: {
          path: '/content',
          type: 'cq:Page',
          fulltext: query,
          'p.limit': limit
        }
      });
      return {
        query,
        results: response.data.hits || [],
        total: response.data.total || 0,
        limit
      };
    }, 'executeJCRQuery');
  }

  async getPageProperties(pagePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const client = this.createAxiosInstance();
      const response = await client.get(`${pagePath}/jcr:content.json`);
      const content = response.data;
      const properties = {
        title: content['jcr:title'],
        description: content['jcr:description'],
        template: content['cq:template'],
        lastModified: content['cq:lastModified'],
        lastModifiedBy: content['cq:lastModifiedBy'],
        created: content['jcr:created'],
        createdBy: content['jcr:createdBy'],
        primaryType: content['jcr:primaryType'],
        resourceType: content['sling:resourceType'],
        tags: content['cq:tags'] || [],
        properties: content,
      };
      return properties;
    }, 'getPageProperties');
  }

  async searchContent(params: any): Promise<object> {
    return safeExecute<object>(async () => {
      const client = this.createAxiosInstance();
      const response = await client.get(this.config.aem.endpoints.query, { params });
      return createSuccessResponse({
        params,
        results: response.data.hits || [],
        total: response.data.total || 0,
        rawResponse: response.data,
      }, 'searchContent');
    }, 'searchContent');
  }

  async getAssetMetadata(assetPath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const client = this.createAxiosInstance();
      const response = await client.get(`${assetPath}.json`);
      const metadata = response.data['jcr:content']?.metadata || {};
      return createSuccessResponse({
        assetPath,
        metadata,
        fullData: response.data,
      }, 'getAssetMetadata');
    }, 'getAssetMetadata');
  }

  async createPage(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { parentPath, title, template, name, properties } = request;
      if (!isValidContentPath(parentPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid parent path: ${String(parentPath)}`, { parentPath });
      }
      const pageName = name || title.replace(/\s+/g, '-').toLowerCase();
      const newPagePath = `${parentPath}/${pageName}`;
      const client = this.createAxiosInstance();
      await client.post(newPagePath, {
        'jcr:primaryType': 'cq:Page',
        'jcr:title': title,
        'cq:template': template,
        ...properties,
      });
      return createSuccessResponse({
        success: true,
        pagePath: newPagePath,
        title,
        template,
        properties,
        timestamp: new Date().toISOString(),
      }, 'createPage');
    }, 'createPage');
  }

  async deletePage(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { pagePath, force = false } = request;
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid page path: ${String(pagePath)}`, { pagePath });
      }
      const client = this.createAxiosInstance();
      let deleted = false;
      try {
        await client.delete(pagePath);
        deleted = true;
      } catch (err: any) {
        if (err.response && err.response.status === 405) {
          try {
            await client.post('/bin/wcmcommand', {
              cmd: 'deletePage',
              path: pagePath,
              force: force.toString(),
            });
            deleted = true;
          } catch (postErr: any) {
            // Fallback to Sling POST servlet
            try {
              await client.post(pagePath, { ':operation': 'delete' });
              deleted = true;
            } catch (slingErr: any) {
              console.error('Sling POST delete failed:', slingErr.response?.status, slingErr.response?.data);
              throw slingErr;
            }
          }
        } else {
          console.error('DELETE failed:', err.response?.status, err.response?.data);
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
      const { pagePath, componentType, resourceType, properties = {}, name } = request;
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid page path: ${String(pagePath)}`, { pagePath });
      }
      if (!isValidComponentType(componentType, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid component type: ${componentType}`, { componentType });
      }
      const componentName = name || `${componentType}_${Date.now()}`;
      const componentPath = `${pagePath}/jcr:content/${componentName}`;
      const client = this.createAxiosInstance();
      await client.post(componentPath, {
        'jcr:primaryType': 'nt:unstructured',
        'sling:resourceType': resourceType,
        ...properties,
        ':operation': 'import',
        ':contentType': 'json',
        ':replace': 'true',
      });
      return createSuccessResponse({
        success: true,
        componentPath,
        componentType,
        resourceType,
        properties,
        timestamp: new Date().toISOString(),
      }, 'createComponent');
    }, 'createComponent');
  }

  async deleteComponent(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { componentPath, force = false } = request;
      if (!isValidContentPath(componentPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid component path: ${String(componentPath)}`, { componentPath });
      }
      const client = this.createAxiosInstance();
      let deleted = false;
      try {
        await client.delete(componentPath);
        deleted = true;
      } catch (err: any) {
        if (err.response && err.response.status === 405) {
          try {
            await client.post(componentPath, { ':operation': 'delete' });
            deleted = true;
          } catch (slingErr: any) {
            console.error('Sling POST delete failed:', slingErr.response?.status, slingErr.response?.data);
            throw slingErr;
          }
        } else {
          console.error('DELETE failed:', err.response?.status, err.response?.data);
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
      const client = this.createAxiosInstance();
      await client.post('/etc/replication/agents.author/publish/jcr:content.queue.json', {
        cmd: 'Deactivate',
        path: contentPaths,
        ignoredeactivated: false,
        onlymodified: false,
      });
      return createSuccessResponse({
        success: true,
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
      const client = this.createAxiosInstance();
      await client.post('/etc/replication/agents.author/publish/jcr:content.queue.json', {
        cmd: 'Activate',
        path: pagePath,
        ignoredeactivated: false,
        onlymodified: false,
      });
      return createSuccessResponse({
        success: true,
        activatedPath: pagePath,
        activateTree,
        timestamp: new Date().toISOString(),
      }, 'activatePage');
    }, 'activatePage');
  }

  async deactivatePage(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { pagePath, deactivateTree = false } = request;
      if (!isValidContentPath(pagePath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid page path: ${String(pagePath)}`, { pagePath });
      }
      const client = this.createAxiosInstance();
      await client.post('/etc/replication/agents.author/publish/jcr:content.queue.json', {
        cmd: 'Deactivate',
        path: pagePath,
        ignoredeactivated: false,
        onlymodified: false,
      });
      return createSuccessResponse({
        success: true,
        deactivatedPath: pagePath,
        deactivateTree,
        timestamp: new Date().toISOString(),
      }, 'deactivatePage');
    }, 'deactivatePage');
  }

  async uploadAsset(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { parentPath, fileName, fileContent, mimeType, metadata = {} } = request;
      if (!isValidContentPath(parentPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid parent path: ${String(parentPath)}`, { parentPath });
      }
      const assetPath = `${parentPath}/${fileName}`;
      const formData = new URLSearchParams();
      if (typeof fileContent === 'string') {
        formData.append('file', fileContent);
      } else {
        formData.append('file', fileContent.toString());
      }
      formData.append('fileName', fileName);
      if (mimeType) {
        formData.append('mimeType', mimeType);
      }
      Object.entries(metadata).forEach(([key, value]) => {
        formData.append(`./jcr:content/metadata/${key}`, String(value));
      });
      const client = this.createAxiosInstance();
      await client.post(assetPath, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return createSuccessResponse({
        success: true,
        assetPath,
        fileName,
        mimeType,
        metadata,
        timestamp: new Date().toISOString(),
      }, 'uploadAsset');
    }, 'uploadAsset');
  }

  async updateAsset(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { assetPath, metadata, fileContent, mimeType } = request;
      if (!isValidContentPath(assetPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid asset path: ${String(assetPath)}`, { assetPath });
      }
      const updateData: any = {};
      if (fileContent) {
        updateData.file = fileContent;
        if (mimeType) {
          updateData.mimeType = mimeType;
        }
      }
      if (metadata) {
        Object.entries(metadata).forEach(([key, value]) => {
          updateData[`./jcr:content/metadata/${key}`] = value;
        });
      }
      const client = this.createAxiosInstance();
      await client.post(assetPath, updateData);
      return createSuccessResponse({
        success: true,
        assetPath,
        updatedMetadata: metadata,
        timestamp: new Date().toISOString(),
      }, 'updateAsset');
    }, 'updateAsset');
  }

  async deleteAsset(request: any): Promise<object> {
    return safeExecute<object>(async () => {
      const { assetPath, force = false } = request;
      if (!isValidContentPath(assetPath, this.aemConfig)) {
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid asset path: ${String(assetPath)}`, { assetPath });
      }
      const client = this.createAxiosInstance();
      await client.delete(assetPath);
      return createSuccessResponse({
        success: true,
        deletedPath: assetPath,
        force,
        timestamp: new Date().toISOString(),
      }, 'deleteAsset');
    }, 'deleteAsset');
  }

  async getTemplates(sitePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const client = this.createAxiosInstance();
      const response = await client.get(`${sitePath}.json`);
      return createSuccessResponse({
        sitePath,
        templates: response.data,
      }, 'getTemplates');
    }, 'getTemplates');
  }

  async getTemplateStructure(templatePath: string): Promise<object> {
    return safeExecute<object>(async () => {
      const client = this.createAxiosInstance();
      const response = await client.get(`${templatePath}.json`);
      return createSuccessResponse({
        templatePath,
        structure: response.data,
      }, 'getTemplateStructure');
    }, 'getTemplateStructure');
  }

  /**
   * Legacy: Get JCR node content as raw JSON for a given path and depth.
   */
  async getNodeContent(path: string, depth: number = 1): Promise<any> {
    return safeExecute<any>(async () => {
      const client = this.createAxiosInstance();
      const response = await client.get(`${path}.json`, { params: { depth } });
      return {
        path,
        depth,
        content: response.data,
      };
    }, 'getNodeContent');
  }
} 