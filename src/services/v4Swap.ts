// Direct swaps against a Bankr token's own Uniswap V4 pool on Base, through Uniswap's Universal
// Router. No aggregator API: the pool key comes from the on-chain index (/api/market/pool) and
// quotes from Uniswap's V4Quoter.
//
// Buy  (pool paired with WETH): fee in ETH -> wrap the rest -> V4 swap WETH -> token -> to the user.
// Sell (any quote): fee in the token via Permit2 -> V4 swap token -> quote -> unwrap WETH to ETH.
// The BankrDex fee (0.1% of the input) is part of the same transaction, like the aggregator path.
// Pure functions (viem only), so scripts can import this file to simulate swaps.
import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Hex } from 'viem';

export const UNIVERSAL_ROUTER = '0x6ff5693b99212da76ad316178a184ab56d299b43';
export const V4_QUOTER = '0x0d5e0f971ed27fbff6c2837bf31316121532048d';
export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
export const WETH = '0x4200000000000000000000000000000000000006';
export const NATIVE = '0x0000000000000000000000000000000000000000';

// Uniswap V4 deployments used for direct swaps (Uniswap/contracts deployments/json/<chainId>.json).
// Robinhood's Bankr pools use the DopplerHookInitializer 0x4e34…a544 as their V4 hook.
export interface V4Deployment {
  chainId: number;
  router: string;
  quoter: string;
  weth: string;
  hooks: string[];
  // Universal Router 2.1+ (v4-periphery with ExactInputSingleParams.minHopPriceX36).
  minHopPrice?: boolean;
}
export const V4_DEPLOYMENTS: Record<string, V4Deployment> = {
  base: { chainId: 8453, router: UNIVERSAL_ROUTER, quoter: V4_QUOTER, weth: WETH, hooks: [] },
  robinhood: {
    chainId: 4663,
    router: '0x204faca1764b154221e35c0d20abb3c525710498',
    quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
    weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
    hooks: ['0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544'],
    minHopPrice: true,
  },
};

// Universal Router commands and V4Router actions (Uniswap v4-periphery / universal-router).
const COMMAND = { PERMIT2_TRANSFER_FROM: 0x02, TRANSFER: 0x05, PERMIT2_PERMIT: 0x0a, WRAP_ETH: 0x0b, UNWRAP_WETH: 0x0c, V4_SWAP: 0x10 } as const;
const ACTION = { SWAP_EXACT_IN_SINGLE: 0x06, SETTLE: 0x0b, SETTLE_ALL: 0x0c, TAKE: 0x0e, TAKE_ALL: 0x0f } as const;
const MSG_SENDER = '0x0000000000000000000000000000000000000001';
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002';

export interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export const routerAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
export const quoterAbi = parseAbi([
  'function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)',
]);
export const permit2Abi = parseAbi(['function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)']);

const POOL_KEY = '(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)';
const poolKeyTuple = (key: PoolKey) => ({
  currency0: key.currency0 as Hex,
  currency1: key.currency1 as Hex,
  fee: key.fee,
  tickSpacing: key.tickSpacing,
  hooks: key.hooks as Hex,
});

export function poolKeyFor(token: string, quote: string, hooks: string, fee = 0x800000, tickSpacing = 200): PoolKey {
  const [currency0, currency1] = BigInt(token) < BigInt(quote) ? [token, quote] : [quote, token];
  return { currency0: currency0.toLowerCase(), currency1: currency1.toLowerCase(), fee, tickSpacing, hooks: hooks.toLowerCase() };
}

export const platformFee = (amount: bigint, feeBps: number) => (amount * BigInt(feeBps)) / 10_000n;

export function quoteCall(key: PoolKey, tokenIn: string, amountIn: bigint): Hex {
  return encodeFunctionData({
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: poolKeyTuple(key), zeroForOne: tokenIn.toLowerCase() === key.currency0, exactAmount: amountIn, hookData: '0x' }],
  });
}

function v4SwapInput(key: PoolKey, tokenIn: string, amountIn: bigint, minOut: bigint, settle: Hex, take: Hex, actions: number[], minHopPrice = false): Hex {
  const zeroForOne = tokenIn.toLowerCase() === key.currency0;
  const swap = minHopPrice
    ? encodeAbiParameters(
      parseAbiParameters(`(${POOL_KEY} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, uint256 minHopPriceX36, bytes hookData)`),
      [{ poolKey: poolKeyTuple(key), zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: '0x' }],
    )
    : encodeAbiParameters(
      parseAbiParameters(`(${POOL_KEY} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`),
      [{ poolKey: poolKeyTuple(key), zeroForOne, amountIn, amountOutMinimum: minOut, hookData: '0x' }],
    );
  return encodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), [
    `0x${actions.map((action) => action.toString(16).padStart(2, '0')).join('')}` as Hex,
    [swap, settle, take],
  ]);
}

export interface BuiltSwap {
  to: string;
  data: Hex;
  value: bigint;
}

