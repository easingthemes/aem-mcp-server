import { AEMFetch } from './aem.fetch.js';
import { createSuccessResponse, safeExecute, createAEMError, AEM_ERROR_CODES } from './aem.errors.js';

export class ContentFragmentManager {
  private readonly fetch: AEMFetch;
  private readonly isAEMaaCS: boolean;

  constructor(fetch: AEMFetch, isAEMaaCS: boolean) {
    this.fetch = fetch;
    this.isAEMaaCS = isAEMaaCS;
  }

  async getContentFragment(path: string): Promise<object> {
    return safeExecute<object>(async () => {
      if (this.isAEMaaCS) {
        const result = await this.fetch.get('/adobe/sites/cf/fragments', { path });
        const fragment = result.items?.[0] || result;
        return createSuccessResponse(this.normalizeFragment(fragment), 'getContentFragment');
      } else {
        const result = await this.fetch.get(`/api/assets${path}.json`);
        return createSuccessResponse(this.normalizeFragmentFrom65(result, path), 'getContentFragment');
      }
    }, 'getContentFragment');
  }

  private normalizeFragment(raw: any): object {
    return {
      path: raw.path || raw.id,
      title: raw.title,
      model: raw.model?.path || raw.model,
      description: raw.description || '',
      fields: this.extractFields(raw),
      variations: this.extractVariations(raw),
      metadata: {
        created: raw.created?.at,
        modified: raw.modified?.at,
        createdBy: raw.created?.by,
        status: raw.status,
      },
    };
  }

  private normalizeFragmentFrom65(raw: any, path: string): object {
    const elements = raw.properties?.elements || {};
    const variations = raw.properties?.variations || {};
    return {
      path,
      title: raw.properties?.title || raw.properties?.['jcr:title'] || '',
      model: raw.properties?.['cq:model'] || '',
      description: raw.properties?.description || '',
      fields: Object.entries(elements).map(([name, el]: [string, any]) => ({
        name,
        value: el.value ?? el[':value'] ?? '',
        type: el[':type'] || 'text',
      })),
      variations: Object.entries(variations).map(([name, v]: [string, any]) => ({
        name,
        title: v.title || name,
        fields: Object.entries(v.elements || {}).map(([fn, fe]: [string, any]) => ({
          name: fn,
          value: fe.value ?? fe[':value'] ?? '',
          type: fe[':type'] || 'text',
        })),
      })),
      metadata: {
        created: raw.properties?.['jcr:created'],
        modified: raw.properties?.['jcr:lastModified'] || raw.properties?.['cq:lastModified'],
        createdBy: raw.properties?.['jcr:createdBy'],
        status: raw.properties?.['cq:lastReplicationAction'] || 'not published',
      },
    };
  }

  private extractFields(raw: any): any[] {
    const fields = raw.fields || raw.elements || [];
    if (Array.isArray(fields)) {
      return fields.map((f: any) => ({
        name: f.name,
        value: f.values?.[0] ?? f.value ?? '',
        type: f.type || 'text',
      }));
    }
    return Object.entries(fields).map(([name, f]: [string, any]) => ({
      name,
      value: f.values?.[0] ?? f.value ?? '',
      type: f.type || 'text',
    }));
  }

  private extractVariations(raw: any): any[] {
    const variations = raw.variations || [];
    if (Array.isArray(variations)) {
      return variations.map((v: any) => ({
        name: v.name || v.id,
        title: v.title || v.name || '',
        fields: this.extractFields(v),
      }));
    }
    return Object.entries(variations).map(([name, v]: [string, any]) => ({
      name,
      title: v.title || name,
      fields: this.extractFields(v),
    }));
  }

