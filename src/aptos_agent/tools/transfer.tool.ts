import { ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Command } from "@langchain/langgraph";
import { z } from "zod";
import { TransferState } from "../subgraphs/transfer.subgraph.js";

export const initiateTransferTool = tool(
  async (
    input: {
      toAddress: string;
      amount: string;
      tokenAddress?: string;
      faAddress?: string;
    },
    config
  ) => {
    const transferState: TransferState = {
      phase: "preparing",
      request: input,
    };

    return new Command({
      goto: "transferFlow",
      update: {
        transferState,
        messages: [
          new ToolMessage({
            content: "Initiating transfer...",
            tool_call_id: config.toolCall.id,
            name: "initiate_transfer",
          }),
        ],
      },
      // graph: Command.PARENT,
    });
  },
  {
    name: "initiate_transfer",
    description:
      "Transfer tokens to another address for the authenticated user. Supports APT and other tokens. If you don't know the token address, use the get_token_list tool to find the address (tokenAddress or faAddress). If neither tokenAddress nor faAddress is provided, APT will be used by default.",
    schema: z.object({
      toAddress: z
        .string()
        .describe(
          "The recipient's Aptos address (ask the user if unknown), DO NOT make up an address"
        ),
      amount: z
        .string()
        .describe("Amount to transfer (exact user input amount)"),
      tokenAddress: z
        .string()
        .optional()
        .describe("The token address to transfer"),
      faAddress: z
        .string()
        .optional()
        .describe(
          "The fungible asset address to transfer (takes priority over tokenAddress)"
        ),
    }),
  }
);
