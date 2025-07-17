import { StructuredTool } from "@langchain/core/tools";
import { Aptos, AptosConfig, Ed25519PrivateKey, Account } from "@aptos-labs/ts-sdk";
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import walletApi from "../apis/wallet.api.js";
import { formatTokenAmount } from "../utils/tokens.utils.js";
import tokenApi from "../apis/token.api.js";
import { getAptosClient } from "../utils/aptos-client.js";

export class BalanceTool extends StructuredTool {
  name = "get_balance";
  description = `Get token balance for a specific wallet address. Supports APT and other tokens. If you don't know the token address, use the get_token_list tool to find the address (tokenAddress or faAddress).`;
  schema = z.object({
    assetTypes: z
      .array(z.string())
      .optional()
      .describe(
        "The token addresses to get the balance for (tokenAddress or faAddress). If not provided, all verified tokens will be returned"
      ),

    address: z
      .string()
      .optional()
      .describe(
        "The address of the wallet to get the balance for (if not provided, the wallet of the authenticated user will be used)"
      ),
  });

  constructor() {
    super();
  }

  async _call(
    input: { assetType?: string },
    _runManager?: any,
    parentConfig?: RunnableConfig
  ): Promise<string> {
    try {
      let { assetTypes, address } = this.schema.parse(input);

      const tokenList = await tokenApi.getTokenList({});
      const tokenMap = new Map<string, any>();
      let isAllToken = false;
      // Add tokens by both tokenAddress and faAddress
      tokenList.forEach((token) => {
        if (token.tokenAddress) {
          tokenMap.set(token.tokenAddress, token);
        }
        if (token.faAddress) {
          tokenMap.set(token.faAddress, token);
        }
      });

      if (!assetTypes || assetTypes.length === 0) {
        isAllToken = true;
        assetTypes = Array.from(tokenMap.keys());
      }

      let walletAddress = address;
      // Get userId from the LangGraph context
      if (!walletAddress) {
        const config = parentConfig;
        const userId = parseInt(
          config?.configurable?.["langgraph_auth_user_id"] ||
            config?.metadata?.["langgraph_auth_user_id"] ||
            "0"
        );

        if (!userId) {
          throw new Error(
            "User not authenticated - missing user identity in context"
          );
        }

        // Get wallet information from userId
        const wallet = await walletApi.getWallet(userId);

        if (!wallet || !wallet.address) {
          throw new Error("Wallet not found or address not available");
        }
        walletAddress = wallet.address;
      }

      // Get balance for the specified coin type
      const aptosClient = getAptosClient();
      const resources = await aptosClient.getAccountCoinsData({
        accountAddress: walletAddress,
        options: {
          where: {
            asset_type: { _in: assetTypes },
          },
        },
      });

      if (!resources || resources.length === 0) {
        throw new Error("Token not found in the wallet");
      }
      const tokens = [];
      for (const coinData of resources) {
        const balanceInSmallestUnit = coinData
          ? coinData.amount.toString()
          : "0";
        if (!coinData.asset_type) {
          continue;
        }
        const token = tokenMap.get(coinData.asset_type);

        // Use utility functions to get token information
        const coinName = token?.name || coinData.metadata?.name;
        const decimals = coinData.metadata?.decimals || token?.decimals;
        const symbol = token?.symbol || coinData.metadata?.symbol;
        if (!decimals) {
          continue;
        }

        // Format the balance using the utility function
        const displayBalance = formatTokenAmount(
          balanceInSmallestUnit,
          decimals
        );
        tokens.push({
          tokenAddress: coinData.asset_type,
          balance: displayBalance,
          balanceInSmallestUnit: balanceInSmallestUnit,
          assetType: coinData.asset_type,
          name: coinName,
          symbol: symbol,
          logoUrl: token?.logoUrl,
        });
      }

      return JSON.stringify({
        walletAddress,
        tokens,
        success: true,
        isAllToken,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        message: "Balance retrieval failed",
      });
    }
  }
}
