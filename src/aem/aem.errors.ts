import { LOGGER } from '../utils/logger.js';

export interface AEMErrorDetails {
  [key: string]: any;
}

export class AEMOperationError extends Error {
  code: string;
  details?: AEMErrorDetails;
  recoverable?: boolean;
  retryAfter?: number;

  constructor(error: {
    code: string;
    message: string;
    details?: AEMErrorDetails;
    recoverable?: boolean;
    retryAfter?: number;
  }) {
    super(error.message);
    this.name = 'AEMOperationError';
    this.code = error.code;
    this.details = error.details;
    this.recoverable = error.recoverable;
    this.retryAfter = error.retryAfter;
  }
}

export const AEM_ERROR_CODES = {
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  TIMEOUT: 'TIMEOUT',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_PATH: 'INVALID_PATH',
  INVALID_COMPONENT_TYPE: 'INVALID_COMPONENT_TYPE',
  INVALID_LOCALE: 'INVALID_LOCALE',
  INVALID_PARAMETERS: 'INVALID_PARAMETERS',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
  PAGE_NOT_FOUND: 'PAGE_NOT_FOUND',
  UPDATE_FAILED: 'UPDATE_FAILED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  REPLICATION_FAILED: 'REPLICATION_FAILED',
  QUERY_FAILED: 'QUERY_FAILED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export function createAEMError(
  code: string,
  message: string,
  details?: AEMErrorDetails,
  recoverable = false,
  retryAfter?: number
): AEMOperationError {
  return new AEMOperationError({ code, message, details, recoverable, retryAfter });
}

export function handleAEMHttpError(error: any, operation: string): AEMOperationError {
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;
    switch (status) {
      case 401:
        return createAEMError(AEM_ERROR_CODES.AUTHENTICATION_FAILED, 'Authentication failed. Check AEM credentials.', { status, data });
      case 403:
        return createAEMError(AEM_ERROR_CODES.INSUFFICIENT_PERMISSIONS, 'Insufficient permissions for this operation.', { status, data, operation });
      case 404:
        return createAEMError(AEM_ERROR_CODES.RESOURCE_NOT_FOUND, 'Resource not found in AEM.', { status, data, operation });
      case 429:
        const retryAfter = error.response.headers['retry-after'];
        return createAEMError(AEM_ERROR_CODES.RATE_LIMITED, 'Rate limit exceeded. Please try again later.', { status, data }, true, retryAfter ? parseInt(retryAfter) * 1000 : 60000);
      case 500:
      case 502:
      case 503:
        return createAEMError(AEM_ERROR_CODES.SYSTEM_ERROR, 'AEM system error. Please try again later.', { status, data }, true, 30000);
      default:
        // Handle both string and object error data
        let errorMsg = 'Unknown error';
        if (typeof data === 'string' && data.trim().length > 0) {
          try {
            const parsed = JSON.parse(data);
            errorMsg = parsed.message || JSON.stringify(parsed);
          } catch {
            errorMsg = data;
          }
        } else if (data && typeof data === 'object' && data.message) {
          errorMsg = data.message;
        } else if (data && typeof data === 'object') {
          errorMsg = JSON.stringify(data);
        }
        return createAEMError(AEM_ERROR_CODES.SYSTEM_ERROR, `HTTP ${status}: ${errorMsg}`, { status, data, operation });
    }
  } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return createAEMError(AEM_ERROR_CODES.CONNECTION_FAILED, 'Cannot connect to AEM instance. Check host and network.', { originalError: error.message }, true, 5000);
  } else if (error.code === 'ETIMEDOUT') {
    return createAEMError(AEM_ERROR_CODES.TIMEOUT, 'Request to AEM timed out.', { originalError: error.message }, true, 10000);
  } else {
    return createAEMError(AEM_ERROR_CODES.SYSTEM_ERROR, `Unexpected error during ${operation}: ${error.message}`, { originalError: error.message });
  }
}

export async function safeExecute<T>(operation: () => Promise<T>, operationName: string, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error instanceof AEMOperationError
        ? error
        : handleAEMHttpError(error, operationName);
      if (!lastError.recoverable || attempt === maxRetries) {
        break;
      }
      const delay = lastError.retryAfter || Math.pow(2, attempt) * 1000;
      // eslint-disable-next-line no-LOGGER
      LOGGER.warn(`[${operationName}] Attempt ${attempt} failed, retrying in ${delay}ms:`, lastError.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

const ERROR_SUGGESTIONS: Record<string, { suggestion: string; alternatives: string[] }> = {
  COMPONENT_NOT_FOUND: {
    suggestion: 'Check the component resourceType spelling. Use getComponents to list all available components.',
    alternatives: ['scanPageComponents to find components on a specific page', 'searchContent to search by partial name'],
  },
  PAGE_NOT_FOUND: {
    suggestion: 'Verify the page path exists. Use listPages or enhancedPageSearch to find pages.',
    alternatives: ['listPages to list children of a parent path', 'enhancedPageSearch for fulltext page search'],
  },
  RESOURCE_NOT_FOUND: {
    suggestion: 'The path may not exist or may have a different structure. Use getNodeContent with depth:1 to explore.',
    alternatives: ['listChildren to see what exists at the parent path'],
  },
  AUTHENTICATION_FAILED: {
    suggestion: 'Check credentials. For Basic Auth: verify username/password. For OAuth: verify client ID/secret and IMS endpoint.',
    alternatives: [],
  },
  INVALID_PATH: {
    suggestion: 'Paths must start with /content, /content/dam, /conf, or /content/experience-fragments.',
    alternatives: ['fetchSites to discover valid site roots'],
  },
  INVALID_COMPONENT_TYPE: {
    suggestion: 'The resourceType may be incorrect. Use getComponents to list valid component types.',
    alternatives: ['scanPageComponents to see what components exist on a page'],
  },
  TIMEOUT: {
    suggestion: 'AEM may be under load or restarting. Retry after a few seconds.',
    alternatives: [],
  },
  CONNECTION_FAILED: {
    suggestion: 'AEM instance may not be running. Check the configured URL and port.',
    alternatives: [],
  },
};

export function createSuccessResponse<T>(data: T, operation: string) {
  return {
    success: true,
    operation,
    timestamp: new Date().toISOString(),
    data
  };
}

export function createErrorResponse(error: AEMOperationError, operation: string) {
  const hints = ERROR_SUGGESTIONS[error.code] || {};
  return {
    success: false,
    operation,
    timestamp: new Date().toISOString(),
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      recoverable: error.recoverable,
      retryAfter: error.retryAfter,
      ...(hints.suggestion && { suggestion: hints.suggestion }),
      ...(hints.alternatives?.length && { alternatives: hints.alternatives }),
    }
  };
}
