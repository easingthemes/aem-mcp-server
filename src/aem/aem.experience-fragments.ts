import { AEMFetch } from './aem.fetch.js';
import { createSuccessResponse, safeExecute, createAEMError, AEM_ERROR_CODES } from './aem.errors.js';
import { LOGGER } from '../utils/logger.js';

export class ExperienceFragmentManager {
  private readonly fetch: AEMFetch;
  private readonly host: string;

  constructor(fetch: AEMFetch, host: string) {
    this.fetch = fetch;
    this.host = host;
  }

  private getPreviewUrl(path: string): string {
    return `${this.host}${path}.html?wcmmode=disabled`;
  }

  async getExperienceFragment(path: string): Promise<object> {
    return safeExecute<object>(async () => {
      const pageData = await this.fetch.get(`${path}.infinity.json`);
      const jcrContent = pageData['jcr:content'] || {};

      // Collect child variations (child pages of the XF)
      const variations: any[] = [];
      for (const [childName, childData] of Object.entries(pageData)) {
        if (childName.startsWith('jcr:') || childName.startsWith('rep:') || typeof childData !== 'object') continue;
        const child = childData as any;
        const childJcr = child['jcr:content'];
        if (!childJcr) continue;
        const variantType = childJcr['cq:xfVariantType'];
        if (!variantType) continue;

        variations.push({
          name: childName,
          type: variantType,
          path: `${path}/${childName}`,
          title: childJcr['jcr:title'] || childName,
        });
      }

      return createSuccessResponse({
        path,
        title: jcrContent['jcr:title'] || '',
        template: jcrContent['cq:template'] || '',
        description: jcrContent['jcr:description'] || '',
        variations,
        tags: jcrContent['cq:tags'] || [],
        lastModified: jcrContent['cq:lastModified'] || jcrContent['jcr:lastModified'] || '',
        status: jcrContent['cq:lastReplicationAction'] || 'not published',
      }, 'getExperienceFragment');
    }, 'getExperienceFragment');
  }

  async listExperienceFragments(params: {
    path?: string;
    template?: string;
    limit?: number;
    offset?: number;
  }): Promise<object> {
    const { path = '/content/experience-fragments', template, limit = 20, offset = 0 } = params;

    return safeExecute<object>(async () => {
      const qbParams: Record<string, any> = {
        'type': 'cq:Page',
        'path': path,
        'property': 'jcr:content/sling:resourceType',
        'property.value': 'cq/experience-fragments/components/experiencefragment',
        'p.limit': limit,
        'p.offset': offset,
        'orderby': '@jcr:content/cq:lastModified',
        'orderby.sort': 'desc',
      };
      if (template) {
        qbParams['2_property'] = 'jcr:content/cq:template';
        qbParams['2_property.value'] = template;
      }

      const result = await this.fetch.get('/bin/querybuilder.json', qbParams);
      const hits = result.hits || [];

      return createSuccessResponse({
        fragments: hits.map((hit: any) => ({
          path: hit.path,
          title: hit['jcr:content']?.['jcr:title'] || hit.name,
          variationCount: Object.keys(hit).filter((k: string) => !k.startsWith('jcr:') && !k.startsWith('rep:')).length,
          lastModified: hit['jcr:content']?.['cq:lastModified'] || '',
        })),
        totalCount: result.total || hits.length,
        limit,
        offset,
      }, 'listExperienceFragments');
    }, 'listExperienceFragments');
  }

