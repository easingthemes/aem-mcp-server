import { getAccessToken } from './aem.auth.js';
import { LOGGER } from '../utils/logger.js';

export type AEMBasicAuth = {
  username: string;
  password: string;
  clientId?: undefined;
  clientSecret?: undefined;
};

export type AEMOAuth = {
  username?: undefined;
  password?: undefined;
  clientId: string;
  clientSecret: string;
  scope?: string | string[];
};

export type AEMAuth = AEMBasicAuth | AEMOAuth;

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
      const headers = new Headers(init.headers || {});
      headers.set('Authorization', `Basic ${this.token}`);
      headers.set('Accept', 'application/json');
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      return fetch(input, { ...init, headers });
    }
  }

  async getAuthToken(config: AEMAuth): Promise<string> {
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
    let response: Response;
    try {
      response = await this.fetch(url, options);
      if (response.status === 401) {
        LOGGER.warn(`AEM request to ${url} returned 401 Unauthorized. Attempting to refresh token...`);
        await this.refreshAuthToken();
        response = await this.fetch(url, options);
      }
      if (!response.ok) throw new Error(`AEM ${options.method || 'GET'} failed: ${response.status}`);
      if (isHtml) {
        return response.text();
      }
      return response.json();
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
  async post(url: string, data: any, options: RequestInit = {}, timeout?: number): Promise<any> {
    let body: BodyInit;
    let headers = new Headers(options.headers || {});
    if (data instanceof URLSearchParams) {
      body = data;
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    } else {
      body = JSON.stringify(data);
      headers.set('Content-Type', 'application/json');
    }
    const fullUrl = this.buildUrlWithParams(url);
    return this.request(fullUrl, { ...options, method: 'POST', body, headers }, timeout);
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
}
