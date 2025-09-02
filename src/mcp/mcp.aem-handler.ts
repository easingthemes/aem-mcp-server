import { AEMConnector } from '../aem/aem.connector.js';
import { CliParams } from '../types.js';
import { handleAEMHttpError } from '../aem/aem.errors.js';
import { LOGGER } from '../utils/logger.js';

export class MCPRequestHandler {
  aemConnector: AEMConnector;
  config: CliParams;

  constructor(config: CliParams) {
    this.config = config;
    this.aemConnector = new AEMConnector(config);
  }

  async init() {
    if (!this.aemConnector.isInitialized) {
      await this.aemConnector.init();
      LOGGER.log('AEM Connector initialized.');
    } else {
      LOGGER.log('AEM Connector already initialized.');
    }
  }

  async handleRequest(method: string, params: any) {
    try {
      await this.init();
    } catch (error: any) {
      LOGGER.error('ERROR initializing MCP Server', error.message);
      throw handleAEMHttpError(error, 'MCP Server Initialization');
    }
    try {
      switch (method) {
        case 'validateComponent':
          return await this.aemConnector.validateComponent(params);
        case 'updateComponent':
          return await this.aemConnector.updateComponent(params);
        case 'undoChanges':
          return await this.aemConnector.undoChanges(params);
        case 'scanPageComponents':
          return await this.aemConnector.scanPageComponents(params.pagePath);
        case 'fetchSites':
          return await this.aemConnector.fetchSites();
        case 'fetchLanguageMasters':
          return await this.aemConnector.fetchLanguageMasters(params.site);
        case 'fetchAvailableLocales':
          return await this.aemConnector.fetchAvailableLocales(params.site, params.languageMasterPath);
        case 'replicateAndPublish':
          return await this.aemConnector.replicateAndPublish(params.selectedLocales, params.componentData, params.localizedOverrides);
        case 'getAllTextContent':
          return await this.aemConnector.getAllTextContent(params.pagePath);
        case 'getPageTextContent':
          return await this.aemConnector.getPageTextContent(params.pagePath);
        case 'getPageImages':
          return await this.aemConnector.getPageImages(params.pagePath);
        case 'updateImagePath':
          return await this.aemConnector.updateImagePath(params.componentPath, params.newImagePath);
        case 'getPageContent':
          return await this.aemConnector.getPageContent(params.pagePath);
        case 'listPages':
          return await this.aemConnector.listPages(params.siteRoot || params.path || '/content', params.depth || 1, params.limit || 20);
        case 'getNodeContent':
          return await this.aemConnector.getNodeContent(params.path, params.depth || 1);
        case 'listChildren':
          return await this.aemConnector.listChildren(params.path);
        case 'getPageProperties':
          return await this.aemConnector.getPageProperties(params.pagePath);
        case 'searchContent':
          return await this.aemConnector.searchContent(params);
        case 'executeJCRQuery':
          return await this.aemConnector.executeJCRQuery(params.query, params.limit);
        case 'getAssetMetadata':
          return await this.aemConnector.getAssetMetadata(params.assetPath);
        case 'getStatus':
          return this.getWorkflowStatus(params.workflowId);
        case 'enhancedPageSearch':
          return await this.aemConnector.searchContent({
            fulltext: params.searchTerm,
            path: params.basePath,
            type: 'cq:Page',
            limit: 20
          });
        case 'createPage':
          return await this.aemConnector.createPage(params);
        case 'deletePage':
          return await this.aemConnector.deletePage(params);
        case 'createComponent':
          return await this.aemConnector.createComponent(params);
        case 'deleteComponent':
          return await this.aemConnector.deleteComponent(params);
        case 'unpublishContent':
          return await this.aemConnector.unpublishContent(params);
        case 'activatePage':
          return await this.aemConnector.activatePage(params);
        case 'deactivatePage':
          return await this.aemConnector.deactivatePage(params);
        case 'uploadAsset':
          return await this.aemConnector.uploadAsset(params);
        case 'updateAsset':
          return await this.aemConnector.updateAsset(params);
        case 'deleteAsset':
          return await this.aemConnector.deleteAsset(params);
        case 'getTemplates':
          return await this.aemConnector.getTemplates(params.sitePath);
        case 'getTemplateStructure':
          return await this.aemConnector.getTemplateStructure(params.templatePath);
        case 'bulkUpdateComponents':
          return await this.aemConnector.bulkUpdateComponents(params);
        default:
          throw new Error(`Unknown method: ${method}`);
      }
    } catch (error: any) {
      return { error: error.message, method, params };
    }
  }

  getWorkflowStatus(workflowId: string) {
    return {
      success: true,
      workflowId: workflowId,
      status: 'completed',
      message: 'Mock workflow status - always returns completed',
      timestamp: new Date().toISOString()
    };
  }
}
