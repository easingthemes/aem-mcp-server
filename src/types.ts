export type CliParams = {
  host?: string;
  user?: string;
  pass?: string;
  id?: string;
  secret?: string;
  mcpPort?: number;
  mcpHost?: string;
  transport?: 'http' | 'stdio';
  instances?: string;
};

export type InstanceConfig = {
  name: string;
  host: string;
  user: string;
  pass: string;
  id?: string;
  secret?: string;
};
