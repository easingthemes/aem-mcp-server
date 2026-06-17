import { AEMFetch } from './aem.fetch.js';
import { createSuccessResponse, safeExecute, createAEMError, AEM_ERROR_CODES } from './aem.errors.js';
import { LOGGER } from '../utils/logger.js';

export class LaunchManager {
  private readonly fetch: AEMFetch;
  private readonly host: string;
  private readonly isAEMaaCS: boolean;

  constructor(fetch: AEMFetch, host: string, isAEMaaCS: boolean) {
    this.fetch = fetch;
    this.host = host;
    this.isAEMaaCS = isAEMaaCS;
  }

  // ─── Page Launches ────────────────────────────────────

  async listPageLaunches(): Promise<object> {
    return safeExecute<object>(async () => {
      const result = await this.fetch.get('/api/launches.json');
      const launches: any[] = result?.launches || result?.entities || [];
      const sorted = launches.sort((a: any, b: any) => {
        const da = new Date(a['cq:created'] || a.created || 0).getTime();
        const db = new Date(b['cq:created'] || b.created || 0).getTime();
        return db - da;
      });
      return createSuccessResponse({
        launches: sorted.map((l: any) => ({
          id: l['jcr:uuid'] || l.id || l.path?.split('/').pop(),
          path: l.path,
          title: l['jcr:content']?.['jcr:title'] || l.title || l['jcr:title'],
          sourcePages: l['cq:sourcePages'] || l.sourcePages || [],
          liveDate: l['cq:liveDate'] || l.liveDate || null,
          status: l['cq:lastReplicationAction'] || l.status || 'draft',
          author: l['jcr:content']?.['cq:lastModifiedBy'] || l.author || null,
          created: l['jcr:content']?.['cq:created'] || l['cq:created'] || null,
        })),
        totalCount: launches.length,
      }, 'listPageLaunches');
    }, 'listPageLaunches');
  }

