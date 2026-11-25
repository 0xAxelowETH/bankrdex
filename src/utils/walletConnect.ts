import type { Eip1193Provider } from './web3';

export type WalletConnectProvider = Awaited<
  ReturnType<(typeof import('@walletconnect/ethereum-provider'))['default']['init']>
>;

let walletConnectProviderPromise: Promise<WalletConnectProvider> | null = null;

export function getWalletConnectProjectId(): string {
  return (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '').trim();
}

export async function getWalletConnectProvider(): Promise<WalletConnectProvider> {
  const projectId = getWalletConnectProjectId();
  if (!projectId) throw new Error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not configured.');

  if (!walletConnectProviderPromise) {
    walletConnectProviderPromise = import('@walletconnect/ethereum-provider').then(({ default: EthereumProvider }) =>
      EthereumProvider.init({
        projectId,
        optionalChains: [8453],
        showQrModal: true,
        // The SDK logs stale-pairing relay messages ("Failed to decode message from topic") at
        // error level although it recovers on its own; real failures still reject our calls.
        // Set to 'debug' temporarily when diagnosing WalletConnect issues.
        ...({ logger: 'fatal' } as Record<string, unknown>),
        metadata: {
          name: 'BankrDex',
          description: 'Base wallet connection for BankrDex',
          url: window.location.origin,
          icons: [],
        },
      }).then((provider) => {
        // Drop inactive pairings left by earlier page loads; their relay messages can no
        // longer be decrypted and only produce console noise. Active sessions are kept.
        void provider.signer.cleanupPendingPairings().catch(() => undefined);
        return provider;
      })
    );
  }

  try {
    return await walletConnectProviderPromise;
  } catch (error) {
    walletConnectProviderPromise = null;
    throw error;
  }
}

export function toEip1193Provider(provider: WalletConnectProvider): Eip1193Provider {
  return {
    request: (args) => provider.request(args),
    on: (event, callback) => provider.on(event as never, callback as never),
    removeListener: (event, callback) => provider.removeListener(event as never, callback as never),
    disconnect: () => provider.disconnect(),
  };
}