import { StructuredTool } from "@langchain/core/tools";
import {
  Account,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import walletApi from "../apis/wallet.api.js";
import { getTokenDecimals } from "../utils/tokens.utils.js";
import { getAptosClient } from "../utils/aptos-client.js";
import { APTOS_CONFIG } from "../config/aptos.config.js";

export class GasEstimationTool extends StructuredTool {
  name = "estimate_gas";
  description = `Estimate gas costs for various Aptos transactions including transfers, smart contract calls, and other operations.`;
  schema = z.object({
    transactionType: z
      .enum(["transfer", "smart_contract", "general"])
      .describe("Type of transaction to estimate gas for"),
    toAddress: z
      .string()
      .optional()
      .describe("Recipient address (required for transfers)"),
    amount: z
      .string()
      .optional()
      .describe(
        "Amount to transfer (exact amount's human input) (required for transfers)"
      ),
    assetType: z
      .string()
      .optional()
      .describe(
        "Coin type for transfers (tokenAddress or faAddress). Defaults to '0x1::aptos_coin::AptosCoin' for APT"
      ),
    moduleAddress: z
      .string()
      .optional()
      .describe("Module address for smart contract calls"),
    functionName: z
      .string()
      .optional()
      .describe("Function name for smart contract calls"),
    typeArgs: z
      .array(z.string())
      .optional()
      .describe("Type arguments for smart contract calls"),
    functionArgs: z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .describe("Function arguments for smart contract calls"),
  });

  constructor() {
    super();
  }

  async _call(
    input: {
      transactionType: "transfer" | "smart_contract" | "general";
      toAddress?: string;
      amount?: string;
      assetType?: string;
      moduleAddress?: string;
      functionName?: string;
      typeArgs?: string[];
      functionArgs?: (string | number | boolean | null)[];
    },
    _runManager?: any,
    parentConfig?: RunnableConfig
  ): Promise<string> {
    try {
      const {
        transactionType,
        toAddress,
        amount,
        assetType = "0x1::aptos_coin::AptosCoin",
        moduleAddress,
        functionName,
        typeArgs = [],
        functionArgs = [],
      } = input;

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

      if (!wallet || !wallet.privateKey) {
        throw new Error("Wallet not found or private key not available");
      }

      // Create account from private key
      const privateKey = new Ed25519PrivateKey(wallet.privateKey);
      const account = Account.fromPrivateKey({ privateKey });

      let transaction;
      let estimationDetails = {};
      const aptosClient = getAptosClient();

      // Create transaction based on type
      switch (transactionType) {
        case "transfer":
          if (!toAddress || !amount) {
            throw new Error(
              "toAddress and amount are required for transfer gas estimation"
            );
          }

          const resources = await aptosClient.getAccountCoinsData({
            accountAddress: account.accountAddress,
            options: {
              where: {
                asset_type: { _eq: assetType },
              },
            },
          });

          const tokenData = resources[0];
          if (!tokenData) {
            throw new Error("Insufficient balance for the token");
          }

          const decimals =
            tokenData.metadata?.decimals ?? getTokenDecimals(assetType);

          const transferAmount = parseFloat(amount) * 10 ** decimals;
          if (tokenData.token_standard === "v2") {
            transaction = await aptosClient.transaction.build.simple({
              sender: account.accountAddress,
              data: {
                function: "0x1::aptos_account::transfer_fungible_assets",
                functionArguments: [
                  assetType, // fungible asset type
                  toAddress, // recipient
                  transferAmount.toString(),
                ],
              },
              options: {
                maxGasAmount: APTOS_CONFIG.maxGasAmount,
                gasUnitPrice: APTOS_CONFIG.gasUnitPrice,
              },
            });
          } else {
            transaction = await aptosClient.transferCoinTransaction({
              sender: account.accountAddress,
              recipient: toAddress,
              amount: transferAmount,
              coinType: assetType as `${string}::${string}::${string}`,
              options: {
                maxGasAmount: APTOS_CONFIG.maxGasAmount,
                gasUnitPrice: APTOS_CONFIG.gasUnitPrice,
              },
            });
          }

          estimationDetails = {
            transactionType: "transfer",
            fromAddress: account.accountAddress.toString(),
            toAddress,
            amount,
            assetType,
            tokenName: tokenData.metadata?.name,
            symbol: tokenData.metadata?.symbol,
          };
          break;

        case "smart_contract":
          if (!moduleAddress || !functionName) {
            throw new Error(
              "moduleAddress and functionName are required for smart contract gas estimation"
            );
          }

          transaction = await aptosClient.transaction.build.simple({
            sender: account.accountAddress,
            data: {
              function:
                `${moduleAddress}::${functionName}` as `${string}::${string}::${string}`,
              typeArguments: typeArgs,
              functionArguments: functionArgs,
            },
          });

          estimationDetails = {
            transactionType: "smart_contract",
            moduleAddress,
            functionName,
            typeArgs,
            functionArgs,
          };
          break;

        case "general":
          // For general estimation, use a simple account creation as baseline
          transaction = await aptosClient.transaction.build.simple({
            sender: account.accountAddress,
            data: {
              function: "0x1::aptos_account::transfer",
              functionArguments: [account.accountAddress, 1],
            },
          });

          estimationDetails = {
            transactionType: "general",
            description: "General transaction baseline estimation",
          };
          break;

        default:
          throw new Error(`Unsupported transaction type: ${transactionType}`);
      }

      // Simulate the transaction to get gas estimation
      const [userTransactionResponse] =
        await aptosClient.transaction.simulate.simple({
          signerPublicKey: account.publicKey,
          transaction,
        });

      // Extract gas information
      const gasUnitPrice = parseInt(userTransactionResponse.gas_unit_price);
      const gasUsed = parseInt(userTransactionResponse.gas_used);
      const maxGasAmount = parseInt(userTransactionResponse.max_gas_amount);
      const totalGasCost = gasUnitPrice * gasUsed;
      const maxGasCost = gasUnitPrice * maxGasAmount;
      // Convert gas costs to APT (1 APT = 100,000,000 Octas)
      const totalGasCostInAPT = totalGasCost / 100_000_000;
      const maxGasCostInAPT = maxGasCost / 100_000_000;

      return JSON.stringify({
        success: true,
        estimation: {
          gasUsed,
          gasUnitPrice,
          maxGasAmount,
          totalGasCost,
          maxGasCost,
          totalGasCostInAPT,
          maxGasCostInAPT,
          success: userTransactionResponse.success,
        },
        transactionDetails: estimationDetails,
        message: `Gas estimation completed for ${transactionType} transaction`,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        message: "Gas estimation failed",
      });
    }
  }
}
