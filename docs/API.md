# AEM MCP Server API Reference

## MCP Resources

The server exposes read-only resources via `resources/list` and `resources/read`:

| Resource URI | Description | Source |
|---|---|---|
| `aem://{instance}/components` | All components (name, resourceType, title, group) | `getComponents()` |
| `aem://{instance}/sites` | Site roots and language structure | `fetchSites()` |
| `aem://{instance}/templates` | Available page templates (path, title) | `getTemplates()` |
| `aem://{instance}/workflow-models` | Workflow models (ID, title, description) | `listWorkflowModels()` |

Resources return summary-only JSON. If a connector call fails, the resource returns an error object rather than crashing the handler.

## Tool Annotations

Every tool includes annotations to help agents make informed decisions:

| Annotation | Values | Purpose |
|---|---|---|
| `group` | `content`, `sites`, `pages`, `components`, `assets`, `search`, `templates`, `workflows`, `fragments-content`, `fragments-experience` | Logical grouping |
| `readOnly` | `true` / `false` | Whether the tool modifies AEM state |
| `complexity` | `low` / `medium` / `high` | Operational risk level |

## Response Verbosity

The following tools accept a `verbosity` parameter:

| Level | Behavior |
|---|---|
| `summary` | Paths and names only (`jcr:primaryType`, `sling:resourceType`, `jcr:title`, `cq:template`) |
| `standard` (default) | Excludes JCR internals (audit, versioning props); truncates text at 500 chars |
| `full` | Returns everything as-is |

Tools with verbosity support: `getPageContent`, `getNodeContent`, `listChildren`, `listPages`, `scanPageComponents`, `getComponents`.

## Component Operations

| Method | Description | Parameters |
|--------|------------|------------|
| `updateComponent` | Update component properties. Validates properties against component dialog definitions (dropdown options, checkbox values, etc.). | `componentPath`, `properties` |
| `bulkUpdateComponents` | Update multiple components with validation | `updates[]`, `validateFirst`, `continueOnError` |
| `scanPageComponents` | Discover all components on a page | `pagePath`, `verbosity` |
| `addComponent` | Add component to a page. Automatically applies `cq:template` structure if available. Validates properties against component dialog definitions. | `pagePath`, `resourceType`, `containerPath`, `name`, `properties` |
| `deleteComponent` | Delete a component | `componentPath`, `force` |
| `convertComponents` | Convert components on a single page. Existing components are deleted and new are created. Properties are not preserved. | `pagePath`, `sourceResourceType`, `targetResourceType`, `requiredProperties`, `continueOnError` |
| `bulkConvertComponents` | Convert components across multiple pages | `sourceResourceType`, `targetResourceType`, `pagePaths[]` or `searchPath`, `depth`, `limit`, `requiredProperties`, `continueOnError` |

## Page Operations

| Method | Description | Parameters |
|--------|-------------|------------|
| `createPage` | Create a new page | `parentPath`, `title`, `template`, `name`, `properties` |
| `deletePage` | Delete a page | `pagePath`, `force` |
| `listPages` | List child pages directly under a path (non-recursive) | `siteRoot`, `depth`, `limit`, `verbosity` |
| `getPageProperties` | Get page properties | `pagePath` |
| `getPageContent` | Get complete page content including resolved XF and CF | `pagePath`, `verbosity` |
| `getAllTextContent` | Get all text content from page | `pagePath` |
| `getPageTextContent` | Get text content from page. May need fine-tunning for the specific project needs. | `pagePath` |
| `getPageImages` | Get all images from page | `pagePath` |
| `enhancedPageSearch` | Intelligent page search with fallbacks | `searchTerm`, `basePath`, `includeAlternateLocales` |
| `activatePage` | Publish a page | `pagePath`, `activateTree` |
| `deactivatePage` | Unpublish a page | `pagePath`, `deactivateTree` |
| `unpublishContent` | Unpublish content | `contentPaths[]`, `unpublishTree` |

## Site & Localization

| Method | Description | Parameters |
|--------|-------------|------------|
| `fetchSites` | Get all available sites | - |
| `fetchLanguageMasters` | Get language masters for a site. Considers "master" and "language-masters" under tenant | `site` |
| `fetchAvailableLocales` | Get available locales | `site` |

## Assets

| Method | Description | Parameters |
|--------|-------------|------------|
| `updateAsset` | Update existing asset | `assetPath`, `metadata`, `fileContent`, `mimeType` |
| `deleteAsset` | Delete asset | `assetPath`, `force` |
| `getAssetMetadata` | Get asset metadata | `assetPath` |
| `updateImagePath` | Update image component path | `componentPath`, `newImagePath` |

## Templates

| Method | Description | Parameters |
|--------|-------------|------------|
| `getTemplates` | Get available page templates. Doesn't support multi-tenancy at the moment. Expects templates to be under /conf/{tenant} | `sitePath` |
| `getTemplateStructure` | Get detailed template structure | `templatePath` |

## Components & Metadata

| Method | Description | Parameters |
|--------|-------------|------------|
| `getComponents` | Get all components from root path | `path`, `verbosity` |

## Search & Queries

| Method | Description | Parameters |
|--------|-------------|------------|
| `searchContent` | Structured content search with filters (type, property values, path scope, fulltext). More flexible than executeJCRQuery. | `type`, `fulltext`, `path`, `limit` |
| `executeJCRQuery` | Fulltext search on cq:Page nodes under /content. Uses QueryBuilder internally. For structured queries, use searchContent. | `query`, `limit` |

