import { StructuredTool } from "@langchain/core/tools";
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import tokenApi from "../apis/token.api.js";
// import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk";

// Common token mappings for Aptos blockchain

export class TokenListTool extends StructuredTool {
  name = "get_token_list";
  description = `Get a list of tokens in the Aptos blockchain. Can get all tokens, or filter by symbol, name, address, or tags.

Returns token information including:
- tokenAddress: The token address following Aptos Coin Standard (Legacy)
- faAddress: The token address following Aptos Fungible Asset (FA) Standard
- name: The on-chain registered token name
- symbol: The on-chain registered token symbol
- decimals: The number of decimal places
- logoUrl: The token logo URL
- websiteUrl: The official website URL (optional)
- coinGeckoId: The CoinGecko ID (optional)
- coinMarketCapId: The CoinMarketCap ID (optional)`;
  schema = z.object({
    symbol: z.string().optional().describe("Token symbol to filter by"),
    name: z.string().optional().describe("Token name to search by"),
    address: z
      .string()
      .optional()
      .describe("Token address to filter by (tokenAddress or faAddress)"),
    tags: z
      .array(z.enum(["Meme", "Emojicoin", "Native", "Bridged"]))
      .optional()
      .describe("Token tags to filter by"),
  });

  async _call(
    input: { symbol?: string; name?: string; address?: string },
    _runManager?: any,
    _parentConfig?: RunnableConfig
  ): Promise<string> {
    try {
      const { symbol, name, address, tags } = this.schema.parse(input);

      const result = await tokenApi.getTokenList({ symbol, name, address, tags });
      return JSON.stringify(result);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.response?.data?.message || error.message,
        message: "Token lookup failed",
      });
    }
  }
}
