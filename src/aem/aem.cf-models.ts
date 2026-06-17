import { AEMFetch } from './aem.fetch.js';
import { createSuccessResponse, safeExecute, createAEMError, AEM_ERROR_CODES } from './aem.errors.js';

export interface CFModelFieldDef {
  name: string;
  type: 'single-line-text' | 'multi-line-text' | 'number' | 'boolean' | 'date-time' | 'enumeration' | 'content-reference' | 'fragment-reference' | 'json';
  label?: string;
  required?: boolean;
  multiValue?: boolean;
  options?: string[];
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
}

export class ContentFragmentModelManager {
  private readonly fetch: AEMFetch;
  private readonly isAEMaaCS: boolean;

  constructor(fetch: AEMFetch, isAEMaaCS: boolean) {
    this.fetch = fetch;
    this.isAEMaaCS = isAEMaaCS;
  }

  async listContentFragmentModels(params: {
    path?: string;
    name?: string;
    status?: string;
    limit?: number;
  }): Promise<object> {
    const { path = '/conf', name, status, limit = 50 } = params;
    return safeExecute<object>(async () => {
      if (this.isAEMaaCS) {
        const queryParams: Record<string, any> = { limit };
        if (path) queryParams.parentPath = path;
        const result = await this.fetch.get('/adobe/sites/cfm/models', queryParams);
        let models = result.items || result.models || [];
        if (name) {
          models = models.filter((m: any) =>
            (m.title || m.name || '').toLowerCase().includes(name.toLowerCase())
          );
        }
        if (status) {
          models = models.filter((m: any) => m.status === status);
        }
        return createSuccessResponse({
          models: models.map((m: any) => ({
            path: m.path || m.id,
            title: m.title || m.name,
            description: m.description || '',
            status: m.status || 'enabled',
            fieldCount: (m.fields || m.elements || []).length,
            modified: m.modified?.at || m.lastModified || '',
          })),
          totalCount: models.length,
        }, 'listContentFragmentModels');
      } else {
        const qbParams: Record<string, any> = {
          type: 'dam:cfm/Model',
          path,
          'p.limit': limit,
          'p.hits': 'full',
          'orderby': '@jcr:content/jcr:lastModified',
          'orderby.sort': 'desc',
        };
        if (name) {
          qbParams['property'] = 'jcr:content/jcr:title';
          qbParams['property.operation'] = 'like';
          qbParams['property.value'] = `%${name}%`;
        }
        if (status) {
          qbParams['property.2'] = 'jcr:content/modelEnabled';
          qbParams['property.2.value'] = status === 'enabled' ? 'true' : 'false';
        }
        const result = await this.fetch.get('/bin/querybuilder.json', qbParams);
        const hits = result.hits || [];
        return createSuccessResponse({
          models: hits.map((hit: any) => ({
            path: hit.path,
            title: hit['jcr:content']?.['jcr:title'] || hit.name,
            description: hit['jcr:content']?.['jcr:description'] || '',
            status: hit['jcr:content']?.modelEnabled === false ? 'disabled' : 'enabled',
            fieldCount: 0,
            modified: hit['jcr:content']?.['jcr:lastModified'] || '',
          })),
          totalCount: result.total || hits.length,
        }, 'listContentFragmentModels');
      }
    }, 'listContentFragmentModels');
  }

