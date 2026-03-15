import { getAccessToken } from './aem.auth.js';
import { LOGGER } from '../utils/logger.js';

export type AEMBasicAuth = {
  username: string;
  password: string;
  clientId?: undefined;
  clientSecret?: undefined;
  accessToken?: undefined;
  refreshToken?: undefined;
  redirectUri?: undefined;
};

export type AEMOAuthServerToServer = {
  username?: undefined;
  password?: undefined;
  clientId: string;
  clientSecret: string;
  scope?: string | string[];
  accessToken?: undefined;
  refreshToken?: undefined;
  redirectUri?: undefined;
};

export type AEMAuth = AEMBasicAuth | AEMOAuthServerToServer;

export type AEMFetchConfig = {
  host: string;
  auth: AEMAuth;
  timeout?: number;
}

type FetchInstance = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

export class AEMFetch {
  private fetch: FetchInstance | null;
  private readonly config: AEMFetchConfig;
  private token: string;
  private tokenExpiry: number;

  constructor(config: AEMFetchConfig) {
    this.config = config;
    this.fetch = null;
    this.token = '';
    this.tokenExpiry = 0;
  }

  /**
   * Initializes the fetch instance with authentication token.
   * Must be called before making requests.
   */
  async init() {
    this.token = await this.getAuthToken(this.config.auth);
    this.fetch = this.getFetchInstance();
  }