  async manageExperienceFragment(params: {
    action: string;
    xfPath?: string;
    parentPath?: string;
    name?: string;
    title?: string;
    template?: string;
    description?: string;
    tags?: string[];
    force?: boolean;
  }): Promise<object> {
    const { action } = params;
    switch (action) {
      case 'create':
        return this.createExperienceFragment(params);
      case 'update':
        return this.updateExperienceFragment(params);
      case 'delete':
        return this.deleteExperienceFragment(params);
      default:
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid action: ${action}. Must be "create", "update", or "delete".`);
    }
  }

  private async createExperienceFragment(params: any): Promise<object> {
    const { parentPath, title, template, description, tags, name } = params;
    if (!parentPath || !title || !template) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'create requires parentPath, title, and template');
    }
    const nodeName = name || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const xfPath = `${parentPath}/${nodeName}`;

    return safeExecute<object>(async () => {
      // Create XF page
      const formData = new URLSearchParams();
      formData.append('./jcr:primaryType', 'cq:Page');
      formData.append('./jcr:content/jcr:primaryType', 'cq:PageContent');
      formData.append('./jcr:content/jcr:title', title);
      formData.append('./jcr:content/sling:resourceType', 'cq/experience-fragments/components/experiencefragment');
      formData.append('./jcr:content/cq:template', template);
      if (description) formData.append('./jcr:content/jcr:description', description);
      if (tags?.length) {
        tags.forEach((tag: string) => formData.append('./jcr:content/cq:tags', tag));
      }
      await this.fetch.post(xfPath, formData);

      // Create default "master" variation
      const masterFormData = new URLSearchParams();
      masterFormData.append('./jcr:primaryType', 'cq:Page');
      masterFormData.append('./jcr:content/jcr:primaryType', 'cq:PageContent');
      masterFormData.append('./jcr:content/jcr:title', 'Master');
      masterFormData.append('./jcr:content/sling:resourceType', 'cq/experience-fragments/components/xfpage');
      masterFormData.append('./jcr:content/cq:xfVariantType', 'web');
      await this.fetch.post(`${xfPath}/master`, masterFormData);

      return createSuccessResponse({
        action: 'create',
        path: xfPath,
        title,
        previewUrl: this.getPreviewUrl(xfPath),
      }, 'manageExperienceFragment');
    }, 'createExperienceFragment');
  }

  private async updateExperienceFragment(params: any): Promise<object> {
    const { xfPath, title, description, tags } = params;
    if (!xfPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'update requires xfPath');
    }

    return safeExecute<object>(async () => {
      const formData = new URLSearchParams();
      if (title) formData.append('./jcr:content/jcr:title', title);
      if (description) formData.append('./jcr:content/jcr:description', description);
      if (tags?.length) {
        tags.forEach((tag: string) => formData.append('./jcr:content/cq:tags', tag));
      }
      await this.fetch.post(xfPath, formData);
      return createSuccessResponse({ action: 'update', path: xfPath }, 'manageExperienceFragment');
    }, 'updateExperienceFragment');
  }

  private async deleteExperienceFragment(params: any): Promise<object> {
    const { xfPath, force } = params;
    if (!xfPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'delete requires xfPath');
    }

    return safeExecute<object>(async () => {
      if (!force) {
        // Check for references before deleting
        try {
          const refs = await this.fetch.get(`${xfPath}.references.json`);
          const referencing = refs?.pages?.filter((p: any) => p.path !== xfPath) || [];
          if (referencing.length > 0) {
            throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS,
              `Cannot delete: XF is referenced by ${referencing.length} page(s): ${referencing.map((p: any) => p.path).join(', ')}. Use force=true to delete anyway.`);
          }
        } catch (refError: any) {
          if (refError.code === AEM_ERROR_CODES.INVALID_PARAMETERS) throw refError;
          // If reference check fails, proceed with delete
          LOGGER.warn(`Could not check references for ${xfPath}: ${refError.message}`);
        }
      }
      const formData = new URLSearchParams();
      formData.append(':operation', 'delete');
      await this.fetch.post(xfPath, formData);
      return createSuccessResponse({ action: 'delete', path: xfPath }, 'manageExperienceFragment');
    }, 'deleteExperienceFragment');
  }

  async manageExperienceFragmentVariation(params: {
    action: string;
    xfPath: string;
    variationName: string;
    variationType?: string;
    title?: string;
    template?: string;
    force?: boolean;
  }): Promise<object> {
    const { action, xfPath, variationName, variationType = 'web', title, template, force } = params;
    const variationPath = `${xfPath}/${variationName}`;

    return safeExecute<object>(async () => {
      switch (action) {
        case 'create': {
          if (!title) {
            throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'create requires title');
          }
          const formData = new URLSearchParams();
          formData.append('./jcr:primaryType', 'cq:Page');
          formData.append('./jcr:content/jcr:primaryType', 'cq:PageContent');
          formData.append('./jcr:content/jcr:title', title);
          formData.append('./jcr:content/sling:resourceType', 'cq/experience-fragments/components/xfpage');
          formData.append('./jcr:content/cq:xfVariantType', variationType);
          if (template) formData.append('./jcr:content/cq:template', template);
          await this.fetch.post(variationPath, formData);
          return createSuccessResponse({
            action: 'create', xfPath, variationName, variationPath, variationType, title,
          }, 'manageExperienceFragmentVariation');
        }
        case 'update': {
          const formData = new URLSearchParams();
          if (title) formData.append('./jcr:content/jcr:title', title);
          if (variationType) formData.append('./jcr:content/cq:xfVariantType', variationType);
          await this.fetch.post(variationPath, formData);
          return createSuccessResponse({ action: 'update', xfPath, variationName, variationPath }, 'manageExperienceFragmentVariation');
        }
        case 'delete': {
          const formData = new URLSearchParams();
          formData.append(':operation', 'delete');
          await this.fetch.post(variationPath, formData);
          return createSuccessResponse({ action: 'delete', xfPath, variationName, variationPath }, 'manageExperienceFragmentVariation');
        }
        default:
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid action: ${action}. Must be "create", "update", or "delete".`);
      }
    }, 'manageExperienceFragmentVariation');
  }
}