  async listContentFragments(params: {
    path: string;
    model?: string;
    limit?: number;
    offset?: number;
  }): Promise<object> {
    const { path, model, limit = 20, offset = 0 } = params;
    return safeExecute<object>(async () => {
      if (this.isAEMaaCS) {
        const queryParams: Record<string, any> = { parentPath: path, limit };
        if (model) queryParams.modelId = model;
        if (offset > 0) queryParams.offset = offset;
        const result = await this.fetch.get('/adobe/sites/cf/fragments', queryParams);
        const items = result.items || [];
        return createSuccessResponse({
          fragments: items.map((item: any) => ({
            path: item.path || item.id,
            title: item.title,
            model: item.model?.path || item.model,
            modified: item.modified?.at,
            status: item.status,
          })),
          totalCount: result.total || items.length,
          limit,
          offset,
        }, 'listContentFragments');
      } else {
        const qbParams: Record<string, any> = {
          'type': 'dam:Asset',
          'path': path,
          'p.limit': limit,
          'p.offset': offset,
          'orderby': '@jcr:content/jcr:lastModified',
          'orderby.sort': 'desc',
        };
        if (model) {
          qbParams['property'] = 'jcr:content/data/cq:model';
          qbParams['property.value'] = model;
        }
        const result = await this.fetch.get('/bin/querybuilder.json', qbParams);
        const hits = result.hits || [];
        return createSuccessResponse({
          fragments: hits.map((hit: any) => ({
            path: hit.path,
            title: hit['jcr:content']?.['jcr:title'] || hit.name,
            model: hit['jcr:content']?.data?.['cq:model'] || '',
            modified: hit['jcr:content']?.['jcr:lastModified'] || '',
            status: hit['jcr:content']?.['cq:lastReplicationAction'] || 'not published',
          })),
          totalCount: result.total || hits.length,
          limit,
          offset,
        }, 'listContentFragments');
      }
    }, 'listContentFragments');
  }

