import { Aptos } from "@aptos-labs/ts-sdk";
import { APTOS_CONFIG, TOKEN_REGISTRY } from "../config/aptos.config.js";
import { DexName } from "../types/function-type.enum.js";
import {
  IDEXService,
  Pool,
  PoolSearchParams,
  SwapParams,
  SwapResult,
  AmountEstimation,
} from "../types/dex.types.js";

interface PairCache {
  [key: string]: {
    data: any;
    timestamp: number;
  };
}

let pairCache: PairCache = {};
const PAIR_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

interface RouteInfo {
  type: 'direct' | 'doublehop' | 'triplehop';
  path: string[];
  estimatedOutput: number;
}

export class PancakeSwapService implements IDEXService {
  getDexName(): DexName {
    return DexName.PANCAKESWAP;
  }

  private getPairCacheKey(resourceAccount: string, tokenA: string, tokenB: string): string {
    const [sortedX, sortedY] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
    return `${resourceAccount}_${sortedX}_${sortedY}`;
  }

  private getCachedPairData(cacheKey: string): any | null {
    if (Math.random() < 0.1) {
      this.cleanExpiredCache();
    }

    const cached = pairCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp) < PAIR_CACHE_DURATION) {
      return cached.data;
    }
    return null;
  }

  private setCachedPairData(cacheKey: string, data: any): void {
    pairCache[cacheKey] = {
      data,
      timestamp: Date.now()
    };
  }

  static clearPairCache(): void {
    pairCache = {};
  }

  private cleanExpiredCache(): void {
    const now = Date.now();
    const expiredKeys = Object.keys(pairCache).filter(key =>
      (now - pairCache[key].timestamp) >= PAIR_CACHE_DURATION
    );

    expiredKeys.forEach(key => {
      delete pairCache[key];
    });
  }

  static getCacheStats(): { totalEntries: number; cacheSize: number } {
    const totalEntries = Object.keys(pairCache).length;
    const cacheSize = JSON.stringify(pairCache).length;
    return { totalEntries, cacheSize };
  }

  async findPools(params: PoolSearchParams): Promise<Pool[]> {
    const { dex, tokenAddressIn, tokenAddressOut, aptosClient } = params;
    if (!tokenAddressIn || !tokenAddressOut) {
      // console.log("PancakeSwap: Missing token addresses");
      return [];
    }
    const tokenInSupported = await this.exitsTokens(tokenAddressIn);
    const tokenOutSupported = await this.exitsTokens(tokenAddressOut);

    if (!tokenInSupported) {
      // console.log(`PancakeSwap: Token ${tokenAddressIn} is not supported`);
      return [];
    }

    if (!tokenOutSupported) {
      // console.log(`PancakeSwap: Token ${tokenAddressOut} is not supported`);
      return [];
    }
    // Find the best routing path (direct, double-hop, or triple-hop)
    const routeInfo = await this.getRoutingPath(
      dex.methodAddress || "",
      tokenAddressIn,
      tokenAddressOut
    );

    if (!routeInfo) {
      // console.log("PancakeSwap: No routing path found");
      return [];
    }

    return [{
      id: dex.methodAddress,
      dex,
      tokenA: tokenAddressIn,
      tokenB: tokenAddressOut,
      pool_address: dex.methodAddress,
      token_a: tokenAddressIn,
      token_b: tokenAddressOut,
      routeType: routeInfo.type,
      routePath: routeInfo.path,
      estimatedOutput: routeInfo.estimatedOutput,
    }];
  }

  async estimateAmountOut(
    pool: Pool,
    amountIn: number,
    aptosClient: Aptos
  ): Promise<AmountEstimation> {
    const resourceAccount = String(pool.dex.methodAddress);

    try {
      let estimatedOutput: number;
      if ((pool as any).routeType && (pool as any).routePath) {
        const routeType = (pool as any).routeType;
        const routePath = (pool as any).routePath;

        // console.log('🔄 PancakeSwap Amount Estimation:', {
        //   routeType,
        //   routePath,
        //   amountIn
        // });

        if (routeType === 'direct') {
          const { reserve_in, reserve_out } = await this.getReserves(
            resourceAccount,
            routePath[0],
            routePath[1]
          );
          estimatedOutput = await this.getAmountOut(amountIn, reserve_in, reserve_out);
          
          // console.log('📊 Direct Route Calculation:', {
          //   reserve_in,
          //   reserve_out,
          //   estimatedOutput
          // });
        } else if (routeType === 'doublehop') {
          const { reserve_in: reserves1_in, reserve_out: reserves1_out } = await this.getReserves(
            resourceAccount,
            routePath[0], // tokenIn
            routePath[1]
          );
          const intermediateOutput = await this.getAmountOut(amountIn, reserves1_in, reserves1_out);

          const { reserve_in: reserves2_in, reserve_out: reserves2_out } = await this.getReserves(
            resourceAccount,
            routePath[1], // intermediate
            routePath[2]
          );
          estimatedOutput = await this.getAmountOut(intermediateOutput, reserves2_in, reserves2_out);

          // console.log('📊 Double Hop Calculation:', {
          //   step1: { reserve_in: reserves1_in, reserve_out: reserves1_out, intermediateOutput },
          //   step2: { reserve_in: reserves2_in, reserve_out: reserves2_out, finalOutput: estimatedOutput }
          // });
        } else {
          // Fallback for unknown route types
          estimatedOutput = Math.floor(amountIn * 0.9);
          // console.log('⚠️ Fallback Calculation:', { estimatedOutput });
        }
      } else {
        // Fallback to direct swap calculation
        const { reserve_in, reserve_out } = await this.getReserves(
          resourceAccount,
          pool.tokenA,
          pool.tokenB
        );
        estimatedOutput = await this.getAmountOut(amountIn, reserve_in, reserve_out);
        
        // console.log('📊 Fallback Direct Calculation:', {
        //   reserve_in,
        //   reserve_out,
        //   estimatedOutput
        // });
      }

      const slippage = 0.5; // Default slippage, will be overridden
      const minAmountOut = Math.floor(estimatedOutput * (1 - slippage / 100));

      // console.log('✅ PancakeSwap Final Estimation:', {
      //   amountIn,
      //   estimatedOutput,
      //   minAmountOut,
      //   slippage
      // });

      return {
        estimatedOutput,
        minAmountOut,
        slippage,
      };
    } catch (error) {
      // console.error("Could not calculate estimated output for PancakeSwap:", error);
      const estimatedOutput = Math.floor(amountIn * 0.9);
      const slippage = 0.5;
      const minAmountOut = Math.floor(estimatedOutput * (1 - slippage / 100));

      // console.log('⚠️ PancakeSwap Fallback Estimation:', {
      //   amountIn,
      //   estimatedOutput,
      //   minAmountOut,
      //   slippage
      // });

      return {
        estimatedOutput,
        minAmountOut,
        slippage,
      };
    }
  }

  async createSwapTransaction(params: SwapParams, pool: Pool): Promise<SwapResult> {
    const { account, aptosClient, tokenAddressIn, tokenAddressOut, amountIn, slippage } = params;
    const resourceAccount = String(pool.dex.methodAddress);

    // console.log('🔄 PancakeSwap Creating Swap Transaction:', {
    //   amountIn,
    //   slippage,
    //   tokenAddressIn,
    //   tokenAddressOut
    // });

    const estimation = await this.estimateAmountOut(pool, amountIn, aptosClient);
    const expectedAmountOut = estimation.estimatedOutput;
    const minAmountOut = Math.floor(expectedAmountOut * (1 - slippage / 100));

    // console.log('📊 PancakeSwap Transaction Details:', {
    //   expectedAmountOut,
    //   minAmountOut,
    //   slippageApplied: slippage
    // });

    const routeType = (pool as any).routeType || 'direct';
    const routePath = (pool as any).routePath || [tokenAddressIn, tokenAddressOut];

    // console.log("routeType", routeType);
    // console.log("PancakeSwap: routePath", pool);
    let payload: any;

    if (routeType === 'direct') {
      payload = {
        function: `${resourceAccount}::router::swap_exact_input` as `${string}::${string}::${string}`,
        typeArguments: [tokenAddressIn, tokenAddressOut],
        functionArguments: [amountIn.toString(), minAmountOut.toString()],
      };

    } else if (routeType === 'doublehop') {
      payload = {
        function: `${resourceAccount}::router::swap_exact_input_doublehop` as `${string}::${string}::${string}`,
        typeArguments: [routePath[0], routePath[1], routePath[2]],
        functionArguments: [amountIn.toString(), minAmountOut.toString()],
      };

    } else if (routeType === 'triplehop') {
      payload = {
        function: `${resourceAccount}::router::swap_exact_input_triplehop` as `${string}::${string}::${string}`,
        typeArguments: [routePath[0], routePath[1], routePath[2], routePath[3]],
        functionArguments: [amountIn.toString(), minAmountOut.toString()],
      };

    } else {
      throw new Error(`Unsupported route type: ${routeType}`);
    }

    // console.log('📦 PancakeSwap Transaction Payload:', payload);

    const transaction = await aptosClient.transaction.build.simple({
      sender: account.accountAddress,
      data: payload,
      options: {
        maxGasAmount: APTOS_CONFIG.maxGasAmount,
        gasUnitPrice: APTOS_CONFIG.gasUnitPrice,
      },
    });

    return {
      transaction,
      estimatedOutput: expectedAmountOut,
      minAmountOut,
    };
  }

  validatePool(pool: Pool, params: PoolSearchParams): boolean {
    const { tokenAddressIn, tokenAddressOut } = params;

    const tokenA = (pool.tokenA || "").toLowerCase();
    const tokenB = (pool.tokenB || "").toLowerCase();
    const poolTokens = [tokenA, tokenB].sort().join(",");
    const requestTokens = [
      tokenAddressIn?.toLowerCase() || "",
      tokenAddressOut?.toLowerCase() || "",
    ].sort().join(",");

    return poolTokens === requestTokens;
  }

  private async getReserves(
    resourceAccount: string,
    tokenA: string,
    tokenB: string
  ): Promise<{ reserve_in: number; reserve_out: number }> {
    const cacheKey = this.getPairCacheKey(resourceAccount, tokenA, tokenB);
    const cachedData = this.getCachedPairData(cacheKey);
    if (cachedData) {
      return cachedData;
    }
    const canonicalTokenA = tokenA === "0xa" ? "0x1::aptos_coin::AptosCoin" : tokenA;
    const canonicalTokenB = tokenB === "0xa" ? "0x1::aptos_coin::AptosCoin" : tokenB;

    const [sortedX, sortedY] = canonicalTokenA < canonicalTokenB ? [canonicalTokenA, canonicalTokenB] : [canonicalTokenB, canonicalTokenA];
    const TYPE = `${resourceAccount}::swap::TokenPairReserve<${sortedX}, ${sortedY}>`;
    const encodedType = encodeURIComponent(TYPE);
    const url = `https://aptos-mainnet.nodereal.io/v1/6efc9017db4344dca3fa89e579f67725/v1/accounts/${resourceAccount}/resource/${encodedType}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
        },
      });

      if (response.status === 404) {
        throw new Error(
          `TokenPairReserve not found for ${canonicalTokenA} <-> ${canonicalTokenB}. This pair might not exist on PancakeSwap.`
        );
      }

      if (response.status !== 200) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const json = await response.json();

      if (!json.data || typeof json.data !== "object") {
        throw new Error("Malformed TokenPairReserve resource: missing data");
      }

      const data = json.data as {
        reserve_x: number | string;
        reserve_y: number | string;
      };

      if (data.reserve_x === undefined || data.reserve_y === undefined) {
        throw new Error("Malformed TokenPairReserve resource: missing reserve_x or reserve_y");
      }

      // Determine if tokens are in reversed order
      const isReversed = canonicalTokenA > canonicalTokenB;

      const result = isReversed ? {
        reserve_in: Number(data.reserve_y),
        reserve_out: Number(data.reserve_x),
      } : {
        reserve_in: Number(data.reserve_x),
        reserve_out: Number(data.reserve_y),
      };

      this.setCachedPairData(cacheKey, result);

      return result;
    } catch (error) {
      // console.error(`Error fetching reserves for ${canonicalTokenA} <-> ${canonicalTokenB}:`, error);
      throw error;
    }
  }

  private async getRoutingPath(
    resourceAccount: string,
    tokenIn: string,
    tokenOut: string
  ): Promise<RouteInfo | null> {
    try {
      const directRoute = await this.tryDirectSwap(resourceAccount, tokenIn, tokenOut);
      if (directRoute) {
        // console.log(`PancakeSwap: Found direct route for ${tokenIn} -> ${tokenOut}`);
        return directRoute;
      }
      const intermediateRoute = await this.findIntermediateRoute(resourceAccount, tokenIn, tokenOut);
      // console.log("intermediateRoute", intermediateRoute);

      if (intermediateRoute) {
        // console.log(`PancakeSwap: Found intermediate route: ${intermediateRoute.path.join(' -> ')}`);
        return intermediateRoute;
      }

      // console.log(`PancakeSwap: No valid route found for ${tokenIn} -> ${tokenOut}`);
      return null;
    } catch (error) {
      // console.error("Error finding routing path:", error);
      return null;
    }
  }

  private async findIntermediateRoute(
    resourceAccount: string,
    tokenIn: string,
    tokenOut: string
  ): Promise<RouteInfo | null> {
    try {
      // Get all supported tokens as potential intermediates
      const allSupportedTokens = await this.getAllSupportedTokens();
      const supportedAddresses = allSupportedTokens.map(token => token.address);

      const potentialIntermediates = supportedAddresses.filter(
        addr => addr !== tokenIn && addr !== tokenOut
      );

      // console.log(`PancakeSwap: Checking ${potentialIntermediates.length} potential intermediate tokens`);

      // console.log("potentialIntermediates checking", potentialIntermediates);

      // Try each intermediate token
      for (const intermediate of potentialIntermediates) {
        try {
          const leg1Exists = await this.checkPairExists(resourceAccount, tokenIn, intermediate);
          const leg2Exists = await this.checkPairExists(resourceAccount, intermediate, tokenOut);
          // console.log("leg1Exists, leg2Exists, tokenIn, intermediate, tokenOut", leg1Exists, leg2Exists, tokenIn, intermediate, tokenOut);

          if (leg1Exists && leg2Exists) {
            return {
              type: 'doublehop',
              path: [tokenIn, intermediate, tokenOut],
              estimatedOutput: 0 // Will be calculated later
            };
          }
        } catch (error) {
          continue;
        }
      }

      return null;
    } catch (error) {
      // console.error("Error finding intermediate route:", error);
      return null;
    }
  }

  private async checkPairExists(
    resourceAccount: string,
    tokenA: string,
    tokenB: string
  ): Promise<boolean> {
    try {
      const cacheKey = `exists_${this.getPairCacheKey(resourceAccount, tokenA, tokenB)}`;
      const cachedData = this.getCachedPairData(cacheKey);
      if (cachedData !== null) {
        return cachedData;
      }

      const canonicalTokenA = tokenA === "0xa" ? "0x1::aptos_coin::AptosCoin" : tokenA;
      const canonicalTokenB = tokenB === "0xa" ? "0x1::aptos_coin::AptosCoin" : tokenB;

      const [sortedX, sortedY] = canonicalTokenA < canonicalTokenB ? [canonicalTokenA, canonicalTokenB] : [canonicalTokenB, canonicalTokenA];
      const TYPE = `${resourceAccount}::swap::TokenPairReserve<${sortedX}, ${sortedY}>`;

      const encodedType = encodeURIComponent(TYPE);

      const url = `https://aptos-mainnet.nodereal.io/v1/6efc9017db4344dca3fa89e579f67725/v1/accounts/${resourceAccount}/resource/${encodedType}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
        },
      });

      const exists = response.status === 200;

      this.setCachedPairData(cacheKey, exists);

      return exists;
    } catch (error) {
      return false;
    }
  }

  private async tryDirectSwap(
    resourceAccount: string,
    tokenIn: string,
    tokenOut: string
  ): Promise<RouteInfo | null> {
    try {
      const pairExists = await this.checkPairExists(resourceAccount, tokenIn, tokenOut);
      if (pairExists) {
        return {
          type: 'direct',
          path: [tokenIn, tokenOut],
          estimatedOutput: 0
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private async getAmountOut(
    amount_in: number,
    reserve_in: number,
    reserve_out: number
  ): Promise<number> {
    if (amount_in <= 0) throw new Error("ERROR_INSUFFICIENT_INPUT_AMOUNT");
    if (reserve_in <= 0 || reserve_out <= 0)
      throw new Error("ERROR_INSUFFICIENT_LIQUIDITY");

    const amount_in_with_fee = amount_in * 0.9975;
    const numerator = amount_in_with_fee * reserve_out;
    const denominator = reserve_in * 1 + amount_in_with_fee;
    return Math.floor(numerator / denominator);
  }

  private static tokenListCache: {
    tokens: any[];
    timestamp: number;
  } | null = null;

  private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  private async getTokenList(): Promise<any[]> {
    const now = Date.now();
    if (PancakeSwapService.tokenListCache &&
      (now - PancakeSwapService.tokenListCache.timestamp) < PancakeSwapService.CACHE_DURATION) {
      return PancakeSwapService.tokenListCache.tokens;
    }

    try {
      // PancakeSwap Aptos Token List API
      const response = await fetch('https://tokens.pancakeswap.finance/pancakeswap-aptos.json');
      if (!response.ok) {
        // console.warn('Failed to fetch PancakeSwap token list');
        return [];
      }

      const tokenList = await response.json();
      const tokens = tokenList.tokens || [];

      // Update cache
      PancakeSwapService.tokenListCache = {
        tokens,
        timestamp: now
      };

      return tokens;
    } catch (error) {
      // console.error('Error fetching PancakeSwap token list:', error);
      return [];
    }
  }

  private async exitsTokens(tokenAddress: string): Promise<boolean> {
    try {
      const tokens = await this.getTokenList();

      // Normalize token address for comparison
      let normalizedTokenAddress = tokenAddress.toLowerCase();

      // Handle special cases for APT token - chỉ cần chứa '::'
      if (normalizedTokenAddress === "0xa" ||
        normalizedTokenAddress.includes("::")) {
        normalizedTokenAddress = "0x1::aptos_coin::aptoscoin";
      }

      // Check if token exists in the list
      const tokenExists = tokens.some((token: any) => {
        const tokenAddr = token.address?.toLowerCase();
        return tokenAddr === normalizedTokenAddress;
      });

      return tokenExists;
    } catch (error) {
      // console.error('Error checking token existence in PancakeSwap:', error);
      return false;
    }
  }

  // Public method to get token info from PancakeSwap list
  async getTokenInfo(tokenAddress: string): Promise<any | null> {
    try {
      const tokens = await this.getTokenList();

      // Normalize token address for comparison
      let normalizedTokenAddress = tokenAddress.toLowerCase();

      // Handle special cases for APT token - chỉ cần chứa '::'
      if (normalizedTokenAddress === "0xa" ||
        normalizedTokenAddress.includes("::")) {
        normalizedTokenAddress = "0x1::aptos_coin::aptoscoin";
      }

      // Find token in the list
      const token = tokens.find((token: any) => {
        const tokenAddr = token.address?.toLowerCase();
        return tokenAddr === normalizedTokenAddress;
      });

      return token || null;
    } catch (error) {
      // console.error('Error getting token info from PancakeSwap:', error);
      return null;
    }
  }

  // Public method to get all supported tokens
  async getAllSupportedTokens(): Promise<any[]> {
    try {
      return await this.getTokenList();
    } catch (error) {
      // console.error('Error getting all supported tokens:', error);
      return [];
    }
  }

  static clearCache(): void {
    PancakeSwapService.tokenListCache = null;
  }
} 