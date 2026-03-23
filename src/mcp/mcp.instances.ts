import { MCPRequestHandler } from './mcp.aem-handler.js';
import { CliParams, InstanceConfig } from '../types.js';
import { LOGGER } from '../utils/logger.js';

/**
 * Registry of named AEM instances. Each instance has its own MCPRequestHandler
 * with independent connection config (host, auth).
 *
 * Parse format: "name:host:user:pass,name2:host2:user2:pass2"
 * URLs with protocol: "name:https://host:user:pass"
 */
export class InstanceRegistry {
  private handlers: Map<string, MCPRequestHandler> = new Map();
  private defaultInstance: string;

  constructor(cliParams: CliParams) {
    const instances = this.parseInstances(cliParams);

    for (const inst of instances) {
      const handlerParams: CliParams = {
        host: inst.host,
        user: inst.user,
        pass: inst.pass,
        id: inst.id,
        secret: inst.secret,
      };
      this.handlers.set(inst.name, new MCPRequestHandler(handlerParams));
      LOGGER.log(`Registered AEM instance: "${inst.name}" → ${inst.host}`);
    }

    this.defaultInstance = instances[0].name;
    LOGGER.log(`Default instance: "${this.defaultInstance}"`);
  }

  private parseInstances(params: CliParams): InstanceConfig[] {
    if (params.instances) {
      const entries = params.instances.split(',').map((s) => s.trim()).filter(Boolean);
      const instances: InstanceConfig[] = [];

      for (const entry of entries) {
        const parts = entry.split(':');
        if (parts.length < 4) {
          LOGGER.error(`Invalid instance format: "${entry}" — expected "name:host:user:pass" or "name:https://host:user:pass"`);
          continue;
        }

        let name: string, host: string, user: string, pass: string;

        if (parts[1]?.startsWith('//') || parts[2]?.startsWith('//')) {
          name = parts[0];
          // Reconstruct protocol://host, then check if next part is a numeric port
          host = parts[1] + ':' + parts[2];
          let nextIdx = 3;
          if (parts[nextIdx] && /^\d+$/.test(parts[nextIdx])) {
            host += ':' + parts[nextIdx];
            nextIdx++;
          }
          user = parts[nextIdx] || 'admin';
          pass = parts.slice(nextIdx + 1).join(':') || 'admin';
        } else {
          name = parts[0];
          host = parts[1];
          user = parts[2];
          pass = parts.slice(3).join(':');
          if (!host.startsWith('http')) {
            host = `http://${host}`;
          }
        }

        instances.push({
          name,
          host,
          user: user || 'admin',
          pass: pass || 'admin',
        });
      }

      if (instances.length === 0) {
        throw new Error('No valid instances parsed from --instances flag');
      }
      return instances;
    }

    return [{
      name: 'default',
      host: params.host || 'http://localhost:4502',
      user: params.user || 'admin',
      pass: params.pass || 'admin',
      id: params.id,
      secret: params.secret,
    }];
  }

  getHandler(instanceName?: string): MCPRequestHandler {
    const name = instanceName || this.defaultInstance;
    const handler = this.handlers.get(name);
    if (!handler) {
      const available = Array.from(this.handlers.keys()).join(', ');
      throw new Error(`Unknown AEM instance: "${name}". Available: ${available}`);
    }
    return handler;
  }

  getDefaultName(): string {
    return this.defaultInstance;
  }

  getInstanceNames(): string[] {
    return Array.from(this.handlers.keys());
  }
}