// Buy a WETH-paired token with native ETH. `amountIn` is the total ETH the user pays.
export function buildBuyWithEth(params: {
  key: PoolKey;
  token: string;
  amountIn: bigint;
  minOut: bigint;
  feeBps: number;
  feeRecipient: string;
  deadline: bigint;
  router?: string;
  weth?: string;
  minHopPrice?: boolean;
}): BuiltSwap {
  const weth = params.weth ?? WETH;
  const fee = platformFee(params.amountIn, params.feeBps);
  const swapAmount = params.amountIn - fee;
  const commands: number[] = [];
  const inputs: Hex[] = [];
  if (fee > 0n) {
    commands.push(COMMAND.TRANSFER);
    inputs.push(encodeAbiParameters(parseAbiParameters('address token, address recipient, uint256 value'), [NATIVE, params.feeRecipient as Hex, fee]));
  }
  commands.push(COMMAND.WRAP_ETH);
  inputs.push(encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountMin'), [ADDRESS_THIS, swapAmount]));
  commands.push(COMMAND.V4_SWAP);
  inputs.push(v4SwapInput(
    params.key,
    weth,
    swapAmount,
    params.minOut,
    // Pay the pool from the router's WETH (payerIsUser = false), then send the token to the user.
    encodeAbiParameters(parseAbiParameters('address currency, uint256 amount, bool payerIsUser'), [weth as Hex, 0n, false]),
    encodeAbiParameters(parseAbiParameters('address currency, uint256 minAmount'), [params.token as Hex, params.minOut]),
    [ACTION.SWAP_EXACT_IN_SINGLE, ACTION.SETTLE, ACTION.TAKE_ALL],
    params.minHopPrice,
  ));
  return {
    to: params.router ?? UNIVERSAL_ROUTER,
    value: params.amountIn,
    data: encodeFunctionData({
      abi: routerAbi,
      functionName: 'execute',
      args: [`0x${commands.map((command) => command.toString(16).padStart(2, '0')).join('')}` as Hex, inputs, params.deadline],
    }),
  };
}

// Sell a token for its quote asset (unwrapped to ETH when the quote is WETH). Requires a Permit2
// allowance for the router (see `permitSingleTypedData`); the signature is passed in.
export function buildSell(params: {
  key: PoolKey;
  token: string;
  quote: string;
  amountIn: bigint;
  minOut: bigint;
  feeBps: number;
  feeRecipient: string;
  deadline: bigint;
  permit?: { details: { token: string; amount: bigint; expiration: number; nonce: number }; spender: string; sigDeadline: bigint; signature: Hex };
  router?: string;
  weth?: string;
  minHopPrice?: boolean;
}): BuiltSwap {
  const weth = params.weth ?? WETH;
  const fee = platformFee(params.amountIn, params.feeBps);
  const swapAmount = params.amountIn - fee;
  const toEth = params.quote.toLowerCase() === weth.toLowerCase();
  const commands: number[] = [];
  const inputs: Hex[] = [];
  if (params.permit) {
    commands.push(COMMAND.PERMIT2_PERMIT);
    inputs.push(encodeAbiParameters(
      parseAbiParameters('((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature'),
      [{
        details: { token: params.permit.details.token as Hex, amount: params.permit.details.amount, expiration: params.permit.details.expiration, nonce: params.permit.details.nonce },
        spender: params.permit.spender as Hex,
        sigDeadline: params.permit.sigDeadline,
      }, params.permit.signature],
    ));
  }
  if (fee > 0n) {
    commands.push(COMMAND.PERMIT2_TRANSFER_FROM);
    inputs.push(encodeAbiParameters(parseAbiParameters('address token, address recipient, uint160 amount'), [params.token as Hex, params.feeRecipient as Hex, fee]));
  }
  commands.push(COMMAND.V4_SWAP);
  inputs.push(v4SwapInput(
    params.key,
    params.token,
    swapAmount,
    params.minOut,
    // The user pays the pool through Permit2 (SETTLE_ALL); WETH output stays in the router to be
    // unwrapped, any other quote goes straight to the user.
    encodeAbiParameters(parseAbiParameters('address currency, uint256 maxAmount'), [params.token as Hex, swapAmount]),
    toEth
      ? encodeAbiParameters(parseAbiParameters('address currency, address recipient, uint256 amount'), [weth as Hex, ADDRESS_THIS, 0n])
      : encodeAbiParameters(parseAbiParameters('address currency, uint256 minAmount'), [params.quote as Hex, params.minOut]),
    [ACTION.SWAP_EXACT_IN_SINGLE, ACTION.SETTLE_ALL, toEth ? ACTION.TAKE : ACTION.TAKE_ALL],
    params.minHopPrice,
  ));
  if (toEth) {
    commands.push(COMMAND.UNWRAP_WETH);
    inputs.push(encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountMin'), [MSG_SENDER, params.minOut]));
  }
  return {
    to: params.router ?? UNIVERSAL_ROUTER,
    value: 0n,
    data: encodeFunctionData({
      abi: routerAbi,
      functionName: 'execute',
      args: [`0x${commands.map((command) => command.toString(16).padStart(2, '0')).join('')}` as Hex, inputs, params.deadline],
    }),
  };
}

// EIP-712 typed data for a Permit2 PermitSingle letting the Universal Router pull `amount`.
export function permitSingleTypedData(params: { token: string; amount: bigint; nonce: number; expiration: number; sigDeadline: bigint; chainId: number; spender?: string }) {
  return {
    domain: { name: 'Permit2', chainId: params.chainId, verifyingContract: PERMIT2 as Hex },
    types: {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    primaryType: 'PermitSingle' as const,
    message: {
      details: { token: params.token as Hex, amount: params.amount, expiration: params.expiration, nonce: params.nonce },
      spender: (params.spender ?? UNIVERSAL_ROUTER) as Hex,
      sigDeadline: params.sigDeadline,
    },
  };
}
