import { tool } from "@langchain/core/tools";
import { Command } from "@langchain/langgraph";
import { ToolMessage } from "@langchain/core/messages";
import { z } from "zod";

export const initiateSwapTool = tool(
  async (
    input: {
      faAddressIn?: string;
      faAddressOut?: string;
      tokenAddressIn?: string;
      tokenAddressOut?: string;
      amountIn: number;
      address: string;
      slippage?: number;
    },
    config
  ) => {
    const swapState = {
      phase: "preparing",
      request: input,
    };
    return new Command({
      goto: "swapFlow",
      update: {
        swapState,
        messages: [
          new ToolMessage({
            content: "Initiating swap...",
            tool_call_id: config.toolCall.id,
            name: "initiate_swap",
          }),
        ],
      },
    });
  },
  {
    name: "swap_tokens",
    description: `Swap tokens on Aptos using different DEX platforms. 
    
Token Address Retrieval:
- Use 'get_token_list' tool to find token addresses
- For APT token, use0xa (shorthand) or 01:aptos_coin::AptosCoin (full address)
- ALWAYS use faAddressIn/Out': Fetch from 'faAddress' returned by get_token_list
- DO NOT use 'tokenAddressIn/Out' for swap operations
- If no addresses are provided for both input and output, APT will be used by default

Example Workflow:
1ll 'get_token_list' to find token details
2e 'faAddress' from the returned data for faAddressIn/Out
3. Specify swap amount and optional slippage
4lues are preserved`,
    schema: z.object({
      faAddressIn: z
        .string()
        .describe(
          "Fungible Asset address for input token. Use '0xa' for APT, or directly from get_token_list's faAddress"
        ),
      faAddressOut: z
        .string()
        .describe(
          "Fungible Asset address for output token. Use '0xa' for APT, or directly from get_token_list's faAddress"
        ),
      tokenAddressIn: z
        .string()
        .describe(
          "Token address for input token, directly from get_token_list's tokenAddress. If only the symbol USDC appears (without a contract address), this means native USDC."
        ),
      tokenAddressOut: z
        .string()
        .describe(
          "Token address for output token, directly from get_token_list's tokenAddress. If only the symbol USDC appears (without a contract address), this means native USDC."
        ),
      amountIn: z.union([
        z.number().min(0.000001, "Amount must be greater than 0.000001 APT"),
        z.string().transform((val) => {
          const num = parseFloat(val);
          if (isNaN(num) || num < 0.000001) {
            throw new Error("Amount must be greater than 0.000001 APT");
          }
          return num;
        })
      ]).describe("Amount to swap (can be number or string)"),
      address: z.string(),
      slippage: z.number().min(0.1).max(50).optional(),
    }),
  }
);
