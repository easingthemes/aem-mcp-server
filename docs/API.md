# AEM MCP Server API Reference

## Component Operations

| Method | Description | Parameters |
|--------|------------|------------|
| `updateComponent` | Update component properties. Validates properties against component dialog definitions (dropdown options, checkbox values, etc.). | `componentPath`, `properties` |
| `bulkUpdateComponents` | Update multiple components with validation | `updates[]`, `validateFirst`, `continueOnError` |
| `scanPageComponents` | Discover all components on a page | `pagePath` |
| `addComponent` | Add component to a page. Automatically applies `cq:template` structure if available. Validates properties against component dialog definitions. | `pagePath`, `resourceType`, `containerPath`, `name`, `properties` |
| `deleteComponent` | Delete a component | `componentPath`, `force` |
| `convertComponents` | Convert components on a single page. Existing components are deleted and new are created. Properties are not preserved. | `pagePath`, `sourceResourceType`, `targetResourceType`, `requiredProperties`, `continueOnError` |
| `bulkConvertComponents` | Convert components across multiple pages | `sourceResourceType`, `targetResourceType`, `pagePaths[]` or `searchPath`, `depth`, `limit`, `requiredProperties`, `continueOnError` |

## Page Operations

| Method | Description | Parameters |
|--------|-------------|------------|
| `createPage` | Create a new page | `parentPath`, `title`, `template`, `name`, `properties` |
| `deletePage` | Delete a page | `pagePath`, `force` |
| `listPages` | List pages under a site root | `siteRoot`, `depth`, `limit` |
| `getPageProperties` | Get page properties | `pagePath` |
| `getPageContent` | Get all page content (XF, CF) | `pagePath` |
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
| `getComponents` | Get all components from root path | - |

## Search & Queries

| Method | Description | Parameters |
|--------|-------------|------------|
| `searchContent` | Search using Query Builder | `type`, `fulltext`, `path`, `limit` |
| `executeJCRQuery` | Currently it's essentially a wrapper for Query Builder, with the path "/content" and type cq:Page. Note: `query` is a fulltext search term and not a JCR Query | `query`, `limit` |

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
| `getNodeContent` | Get JCR node content (legacy) | `path`, `depth` |
| `listChildren` | List child nodes (legacy) | `path` |

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

**Total Methods:** 46