  async getContentFragmentModelSchema(params: {
    modelPath: string;
  }): Promise<object> {
    const { modelPath } = params;
    if (!modelPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'getContentFragmentModelSchema requires modelPath');
    }
    return safeExecute<object>(async () => {
      if (this.isAEMaaCS) {
        const result = await this.fetch.get('/adobe/sites/cfm/models', { path: modelPath });
        const model = result.items?.[0] || result;
        const fields = (model.fields || model.elements || []).map((f: any) => ({
          name: f.name,
          type: this.normalizeFieldType(f.fieldType || f.type || 'text'),
          label: f.label || f.name,
          required: f.required === true,
          multiValue: f.multi === true || f.multiValue === true,
          constraints: this.extractConstraints(f),
        }));
        return createSuccessResponse({
          modelPath,
          title: model.title || model.name || modelPath,
          description: model.description || '',
          fields,
        }, 'getContentFragmentModelSchema');
      } else {
        const result = await this.fetch.get(`${modelPath}.infinity.json`);
        const jcrContent = result['jcr:content'] || result;
        const title = jcrContent['jcr:title'] || modelPath.split('/').pop() || '';
        const fields = this.extractFieldsFrom65Model(jcrContent);
        return createSuccessResponse({
          modelPath,
          title,
          description: jcrContent['jcr:description'] || '',
          fields,
        }, 'getContentFragmentModelSchema');
      }
    }, 'getContentFragmentModelSchema');
  }

  private normalizeFieldType(raw: string): string {
    const map: Record<string, string> = {
      'text-single': 'single-line-text',
      'text-multi': 'multi-line-text',
      'text-singleline': 'single-line-text',
      'text-multiline': 'multi-line-text',
      'number': 'number',
      'boolean': 'boolean',
      'date': 'date-time',
      'calendar': 'date-time',
      'enumeration': 'enumeration',
      'tags': 'tags',
      'content-reference': 'content-reference',
      'fragment-reference': 'fragment-reference',
      'json': 'json',
    };
    return map[raw.toLowerCase()] || raw;
  }

  private extractConstraints(f: any): Record<string, any> {
    const c: Record<string, any> = {};
    if (f.maxLength !== undefined) c.maxLength = f.maxLength;
    if (f.minLength !== undefined) c.minLength = f.minLength;
    if (f.minimum !== undefined) c.minimum = f.minimum;
    if (f.maximum !== undefined) c.maximum = f.maximum;
    if (f.pattern !== undefined) c.pattern = f.pattern;
    if (f.options) c.options = f.options;
    if (f.allowedContentTypes) c.allowedContentTypes = f.allowedContentTypes;
    if (f.allowedFragmentModels) c.allowedFragmentModels = f.allowedFragmentModels;
    return c;
  }

  private extractFieldsFrom65Model(jcrContent: any): Array<{
    name: string; type: string; label: string; required: boolean; multiValue: boolean; constraints: Record<string, any>;
  }> {
    const fields: any[] = [];
    const walk = (node: any, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 8) return;
      if (node['sling:resourceType']?.includes('cfm/models/editor/components/datatypes')) {
        fields.push({
          name: node['name'] || node['fieldLabel'] || '',
          type: this.normalizeFieldType(
            node['valueType'] || node['fieldType'] || node['sling:resourceType'].split('/').pop() || 'text'
          ),
          label: node['fieldLabel'] || node['name'] || '',
          required: node['required'] === true || node['required'] === 'true',
          multiValue: node['multiple'] === true || node['multiple'] === 'true',
          constraints: this.extractConstraints(node),
        });
      }
      for (const key of Object.keys(node)) {
        if (!key.startsWith('jcr:') && !key.startsWith(':') && typeof node[key] === 'object') {
          walk(node[key], depth + 1);
        }
      }
    };
    walk(jcrContent);
    return fields;
  }

  async createContentFragmentModel(params: {
    parentPath: string;
    name: string;
    title: string;
    description?: string;
    fields?: CFModelFieldDef[];
    dryRun?: boolean;
  }): Promise<object> {
    const { parentPath, name, title, description = '', fields = [], dryRun = false } = params;
    if (!parentPath || !name || !title) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'createContentFragmentModel requires parentPath, name, and title');
    }

    if (dryRun) {
      const validTypes = ['single-line-text', 'multi-line-text', 'number', 'boolean', 'date-time', 'enumeration', 'content-reference', 'fragment-reference', 'json'];
      const invalid = fields.filter(f => !validTypes.includes(f.type));
      if (invalid.length > 0) {
        return createSuccessResponse({
          dryRun: true,
          valid: false,
          errors: invalid.map(f => `Field "${f.name}" has unsupported type "${f.type}"`),
        }, 'createContentFragmentModel');
      }
      const missingNames = fields.filter(f => !f.name);
      if (missingNames.length > 0) {
        return createSuccessResponse({
          dryRun: true,
          valid: false,
          errors: ['One or more fields are missing a "name" property'],
        }, 'createContentFragmentModel');
      }
      return createSuccessResponse({
        dryRun: true,
        valid: true,
        wouldCreate: `${parentPath}/${name}`,
        fieldCount: fields.length,
      }, 'createContentFragmentModel');
    }

    return safeExecute<object>(async () => {
      const modelPath = `${parentPath}/${name}`;
      if (this.isAEMaaCS) {
        const body: any = {
          parentPath,
          name,
          title,
          description,
          fields: fields.map(f => this.serializeFieldForCloud(f)),
        };
        const result = await this.fetch.post('/adobe/sites/cfm/models', body);
        return createSuccessResponse({
          action: 'create',
          path: result.path || modelPath,
          title,
          fieldCount: fields.length,
        }, 'createContentFragmentModel');
      } else {
        const formData = new URLSearchParams();
        formData.append('jcr:primaryType', 'nt:folder');
        formData.append('jcr:content/jcr:primaryType', 'dam:cfm/Model');
        formData.append('jcr:content/jcr:title', title);
        if (description) formData.append('jcr:content/jcr:description', description);
        formData.append('jcr:content/modelEnabled', 'true');
        fields.forEach((f, idx) => {
          const fieldPrefix = `jcr:content/model/jcr:content/items/field_${idx}`;
          formData.append(`${fieldPrefix}/jcr:primaryType`, 'nt:unstructured');
          formData.append(`${fieldPrefix}/sling:resourceType`, this.getFieldResourceType65(f.type));
          formData.append(`${fieldPrefix}/name`, f.name);
          formData.append(`${fieldPrefix}/fieldLabel`, f.label || f.name);
          if (f.required) formData.append(`${fieldPrefix}/required`, 'true');
          if (f.multiValue) formData.append(`${fieldPrefix}/multiple`, 'true');
          if (f.maxLength !== undefined) formData.append(`${fieldPrefix}/maxLength`, String(f.maxLength));
          if (f.options) formData.append(`${fieldPrefix}/options`, f.options.join(','));
        });
        await this.fetch.post(modelPath, formData);
        return createSuccessResponse({
          action: 'create',
          path: modelPath,
          title,
          fieldCount: fields.length,
        }, 'createContentFragmentModel');
      }
    }, 'createContentFragmentModel');
  }

  private serializeFieldForCloud(f: CFModelFieldDef): Record<string, any> {
    const field: Record<string, any> = {
      name: f.name,
      fieldType: f.type,
      label: f.label || f.name,
      required: f.required || false,
      multi: f.multiValue || false,
    };
    if (f.maxLength !== undefined) field.maxLength = f.maxLength;
    if (f.minLength !== undefined) field.minLength = f.minLength;
    if (f.minimum !== undefined) field.minimum = f.minimum;
    if (f.maximum !== undefined) field.maximum = f.maximum;
    if (f.options) field.options = f.options;
    return field;
  }

  private getFieldResourceType65(type: string): string {
    const map: Record<string, string> = {
      'single-line-text': 'dam/cfm/models/editor/components/datatypes/singlelinetext',
      'multi-line-text': 'dam/cfm/models/editor/components/datatypes/multilinetext',
      'number': 'dam/cfm/models/editor/components/datatypes/number',
      'boolean': 'dam/cfm/models/editor/components/datatypes/boolean',
      'date-time': 'dam/cfm/models/editor/components/datatypes/calendar',
      'enumeration': 'dam/cfm/models/editor/components/datatypes/enumeration',
      'content-reference': 'dam/cfm/models/editor/components/datatypes/contentreference',
      'fragment-reference': 'dam/cfm/models/editor/components/datatypes/fragmentreference',
      'json': 'dam/cfm/models/editor/components/datatypes/json',
    };
    return map[type] || 'dam/cfm/models/editor/components/datatypes/singlelinetext';
  }

  async updateContentFragmentModel(params: {
    modelPath: string;
    title?: string;
    description?: string;
    addFields?: CFModelFieldDef[];
    removeFields?: string[];
    updateFields?: CFModelFieldDef[];
  }): Promise<object> {
    const { modelPath, title, description, addFields = [], removeFields = [], updateFields = [] } = params;
    if (!modelPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'updateContentFragmentModel requires modelPath');
    }
    if (!title && !description && addFields.length === 0 && removeFields.length === 0 && updateFields.length === 0) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'updateContentFragmentModel requires at least one of: title, description, addFields, removeFields, updateFields');
    }

    return safeExecute<object>(async () => {
      if (this.isAEMaaCS) {
        const body: any = {};
        if (title) body.title = title;
        if (description !== undefined) body.description = description;
        if (addFields.length) body.addFields = addFields.map(f => this.serializeFieldForCloud(f));
        if (removeFields.length) body.removeFields = removeFields;
        if (updateFields.length) body.updateFields = updateFields.map(f => this.serializeFieldForCloud(f));
        await this.fetch.put(`/adobe/sites/cfm/models?path=${encodeURIComponent(modelPath)}`, body);
        return createSuccessResponse({
          action: 'update',
          modelPath,
          addedFields: addFields.length,
          removedFields: removeFields.length,
          updatedFields: updateFields.length,
        }, 'updateContentFragmentModel');
      } else {
        const formData = new URLSearchParams();
        if (title) formData.append('jcr:content/jcr:title', title);
        if (description !== undefined) formData.append('jcr:content/jcr:description', description);
        removeFields.forEach(fieldName => {
          formData.append(`jcr:content/model/jcr:content/items/${fieldName}@Delete`, 'true');
        });
        addFields.forEach((f, idx) => {
          const fieldPrefix = `jcr:content/model/jcr:content/items/field_add_${idx}`;
          formData.append(`${fieldPrefix}/jcr:primaryType`, 'nt:unstructured');
          formData.append(`${fieldPrefix}/sling:resourceType`, this.getFieldResourceType65(f.type));
          formData.append(`${fieldPrefix}/name`, f.name);
          formData.append(`${fieldPrefix}/fieldLabel`, f.label || f.name);
          if (f.required) formData.append(`${fieldPrefix}/required`, 'true');
          if (f.multiValue) formData.append(`${fieldPrefix}/multiple`, 'true');
          if (f.maxLength !== undefined) formData.append(`${fieldPrefix}/maxLength`, String(f.maxLength));
          if (f.options) formData.append(`${fieldPrefix}/options`, f.options.join(','));
        });
        updateFields.forEach(f => {
          const fieldPrefix = `jcr:content/model/jcr:content/items/${f.name}`;
          if (f.label) formData.append(`${fieldPrefix}/fieldLabel`, f.label);
          if (f.required !== undefined) formData.append(`${fieldPrefix}/required`, String(f.required));
          if (f.multiValue !== undefined) formData.append(`${fieldPrefix}/multiple`, String(f.multiValue));
          if (f.maxLength !== undefined) formData.append(`${fieldPrefix}/maxLength`, String(f.maxLength));
        });
        await this.fetch.post(modelPath, formData);
        return createSuccessResponse({
          action: 'update',
          modelPath,
          addedFields: addFields.length,
          removedFields: removeFields.length,
          updatedFields: updateFields.length,
        }, 'updateContentFragmentModel');
      }
    }, 'updateContentFragmentModel');
  }

  async deleteContentFragmentModel(params: {
    modelPath: string;
    force?: boolean;
  }): Promise<object> {
    const { modelPath, force = false } = params;
    if (!modelPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'deleteContentFragmentModel requires modelPath');
    }

    return safeExecute<object>(async () => {
      if (!force && !this.isAEMaaCS) {
        const checkParams: Record<string, any> = {
          type: 'dam:Asset',
          'property': 'jcr:content/data/cq:model',
          'property.value': modelPath,
          'p.limit': 1,
          'p.hits': 'selective',
          'p.properties': 'jcr:path',
        };
        const check = await this.fetch.get('/bin/querybuilder.json', checkParams);
        const hitCount = check.total || (check.hits || []).length;
        if (hitCount > 0) {
          throw createAEMError(
            AEM_ERROR_CODES.VALIDATION_FAILED,
            `Model "${modelPath}" is used by ${hitCount} fragment(s). Pass force=true to delete anyway.`,
            { modelPath, fragmentCount: hitCount }
          );
        }
      }

      if (this.isAEMaaCS) {
        const url = `/adobe/sites/cfm/models?path=${encodeURIComponent(modelPath)}${force ? '&force=true' : ''}`;
        await this.fetch.delete(url);
      } else {
        const formData = new URLSearchParams();
        formData.append(':operation', 'delete');
        await this.fetch.post(modelPath, formData);
      }
      return createSuccessResponse({ action: 'delete', modelPath, force }, 'deleteContentFragmentModel');
    }, 'deleteContentFragmentModel');
  }

  async batchManageContentFragmentModels(params: {
    operations: Array<{
      action: 'copy' | 'delete' | 'patch';
      modelPath: string;
      targetPath?: string;
      patch?: {
        title?: string;
        description?: string;
        addFields?: CFModelFieldDef[];
        removeFields?: string[];
      };
    }>;
    continueOnError?: boolean;
    validateFirst?: boolean;
  }): Promise<object> {
    const { operations, continueOnError = true, validateFirst = false } = params;
    if (!operations || operations.length === 0) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'batchManageContentFragmentModels requires a non-empty operations array');
    }

    return safeExecute<object>(async () => {
      if (validateFirst) {
        const validationErrors: string[] = [];
        operations.forEach((op, idx) => {
          if (!op.modelPath) validationErrors.push(`operations[${idx}]: modelPath is required`);
          if (op.action === 'copy' && !op.targetPath) validationErrors.push(`operations[${idx}]: copy action requires targetPath`);
          if (!['copy', 'delete', 'patch'].includes(op.action)) validationErrors.push(`operations[${idx}]: unknown action "${op.action}"`);
        });
        if (validationErrors.length > 0) {
          return createSuccessResponse({
            validateFirst: true,
            valid: false,
            errors: validationErrors,
          }, 'batchManageContentFragmentModels');
        }
      }

      const results: Array<{ modelPath: string; action: string; success: boolean; error?: string; result?: any }> = [];

      for (const op of operations) {
        try {
          let result: any;
          if (op.action === 'delete') {
            result = await this.deleteContentFragmentModel({ modelPath: op.modelPath });
          } else if (op.action === 'patch') {
            result = await this.updateContentFragmentModel({
              modelPath: op.modelPath,
              title: op.patch?.title,
              description: op.patch?.description,
              addFields: op.patch?.addFields || [],
              removeFields: op.patch?.removeFields || [],
              updateFields: [],
            });
          } else if (op.action === 'copy') {
            const schema: any = await this.getContentFragmentModelSchema({ modelPath: op.modelPath });
            const targetName = op.targetPath!.split('/').pop() || 'copy';
            const targetParent = op.targetPath!.split('/').slice(0, -1).join('/');
            result = await this.createContentFragmentModel({
              parentPath: targetParent,
              name: targetName,
              title: (schema.data?.title || targetName) + ' (copy)',
              description: schema.data?.description || '',
              fields: (schema.data?.fields || []).map((f: any) => ({
                name: f.name,
                type: f.type,
                label: f.label,
                required: f.required,
                multiValue: f.multiValue,
                ...(f.constraints || {}),
              })),
            });
          }
          results.push({ modelPath: op.modelPath, action: op.action, success: true, result });
        } catch (err: any) {
          results.push({ modelPath: op.modelPath, action: op.action, success: false, error: err.message });
          if (!continueOnError) break;
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      return createSuccessResponse({
        total: operations.length,
        succeeded,
        failed,
        results,
      }, 'batchManageContentFragmentModels');
    }, 'batchManageContentFragmentModels');
  }

  async listContentFragmentTemplates(params: {
    modelPath: string;
  }): Promise<object> {
    const { modelPath } = params;
    if (!modelPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'listContentFragmentTemplates requires modelPath');
    }

    return safeExecute<object>(async () => {
      const templatesPath = `${modelPath}/templates`;
      const result = await this.fetch.get(`${templatesPath}.2.json`);
      const templates: any[] = [];
      for (const [key, value] of Object.entries(result)) {
        if (key.startsWith('jcr:') || key.startsWith(':')) continue;
        const t = value as any;
        if (typeof t === 'object' && t !== null) {
          templates.push({
            name: key,
            title: t['jcr:title'] || t['jcr:content']?.['jcr:title'] || key,
            description: t['jcr:description'] || t['jcr:content']?.['jcr:description'] || '',
            path: `${templatesPath}/${key}`,
          });
        }
      }
      return createSuccessResponse({
        modelPath,
        templates,
        totalCount: templates.length,
      }, 'listContentFragmentTemplates');
    }, 'listContentFragmentTemplates');
  }

  async graphqlIntrospection(params: {
    endpoint?: string;
  }): Promise<object> {
    const { endpoint = '/content/graphql/global/endpoint.gql' } = params;

    return safeExecute<object>(async () => {
      const introspectionQuery = `{
  __schema {
    queryType { name }
    types {
      name
      kind
      description
      fields(includeDeprecated: false) {
        name
        type { name kind ofType { name kind } }
      }
    }
  }
}`;
      const result = await this.fetch.post(endpoint, { query: introspectionQuery }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      const schema = result?.data?.__schema;
      if (!schema) {
        return createSuccessResponse({
          endpoint,
          rawResponse: result,
          note: 'AEM GraphQL endpoint returned an unexpected shape. Check that the endpoint URL is correct and GraphQL is enabled on this instance.',
        }, 'graphqlIntrospection');
      }
      const contentTypes = (schema.types || [])
        .filter((t: any) => !t.name.startsWith('__') && t.kind !== 'SCALAR' && t.kind !== 'BUILT_IN')
        .map((t: any) => ({
          name: t.name,
          kind: t.kind,
          description: t.description || '',
          fields: (t.fields || []).map((f: any) => ({
            name: f.name,
            type: f.type?.name || f.type?.ofType?.name || f.type?.kind || 'unknown',
          })),
        }));
      return createSuccessResponse({
        endpoint,
        queryType: schema.queryType?.name,
        contentTypes,
        totalTypes: contentTypes.length,
      }, 'graphqlIntrospection');
    }, 'graphqlIntrospection');
  }
}
