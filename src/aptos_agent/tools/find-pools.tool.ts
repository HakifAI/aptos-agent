import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
// import { APTOS_CONFIG } from "../config/aptos.config.js";
// import { getTokenSymbol } from "../utils/tokens.utils.js";
import { Aptos } from "@aptos-labs/ts-sdk";
// import dexApi from "../apis/dex.api.js";
// import { FunctionType } from "../types/function-type.enum.js";

// Use 'any' for generic to avoid type errors if ToolInputSchemaBase is not available
export class FindPoolsTool extends StructuredTool<any> {
  name = "find_pools";
  description =
    "Find suitable liquidity pools for swapping between two tokens across multiple DEXes/methods. Always use the FA address (faAddress, for FA v2 tokens) for both tokens, NOT the tokenAddress (coin type address, for FA v1 tokens). If you do not know the faAddress, use a token list tool to look it up by symbol or name. Returns a list of pools, each with DEX, token, fee, poolId, etc. for the user to choose from.";
  schema = z.object({
    faAddressIn: z
      .string()
      .describe(
        "FA address (Fungible Asset address, for FA v2 tokens) of the token you want to swap from. Do NOT use tokenAddress (coin type address)."
      ),
    faAddressOut: z
      .string()
      .describe(
        "FA address (Fungible Asset address, for FA v2 tokens) of the token you want to swap to. Do NOT use tokenAddress (coin type address)."
      ),
  });
  aptosClient: Aptos;

  // constructor() {
  //   super();
  //   const config = new AptosConfig({
  //     network: APTOS_CONFIG.network,
  //     ...(APTOS_CONFIG.rpcUrl && { fullnode: APTOS_CONFIG.rpcUrl }),
  //   });
  //   this.aptosClient = new Aptos(config);
  // }

  async _call(
  //   {
  //   faAddressIn,
  //   faAddressOut,
  // }: {
  //   faAddressIn: string;
  //   faAddressOut: string;
  // }
) {
    // Warn if user provides a tokenAddress (heuristic: contains '::')
  //   if (faAddressIn.includes("::") || faAddressOut.includes("::")) {
  //     return "Warning: You provided a tokenAddress (coin type address). Please provide the FA address (Fungible Asset address, for FA v2 tokens) for both tokens. Use a token list tool to look up the correct faAddress.";
  //   }
  //   const dexes = await dexApi.getDexes();
  //   const allPoolMessages: string[] = [];
  //   for (const dex of dexes) {
  //     const findPoolsFunction = dex.functions.find(
  //       (f: any) => f.functionType === FunctionType.FIND_POOLS && f.isActive
  //     );
  //     // if (!findPoolsFunction) continue;
  //     const dexPoolMessages: string[] = [];
  //     try {

  //       if (dex.name === "cellena") {
  //         console.log(12313123123123);
  //         const getAmount = await this.aptosClient.view({
  //           payload: {
  //             function: `${dex.methodAddress}::router::get_amount_out`,
  //             functionArguments: ["2000000", "0xa", "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b", "false"], // Assuming these are common arguments for now
  //             typeArguments: [],
  //           },
  //         });
  //         console.log("testtttttttttttt", getAmount);
  //       }
  //       const result = await this.aptosClient.view({
  //         payload: {
  //           function: `${dex.methodAddress}::${findPoolsFunction.functionName}`,
  //           functionArguments: ["0", "20"], // Assuming these are common arguments for now
  //           typeArguments: [],
  //         },
  //       });

  //       const pools = Array.isArray(result[0]) ? result[0] : [];
  //       const filteredPools = pools.filter((pool: any) => {
  //         const typeA = (
  //           pool.token_a?.inner ||
  //           pool.token_a ||
  //           ""
  //         ).toLowerCase();
  //         const typeB = (
  //           pool.token_b?.inner ||
  //           pool.token_b ||
  //           ""
  //         ).toLowerCase();
  //         return (
  //           (typeA === faAddressIn.toLowerCase() &&
  //             typeB === faAddressOut.toLowerCase()) ||
  //           (typeA === faAddressOut.toLowerCase() &&
  //             typeB === faAddressIn.toLowerCase())
  //         );
  //       });
  //       if (filteredPools.length > 0) {
  //         dexPoolMessages.push(`\n--- ${dex.displayName} Pools ---`);
  //         for (const pool of filteredPools) {
  //           const poolId = pool.pool?.inner ?? pool.pool;
  //           const fee = pool.fee_rate;
  //           const symbolA = getTokenSymbol(pool.token_a?.inner || pool.token_a);
  //           const symbolB = getTokenSymbol(pool.token_b?.inner || pool.token_b);
  //           dexPoolMessages.push(
  //             `  Token: ${symbolA} ⇄ ${symbolB} | Fee: ${fee} | poolId: ${poolId} | methodAddress: ${dex.methodAddress} | adapterKey: ${dex.name}`
  //           );
  //         }
  //         const swapFunctions = dex.functions.filter(
  //           (f: any) => f.functionType === FunctionType.SWAP && f.isActive
  //         );
  //         if (swapFunctions.length > 0) {
  //           dexPoolMessages.push(
  //             `  Available Swap Functions for ${dex.displayName}:`
  //           );
  //           swapFunctions.forEach((sf: any) => {
  //             dexPoolMessages.push(
  //               `    - ${sf.description} (functionName: ${sf.functionName})`
  //             );
  //           });
  //         }
  //       }
  //     } catch (error: any) {
  //       console.warn(
  //         `Could not fetch pools for DEX ${dex.displayName}: ${error.message}`
  //       );
  //     }
  //     allPoolMessages.push(...dexPoolMessages);
  //   }
  //   if (allPoolMessages.length === 0) {
  //     return "No suitable liquidity pool found on current DEXes.";
  //   }
  //   return [
  //     "Found suitable liquidity pool(s). Please choose the pool you want to use and provide the following parameters to the 'swap_tokens' tool: poolId, methodAddress, adapterKey, faAddressIn, faAddressOut, and amountIn.",
  //     ...allPoolMessages,
  //   ].join("\n");
  }
}
