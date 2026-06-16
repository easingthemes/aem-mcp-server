# CF Models API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new MCP tools that let AI agents discover, inspect, create, update, delete, and batch-manage AEM Content Fragment Models, plus GraphQL schema introspection.

**Architecture:** A new `ContentFragmentModelManager` class in `src/aem/aem.cf-models.ts` handles all AEM API calls using the existing `AEMFetch` wrapper, routing between AEM 6.5 (QueryBuilder + JCR Sling POST) and AEMaaCS (CF Admin API) via the `isAEMaaCS` flag — identical pattern to `ContentFragmentManager` in `aem.content-fragments.ts`. The manager is wired into `AEMConnector` as a new `cfModels` property, thin delegate methods added to the connector, 8 Zod schemas added to a new `contentFragmentModelSchemas` group in `mcp.tools.ts`, and 8 cases added to the switch in `mcp.aem-handler.ts`.

**Tech Stack:** TypeScript ESM, `zod@3.24.4` (pinned — do NOT upgrade), `zod-to-json-schema`, native `fetch` via `AEMFetch`.

## Global Constraints

- Zod pinned at `3.24.4` — do NOT change `package.json` zod dependency
- All imports must use `.js` extensions (ESM project, `"type": "module"` in package.json)
- All `z.object()` schemas must call `.passthrough()` to allow extra properties through Zod validation
- AEM 6.5 vs AEMaaCS routing: check `this.isAEMaaCS` — `true` means AEMaaCS (OAuth S2S), `false` means AEM 6.5 (Basic auth)
- No test framework is configured — "tests" in this plan are manual curl/build verification steps
- Build command: `npm run build` (full) or `npm run build:ts` (esbuild-only, faster)
- `createSuccessResponse` and `safeExecute` from `aem.errors.ts` must wrap every public method
- `AEM_ERROR_CODES.INVALID_PARAMETERS` for validation errors, `AEM_ERROR_CODES.RESOURCE_NOT_FOUND` for 404s

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/aem/aem.cf-models.ts` | **Create** | `ContentFragmentModelManager` — all 8 tool implementations |
| `src/aem/aem.connector.ts` | **Modify** | Import `ContentFragmentModelManager`, add `cfModels` property, add 8 delegate methods |
| `src/mcp/mcp.tools.ts` | **Modify** | Add `contentFragmentModelSchemas` group, add 8 entries to `toolSchemas`, `toolDescriptions`, `toolAnnotations` |
| `src/mcp/mcp.aem-handler.ts` | **Modify** | Add 8 `case` blocks to the switch statement |

---

### Task 1: Scaffold `aem.cf-models.ts` — class skeleton + `listContentFragmentModels`

**Files:**
- Create: `src/aem/aem.cf-models.ts`

**Interfaces:**
- Produces: `ContentFragmentModelManager` class exported as named export; constructor takes `(fetch: AEMFetch, isAEMaaCS: boolean)`; public method `listContentFragmentModels(params: { path?: string; name?: string; status?: string; limit?: number }): Promise<object>`

- [ ] **Step 1: Create the file with the class skeleton**

Create `src/aem/aem.cf-models.ts` with this exact content:

```typescript
import { AEMFetch } from './aem.fetch.js';
import { createSuccessResponse, safeExecute, createAEMError, AEM_ERROR_CODES } from './aem.errors.js';

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
        // AEMaaCS: CF Admin Models API
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
        // AEM 6.5: QueryBuilder — type=dam:cfm/Model under /conf
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
}
```

- [ ] **Step 2: Verify the file builds**

Run: `npm run build:ts`
Expected: Exit 0, no TypeScript or esbuild errors.

- [ ] **Step 3: Commit the skeleton**

```bash
git add src/aem/aem.cf-models.ts
git commit -m "feat(cf-models): scaffold ContentFragmentModelManager with listContentFragmentModels"
```

---

### Task 2: Add `getContentFragmentModelSchema`

**Files:**
- Modify: `src/aem/aem.cf-models.ts`

**Interfaces:**
- Consumes: `ContentFragmentModelManager` class from Task 1
- Produces: public method `getContentFragmentModelSchema(params: { modelPath: string }): Promise<object>` — returns `{ modelPath, title, fields: Array<{ name, type, required, multiValue, constraints }> }`

- [ ] **Step 1: Add the method to `ContentFragmentModelManager`**

In `src/aem/aem.cf-models.ts`, add the following method inside the class body, after `listContentFragmentModels`:

```typescript
  async getContentFragmentModelSchema(params: {
    modelPath: string;
  }): Promise<object> {
    const { modelPath } = params;
    if (!modelPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'getContentFragmentModelSchema requires modelPath');
    }
    return safeExecute<object>(async () => {
      if (this.isAEMaaCS) {
        // AEMaaCS: GET /adobe/sites/cfm/models?path=<modelPath>
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
        // AEM 6.5: GET <modelPath>.infinity.json then traverse field nodes
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
    // Walk the cq:dialog tree for field definitions with cfm datatype resource types
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
```

- [ ] **Step 2: Verify the file builds**

Run: `npm run build:ts`
Expected: Exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/aem/aem.cf-models.ts
git commit -m "feat(cf-models): add getContentFragmentModelSchema with AEM 6.5 + AEMaaCS routing"
```

---

### Task 3: Add `createContentFragmentModel`

**Files:**
- Modify: `src/aem/aem.cf-models.ts`

**Interfaces:**
- Consumes: `ContentFragmentModelManager` with methods from Tasks 1–2
- Produces: exported `CFModelFieldDef` interface; public method `createContentFragmentModel(params: { parentPath: string; name: string; title: string; description?: string; fields?: CFModelFieldDef[]; dryRun?: boolean }): Promise<object>`

- [ ] **Step 1: Add the `CFModelFieldDef` interface and `createContentFragmentModel` method**

In `src/aem/aem.cf-models.ts`, add the interface at the top of the file (after the imports, before the class):

```typescript
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
```

Add inside the class after `extractFieldsFrom65Model`:

```typescript
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

    // Dry-run: validate field definitions without hitting AEM
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
        // AEMaaCS: POST /adobe/sites/cfm/models
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
        // AEM 6.5: Create model node via Sling POST
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
```

- [ ] **Step 2: Verify the file builds**

Run: `npm run build:ts`
Expected: Exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/aem/aem.cf-models.ts
git commit -m "feat(cf-models): add createContentFragmentModel with dry-run validation"
```

---

### Task 4: Add `updateContentFragmentModel`

**Files:**
- Modify: `src/aem/aem.cf-models.ts`

**Interfaces:**
- Consumes: `CFModelFieldDef` interface from Task 3, `serializeFieldForCloud` and `getFieldResourceType65` private methods from Task 3
- Produces: public method `updateContentFragmentModel(params: { modelPath: string; title?: string; description?: string; addFields?: CFModelFieldDef[]; removeFields?: string[]; updateFields?: CFModelFieldDef[] }): Promise<object>`

- [ ] **Step 1: Add the method inside the class**

In `src/aem/aem.cf-models.ts`, add after `createContentFragmentModel`:

```typescript
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
        // AEMaaCS: PUT /adobe/sites/cfm/models?path=<modelPath>
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
        // AEM 6.5: Sling POST to the model node
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
```

- [ ] **Step 2: Verify the file builds**

Run: `npm run build:ts`
Expected: Exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/aem/aem.cf-models.ts
git commit -m "feat(cf-models): add updateContentFragmentModel (add/remove/update fields)"
```

---

### Task 5: Add `deleteContentFragmentModel` and `batchManageContentFragmentModels`

**Files:**
- Modify: `src/aem/aem.cf-models.ts`

**Interfaces:**
- Consumes: `CFModelFieldDef` from Task 3, `updateContentFragmentModel` from Task 4, `createContentFragmentModel` from Task 3, `getContentFragmentModelSchema` from Task 2
- Produces:
  - `deleteContentFragmentModel(params: { modelPath: string; force?: boolean }): Promise<object>`
  - `batchManageContentFragmentModels(params: { operations: Array<{ action: 'copy'|'delete'|'patch'; modelPath: string; targetPath?: string; patch?: { title?: string; description?: string; addFields?: CFModelFieldDef[]; removeFields?: string[] } }>; continueOnError?: boolean; validateFirst?: boolean }): Promise<object>`

- [ ] **Step 1: Add `deleteContentFragmentModel`**

In `src/aem/aem.cf-models.ts`, add after `updateContentFragmentModel`:

```typescript
  async deleteContentFragmentModel(params: {
    modelPath: string;
    force?: boolean;
  }): Promise<object> {
    const { modelPath, force = false } = params;
    if (!modelPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'deleteContentFragmentModel requires modelPath');
    }

    return safeExecute<object>(async () => {
      // Guard: check if any fragments use this model before deleting
      if (!force) {
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
```

- [ ] **Step 2: Add `batchManageContentFragmentModels`**

In `src/aem/aem.cf-models.ts`, add after `deleteContentFragmentModel`:

```typescript
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
              fields: schema.data?.fields || [],
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
```

- [ ] **Step 3: Verify the file builds**

Run: `npm run build:ts`
Expected: Exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/aem/aem.cf-models.ts
git commit -m "feat(cf-models): add deleteContentFragmentModel (guard + force) and batchManageContentFragmentModels"
```

---

### Task 6: Add `listContentFragmentTemplates` and `graphqlIntrospection`

**Files:**
- Modify: `src/aem/aem.cf-models.ts`

**Interfaces:**
- Consumes: `ContentFragmentModelManager` with all prior methods
- Produces:
  - `listContentFragmentTemplates(params: { modelPath: string }): Promise<object>`
  - `graphqlIntrospection(params: { endpoint?: string }): Promise<object>`

- [ ] **Step 1: Add `listContentFragmentTemplates`**

In `src/aem/aem.cf-models.ts`, add after `batchManageContentFragmentModels`:

```typescript
  async listContentFragmentTemplates(params: {
    modelPath: string;
  }): Promise<object> {
    const { modelPath } = params;
    if (!modelPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'listContentFragmentTemplates requires modelPath');
    }

    return safeExecute<object>(async () => {
      // Templates live under <modelPath>/templates/ on both AEM 6.5 and AEMaaCS
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
```

- [ ] **Step 2: Add `graphqlIntrospection`**

In `src/aem/aem.cf-models.ts`, add after `listContentFragmentTemplates`:

```typescript
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
        'Content-Type': 'application/json',
        'Accept': 'application/json',
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
```

- [ ] **Step 3: Verify the file builds**

Run: `npm run build:ts`
Expected: Exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/aem/aem.cf-models.ts
git commit -m "feat(cf-models): add listContentFragmentTemplates and graphqlIntrospection"
```

---

### Task 7: Wire `ContentFragmentModelManager` into `AEMConnector`

**Files:**
- Modify: `src/aem/aem.connector.ts`

**Interfaces:**
- Consumes: `ContentFragmentModelManager` class from `src/aem/aem.cf-models.ts` (Tasks 1–6)
- Produces: `AEMConnector` gains a `cfModels: ContentFragmentModelManager` readonly property and 8 public delegate methods:
  - `listContentFragmentModels(params: any): Promise<object>`
  - `getContentFragmentModelSchema(params: any): Promise<object>`
  - `createContentFragmentModel(params: any): Promise<object>`
  - `updateContentFragmentModel(params: any): Promise<object>`
  - `deleteContentFragmentModel(params: any): Promise<object>`
  - `batchManageContentFragmentModels(params: any): Promise<object>`
  - `listContentFragmentTemplates(params: any): Promise<object>`
  - `graphqlIntrospection(params: any): Promise<object>`

- [ ] **Step 1: Add the import at the top of `aem.connector.ts`**

In `src/aem/aem.connector.ts`, find:
```typescript
import { ContentFragmentManager } from './aem.content-fragments.js';
```

Add directly after it:
```typescript
import { ContentFragmentModelManager } from './aem.cf-models.js';
```

- [ ] **Step 2: Add the `cfModels` property declaration**

Find in the class body:
```typescript
  readonly contentFragments: ContentFragmentManager;
  readonly experienceFragments: ExperienceFragmentManager;
```

Change to:
```typescript
  readonly contentFragments: ContentFragmentManager;
  readonly cfModels: ContentFragmentModelManager;
  readonly experienceFragments: ExperienceFragmentManager;
```

- [ ] **Step 3: Initialize `cfModels` in the constructor**

Find:
```typescript
    this.contentFragments = new ContentFragmentManager(this.fetch, this.isAEMaaCS);
```

Add directly after it:
```typescript
    this.cfModels = new ContentFragmentModelManager(this.fetch, this.isAEMaaCS);
```

- [ ] **Step 4: Add 8 delegate methods**

Find the section comment:
```typescript
  // ─── Content Fragments (delegated) ───────────────────
```

Add a new section directly before it:
```typescript
  // ─── CF Models (delegated) ───────────────────────────
  async listContentFragmentModels(params: any): Promise<object> {
    return this.cfModels.listContentFragmentModels(params);
  }
  async getContentFragmentModelSchema(params: any): Promise<object> {
    return this.cfModels.getContentFragmentModelSchema(params);
  }
  async createContentFragmentModel(params: any): Promise<object> {
    return this.cfModels.createContentFragmentModel(params);
  }
  async updateContentFragmentModel(params: any): Promise<object> {
    return this.cfModels.updateContentFragmentModel(params);
  }
  async deleteContentFragmentModel(params: any): Promise<object> {
    return this.cfModels.deleteContentFragmentModel(params);
  }
  async batchManageContentFragmentModels(params: any): Promise<object> {
    return this.cfModels.batchManageContentFragmentModels(params);
  }
  async listContentFragmentTemplates(params: any): Promise<object> {
    return this.cfModels.listContentFragmentTemplates(params);
  }
  async graphqlIntrospection(params: any): Promise<object> {
    return this.cfModels.graphqlIntrospection(params);
  }

```

- [ ] **Step 5: Verify the full build**

Run: `npm run build`
Expected: Exit 0, no TypeScript errors and no esbuild errors.

- [ ] **Step 6: Commit**

```bash
git add src/aem/aem.connector.ts
git commit -m "feat(cf-models): wire ContentFragmentModelManager into AEMConnector"
```

---

### Task 8: Add Zod schemas + descriptions + annotations to `mcp.tools.ts`

**Files:**
- Modify: `src/mcp/mcp.tools.ts`

**Interfaces:**
- Consumes: none (pure schema definitions)
- Produces: 8 new entries exported as part of `toolSchemas`, `toolDescriptions`, `toolAnnotations`; all 8 tool names added to the `ToolName` union type automatically

- [ ] **Step 1: Add the `contentFragmentModelSchemas` group**

In `src/mcp/mcp.tools.ts`, find the comment line:
```typescript
// ─── Content Fragments ────────────────────────────────
```

Insert the following new block directly **before** that comment:

```typescript
// ─── CF Models ────────────────────────────────────────
const contentFragmentModelSchemas = {
  listContentFragmentModels: z.object({
    path: z.string().optional().describe('Root configuration path to search under (default: /conf)'),
    name: z.string().optional().describe('Filter by model title/name (substring match)'),
    status: z.enum(['enabled', 'disabled']).optional().describe('Filter by model status'),
    limit: z.number().optional().describe('Max results (default: 50)'),
  }).passthrough(),
  getContentFragmentModelSchema: z.object({
    modelPath: z.string().describe('Full JCR path to the CF model (e.g., /conf/mysite/settings/dam/cfm/models/article)'),
  }).passthrough(),
  createContentFragmentModel: z.object({
    parentPath: z.string().describe('Parent path where the model will be created (e.g., /conf/mysite/settings/dam/cfm/models)'),
    name: z.string().describe('Node name for the model (lowercase, hyphens allowed)'),
    title: z.string().describe('Human-readable model title'),
    description: z.string().optional().describe('Model description'),
    fields: z.array(z.object({
      name: z.string(),
      type: z.enum(['single-line-text', 'multi-line-text', 'number', 'boolean', 'date-time', 'enumeration', 'content-reference', 'fragment-reference', 'json']),
      label: z.string().optional(),
      required: z.boolean().optional(),
      multiValue: z.boolean().optional(),
      options: z.array(z.string()).optional(),
      maxLength: z.number().optional(),
      minLength: z.number().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
    }).passthrough()).optional().describe('Field definitions for the model'),
    dryRun: z.boolean().optional().describe('Validate without creating (default: false)'),
  }).passthrough(),
  updateContentFragmentModel: z.object({
    modelPath: z.string().describe('Full JCR path to the CF model to update'),
    title: z.string().optional().describe('New title for the model'),
    description: z.string().optional().describe('New description'),
    addFields: z.array(z.object({
      name: z.string(),
      type: z.enum(['single-line-text', 'multi-line-text', 'number', 'boolean', 'date-time', 'enumeration', 'content-reference', 'fragment-reference', 'json']),
      label: z.string().optional(),
      required: z.boolean().optional(),
      multiValue: z.boolean().optional(),
      options: z.array(z.string()).optional(),
      maxLength: z.number().optional(),
    }).passthrough()).optional().describe('New fields to add to the model'),
    removeFields: z.array(z.string()).optional().describe('Field names to remove'),
    updateFields: z.array(z.object({
      name: z.string(),
      type: z.enum(['single-line-text', 'multi-line-text', 'number', 'boolean', 'date-time', 'enumeration', 'content-reference', 'fragment-reference', 'json']),
      label: z.string().optional(),
      required: z.boolean().optional(),
      multiValue: z.boolean().optional(),
      maxLength: z.number().optional(),
    }).passthrough()).optional().describe('Existing fields to modify'),
  }).passthrough(),
  deleteContentFragmentModel: z.object({
    modelPath: z.string().describe('Full JCR path to the CF model to delete'),
    force: z.boolean().optional().describe('Delete even if fragments still use this model (default: false)'),
  }).passthrough(),
  batchManageContentFragmentModels: z.object({
    operations: z.array(z.object({
      action: z.enum(['copy', 'delete', 'patch']),
      modelPath: z.string().describe('Source model path'),
      targetPath: z.string().optional().describe('Target path (required for copy)'),
      patch: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        addFields: z.array(z.object({
          name: z.string(),
          type: z.enum(['single-line-text', 'multi-line-text', 'number', 'boolean', 'date-time', 'enumeration', 'content-reference', 'fragment-reference', 'json']),
        }).passthrough()).optional(),
        removeFields: z.array(z.string()).optional(),
      }).passthrough().optional().describe('Patch payload (required for patch action)'),
    }).passthrough()).describe('List of model operations to execute'),
    continueOnError: z.boolean().optional().describe('Continue processing if one operation fails (default: true)'),
    validateFirst: z.boolean().optional().describe('Validate all operations before executing any (default: false)'),
  }).passthrough(),
  listContentFragmentTemplates: z.object({
    modelPath: z.string().describe('Full JCR path to the CF model whose templates to list'),
  }).passthrough(),
  graphqlIntrospection: z.object({
    endpoint: z.string().optional().describe('GraphQL endpoint path (default: /content/graphql/global/endpoint.gql)'),
  }).passthrough(),
};

```

- [ ] **Step 2: Add `contentFragmentModelSchemas` to the `toolSchemas` spread**

Find:
```typescript
export const toolSchemas = {
  ...contentSchemas,
  ...siteSchemas,
  ...pageSchemas,
  ...componentSchemas,
  ...assetSchemas,
  ...searchSchemas,
  ...templateSchemas,
  ...workflowSchemas,
  ...contentFragmentSchemas,
  ...experienceFragmentSchemas,
} as const;
```

Change to:
```typescript
export const toolSchemas = {
  ...contentSchemas,
  ...siteSchemas,
  ...pageSchemas,
  ...componentSchemas,
  ...assetSchemas,
  ...searchSchemas,
  ...templateSchemas,
  ...workflowSchemas,
  ...contentFragmentSchemas,
  ...contentFragmentModelSchemas,
  ...experienceFragmentSchemas,
} as const;
```

- [ ] **Step 3: Add 8 entries to `toolDescriptions`**

In `src/mcp/mcp.tools.ts`, find the entry for `manageContentFragmentVariation` in `toolDescriptions`:
```typescript
  manageContentFragmentVariation: 'Create, update, or delete a variation within a content fragment',
```

Add directly after it:
```typescript
  listContentFragmentModels: 'List all CF models under a configuration path. Filter by name substring, status (enabled/disabled), or folder. Returns model path, title, field count, and last modified date.',
  getContentFragmentModelSchema: 'Get the full field schema for a CF model — field names, types (single-line-text, multi-line-text, number, boolean, date-time, enumeration, content-reference, fragment-reference, json), required flag, multi-value flag, and constraints. Use this before creating fragments to discover required fields.',
  createContentFragmentModel: 'Create a new CF model with field definitions. Use dryRun=true to validate field types and names without persisting. Supports all AEM field types.',
  updateContentFragmentModel: 'Add, remove, or modify fields on an existing CF model. Use addFields to append new fields, removeFields with field names to drop, updateFields to modify existing field properties.',
  deleteContentFragmentModel: 'Delete a CF model. Blocked if any fragments still reference the model unless force=true is passed.',
  batchManageContentFragmentModels: 'Copy, patch, or delete multiple CF models in one call. Use continueOnError=true (default) to process all even if some fail. Use validateFirst=true to check all operations before executing any.',
  listContentFragmentTemplates: 'List all templates defined under a CF model path.',
  graphqlIntrospection: 'Execute a GraphQL __schema introspection query against the AEM GraphQL endpoint. Returns all content types, available query fields, and field types. Useful for discovering fragment models exposed via headless GraphQL.',
```

- [ ] **Step 4: Add 8 entries to `toolAnnotations`**

In `src/mcp/mcp.tools.ts`, find:
```typescript
  manageContentFragmentVariation: { group: 'fragments-content', readOnly: false, complexity: 'medium' },
```

Add directly after it:
```typescript
  // CF Models
  listContentFragmentModels: { group: 'fragments-models', readOnly: true, complexity: 'low' },
  getContentFragmentModelSchema: { group: 'fragments-models', readOnly: true, complexity: 'low' },
  createContentFragmentModel: { group: 'fragments-models', readOnly: false, complexity: 'high' },
  updateContentFragmentModel: { group: 'fragments-models', readOnly: false, complexity: 'high' },
  deleteContentFragmentModel: { group: 'fragments-models', readOnly: false, complexity: 'high' },
  batchManageContentFragmentModels: { group: 'fragments-models', readOnly: false, complexity: 'high' },
  listContentFragmentTemplates: { group: 'fragments-models', readOnly: true, complexity: 'low' },
  graphqlIntrospection: { group: 'fragments-models', readOnly: true, complexity: 'medium' },
```

- [ ] **Step 5: Verify the full build**

Run: `npm run build`
Expected: Exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp.tools.ts
git commit -m "feat(cf-models): add 8 Zod schemas, descriptions, and annotations to mcp.tools.ts"
```

---

### Task 9: Add 8 handler cases to `mcp.aem-handler.ts`

**Files:**
- Modify: `src/mcp/mcp.aem-handler.ts`

**Interfaces:**
- Consumes: `AEMConnector` methods from Task 7 (`listContentFragmentModels`, `getContentFragmentModelSchema`, `createContentFragmentModel`, `updateContentFragmentModel`, `deleteContentFragmentModel`, `batchManageContentFragmentModels`, `listContentFragmentTemplates`, `graphqlIntrospection`); tool names from Task 8

- [ ] **Step 1: Add 8 case blocks to the switch statement**

In `src/mcp/mcp.aem-handler.ts`, find:
```typescript
        case 'getContentFragment':
          return await this.aemConnector.getContentFragment(params.path);
```

Add the following 8 cases directly **before** that block:
```typescript
        case 'listContentFragmentModels':
          return await this.aemConnector.listContentFragmentModels(params);
        case 'getContentFragmentModelSchema':
          return await this.aemConnector.getContentFragmentModelSchema(params);
        case 'createContentFragmentModel':
          return await this.aemConnector.createContentFragmentModel(params);
        case 'updateContentFragmentModel':
          return await this.aemConnector.updateContentFragmentModel(params);
        case 'deleteContentFragmentModel':
          return await this.aemConnector.deleteContentFragmentModel(params);
        case 'batchManageContentFragmentModels':
          return await this.aemConnector.batchManageContentFragmentModels(params);
        case 'listContentFragmentTemplates':
          return await this.aemConnector.listContentFragmentTemplates(params);
        case 'graphqlIntrospection':
          return await this.aemConnector.graphqlIntrospection(params);
```

- [ ] **Step 2: Verify the full build**

Run: `npm run build`
Expected: Exit 0.

- [ ] **Step 3: Verify tool count increased by 8**

Run:
```bash
node -e "import('./dist/mcp/mcp.tools.js').then(m => console.log('Tool count:', Object.keys(m.toolSchemas).length))"
```
Expected: Previous tool count (57) + 8 = 65.

- [ ] **Step 4: Verify the 8 new tool names appear**

Run:
```bash
node -e "import('./dist/mcp/mcp.tools.js').then(m => console.log(Object.keys(m.toolSchemas).filter(k => k.includes('ContentFragmentModel') || k === 'graphqlIntrospection' || k === 'listContentFragmentTemplates')))"
```
Expected output:
```
[
  'listContentFragmentModels',
  'getContentFragmentModelSchema',
  'createContentFragmentModel',
  'updateContentFragmentModel',
  'deleteContentFragmentModel',
  'batchManageContentFragmentModels',
  'listContentFragmentTemplates',
  'graphqlIntrospection'
]
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp.aem-handler.ts
git commit -m "feat(cf-models): add 8 handler cases to mcp.aem-handler.ts switch"
```

---

### Task 10: End-to-end smoke test and final build verification

**Files:**
- No code changes — verification only

- [ ] **Step 1: Run the full build one final time**

Run: `npm run build`
Expected: Exit 0, no errors.

- [ ] **Step 2: Start the server in stdio mode and list tools**

Run:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/cli.js -t stdio 2>/dev/null | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const lines=d.trim().split('\n'); const resp=JSON.parse(lines[lines.length-1]); const cfModelTools=resp.result.tools.filter(t=>t.name.includes('ContentFragmentModel')||t.name==='graphqlIntrospection'||t.name==='listContentFragmentTemplates'); console.log('CF Model tools found:', cfModelTools.map(t=>t.name)); })"
```
Expected: 8 tool names printed — `listContentFragmentModels`, `getContentFragmentModelSchema`, `createContentFragmentModel`, `updateContentFragmentModel`, `deleteContentFragmentModel`, `batchManageContentFragmentModels`, `listContentFragmentTemplates`, `graphqlIntrospection`.

- [ ] **Step 3: Verify Zod validation rejects bad input**

Run:
```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"createContentFragmentModel","arguments":{}}}' | node dist/cli.js -t stdio 2>/dev/null | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const lines=d.trim().split('\n'); const resp=JSON.parse(lines[lines.length-1]); console.log('Error message:', resp.error?.message || JSON.stringify(resp.result)); })"
```
Expected: An error message containing "Invalid input for createContentFragmentModel" and mentioning required fields `parentPath`, `name`, `title`.

- [ ] **Step 4: Final commit if any clean-up was needed**

If no fixes were needed, skip. Otherwise:
```bash
git add -p
git commit -m "fix(cf-models): address build/smoke-test issues"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `listContentFragmentModels` — Task 1 (path/name/status filter, returns path/title/description/fieldCount/modified)
- [x] `getContentFragmentModelSchema` — Task 2 (field name/type/required/multiValue/constraints; normalizeFieldType + extractConstraints helpers)
- [x] `createContentFragmentModel` — Task 3 (all 9 field types, dry-run validation, CFModelFieldDef interface exported)
- [x] `updateContentFragmentModel` — Task 4 (addFields/removeFields/updateFields, requires at least one change)
- [x] `deleteContentFragmentModel` — Task 5 (QueryBuilder fragment-existence guard, force flag bypass)
- [x] `batchManageContentFragmentModels` — Task 5 (copy/patch/delete, continueOnError, validateFirst)
- [x] `listContentFragmentTemplates` — Task 6 (reads templates/ child nodes)
- [x] `graphqlIntrospection` — Task 6 (POST introspection query, filters out built-in __-prefixed types)
- [x] AEM 6.5 vs AEMaaCS routing — every public method branches on `this.isAEMaaCS`
- [x] `mcp.tools.ts` schema group, toolSchemas spread, toolDescriptions, toolAnnotations — Task 8
- [x] `mcp.aem-handler.ts` switch cases — Task 9
- [x] `aem.connector.ts` import, property, constructor init, delegate methods — Task 7
- [x] Build verification at every task + final smoke test — Tasks 1–10

**Placeholder scan:** All steps contain complete code. No TBD, no TODO, no "see Task N for similar code".

**Type consistency:**
- `CFModelFieldDef` defined in Task 3, referenced in Tasks 4, 5 — same interface name
- `ContentFragmentModelManager` class name consistent across Tasks 1–7
- All 8 method names match across: implementation (Tasks 1–6), connector delegates (Task 7), Zod schema keys (Task 8), switch cases (Task 9)
- `serializeFieldForCloud` and `getFieldResourceType65` defined in Task 3, used in Tasks 3 and 4
- `normalizeFieldType`, `extractConstraints`, `extractFieldsFrom65Model` defined in Task 2, used in Task 2 only
