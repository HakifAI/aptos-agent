import { TOKEN_REGISTRY } from "../config/aptos.config.js";

// Cache for token registry lookups
const tokenRegistryCache = new Map<string, any>();

// Initialize cache
function initializeTokenCache() {
  if (tokenRegistryCache.size === 0) {
    Object.values(TOKEN_REGISTRY).forEach((token) => {
      tokenRegistryCache.set(token.assetType, token);
    });
  }
}

/**
 * Gets token information by coin type address
 * @param assetType The coin type address
 * @returns Token information if found
 */
export function getTokenInfoByAssetType(assetType: string) {
  initializeTokenCache();
  return tokenRegistryCache.get(assetType);
}

/**
 * Gets token decimals for a given coin type
 * @param assetType The coin type address
 * @returns Number of decimals or 0 if not found
 */
export function getTokenDecimals(assetType: string): number {
  const token = getTokenInfoByAssetType(assetType);
  return token?.decimals || 0;
}

/**
 * Gets token symbol for a given coin type
 * @param assetType The coin type address
 * @returns Symbol or fallback to the last part of the coin type
 */
export function getTokenSymbol(assetType: string): string {
  const token = getTokenInfoByAssetType(assetType);
  if (token) {
    return token.symbol;
  }

  // Fallback to extracting from the coin type
  return assetType.split("::").pop() || "Unknown";
}

/**
 * Formats a token amount based on its decimals
 * @param amount Amount in smallest unit
 * @param decimals Number of decimals for the token
 * @returns Formatted amount as string
 */
export function formatTokenAmount(amount: string, decimals: number): string {
  if (decimals > 0) {
    const amountNum = parseFloat(amount);
    return (amountNum / Math.pow(10, decimals)).toString();
  }
  return amount;
}

/**
 * Calculate gas fee information from transaction details
 * @param transactionData Transaction data containing gas_used and gas_unit_price
 * @returns Gas fee information including costs in Octas and APT
 */
export function calculateGasFee(transactionData: any) {
  const gasUsed = parseInt(transactionData.gas_used || "0");
  const gasUnitPrice = parseInt(transactionData.gas_unit_price || "0");

  // Calculate total gas fee in Octas (smallest unit of APT)
  const gasFeeInOctas = gasUsed * gasUnitPrice;

  // Convert to APT (1 APT = 100,000,000 Octas)
  const gasFeeInAPT = gasFeeInOctas / 100_000_000;

  return {
    gasUsed,
    gasUnitPrice,
    gasFeeInOctas,
    gasFeeInAPT: gasFeeInAPT.toString(),
    gasFeeFormatted: `${gasFeeInAPT} APT`,
  };
}

/**
 * Convert Octas to APT
 * @param octas Amount in Octas
 * @returns Amount in APT as string
 */
export function octasToAPT(octas: string | number): string {
  const octasNum = typeof octas === "string" ? parseFloat(octas) : octas;
  return (octasNum / 100_000_000).toString();
}

/**
 * Convert APT to Octas
 * @param apt Amount in APT
 * @returns Amount in Octas as string
 */
export function aptToOctas(apt: string | number): string {
  const aptNum = typeof apt === "string" ? parseFloat(apt) : apt;
  return (aptNum * 100_000_000).toString();
}
