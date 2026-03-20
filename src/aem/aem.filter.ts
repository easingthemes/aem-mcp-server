const JCR_INTERNAL_PROPS = new Set([
  'jcr:created', 'jcr:createdBy', 'jcr:lastModified', 'jcr:lastModifiedBy',
  'jcr:uuid', 'jcr:baseVersion', 'jcr:predecessors', 'jcr:versionHistory',
  'jcr:isCheckedOut', 'jcr:mixinTypes',
  'cq:lastRolledout', 'cq:lastRolledoutBy', 'cq:lastReplicatedBy',
  'cq:lastReplicationAction', 'cq:lastModified', 'cq:lastModifiedBy',
  'rep:policy',
]);

const ALWAYS_KEEP = new Set(['jcr:primaryType', 'jcr:title', 'jcr:description']);
const SUMMARY_PROPS = new Set(['jcr:primaryType', 'sling:resourceType', 'jcr:title', 'cq:template']);

export function filterProperties(obj: Record<string, any>, verbosity: string = 'standard'): Record<string, any> {
  if (verbosity === 'full') return obj;

  const filtered: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (ALWAYS_KEEP.has(key)) {
      filtered[key] = value;
    } else if (verbosity === 'summary') {
      if (SUMMARY_PROPS.has(key)) {
        filtered[key] = value;
      }
    } else {
      // Standard: exclude JCR internals
      if (!JCR_INTERNAL_PROPS.has(key)) {
        filtered[key] = typeof value === 'string' && value.length > 500
          ? value.substring(0, 500) + '...[truncated, use getNodeContent for full]'
          : value;
      }
    }
  }
  return filtered;
}

export function filterNodeTree(node: Record<string, any>, verbosity: string = 'standard', depth: number = 0, maxDepth: number = 3): Record<string, any> {
  if (verbosity === 'full') return node;

  const filtered = filterProperties(node, verbosity);

  // Recursively filter child nodes
  for (const [key, value] of Object.entries(filtered)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < maxDepth) {
      filtered[key] = filterNodeTree(value, verbosity, depth + 1, maxDepth);
    }
  }

  return filtered;
}
