export class MCPRequestHandler {
    aemConnector;
    constructor(aemConnector) {
        this.aemConnector = aemConnector;
    }
    async handleRequest(method, params) {
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
                case 'listMethods':
                    return { methods: this.getAvailableMethods() };
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
                default:
                    throw new Error(`Unknown method: ${method}`);
            }
        }
        catch (error) {
            return { error: error.message, method, params };
        }
    }
    getWorkflowStatus(workflowId) {
        return {
            success: true,
            workflowId: workflowId,
            status: 'completed',
            message: 'Mock workflow status - always returns completed',
            timestamp: new Date().toISOString()
        };
    }
    getAvailableMethods() {
        return [
            { name: 'validateComponent', description: 'Validate component changes before applying them', parameters: ['locale', 'page_path', 'component', 'props'] },
            { name: 'updateComponent', description: 'Update component properties in AEM', parameters: ['componentPath', 'properties'] },
            { name: 'undoChanges', description: 'Undo the last component changes', parameters: ['job_id'] },
            { name: 'scanPageComponents', description: 'Scan a page to discover all components and their properties', parameters: ['pagePath'] },
            { name: 'fetchSites', description: 'Get all available sites in AEM', parameters: [] },
            { name: 'fetchLanguageMasters', description: 'Get language masters for a specific site', parameters: ['site'] },
            { name: 'fetchAvailableLocales', description: 'Get available locales for a site and language master', parameters: ['site', 'languageMasterPath'] },
            { name: 'replicateAndPublish', description: 'Replicate and publish content to selected locales', parameters: ['selectedLocales', 'componentData', 'localizedOverrides'] },
            { name: 'getAllTextContent', description: 'Get all text content from a page including titles, text components, and descriptions', parameters: ['pagePath'] },
            { name: 'getPageTextContent', description: 'Get text content from a specific page', parameters: ['pagePath'] },
            { name: 'getPageImages', description: 'Get all images from a page, including those within Experience Fragments', parameters: ['pagePath'] },
            { name: 'updateImagePath', description: 'Update the image path for an image component and verify the update', parameters: ['componentPath', 'newImagePath'] },
            { name: 'getPageContent', description: 'Get all content from a page including Experience Fragments and Content Fragments', parameters: ['pagePath'] },
            { name: 'listPages', description: 'List all pages under a site root', parameters: ['siteRoot', 'depth', 'limit'] },
            { name: 'getNodeContent', description: 'Legacy: Get JCR node content', parameters: ['path', 'depth'] },
            { name: 'listChildren', description: 'Legacy: List child nodes', parameters: ['path'] },
            { name: 'getPageProperties', description: 'Get page properties', parameters: ['pagePath'] },
            { name: 'searchContent', description: 'Search content using Query Builder', parameters: ['type', 'fulltext', 'path', 'limit'] },
            { name: 'executeJCRQuery', description: 'Execute JCR query', parameters: ['query', 'limit'] },
            { name: 'getAssetMetadata', description: 'Get asset metadata', parameters: ['assetPath'] },
            { name: 'getStatus', description: 'Get workflow status by ID', parameters: ['workflowId'] },
            { name: 'listMethods', description: 'Get list of available MCP methods', parameters: [] },
            { name: 'enhancedPageSearch', description: 'Intelligent page search with comprehensive fallback strategies and cross-section search', parameters: ['searchTerm', 'basePath', 'includeAlternateLocales'] },
            { name: 'createPage', description: 'Create a new page in AEM', parameters: ['parentPath', 'title', 'template', 'name', 'properties'] },
            { name: 'deletePage', description: 'Delete a page from AEM', parameters: ['pagePath', 'force'] },
            { name: 'createComponent', description: 'Create a new component on a page', parameters: ['pagePath', 'componentType', 'resourceType', 'properties', 'name'] },
            { name: 'deleteComponent', description: 'Delete a component from AEM', parameters: ['componentPath', 'force'] },
            { name: 'unpublishContent', description: 'Unpublish content from the publish environment', parameters: ['contentPaths', 'unpublishTree'] },
            { name: 'activatePage', description: 'Activate (publish) a single page', parameters: ['pagePath', 'activateTree'] },
            { name: 'deactivatePage', description: 'Deactivate (unpublish) a single page', parameters: ['pagePath', 'deactivateTree'] },
            { name: 'uploadAsset', description: 'Upload a new asset to AEM DAM', parameters: ['parentPath', 'fileName', 'fileContent', 'mimeType', 'metadata'] },
            { name: 'updateAsset', description: 'Update an existing asset in AEM DAM', parameters: ['assetPath', 'metadata', 'fileContent', 'mimeType'] },
            { name: 'deleteAsset', description: 'Delete an asset from AEM DAM', parameters: ['assetPath', 'force'] },
            { name: 'getTemplates', description: 'Get available page templates', parameters: ['sitePath'] },
            { name: 'getTemplateStructure', description: 'Get detailed structure of a specific template', parameters: ['templatePath'] },
        ];
    }
}
