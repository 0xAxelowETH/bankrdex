export interface OkxDexCredentials {
  apiKey: string | undefined;
  secretKey: string | undefined;
  passphrase: string | undefined;
  projectId: string | undefined;
}

export function getOkxDexCredentials(env: Record<string, string | undefined> = process.env): OkxDexCredentials {
  return {
    apiKey: env.OKX_DEX_API_KEY || env.OKX_API_KEY,
    secretKey: env.OKX_DEX_SECRET_KEY || env.OKX_SECRET_KEY,
    passphrase: env.OKX_DEX_PASSPHRASE || env.OKX_PASSPHRASE,
    projectId: env.OKX_DEX_PROJECT_ID || env.OKX_PROJECT_ID,
  };
}
