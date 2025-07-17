import { StructuredTool } from "@langchain/core/tools";
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import walletApi from "../apis/wallet.api.js";
import { getAptosClient } from "../utils/aptos-client.js";
import { APTOS_CONFIG } from "../config/aptos.config.js";

export class WalletInfoTool extends StructuredTool {
  name = "get_wallet_info";
  description = `Get wallet information for the authenticated user including address, public key, and account details.`;
  schema = z.object({});

  constructor() {
    super();
  }

  async _call(
    _input: {},
    _runManager?: any,
    parentConfig?: RunnableConfig
  ): Promise<string> {
    try {
      // Get userId from the LangGraph context
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

      // Get account information from the blockchain
      try {
        const aptosClient = getAptosClient();
        const accountInfo = await aptosClient.getAccountInfo({
          accountAddress: wallet.address,
        });
        
        // Get account coins to verify account exists and check balance status
        const accountCoinsData = await aptosClient.getAccountCoinsData({
          accountAddress: wallet.address,
        });

        return JSON.stringify({
          success: true,
          wallet: {
            address: wallet.address,
            publicKey: wallet.publicKey,
          },
          accountInfo: {
            sequenceNumber: accountInfo.sequence_number,
            authenticationKey: accountInfo.authentication_key,
          },
          accountStatus: {
            hasTokens: accountCoinsData.length > 0,
            numberOfTokenTypes: accountCoinsData.length,
          },
          network: APTOS_CONFIG.network,
          explorerUrl: `https://explorer.aptoslabs.com/account/${wallet.address}?network=${APTOS_CONFIG.network}`,
          message: "Wallet information retrieved successfully",
        });
      } catch (_e) {
        return JSON.stringify({
          success: true,
          wallet: {
            address: wallet.address,
            publicKey: wallet.publicKey,
          },
          network: APTOS_CONFIG.network,
          explorerUrl: `https://explorer.aptoslabs.com/account/${wallet.address}?network=${APTOS_CONFIG.network}`,
          message: "Wallet information retrieved successfully",
        });
      }
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        message: "Failed to retrieve wallet information",
      });
    }
  }
}
