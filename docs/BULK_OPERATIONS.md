# Bulk Operations Documentation

## Overview

The AEM MCP Server provides two powerful bulk operations for managing components across AEM pages: `bulkUpdateComponents` and `bulkConvertComponents`. These tools enable efficient batch processing of component updates and conversions with built-in validation and error handling.

---

## bulkUpdateComponents

### Purpose
Updates multiple components across different pages in a single operation with validation and error handling support.

### How It Works

1. **Validation Phase** (optional, enabled by default):
   - Verifies all component paths exist before processing
   - If `validateFirst=true` and a component is not found, the operation can either:
     - Stop immediately if `continueOnError=false`
     - Continue with remaining components if `continueOnError=true`

2. **Update Phase**:
   - Iterates through each component in the `updates` array
   - Calls `updateComponent` for each component with its specified properties
   - Tracks success/failure for each update
   - Stops on first error if `continueOnError=false`, otherwise continues processing

3. **Response**:
   - Returns summary with total updates, successful updates, and failed updates
   - Includes detailed results for each component update attempt

### Parameters

- **updates** (required): Array of objects with:
  - `componentPath`: Full path to the component (e.g., `/content/site/en/page/jcr:content/root/container/component_123`)
  - `properties`: Object containing properties to update
- **validateFirst** (optional, default: `true`): Validate component existence before updating
- **continueOnError** (optional, default: `false`): Continue processing remaining components if one fails

### Example Use Case
Update text content across multiple components on different pages:
```json
{
  "updates": [
    {
      "componentPath": "/content/site/en/page1/jcr:content/root/container/text1",
      "properties": { "text": "Updated content 1" }
    },
    {
      "componentPath": "/content/site/en/page2/jcr:content/root/container/text2",
      "properties": { "text": "Updated content 2" }
    }
  ],
  "validateFirst": true,
  "continueOnError": true
}
```

---

## bulkConvertComponents

### Purpose
Converts components of one type to another type across multiple pages. Finds all matching source components, deletes them, and creates new target components at the same location.

### How It Works

1. **Page Discovery**:
   - Option A: Uses provided `pagePaths` array for specific pages
   - Option B: Uses `searchPath` to find all pages under a path (with optional `depth` and `limit`)

2. **Component Conversion** (per page):
   - Scans each page for components matching `sourceResourceType`
   - For each matching component:
     - Validates target component requirements (checks `cq:dialog` and `sling:resourceSuperType`)
     - Deletes the source component
     - Creates new target component at the same path with:
       - Same `jcr:primaryType`
       - New `sling:resourceType`
       - Required properties from `requiredProperties` parameter
   - Preserves component location and parent structure

3. **Error Handling**:
   - If `continueOnError=true`: Continues processing remaining pages even if one fails
   - If `continueOnError=false`: Stops on first page error
   - Returns detailed results per page with component counts

4. **Response**:
   - Summary of pages processed, succeeded, and failed
   - Total components found, converted, and failed
   - Per-page breakdown of conversion results

### Parameters

- **sourceResourceType** (required): Resource type to find and convert (e.g., `foundation/components/text`)
- **targetResourceType** (required): Resource type to convert to (e.g., `aemmcp/base/components/aemmcp-text/v1/aemmcp-text`)
- **pagePaths** (optional): Array of specific page paths to process
- **searchPath** (optional): Base path to search for pages (alternative to `pagePaths`)
- **depth** (optional, default: `2`): Depth to search when using `searchPath`
- **limit** (optional, default: `50`): Maximum pages to process when using `searchPath`
- **requiredProperties** (optional): Object with required property values for target component
- **continueOnError** (optional, default: `true`): Continue processing pages even if some fail

### Example Use Case
Convert all legacy text components to new component type across a site section:
```json
{
  "sourceResourceType": "foundation/components/text",
  "targetResourceType": "aemmcp/base/components/aemmcp-text/v1/aemmcp-text",
  "searchPath": "/content/mysite/en",
  "depth": 3,
  "limit": 100,
  "requiredProperties": {
    "text": "Migrated from legacy component"
  },
  "continueOnError": true
}
```

### Key Features

- **Automatic Property Validation**: Checks target component's `cq:dialog` and `sling:resourceSuperType` to identify required properties
- **Location Preservation**: Maintains exact component location and hierarchy
- **Bulk Processing**: Handles multiple pages efficiently with progress tracking
- **Error Resilience**: Configurable error handling to balance safety vs. completion

---

## Comparison

| Feature | bulkUpdateComponents | bulkConvertComponents |
|---------|---------------------|----------------------|
| **Operation** | Updates properties | Changes component type |
| **Scope** | Specific component paths | Components across pages |
| **Discovery** | Manual (provide paths) | Automatic (scan pages) |
| **Component Deletion** | No | Yes (replaced) |
| **Component Creation** | No | Yes (new type) |
| **Use Case** | Property updates | Component migration |

---

## Best Practices

1. **Always use `validateFirst=true`** for `bulkUpdateComponents` to catch invalid paths early
2. **Use `continueOnError=true`** for large bulk operations to maximize completion
3. **Test on a small subset** before running bulk operations on production
4. **Provide `requiredProperties`** for `bulkConvertComponents` when target components have mandatory fields
5. **Monitor response results** to identify any failed operations for manual review