  async manageContentFragment(params: {
    action: string;
    fragmentPath?: string;
    parentPath?: string;
    title?: string;
    name?: string;
    model?: string;
    fields?: Record<string, any>;
    description?: string;
    force?: boolean;
  }): Promise<object> {
    const { action } = params;
    switch (action) {
      case 'create':
        return this.createContentFragment(params);
      case 'update':
        return this.updateContentFragment(params);
      case 'delete':
        return this.deleteContentFragment(params);
      default:
        throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid action: ${action}. Must be "create", "update", or "delete".`);
    }
  }

  private async createContentFragment(params: any): Promise<object> {
    const { parentPath, title, model, fields, description, name } = params;
    if (!parentPath || !title || !model) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'create requires parentPath, title, and model');
    }
    const nodeName = name || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    return safeExecute<object>(async () => {
      if (this.isAEMaaCS) {
        const body: any = { title, model, description: description || '' };
        if (fields) {
          body.fields = Object.entries(fields).map(([k, v]) => ({ name: k, value: v }));
        }
        const result = await this.fetch.post(`/adobe/sites/cf/fragments?parentPath=${encodeURIComponent(parentPath)}&name=${encodeURIComponent(nodeName)}`, body);
        return createSuccessResponse({ action: 'create', path: result.path || `${parentPath}/${nodeName}`, title, model }, 'manageContentFragment');
      } else {
        const formData = new URLSearchParams();
        formData.append('./jcr:primaryType', 'dam:Asset');
        formData.append('./jcr:content/jcr:primaryType', 'dam:AssetContent');
        formData.append('./jcr:content/jcr:title', title);
        formData.append('./jcr:content/data/jcr:primaryType', 'nt:unstructured');
        formData.append('./jcr:content/data/cq:model', model);
        if (description) formData.append('./jcr:content/data/description', description);
        if (fields) {
          for (const [key, value] of Object.entries(fields)) {
            formData.append(`./jcr:content/data/master/${key}`, String(value));
          }
        }
        const cfPath = `${parentPath}/${nodeName}`;
        await this.fetch.post(cfPath, formData);
        return createSuccessResponse({ action: 'create', path: cfPath, title, model }, 'manageContentFragment');
      }
    }, 'createContentFragment');
  }

  private async updateContentFragment(params: any): Promise<object> {
    const { fragmentPath, fields, description, title } = params;
    if (!fragmentPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'update requires fragmentPath');
    }

    return safeExecute<object>(async () => {
      if (this.isAEMaaCS) {
        const body: any = {};
        if (title) body.title = title;
        if (description) body.description = description;
        if (fields) {
          body.fields = Object.entries(fields).map(([k, v]) => ({ name: k, value: v }));
        }
        await this.fetch.put(`/adobe/sites/cf/fragments?path=${encodeURIComponent(fragmentPath)}`, body);
        return createSuccessResponse({ action: 'update', path: fragmentPath }, 'manageContentFragment');
      } else {
        const formData = new URLSearchParams();
        if (title) formData.append('./jcr:content/jcr:title', title);
        if (description) formData.append('./jcr:content/data/description', description);
        if (fields) {
          for (const [key, value] of Object.entries(fields)) {
            formData.append(`./jcr:content/data/master/${key}`, String(value));
          }
        }
        await this.fetch.post(fragmentPath, formData);
        return createSuccessResponse({ action: 'update', path: fragmentPath }, 'manageContentFragment');
      }
    }, 'updateContentFragment');
  }

  private async deleteContentFragment(params: any): Promise<object> {
    const { fragmentPath, force } = params;
    if (!fragmentPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'delete requires fragmentPath');
    }

    return safeExecute<object>(async () => {
      if (this.isAEMaaCS) {
        const url = `/adobe/sites/cf/fragments?path=${encodeURIComponent(fragmentPath)}${force ? '&force=true' : ''}`;
        await this.fetch.delete(url);
        return createSuccessResponse({ action: 'delete', path: fragmentPath }, 'manageContentFragment');
      } else {
        const formData = new URLSearchParams();
        formData.append(':operation', 'delete');
        await this.fetch.post(fragmentPath, formData);
        return createSuccessResponse({ action: 'delete', path: fragmentPath }, 'manageContentFragment');
      }
    }, 'deleteContentFragment');
  }

  async manageContentFragmentVariation(params: {
    action: string;
    fragmentPath: string;
    variationName: string;
    title?: string;
    fields?: Record<string, any>;
  }): Promise<object> {
    const { action, fragmentPath, variationName, title, fields } = params;

    return safeExecute<object>(async () => {
      switch (action) {
        case 'create': {
          if (!title) {
            throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'create requires title');
          }
          if (this.isAEMaaCS) {
            await this.fetch.post(
              `/adobe/sites/cf/fragments?path=${encodeURIComponent(fragmentPath)}/variations`,
              { name: variationName, title, fields: fields ? Object.entries(fields).map(([k, v]) => ({ name: k, value: v })) : undefined }
            );
          } else {
            const formData = new URLSearchParams();
            formData.append('./jcr:primaryType', 'nt:unstructured');
            formData.append('./jcr:title', title);
            if (fields) {
              for (const [key, value] of Object.entries(fields)) {
                formData.append(`./${key}`, String(value));
              }
            }
            await this.fetch.post(`${fragmentPath}/jcr:content/data/${variationName}`, formData);
          }
          return createSuccessResponse({ action: 'create', fragmentPath, variationName, title }, 'manageContentFragmentVariation');
        }
        case 'update': {
          if (this.isAEMaaCS) {
            const body: any = {};
            if (title) body.title = title;
            if (fields) {
              body.fields = Object.entries(fields).map(([k, v]) => ({ name: k, value: v }));
            }
            await this.fetch.put(
              `/adobe/sites/cf/fragments?path=${encodeURIComponent(fragmentPath)}/variations/${variationName}`,
              body
            );
          } else {
            const formData = new URLSearchParams();
            if (title) formData.append('./jcr:title', title);
            if (fields) {
              for (const [key, value] of Object.entries(fields)) {
                formData.append(`./${key}`, String(value));
              }
            }
            await this.fetch.post(`${fragmentPath}/jcr:content/data/${variationName}`, formData);
          }
          return createSuccessResponse({ action: 'update', fragmentPath, variationName }, 'manageContentFragmentVariation');
        }
        case 'delete': {
          if (this.isAEMaaCS) {
            await this.fetch.delete(
              `/adobe/sites/cf/fragments?path=${encodeURIComponent(fragmentPath)}/variations/${variationName}`
            );
          } else {
            const formData = new URLSearchParams();
            formData.append(':operation', 'delete');
            await this.fetch.post(`${fragmentPath}/jcr:content/data/${variationName}`, formData);
          }
          return createSuccessResponse({ action: 'delete', fragmentPath, variationName }, 'manageContentFragmentVariation');
        }
        default:
          throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, `Invalid action: ${action}. Must be "create", "update", or "delete".`);
      }
    }, 'manageContentFragmentVariation');
  }
}