## Workflows

| Method | Description | Parameters |
|--------|-------------|------------|
| `listWorkflowModels` | List all available workflow models with descriptions | - |
| `startWorkflow` | Start a workflow instance | `modelId`, `payload`, `payloadType` |
| `listWorkflowInstances` | List workflow instances (optionally filtered by state) | `state` (optional) |
| `getWorkflowInstance` | Get details of a specific workflow instance | `instanceId` |
| `updateWorkflowInstanceState` | Update workflow instance state | `instanceId`, `state` |
| `getInboxItems` | Get all work items in the inbox | - |
| `completeWorkItem` | Complete or advance a work item | `workItemPath`, `routeId` (optional), `comment` (optional) |
| `delegateWorkItem` | Delegate a work item to another user/group | `workItemPath`, `delegatee` |
| `getWorkItemRoutes` | Get available routes for a work item | `workItemPath` |

### Common Workflow Models

The following workflow models are commonly used in AEM:

| Workflow ID | Description | Use Case |
|-------------|-------------|----------|
| `request_for_activation` | Publish/activate pages | Use to publish pages to the publish environment |
| `request_for_deactivation` | Unpublish/deactivate pages | Use to unpublish pages from the publish environment |
| `request_for_deletion` | Delete pages | Use to delete pages (with deactivation first) |
| `request_for_deletion_without_deactivation` | Delete pages without unpublishing | Use to delete pages without unpublishing first |
| `dam/update_asset` | Update DAM assets | Use to update digital assets |
| `dam/dam-update-language-copy` | Update language copies of assets | Use to update translated asset versions |
| `dam/dam-create-language-copy` | Create language copies of assets | Use to create translated asset versions |
| `wcm-translation/translate-language-copy` | Translate language copies | Use for page translation workflows |
| `wcm-translation/create_language_copy` | Create language copies | Use to create translated page versions |
| `wcm-translation/prepare_translation_project` | Prepare translation project | Use to set up translation projects |
| `wcm-translation/sync_translation_job` | Sync translation job | Use to synchronize translation jobs |
| `wcm-translation/update_language_copy` | Update language copy | Use to update translated page versions |
| `scheduled_activation` | Scheduled activation | Use for scheduled page publishing |
| `scheduled_deactivation` | Scheduled deactivation | Use for scheduled page unpublishing |

**Example: Publishing a page using workflow**
```javascript
// Start activation workflow
startWorkflow({
  modelId: "request_for_activation",
  payload: "/content/site/en/page",
  payloadType: "JCR_PATH"
})

// Check inbox for work items
getInboxItems()

// Complete the work item
completeWorkItem({
  workItemPath: "/var/workflow/instances/.../workItems/...",
  comment: "Approved for publication"
})
```

## Utilities

| Method | Description | Parameters |
|--------|-------------|------------|
| `getNodeContent` | Get raw JCR node properties at a path and depth | `path`, `depth`, `verbosity` |
| `listChildren` | List child nodes | `path`, `verbosity` |

## Content Fragments

| Method | Description | Parameters |
|--------|-------------|------------|
| `getContentFragment` | Get a content fragment with all fields, variations, and metadata | `path` |
| `listContentFragments` | List content fragments under a path with optional model filter | `path`, `model`, `limit`, `offset` |
| `manageContentFragment` | Create, update, or delete a content fragment | `action`, `fragmentPath`, `parentPath`, `title`, `name`, `model`, `fields`, `description`, `force` |
| `manageContentFragmentVariation` | Create, update, or delete a variation within a content fragment | `action`, `fragmentPath`, `variationName`, `title`, `fields` |

## Experience Fragments

| Method | Description | Parameters |
|--------|-------------|------------|
| `getExperienceFragment` | Get an experience fragment with all variations and components | `path` |
| `listExperienceFragments` | List experience fragments under a path with optional template filter | `path`, `template`, `limit`, `offset` |
| `manageExperienceFragment` | Create, update, or delete an experience fragment. Auto-creates master variation on create. | `action`, `xfPath`, `parentPath`, `name`, `title`, `template`, `description`, `tags`, `force` |
| `manageExperienceFragmentVariation` | Create, update, or delete a variation within an experience fragment | `action`, `xfPath`, `variationName`, `variationType`, `title`, `template`, `force` |

## Bulk Operations

For detailed documentation on `bulkUpdateComponents` and `bulkConvertComponents`, see [BULK_OPERATIONS.md](./BULK_OPERATIONS.md).

## Component Features

### cq:template Support
When adding a component using `addComponent`, if the component has a `cq:template` node defined, the server will:
- Automatically fetch the template structure
- Merge template properties with provided properties
- Create all child nodes defined in the template
- This ensures components like column controls initialize with their default structure (e.g., columns)

### Property Validation
Both `addComponent` and `updateComponent` now validate properties against the component's dialog definition:
- **Select/Dropdown fields**: Validates that provided values match available options
- **Checkbox fields**: Validates boolean values or 'true'/'false' strings
- **Number fields**: Validates numeric values
- Returns validation errors/warnings before applying changes to prevent component loading failures

**Total Tools:** 57 | **MCP Resources:** 4
