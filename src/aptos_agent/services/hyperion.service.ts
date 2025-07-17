import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk";
import { APTOS_CONFIG } from "../config/aptos.config.js";
import { DexName, FunctionType } from "../types/function-type.enum.js";
import {
  IDEXService,
  Pool,
  PoolSearchParams,
  SwapParams,
  SwapResult,
  AmountEstimation,
} from "../types/dex.types.js";

export class HyperionService implements IDEXService {
  getDexName(): DexName {
    return DexName.HYPERION;
  }

  async findPools(params: PoolSearchParams): Promise<Pool[]> {
    const { dex, faAddressIn, faAddressOut, tokenAddressIn, tokenAddressOut } =
      params;
    const findPoolsFunction = dex.functions.find(
      (f) => f.functionType === FunctionType.FIND_POOLS && f.isActive
    );

    if (
      !findPoolsFunction ||
      !dex.methodAddress ||
      !findPoolsFunction.functionName
    ) {
      return [];
    }

    try {
      const methodAddress = String(dex.methodAddress);
      const functionName = String(findPoolsFunction.functionName);

      if (!functionName.includes("::")) {
        throw new Error(
          `Function name for Hyperion must be in the format 'module::function', got '${functionName}'`
        );
      }

      const [module, func] = functionName.split("::");
      if (!module || !func) {
        throw new Error(`Invalid functionName format: ${functionName}`);
      }

      const functionString =
        `${methodAddress}::${module}::${func}` as `${string}::${string}::${string}`;
      const aptosClient = new Aptos(
        new AptosConfig({ network: APTOS_CONFIG.network })
      );

      const result = await aptosClient.view({
        payload: {
          function: functionString,
          functionArguments: ["0", "20"],
          typeArguments: [],
        },
      });

      const pools = Array.isArray(result[0]) ? result[0] : [];

      // Lọc pool theo cặp token
      const filteredPools = pools.filter((pool) => {
        const poolTokenA = pool.token_a?.inner || pool.token_a;
        const poolTokenB = pool.token_b?.inner || pool.token_b;

        // Xác định tokenIn và tokenOut từ params
        const tokenIn = faAddressIn || tokenAddressIn;
        const tokenOut = faAddressOut || tokenAddressOut;

        // Kiểm tra cả hai chiều (A->B và B->A)
        const isMatch =
          (poolTokenA === tokenIn && poolTokenB === tokenOut) ||
          (poolTokenA === tokenOut && poolTokenB === tokenIn);

        return isMatch;
      });

      // Map và estimate amount out cho từng pool
      const poolsWithEstimation = await Promise.all(
        filteredPools.map(async (pool) => {
          const feeRateRaw = pool.fee_rate || 0;
          const feeRatePercentage =
            typeof feeRateRaw === "number"
              ? feeRateRaw / 10000
              : parseFloat(feeRateRaw) / 10000;

          const mappedPool = {
            id: pool.pool?.inner || pool.pool || pool.pool_address?.address,
            dex,
            tokenA: pool.token_a?.inner || pool.token_a,
            tokenB: pool.token_b?.inner || pool.token_b,
            fee: feeRatePercentage,
            token_a: pool.token_a,
            token_b: pool.token_b,
            pool: pool.pool,
            fee_rate: feeRateRaw,
            fee_rate_percentage: feeRatePercentage,
            ...pool,
          };

          // Estimate amount out để sort
          try {
            // Sử dụng 1 token làm test amount để sort pools
            const testAmountIn = 1000000; // 1 token default
            const estimation = await this.estimateAmountOut(
              mappedPool,
              testAmountIn,
              aptosClient
            );
            return {
              ...mappedPool,
              estimatedOutput: estimation.estimatedOutput,
              minAmountOut: estimation.minAmountOut,
            };
          } catch (error) {
            return {
              ...mappedPool,
              estimatedOutput: 0,
              minAmountOut: 0,
            };
          }
        })
      );

      // Sort theo estimatedOutput giảm dần và chỉ lấy top 5
      const sortedPools = poolsWithEstimation
        .filter((pool) => pool.estimatedOutput > 0) // Loại bỏ pool có estimatedOutput = 0
        .sort((a, b) => b.estimatedOutput - a.estimatedOutput)
        .slice(0, 5);

      return sortedPools;
    } catch (error) {
      return [];
    }
  }