  async createPageLaunch(params: {
    sourcePaths: string[];
    title: string;
    liveDate?: string;
  }): Promise<object> {
    const { sourcePaths, title, liveDate } = params;
    if (!sourcePaths?.length) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'createPageLaunch requires at least one sourcePath');
    }
    if (!title) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'createPageLaunch requires a title');
    }
    return safeExecute<object>(async () => {
      const formData = new URLSearchParams();
      formData.append('_charset_', 'utf-8');
      formData.append('title', title);
      sourcePaths.forEach((p) => formData.append('path', p));
      if (liveDate) formData.append('liveDate', liveDate);
      const response = await this.fetch.post(
        '/libs/wcm/core/content/sites/launchmanager.createlaunch.json',
        formData,
      );
      LOGGER.log('createPageLaunch response:', JSON.stringify(response));
      const launchPath: string = response?.launchPath || response?.path || '';
      const launchId: string = launchPath.split('/').pop() || '';
      return createSuccessResponse({ launchId, launchPath, title, sourcePaths, liveDate }, 'createPageLaunch');
    }, 'createPageLaunch');
  }

  async getPageLaunch(params: { launchId: string }): Promise<object> {
    const { launchId } = params;
    if (!launchId) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'getPageLaunch requires launchId');
    }
    return safeExecute<object>(async () => {
      const data = await this.fetch.get(`/api/launches/${launchId}.json`);
      return createSuccessResponse({
        launchId,
        path: data.path || `/content/launches/${launchId}`,
        title: data['jcr:content']?.['jcr:title'] || data['jcr:title'] || launchId,
        sourcePages: data['cq:sourcePages'] || [],
        liveDate: data['jcr:content']?.['cq:liveDate'] || data['cq:liveDate'] || null,
        status: data['jcr:content']?.['cq:lastReplicationAction'] || 'draft',
        copies: data['cq:launchPages'] || [],
      }, 'getPageLaunch');
    }, 'getPageLaunch');
  }

  async deletePageLaunch(params: { launchPath: string }): Promise<object> {
    const { launchPath } = params;
    if (!launchPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'deletePageLaunch requires launchPath');
    }
    return safeExecute<object>(async () => {
      const formData = new URLSearchParams();
      formData.append(':operation', 'delete');
      await this.fetch.post(launchPath, formData);
      return createSuccessResponse({ deleted: true, launchPath }, 'deletePageLaunch');
    }, 'deletePageLaunch');
  }

  async editPageLaunchSources(params: {
    launchPath: string;
    addPaths?: string[];
    removePaths?: string[];
  }): Promise<object> {
    const { launchPath, addPaths = [], removePaths = [] } = params;
    if (!launchPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'editPageLaunchSources requires launchPath');
    }
    if (!addPaths.length && !removePaths.length) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'editPageLaunchSources requires at least one path in addPaths or removePaths');
    }
    return safeExecute<object>(async () => {
      const formData = new URLSearchParams();
      formData.append('_charset_', 'utf-8');
      addPaths.forEach((p) => formData.append('addPath', p));
      removePaths.forEach((p) => formData.append('removePath', p));
      await this.fetch.post(
        `/libs/wcm/core/content/sites/launchmanager.editsources.json`,
        formData,
      );
      return createSuccessResponse({ launchPath, addPaths, removePaths }, 'editPageLaunchSources');
    }, 'editPageLaunchSources');
  }

  async copyPageToLaunch(params: {
    launchPath: string;
    pagePath: string;
  }): Promise<object> {
    const { launchPath, pagePath } = params;
    if (!launchPath || !pagePath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'copyPageToLaunch requires launchPath and pagePath');
    }
    return safeExecute<object>(async () => {
      await this.editPageLaunchSources({ launchPath, addPaths: [pagePath] });
      const launchId = launchPath.split('/').pop() || '';
      const copyPath = pagePath.replace('/content/', `/content/launches/${launchId}/`);
      return createSuccessResponse({ launchPath, pagePath, copyPath }, 'copyPageToLaunch');
    }, 'copyPageToLaunch');
  }

  async promotePageLaunch(params: {
    launchPath: string;
    pagePaths?: string[];
  }): Promise<object> {
    const { launchPath, pagePaths = [] } = params;
    if (!launchPath) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'promotePageLaunch requires launchPath');
    }
    return safeExecute<object>(async () => {
      const formData = new URLSearchParams();
      formData.append('_charset_', 'utf-8');
      formData.append('launchPath', launchPath);
      if (pagePaths.length) {
        pagePaths.forEach((p) => formData.append('path', p));
      }
      const response = await this.fetch.post(
        '/libs/wcm/core/content/sites/launchmanager.promoteLaunch.json',
        formData,
      );
      LOGGER.log('promotePageLaunch response:', JSON.stringify(response));
      return createSuccessResponse({ promoted: true, launchPath, pagePaths }, 'promotePageLaunch');
    }, 'promotePageLaunch');
  }

  // ─── Content Fragment Launches (AEMaaCS only) ─────────

  private assertAEMaaCS(operation: string): void {
    if (!this.isAEMaaCS) {
      throw createAEMError(
        AEM_ERROR_CODES.INVALID_PARAMETERS,
        `${operation} requires AEMaaCS (Cloud Service). This operation is not available on AEM 6.5.`,
        { suggestion: 'Configure OAuth (clientId/clientSecret) to connect to AEMaaCS.' },
      );
    }
  }

  async createContentFragmentLaunch(params: {
    fragmentUUIDs: string[];
    title: string;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
  }): Promise<object> {
    this.assertAEMaaCS('createContentFragmentLaunch');
    const { fragmentUUIDs, title, pollIntervalMs = 2000, maxPollAttempts = 15 } = params;
    if (!fragmentUUIDs?.length) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'createContentFragmentLaunch requires at least one fragmentUUID');
    }
    if (!title) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'createContentFragmentLaunch requires a title');
    }
    return safeExecute<object>(async () => {
      const body = { title, items: fragmentUUIDs.map((uuid) => ({ id: uuid })) };
      const response = await this.fetch.post('/adobe/sites/cf/launches', body, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      LOGGER.log('createContentFragmentLaunch initial response:', JSON.stringify(response));
      const launchId: string = response?.id || response?.launchId || '';
      if (!launchId) {
        return createSuccessResponse({ status: 'created', response }, 'createContentFragmentLaunch');
      }
      let status = response?.status || 'processing';
      let attempt = 0;
      while (status === 'processing' && attempt < maxPollAttempts) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        const poll = await this.fetch.get(`/adobe/sites/cf/launches/${launchId}`, undefined, {
          headers: { 'Accept': 'application/json' },
        });
        status = poll?.status || 'ready';
        LOGGER.log(`CF launch poll attempt ${attempt + 1}: status=${status}`);
        attempt++;
      }
      return createSuccessResponse({
        launchId,
        title,
        fragmentUUIDs,
        status,
        pollAttempts: attempt,
      }, 'createContentFragmentLaunch');
    }, 'createContentFragmentLaunch');
  }

  async createContentFragmentLaunchWithLiveDate(params: {
    fragmentUUIDs: string[];
    title: string;
    liveDate: string;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
  }): Promise<object> {
    this.assertAEMaaCS('createContentFragmentLaunchWithLiveDate');
    const { fragmentUUIDs, title, liveDate, pollIntervalMs = 2000, maxPollAttempts = 15 } = params;
    if (!fragmentUUIDs?.length) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'createContentFragmentLaunchWithLiveDate requires at least one fragmentUUID');
    }
    if (!title || !liveDate) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'createContentFragmentLaunchWithLiveDate requires title and liveDate');
    }
    return safeExecute<object>(async () => {
      const body = { title, liveDate, items: fragmentUUIDs.map((uuid) => ({ id: uuid })) };
      const response = await this.fetch.post('/adobe/sites/cf/launches', body, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      LOGGER.log('createContentFragmentLaunchWithLiveDate initial response:', JSON.stringify(response));
      const launchId: string = response?.id || response?.launchId || '';
      if (!launchId) {
        return createSuccessResponse({ status: 'created', response }, 'createContentFragmentLaunchWithLiveDate');
      }
      let status = response?.status || 'processing';
      let attempt = 0;
      while (status === 'processing' && attempt < maxPollAttempts) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        const poll = await this.fetch.get(`/adobe/sites/cf/launches/${launchId}`, undefined, {
          headers: { 'Accept': 'application/json' },
        });
        status = poll?.status || 'ready';
        LOGGER.log(`CF launch poll attempt ${attempt + 1}: status=${status}`);
        attempt++;
      }
      return createSuccessResponse({
        launchId,
        title,
        liveDate,
        fragmentUUIDs,
        status,
        pollAttempts: attempt,
      }, 'createContentFragmentLaunchWithLiveDate');
    }, 'createContentFragmentLaunchWithLiveDate');
  }

  async getContentFragmentLaunch(params: { launchId: string }): Promise<object> {
    this.assertAEMaaCS('getContentFragmentLaunch');
    const { launchId } = params;
    if (!launchId) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'getContentFragmentLaunch requires launchId');
    }
    return safeExecute<object>(async () => {
      const { data, etag } = await this.fetch.getWithHeaders(
        `/adobe/sites/cf/launches/${launchId}`,
        undefined,
        { headers: { 'Accept': 'application/json' } },
      );
      return createSuccessResponse({
        launchId,
        etag,
        title: data?.title,
        status: data?.status,
        liveDate: data?.liveDate || null,
        items: data?.items || [],
        raw: data,
      }, 'getContentFragmentLaunch');
    }, 'getContentFragmentLaunch');
  }

  async promoteContentFragmentLaunch(params: {
    launchId: string;
    etag: string;
  }): Promise<object> {
    this.assertAEMaaCS('promoteContentFragmentLaunch');
    const { launchId, etag } = params;
    if (!launchId || !etag) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'promoteContentFragmentLaunch requires launchId and etag');
    }
    return safeExecute<object>(async () => {
      const response = await this.fetch.post(
        `/adobe/sites/cf/launches/${launchId}/promote`,
        {},
        { headers: { 'If-Match': etag, 'Content-Type': 'application/json', 'Accept': 'application/json' } },
      );
      LOGGER.log('promoteContentFragmentLaunch response:', JSON.stringify(response));
      return createSuccessResponse({ promoted: true, launchId }, 'promoteContentFragmentLaunch');
    }, 'promoteContentFragmentLaunch');
  }

  async editContentFragmentLaunchSources(params: {
    launchId: string;
    etag: string;
    addUUIDs?: string[];
    removeUUIDs?: string[];
  }): Promise<object> {
    this.assertAEMaaCS('editContentFragmentLaunchSources');
    const { launchId, etag, addUUIDs = [], removeUUIDs = [] } = params;
    if (!launchId || !etag) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'editContentFragmentLaunchSources requires launchId and etag');
    }
    if (!addUUIDs.length && !removeUUIDs.length) {
      throw createAEMError(AEM_ERROR_CODES.INVALID_PARAMETERS, 'editContentFragmentLaunchSources requires at least one UUID in addUUIDs or removeUUIDs');
    }
    return safeExecute<object>(async () => {
      const body: any = {};
      if (addUUIDs.length) body.add = addUUIDs.map((id) => ({ id }));
      if (removeUUIDs.length) body.remove = removeUUIDs.map((id) => ({ id }));
      const response = await this.fetch.patch(
        `/adobe/sites/cf/launches/${launchId}`,
        body,
        { headers: { 'If-Match': etag, 'Content-Type': 'application/json', 'Accept': 'application/json' } },
      );
      LOGGER.log('editContentFragmentLaunchSources response:', JSON.stringify(response));
      return createSuccessResponse({ launchId, addUUIDs, removeUUIDs }, 'editContentFragmentLaunchSources');
    }, 'editContentFragmentLaunchSources');
  }
}
