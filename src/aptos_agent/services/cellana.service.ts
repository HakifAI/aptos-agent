import { Aptos } from "@aptos-labs/ts-sdk";
import { APTOS_CONFIG } from "../config/aptos.config.js";
import { DexName } from "../types/function-type.enum.js";
import {
  IDEXService,
  Pool,
  PoolSearchParams,
  SwapParams,
  SwapResult,
  AmountEstimation,
} from "../types/dex.types.js";

export class CellanaService implements IDEXService {
  getDexName(): DexName {
    return DexName.CELLANA;
  }

  async findPools(params: PoolSearchParams): Promise<Pool[]> {
    const { dex, tokenAddressIn, tokenAddressOut, aptosClient, faAddressIn, faAddressOut } = params;

    // Convert "0xa" to "0x1::aptos_coin::AptosCoin" for Cellana
    let addressIn = faAddressIn || tokenAddressIn;
    let addressOut = faAddressOut || tokenAddressOut;
    
    // Handle APT token conversion
    if (addressIn === "0xa") {
      addressIn = "0x1::aptos_coin::AptosCoin";
    }
    if (addressOut === "0xa") {
      addressOut = "0x1::aptos_coin::AptosCoin";
    }
    
    if (!addressIn || !addressOut) {
      return [];
    }

    try {
      const axios = (await import("axios")).default;
      const response = await axios.post(
        "https://api-v2.cellana.finance/api/v1/pool/router",
        {
          address0: addressIn,
          address1: addressOut,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = response.data;

      if (
        data.code !== 200 ||
        !data.data?.path ||
        data.data.path.length === 0
      ) {
        return [];
      }

      let bestPath = data.data.path[0];
      let maxAmountOut = 0;

      // Find best path with highest output
      for (const path of data.data.path) {
        try {
          const wrapToAddresses = path.routers.map((router: any) => router.wrapTo);
          const stableFlags = path.routers.map((router: any) => router.stable || false);

          const amountOutResult = await this.getCellanaAmountOut(
            aptosClient,
            dex.methodAddress,
            1000000, // Test amount
            path.routers[0].wrapFrom,
            wrapToAddresses,
            stableFlags
          );

          if (amountOutResult.amountOut > maxAmountOut) {
            maxAmountOut = amountOutResult.amountOut;
            bestPath = path;
          }
        } catch (error) {
          continue;
        }
      }

      // Calculate total fee rate
      let totalFeeRate = 0;
      for (const router of bestPath.routers) {
        try {
          const routerFeeRate = await this.getCellanaFeeRate(
            aptosClient,
            dex.methodAddress,
            router.poolAddress
          );
          totalFeeRate += routerFeeRate;
        } catch (error) {
          totalFeeRate += 10; // Default fee
        }
      }

      const pool: Pool = {
        id: bestPath.routers[0].poolAddress,
        dex,
        tokenA: addressIn,
        tokenB: addressOut,
        fee: totalFeeRate,
        // Cellana specific properties
        pool_address: {
          address: bestPath.routers[0].poolAddress,
          token_a: addressIn,
          token_b: addressOut,
        },
        token_a: addressIn,
        token_b: addressOut,
        stable: bestPath.routers.some((router: any) => router.stable),
        routers: bestPath.routers,
        routeType: 'multi-hop',
        routePath: [addressIn, ...bestPath.routers.map((r: any) => r.wrapTo)],
      };

      return [pool];
    } catch (error) {
      return [];
    }
  }

  async estimateAmountOut(
    pool: Pool,
    amountIn: number,
    aptosClient: Aptos
  ): Promise<AmountEstimation> {
    try {
      const routers = (pool as any).routers || [];
      if (routers.length === 0) {
        throw new Error("No routers found for Cellana pool");
      }

      const firstRouter = routers[0];
      const wrapToAddresses = routers.map((router: any) => router.wrapTo);
      const stableFlags = routers.map((router: any) => router.stable || false);

      const amountOutResult = await this.getCellanaAmountOut(
        aptosClient,
        pool.dex.methodAddress,
        amountIn,
        firstRouter.wrapFrom,
        wrapToAddresses,
        stableFlags
      );

      const estimatedOutput = amountOutResult.amountOut;

      return {
        estimatedOutput,
        minAmountOut: estimatedOutput, // Will be calculated with actual slippage in createSwapTransaction
        slippage: 0.5, // Default slippage - actual slippage will be applied during transaction creation
      };
    } catch (error) {
      throw error;
    }
  }

  async createSwapTransaction(params: SwapParams, pool: Pool): Promise<SwapResult> {
    const { 
      account, 
      aptosClient, 
      tokenAddressIn, 
      tokenAddressOut, 
      amountIn, 
      slippage, 
      toAddress 
    } = params;

    // Validate slippage parameter
    this.validateSlippage(slippage);

    const routerAddress = String(pool.dex.methodAddress);
    const routers = (pool as any).routers || [];
    
    if (routers.length === 0) {
      throw new Error("No routers found for Cellana pool");
    }

    const finalAddressIn = (pool as any).token_a || tokenAddressIn;
    const finalAddressOut = (pool as any).token_b || tokenAddressOut;

    // Calculate amount out and min amount out with slippage protection
    const estimation = await this.estimateAmountOut(pool, amountIn, aptosClient);
    const calculatedAmountOut = estimation.estimatedOutput;
    const minAmountOut = Math.floor(calculatedAmountOut * (1 - slippage / 100));

    // Create transaction payload based on token types
    // Cellana supports 4 different swap functions:
    // 1. swap_route_entry_both_coins - both tokens are coins (address contains ::)
    // 2. swap_route_entry_from_coin - input token is coin, output is FA
    // 3. swap_route_entry_to_coin - input token is FA, output is coin  
    // 4. swap_route_entry - both tokens are fungible assets
    let payload: any;
    const coinAddresses = routers.map((router: any) => router.wrapTo);
    const transactionStableFlags = routers.map((router: any) => router.stable || false);

    const isCoinAddress = (token: string) => {
      if (!token || typeof token !== 'string') return false;
      return token.includes('::');
    };

    if (isCoinAddress(finalAddressIn) && isCoinAddress(finalAddressOut)) {
      // Both tokens are coins
      payload = {
        function: `${routerAddress}::router::swap_route_entry_both_coins` as `${string}::${string}::${string}`,
        typeArguments: [finalAddressIn, finalAddressOut],
        functionArguments: [
          amountIn.toString(),
          minAmountOut.toString(),
          coinAddresses,
          transactionStableFlags,
          toAddress,
        ],
      };
    } else if (isCoinAddress(finalAddressIn)) {
      // Input token is coin
      payload = {
        function: `${routerAddress}::router::swap_route_entry_from_coin` as `${string}::${string}::${string}`,
        typeArguments: [finalAddressIn],
        functionArguments: [
          amountIn.toString(),
          minAmountOut.toString(),
          coinAddresses,
          transactionStableFlags,
          toAddress,
        ],
      };
    } else if (isCoinAddress(finalAddressOut)) {
      // Output token is coin
      payload = {
        function: `${routerAddress}::router::swap_route_entry_to_coin` as `${string}::${string}::${string}`,
        typeArguments: [finalAddressOut],
        functionArguments: [
          amountIn.toString(),
          minAmountOut.toString(),
          finalAddressIn,
          coinAddresses,
          transactionStableFlags,
          toAddress,
        ],
      };
    } else {
      // Both tokens are fungible assets
      payload = {
        function: `${routerAddress}::router::swap_route_entry` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [
          amountIn.toString(),
          minAmountOut.toString(),
          finalAddressIn,
          coinAddresses,
          transactionStableFlags,
          toAddress,
        ],
      };
    }

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
      estimatedOutput: calculatedAmountOut,
      minAmountOut,
    };
  }

  validatePool(pool: Pool, params: PoolSearchParams): boolean {
    if (!pool.routers || (pool as any).routers.length === 0) {
      return false;
    }

    const tokenA = pool.tokenA?.toLowerCase() || '';
    const tokenB = pool.tokenB?.toLowerCase() || '';
    const addressIn = (params.tokenAddressIn || params.faAddressIn)?.toLowerCase() || '';
    const addressOut = (params.tokenAddressOut || params.faAddressOut)?.toLowerCase() || '';

    return (tokenA === addressIn && tokenB === addressOut) ||
           (tokenA === addressOut && tokenB === addressIn);
  }

  private validateSlippage(slippage: number): void {
    if (typeof slippage !== 'number' || isNaN(slippage)) {
      throw new Error(`Invalid slippage type: ${typeof slippage}. Slippage must be a number`);
    }
    if (slippage < 0.1 || slippage > 50) {
      throw new Error(`Invalid slippage value: ${slippage}%. Slippage must be between 0.1% and 50%`);
    }
  }

  // Helper methods from original file
  private async getCellanaAmountOut(
    aptosClient: Aptos,
    routerAddress: string,
    amountIn: number,
    wrapFrom: string,
    wrapToAddresses: string[],
    stableFlags: boolean[]
  ): Promise<{ amountOut: number; fee: number }> {
    try {
      const U64_MAX = BigInt("18446744073709551615");
      const amountInBigInt = BigInt(amountIn);

      if (amountInBigInt > U64_MAX) {
        throw new Error(`Amount ${amountIn} exceeds u64 maximum value ${U64_MAX}`);
      }

      if (amountInBigInt <= 0) {
        throw new Error(`Amount ${amountIn} must be greater than 0`);
      }

      const result = await aptosClient.view({
        payload: {
          function: `${routerAddress}::router::get_amounts_out` as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [
            amountIn.toString(),
            wrapFrom,
            wrapToAddresses,
            stableFlags,
          ],
        },
      });

      if (Array.isArray(result) && result.length >= 1) {
        const amountOut = Number(result[0]);
        return { amountOut, fee: 0 };
      } else {
        throw new Error("Invalid response from get_amounts_out");
      }
    } catch (error) {
      throw error;
    }
  }

  private async getCellanaFeeRate(
    aptosClient: Aptos,
    routerAddress: string,
    poolObject: string
  ): Promise<number> {
    try {
      const result = await aptosClient.view({
        payload: {
          function: `${routerAddress}::liquidity_pool::swap_fee_bps` as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [poolObject],
        },
      });

      if (Array.isArray(result)) {
        const fee_rate = Number(result[0]);
        return fee_rate;
      } else {
        throw new Error("Invalid response from swap_fee_bps");
      }
    } catch (error) {
      throw error;
    }
  }
} 