  /**
   * Returns a fetch instance with proper headers for AEM authentication.
   */
  private getFetchInstance(): FetchInstance {
    return (input: RequestInfo, init: RequestInit = {}): Promise<Response> => {
      // Work with existing headers - create new Headers object to avoid mutating the original
      const headers = init.headers instanceof Headers 
        ? new Headers(init.headers) 
        : new Headers(init.headers || {});
      
      // Always set Authorization (required for all requests)
      // Use Bearer for OAuth server-to-server, Basic for username/password
      const isOAuth = this.config.auth.clientId && !this.config.auth.username;
      if (isOAuth) {
        headers.set('Authorization', `Bearer ${this.token}`);
      } else {
        headers.set('Authorization', `Basic ${this.token}`);
      }
      
      // Only set default Accept header if not already set
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }
      
      // Only set default Content-Type if not already set (form data will set it in post())
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      
      // Create new options object with our headers, preserving other init properties
      const { headers: _, ...initWithoutHeaders } = init;
      return fetch(input, { ...initWithoutHeaders, headers });
    }
  }

  async getAuthToken(config: AEMAuth): Promise<string> {
    // OAuth Server-to-Server (client credentials)
    if (config.clientId && config.clientSecret) {
      const now = Date.now();
      if (this.token && now < this.tokenExpiry) {
        return this.token;
      }
      const token = await getAccessToken(config.clientId, config.clientSecret, config.scope);
      this.token = token.access_token;
      this.tokenExpiry = now + (token.expires_in - 60) * 1000;
      return this.token;
    }
    
    // Basic Authentication (username/password)
    if (config.username && config.password) {
      return Buffer.from(`${config.username}:${config.password}`).toString('base64');
    }
    
    throw new Error('No authentication credentials provided');
  }

  async refreshAuthToken() {
    this.token = ''; // Reset token to force refresh
    this.tokenExpiry = 0; // Reset expiry
    this.token = await this.getAuthToken(this.config.auth);
  }
  /**
   * Returns timeout options for fetch requests, including AbortController and timeoutId.
   * @param requestTimeout Optional timeout in ms (overrides config.timeout)
   */
  private getTimeoutOptions(requestTimeout?: number) {
    let controller: AbortController | undefined;
    let timeoutId: NodeJS.Timeout | undefined;
    let signal: AbortSignal | undefined;
    const timeout = requestTimeout || this.config.timeout;
    if (timeout) {
      controller = new AbortController();
      signal = controller.signal;
      timeoutId = setTimeout(() => controller!.abort(), timeout);
    }
    return {
      signal,
      timeoutId,
    };
  }

  /**
   * Builds a URL with query parameters.
   * @param url Relative URL string
   * @param params Optional key-value pairs to append as query params
   * @returns Absolute URL string with query parameters
   */
  private buildUrlWithParams(url: string, params?: Record<string, any>): string {
    const baseUrl = this.config.host.endsWith('/') ? this.config.host.slice(0, -1) : this.config.host;
    const relUrl = url.startsWith('/') ? url : `/${url}`;
    const absUrl = `${baseUrl}${relUrl}`;
    if (!params || Object.keys(params).length === 0) return absUrl;
    const urlObj = new URL(absUrl);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) urlObj.searchParams.append(k, String(v));
    });
    return urlObj.toString();
  }

  /**
   * Internal request method with timeout and error handling.
   * If a 401 Unauthorized is received, refreshes the auth token and retries once.
   * @param url Absolute URL string
   * @param options Fetch options
   * @param timeout Optional timeout in ms
   * @param isHtml Optional flag to indicate if response is HTML
   * @returns Parsed JSON response
   */
  private async request(url: string, options: RequestInit = {}, timeout?: number, isHtml?: boolean): Promise<any> {
    if (!this.fetch) {
      throw new Error('AEMFetch not initialized. Call await init(config) before making requests.');
    }
    const { timeoutId, signal } = this.getTimeoutOptions(timeout);
    if (timeout) {
      options.signal = signal;
    }
    // Explicitly set redirect to follow (default behavior, but making it explicit)
    options.redirect = options.redirect || 'follow';
    let response: Response;
    try {
      response = await this.fetch(url, options);
      if (response.status === 401) {
        LOGGER.warn(`AEM request to ${url} returned 401 Unauthorized. Attempting to refresh token...`);
        await this.refreshAuthToken();
        response = await this.fetch(url, options);
      }
      // Handle redirect status codes (300-399) - fetch should follow automatically, but log if it doesn't
      if (response.status >= 300 && response.status < 400 && !response.ok) {
        const location = response.headers.get('Location');
        if (location) {
          LOGGER.warn(`Redirect detected (${response.status}) from ${url} to ${location}`);
          // Follow the redirect manually if fetch didn't
          const redirectUrl = location.startsWith('http') ? location : `${this.config.host}${location}`;
          response = await this.fetch(redirectUrl, { ...options, redirect: 'follow' });
        }
      }
      if (!response.ok) {
        // Try to get error message from response body
        // Clone response before reading to avoid consuming the stream
        const clonedResponse = response.clone();
        let errorMessage = `AEM ${options.method || 'GET'} failed: ${response.status}`;
        let errorText: string | null = null;
        try {
          errorText = await clonedResponse.text();
          if (errorText && errorText.trim().length > 0) {
            try {
              const errorJson = JSON.parse(errorText);
              errorMessage = `AEM ${options.method || 'GET'} failed: ${response.status} - ${JSON.stringify(errorJson)}`;
            } catch {
              errorMessage = `AEM ${options.method || 'GET'} failed: ${response.status} - ${errorText}`;
            }
          }
        } catch (readError) {
          // If we can't read error, use default message
        }
        const error: any = new Error(errorMessage);
        error.status = response.status;
        error.response = { status: response.status, data: errorText || null };
        throw error;
      }
      
      // Handle empty responses (common for DELETE operations)
      // 204 No Content or empty body should return null/empty object
      if (response.status === 204 || response.status === 200) {
        const contentType = response.headers.get('content-type') || '';
        const contentLength = response.headers.get('content-length');
        
        // If it's a DELETE operation and no content, return empty object
        if (options.method === 'DELETE' && (!contentLength || contentLength === '0')) {
          return {};
        }
        
        // If content-type is not JSON and no content, return empty object
        if (!contentType.includes('application/json') && (!contentLength || contentLength === '0')) {
          return {};
        }
      }
      
      if (isHtml) {
        return response.text();
      }
      
      // Check if response has content before parsing JSON
      const text = await response.text();
      if (!text || text.trim().length === 0) {
        return {};
      }
      
      // Try to parse as JSON, but handle non-JSON responses gracefully
      try {
        return JSON.parse(text);
      } catch (parseError: any) {
        // If it's not JSON and we expected JSON, log a warning but return the text
        // This handles cases where AEM returns HTML error pages
        if (options.method === 'DELETE') {
          // For DELETE, if we can't parse JSON, assume success if status is 2xx
          if (response.status >= 200 && response.status < 300) {
            LOGGER.warn(`DELETE response was not JSON, but status ${response.status} indicates success`);
            return { success: true, status: response.status };
          }
        }
        throw new Error(`Failed to parse response as JSON: ${parseError.message}. Response: ${text.substring(0, 200)}`);
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Performs a GET request with optional query parameters and timeout.
   * @param url Absolute URL string
   * @param params Optional query parameters
   * @param options Fetch options
   * @param timeout Optional timeout in ms
   * @param isHtml Optional flag to indicate if response is HTML
   * @returns Parsed JSON response
   */
  async get(url: string, params?: Record<string, any>, options: RequestInit = {}, timeout?: number, isHtml?: boolean): Promise<any> {
    const fullUrl = this.buildUrlWithParams(url, params);
    return this.request(fullUrl, options, timeout, isHtml);
  }

  /**
   * Performs a POST request with JSON or form data and optional timeout.
   * @param url Absolute URL string
   * @param data Request body (object or URLSearchParams)
   * @param options Fetch options
   * @param timeout Optional timeout in ms
   * @returns Parsed JSON response
   */
  async post(url: string, data: any, options: RequestInit = {}, timeout?: number, isHtml?: boolean): Promise<any> {
    let body: BodyInit;
    // Start with headers from options - handle both Headers object and plain object
    const headers = options.headers instanceof Headers
      ? new Headers(options.headers)
      : new Headers(options.headers || {});
    
    if (data instanceof URLSearchParams) {
      body = data;
      // Set Content-Type for form data - this must be set explicitly
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    } else {
      body = JSON.stringify(data);
      // Only set JSON Content-Type if not already set
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
    
    const fullUrl = this.buildUrlWithParams(url);
    // Remove headers from options to avoid conflicts, then set our merged headers
    const { headers: _, ...optionsWithoutHeaders } = options;
    return this.request(fullUrl, { ...optionsWithoutHeaders, method: 'POST', body, headers }, timeout, isHtml);
  }

  /**
   * Performs a DELETE request with optional timeout.
   * @param url Absolute URL string
   * @param options Fetch options
   * @param timeout Optional timeout in ms
   * @returns Parsed JSON response
   */
  async delete(url: string, options: RequestInit = {}, timeout?: number): Promise<any> {
    const fullUrl = this.buildUrlWithParams(url);
    return this.request(fullUrl, { ...options, method: 'DELETE' }, timeout);
  }

  /**
   * Performs a PUT request with JSON body and optional timeout.
   * Used by AEMaaCS Content Fragment Management API for updates.
   */
  async put(url: string, data: any, options: RequestInit = {}, timeout?: number): Promise<any> {
    let body: BodyInit;
    const headers = options.headers instanceof Headers
      ? new Headers(options.headers)
      : new Headers(options.headers || {});

    if (data instanceof URLSearchParams) {
      body = data;
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    } else {
      body = JSON.stringify(data);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }

    const fullUrl = this.buildUrlWithParams(url);
    const { headers: _, ...optionsWithoutHeaders } = options;
    return this.request(fullUrl, { ...optionsWithoutHeaders, method: 'PUT', body, headers }, timeout);
  }

  /**
   * Performs a POST request and returns the raw Response object to access headers.
   * Useful for endpoints that return Location headers (like workflow creation).
   * @param url Relative URL string
   * @param data Request body (object or URLSearchParams)
   * @param options Fetch options
   * @param timeout Optional timeout in ms
   * @returns Raw Response object
   */
  async postWithHeaders(url: string, data: any, options: RequestInit = {}, timeout?: number): Promise<Response> {
    if (!this.fetch) {
      throw new Error('AEMFetch not initialized. Call await init() before making requests.');
    }
    
    let body: BodyInit;
    const headers = options.headers instanceof Headers
      ? new Headers(options.headers)
      : new Headers(options.headers || {});
    
    if (data instanceof URLSearchParams) {
      body = data;
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    } else {
      body = JSON.stringify(data);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
    
    const fullUrl = this.buildUrlWithParams(url);
    const { timeoutId, signal } = this.getTimeoutOptions(timeout);
    if (timeout) {
      options.signal = signal;
    }
    
    try {
      const response = await this.fetch(fullUrl, {
        ...options,
        method: 'POST',
        body,
        headers
      });
      
      if (response.status === 401) {
        await this.refreshAuthToken();
        return await this.fetch(fullUrl, {
          ...options,
          method: 'POST',
          body,
          headers: new Headers(headers)
        });
      }
      
      return response;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
