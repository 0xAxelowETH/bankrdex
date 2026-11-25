export interface BinanceWeb3Credentials {
  apiKey: string | undefined;
  secretKey: string | undefined;
}

// Only Binance-specific names: generic API_KEY/SECRET_KEY could belong to another service.
export function getBinanceWeb3Credentials(
  env: Record<string, string | undefined> = process.env
): BinanceWeb3Credentials {
  return {
    apiKey: env.BINANCE_WEB3_API_KEY?.trim() || env.BINANCE_API_KEY?.trim(),
    secretKey: env.BINANCE_WEB3_SECRET_KEY?.trim() || env.BINANCE_SECRET_KEY?.trim(),
  };
}