  async estimateAmountOut(
    pool: Pool,
    amountIn: number,
    aptosClient: Aptos
  ): Promise<AmountEstimation> {
    const poolId = pool.id;
    const methodAddress = pool.dex.methodAddress;
    const tokenIn = pool.tokenA === "0xa" ? "0xa" : pool.tokenA;

    try {
      const result = await aptosClient.view({
        payload: {
          function: `${methodAddress}::pool_v3::get_amount_out`,
          typeArguments: [],
          functionArguments: [poolId, tokenIn, amountIn.toString()],
        },
      });

      const estimatedOutput = Number(result[0]);
      const slippage = 0.5; // Default slippage, will be overridden
      const minAmountOut = Math.floor(estimatedOutput * (1 - slippage / 100));

      return {
        estimatedOutput,
        minAmountOut,
        slippage,
      };
    } catch (error) {
      const estimatedOutput = Math.floor(amountIn * 0.9);
      const slippage = 0.5;
      const minAmountOut = Math.floor(estimatedOutput * (1 - slippage / 100));

      return {
        estimatedOutput,
        minAmountOut,
        slippage,
      };
    }
  }

  async createSwapTransaction(
    params: SwapParams,
    pool: Pool
  ): Promise<SwapResult> {
    const {
      account,
      aptosClient,
      faAddressIn,
      faAddressOut,
      amountIn,
      slippage,
      toAddress,
    } = params;
    const poolId = pool.id;
    const methodAddress = pool.dex.methodAddress;

    if (!poolId || !methodAddress) {
      throw new Error("Invalid pool information for Hyperion");
    }

    const estimation = await this.estimateAmountOut(
      pool,
      amountIn,
      aptosClient
    );
    const minAmountOut = Math.floor(
      estimation.estimatedOutput * (1 - slippage / 100)
    );

    let payload;
    if (faAddressIn === "0xa") {
      // APT to Token
      payload = {
        function:
          `${methodAddress}::router_v3::swap_batch_coin_entry` as `${string}::${string}::${string}`,
        typeArguments: ["0x1::aptos_coin::AptosCoin"],
        functionArguments: [
          [poolId],
          "0xa",
          faAddressOut,
          amountIn.toString(),
          minAmountOut.toString(),
          toAddress,
        ],
      };
    } else if (faAddressOut === "0xa") {
      // Token to APT
      payload = {
        function:
          `${methodAddress}::router_v3::swap_batch` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [
          [poolId],
          faAddressIn,
          "0xa",
          amountIn.toString(),
          minAmountOut.toString(),
          toAddress,
        ],
      };
    } else {
      // Token to Token
      payload = {
        function:
          `${methodAddress}::router_v3::swap_batch` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [
          [poolId],
          faAddressIn,
          faAddressOut,
          amountIn.toString(),
          minAmountOut.toString(),
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
      estimatedOutput: estimation.estimatedOutput,
      minAmountOut,
    };
  }

  validatePool(pool: Pool, params: PoolSearchParams): boolean {
    const { faAddressIn, faAddressOut, tokenAddressIn, tokenAddressOut } =
      params;

    // Xác định tokenIn và tokenOut từ params
    const tokenIn = faAddressIn || tokenAddressIn;
    const tokenOut = faAddressOut || tokenAddressOut;

    // Kiểm tra pool có đúng cặp token không
    const poolTokenA = pool.tokenA?.toLowerCase() || "";
    const poolTokenB = pool.tokenB?.toLowerCase() || "";
    const requestTokenIn = tokenIn?.toLowerCase() || "";
    const requestTokenOut = tokenOut?.toLowerCase() || "";

    // Kiểm tra cả hai chiều (A->B và B->A)
    const isMatch =
      (poolTokenA === requestTokenIn && poolTokenB === requestTokenOut) ||
      (poolTokenA === requestTokenOut && poolTokenB === requestTokenIn);

    return isMatch;
  }
}
