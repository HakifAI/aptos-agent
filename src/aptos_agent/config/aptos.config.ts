import { Network } from "@aptos-labs/ts-sdk";

/**
 * Aptos blockchain configuration
 * You can change the network based on your deployment environment
 */
export const APTOS_CONFIG = {
  // Change this to Network.TESTNET or Network.DEVNET for testing
  network: (process.env.APTOS_NETWORK as Network) || Network.TESTNET,

  // RPC URL can be overridden if needed
  rpcUrl: process.env.APTOS_RPC_URL,

  // // Default gas settings
  maxGasAmount: 20000,
  gasUnitPrice: 100,
};

/**
 * Get network display name for logging
 */
export function getNetworkName(): string {
  switch (APTOS_CONFIG.network) {
    case Network.MAINNET:
      return "Mainnet";
    case Network.TESTNET:
      return "Testnet";
    case Network.DEVNET:
      return "Devnet";
    default:
      return "Unknown";
  }
}

export const TOKEN_REGISTRY: Record<
  string,
  { assetType: string; name: string; symbol: string; decimals: number }
> = {
  // Native APT
  APT: {
    assetType: "0x1::aptos_coin::AptosCoin",
    name: "Aptos Token",
    symbol: "APT",
    decimals: 8,
  },
  APTOS: {
    assetType: "0x1::aptos_coin::AptosCoin",
    name: "Aptos Token",
    symbol: "APT",
    decimals: 8,
  },

  // Stablecoins
  USDC: {
    assetType:
      "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
  },
  USDT: {
    assetType:
      "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b",
    name: "Tether USD",
    symbol: "USDT",
    decimals: 6,
  },

  // Wrapped tokens
  WETH: {
    assetType:
      "0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::WETH",
    name: "Wrapped Ethereum (LayerZero WETH)",
    symbol: "lzWETH",
    decimals: 8,
  },
  WBTC: {
    assetType:
      "0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::WBTC",
    name: "Wrapped BTC (LayerZero WBTC)",
    symbol: "lzWBTC",
    decimals: 8,
  },

  // Other popular tokens (these addresses are examples - update with real addresses)
  BNB: {
    assetType:
      "0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::BNB",
    name: "Binance Coin",
    symbol: "BNB",
    decimals: 8,
  },
  SOL: {
    assetType:
      "0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::SOL",
    name: "Solana",
    symbol: "SOL",
    decimals: 8,
  },
};
