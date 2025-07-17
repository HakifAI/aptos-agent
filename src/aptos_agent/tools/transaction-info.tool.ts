import { StructuredTool } from "@langchain/core/tools";
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import { getAptosClient } from "../utils/aptos-client.js";
import { APTOS_CONFIG } from "../config/aptos.config.js";
import { calculateGasFee } from "../utils/tokens.utils.js";

export class TransactionInfoTool extends StructuredTool {
  name = "get_transaction_info";
  description = `Get detailed information about a transaction by its hash including status, gas fees, events, and other transaction details.`;
  schema = z.object({
    transactionHash: z
      .string()
      .describe("The transaction hash to look up (e.g., '0x123abc...')"),
  });

  constructor() {
    super();
  }

  async _call(
    input: { transactionHash: string },
    _runManager?: any,
    _parentConfig?: RunnableConfig
  ): Promise<string> {
    try {
      const { transactionHash } = input;

      if (!transactionHash || typeof transactionHash !== "string") {
        throw new Error("Invalid transaction hash provided");
      }

      // Clean the transaction hash (remove any leading '0x' if present)
      const cleanHash = transactionHash.startsWith("0x") 
        ? transactionHash 
        : `0x${transactionHash}`;

      // Get transaction details from the blockchain
      const aptosClient = getAptosClient();
      const transaction = await aptosClient.waitForTransaction({
        transactionHash: cleanHash,
      });

      // Calculate gas fee information using utility function (safe access)
      const gasFeeInfo = calculateGasFee(transaction);
      
      // Extract basic transaction information (safely accessing properties)
      const basicInfo = {
        hash: transaction.hash,
        version: transaction.version,
        success: transaction.success,
        vmStatus: (transaction as any).vm_status || "N/A",
        gasUsed: transaction.gas_used,
        gasUnitPrice: (transaction as any).gas_unit_price || "N/A",
        maxGasAmount: (transaction as any).max_gas_amount || "N/A",
        expirationTimestampSecs: (transaction as any).expiration_timestamp_secs || "N/A",
        sequenceNumber: (transaction as any).sequence_number || "N/A",
      };

      // Extract sender information (safely)
      const senderInfo = {
        sender: (transaction as any).sender || "N/A",
      };

      // Extract payload information if available (safely)
      let payloadInfo = {};
      const payload = (transaction as any).payload;
      if (payload) {
        payloadInfo = {
          type: payload.type || "N/A",
          function: payload.function || "N/A",
          arguments: payload.arguments || [],
          typeArguments: payload.type_arguments || [],
        };
      }

      // Extract events information (safely)
      let eventsInfo: any[] = [];
      const events = (transaction as any).events;
      if (events && Array.isArray(events)) {
        eventsInfo = events.map((event: any, index: number) => ({
          eventIndex: index,
          type: event.type,
          sequenceNumber: event.sequence_number,
          data: event.data,
        }));
      }

      // Extract changes/state changes if available (safely)
      let changesInfo: any[] = [];
      const changes = (transaction as any).changes;
      if (changes && Array.isArray(changes)) {
        changesInfo = changes.map((change: any, index: number) => ({
          changeIndex: index,
          type: change.type,
          address: change.address || "N/A",
          stateKeyHash: change.state_key_hash || "N/A",
          data: change.data || {},
        }));
      }

      return JSON.stringify({
        success: true,
        transaction: {
          basic: basicInfo,
          sender: senderInfo,
          payload: payloadInfo,
          events: eventsInfo,
          changes: changesInfo,
          gasFee: gasFeeInfo,
        },
        network: APTOS_CONFIG.network,
        explorerUrl: `https://explorer.aptoslabs.com/txn/${transaction.hash}?network=${APTOS_CONFIG.network}`,
        message: "Transaction information retrieved successfully",
      });
    } catch (error: any) {
      // Handle specific error cases
      if (error.message?.includes("not found") || error.message?.includes("404")) {
        return JSON.stringify({
          success: false,
          error: "Transaction not found",
          message: "The specified transaction hash was not found on the blockchain",
        });
      }

      if (error.message?.includes("invalid") || error.message?.includes("format")) {
        return JSON.stringify({
          success: false,
          error: "Invalid transaction hash format",
          message: "Please provide a valid transaction hash",
        });
      }

      return JSON.stringify({
        success: false,
        error: error.message,
        message: "Failed to retrieve transaction information",
      });
    }
  }
} 