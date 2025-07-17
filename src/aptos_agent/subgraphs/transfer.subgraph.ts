import {
  Annotation,
  END,
  GraphInterrupt,
  interrupt,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { HumanInterrupt } from "@langchain/langgraph/prebuilt";
import {
  Aptos,
  AptosConfig,
  Account,
  Ed25519PrivateKey,
  SimpleTransaction,
} from "@aptos-labs/ts-sdk";
import walletApi from "../apis/wallet.api.js";
import { APTOS_CONFIG } from "../config/aptos.config.js";
import { getTokenDecimals, calculateGasFee } from "../utils/tokens.utils.js";
import { RunnableConfig } from "@langchain/core/runnables";

// Add transfer state helpers
export interface TransferRequest {
  toAddress: string;
  amount: string;
  tokenAddress?: string;
  faAddress?: string;
}

interface PreparedTransaction {
  transferAmount: number;
  accountAddress: string;
  decimals: number;
  tokenData: any;
  gasEstimation: {
    totalGasCostInAPT: number;
    maxGasCostInAPT: number;
  };
  assetType: string;
}

export interface TransferResult {
  success: boolean;
  error?: string;
  message?: string;
  transactionHash?: string;
  fromAddress?: string;
  toAddress?: string;
  amount?: string;
  assetType?: string;
  tokenName?: string;
  symbol?: string;
  gasUsed?: string;
}

export interface TransferState {
  phase: "preparing" | "confirming" | "executing" | "completed" | "error";
  request: TransferRequest;
  preparedTransaction?: PreparedTransaction;
  result?: TransferResult;
  error?: string;
  // transferTool: ToolCall;
}

async function createTransferTransaction(
  account: Account,
  toAddress: string,
  transferAmount: number,
  assetType: string,
  aptosClient: Aptos,
  tokenStandard: string
) {
  let transaction: SimpleTransaction;

  if (tokenStandard === "v2") {
    transaction = await aptosClient.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: "0x1::aptos_account::transfer_fungible_assets",
        functionArguments: [assetType, toAddress, transferAmount.toString()],
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

  return transaction;
}

// Replace prepareTransferNode function
export async function prepareTransferNode(
  state: typeof TransferGraphAnnotation.State,
  config: RunnableConfig
): Promise<typeof TransferGraphAnnotation.Update> {
  const { transferState } = state;
  if (!transferState) {
    throw new Error("No transfer state found");
  }
  const { toAddress, amount, faAddress, tokenAddress } = transferState.request;

  try {
    // Extract transfer request from messages
    let assetType = "0x1::aptos_coin::AptosCoin";

    if (faAddress) {
      assetType = faAddress;
    } else if (tokenAddress) {
      assetType = tokenAddress;
    }

    // Get user ID from context
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

    // Validate inputs
    if (!toAddress || typeof toAddress !== "string") {
      throw new Error("Invalid toAddress provided");
    }
    if (!amount || typeof amount !== "string") {
      throw new Error("Invalid amount provided");
    }

    // Get wallet
    const wallet = await walletApi.getWallet(userId);
    if (!wallet || !wallet.privateKey) {
      throw new Error("Wallet not found or private key not available");
    }

    // Create account
    const privateKey = new Ed25519PrivateKey(wallet.privateKey);
    const account = Account.fromPrivateKey({ privateKey });

    // Create Aptos client
    const aptosConfig = new AptosConfig({
      network: APTOS_CONFIG.network,
      ...(APTOS_CONFIG.rpcUrl && { fullnode: APTOS_CONFIG.rpcUrl }),
    });
    const aptosClient = new Aptos(aptosConfig);

    // Check balance and get token data
    const amountNumber = parseFloat(amount);
    const resources = await aptosClient.getAccountCoinsData({
      accountAddress: account.accountAddress,
      options: {
        where: {
          asset_type: { _eq: assetType },
        },
      },
    });

    const tokenData = resources[0];
    if (!tokenData || !tokenData.amount) {
      throw new Error("Token not found or insufficient balance");
    }

    const decimals =
      tokenData.metadata?.decimals ?? getTokenDecimals(assetType);
    const balance = Number(tokenData.amount || 0);
    const transferAmount = amountNumber * 10 ** decimals;

    if (amountNumber > balance) {
      throw new Error(
        `Insufficient balance. Available: ${balance}, Required: ${amountNumber}`
      );
    }

    // Build transaction
    const transaction = await createTransferTransaction(
      account,
      toAddress,
      transferAmount,
      assetType,
      aptosClient,
      tokenData.token_standard || "v1"
    );

    // Simulate for gas estimation
    const [simulationResult] = await aptosClient.transaction.simulate.simple({
      signerPublicKey: account.publicKey,
      transaction,
    });

    const gasUnitPrice = parseInt(simulationResult.gas_unit_price);
    const gasUsed = parseInt(simulationResult.gas_used);
    const maxGasAmount = parseInt(simulationResult.max_gas_amount);
    const totalGasCost = gasUnitPrice * gasUsed;
    const maxGasCost = gasUnitPrice * maxGasAmount;
    const totalGasCostInAPT = totalGasCost / 100_000_000;
    const maxGasCostInAPT = maxGasCost / 100_000_000;

    // Create prepared transaction data
    const preparedTransaction: PreparedTransaction = {
      transferAmount,
      decimals,
      tokenData,
      gasEstimation: {
        totalGasCostInAPT,
        maxGasCostInAPT,
      },
      assetType,
      accountAddress: account.accountAddress.toString(),
    };

    // Update state to confirming phase
    const updatedState: TransferState = {
      ...transferState,
      phase: "confirming",
      preparedTransaction,
    };

    return {
      transferState: updatedState,
    };
  } catch (error: any) {
    const errorState: TransferState = {
      ...transferState,
      phase: "error",
      error: error.message,
      result: {
        success: false,
        error: error.message,
        message: "Transfer preparation failed",
      },
    };

    return {
      transferState: errorState,
    };
  }
}

// Replace confirmTransferNode function
export async function confirmTransferNode(
  state: typeof TransferGraphAnnotation.State,
  _config: RunnableConfig
): Promise<typeof TransferGraphAnnotation.Update> {
  const transferState = state.transferState;
  try {
    // Extract transfer state

    if (!transferState?.preparedTransaction || !transferState?.request) {
      throw new Error("No prepared transaction found for confirmation");
    }

    const { request, preparedTransaction } = transferState;
    const { tokenData, gasEstimation, assetType, accountAddress } =
      preparedTransaction;

    const tokenName = tokenData.metadata?.name || "Unknown Token";

    // Build detailed confirmation message
    const confirmationDetails = `**Token Details:**
- **Token:** [${tokenData.metadata?.symbol || "N/A"} (${tokenName})](https://explorer.aptoslabs.com/${tokenData.token_standard === "v2" ? "coin" : "fungible_asset"}/${assetType}?network=${APTOS_CONFIG.network})
- **Amount:** ${request.amount}

**Transaction Details:**
- **From:** ${accountAddress}
- **To:** ${request.toAddress}
- **Network:** ${APTOS_CONFIG.network}
- **Estimated Gas:** ${gasEstimation.totalGasCostInAPT.toFixed(6)} APT
- **Max Gas Cost:** ${gasEstimation.maxGasCostInAPT.toFixed(6)} APT

**⚠️ Please review all details carefully before proceeding.**

Click **Accept** to execute the transfer or **Ignore** to cancel.`;

    // Use interrupt to pause for user confirmation
    const humanResponses = interrupt({
      action_request: {
        action: "Transfer Confirmation",
        args: {
          ...request,
          tokenInfo: {
            name: tokenName,
            symbol: tokenData.metadata?.symbol,
            type: assetType,
          },
          gasEstimate: gasEstimation,
          fromAddress: accountAddress,
        },
      },
      description: confirmationDetails,
      config: {
        allow_ignore: true,
        allow_accept: true,
        allow_edit: false,
        allow_respond: false,
      },
    } as HumanInterrupt);

    // Process user response
    if (humanResponses[0]?.type !== "accept") {
      const cancelledState: TransferState = {
        ...transferState,
        phase: "error",
        result: {
          success: false,
          error: "User cancelled the transfer",
          message: "Transfer cancelled by user",
        },
      };

      return {
        transferState: cancelledState,
      };
    }

    // User accepted - move to execution phase
    const executingState: TransferState = {
      ...transferState,
      phase: "executing",
    };

    return {
      transferState: executingState,
    };
  } catch (error: any) {
    if (error instanceof GraphInterrupt) {
      throw error;
    }

    const errorState: TransferState = {
      ...state.transferState,
      phase: "error",
      error: error.message,
    };

    return {
      transferState: errorState,
    };
  }
}

// Replace executeTransferNode function
export async function executeTransferNode(
  state: typeof TransferGraphAnnotation.State,
  config: RunnableConfig
): Promise<typeof TransferGraphAnnotation.Update> {
  const transferState = state.transferState;
  try {
    // Extract transfer state

    if (!transferState?.preparedTransaction) {
      throw new Error("No prepared transaction found for execution");
    }

    const { preparedTransaction, request } = transferState;
    const { tokenData, assetType } = preparedTransaction;
    if (!request?.toAddress) {
      throw new Error("To address is required");
    }

    // Get user ID from context
    const userId = parseInt(
      config?.configurable?.["langgraph_auth_user_id"] ||
        config?.metadata?.["langgraph_auth_user_id"] ||
        "0"
    );

    const wallet = await walletApi.getWallet(userId);
    if (!wallet || !wallet.privateKey) {
      throw new Error("Wallet not found or private key not available");
    }

    const account = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(wallet.privateKey),
    });

    // Create Aptos client
    const aptosConfig = new AptosConfig({
      network: APTOS_CONFIG.network,
      ...(APTOS_CONFIG.rpcUrl && { fullnode: APTOS_CONFIG.rpcUrl }),
    });
    const aptosClient = new Aptos(aptosConfig);

    const transaction = await createTransferTransaction(
      account,
      request?.toAddress,
      preparedTransaction.transferAmount,
      assetType,
      aptosClient,
      tokenData.token_standard || "v1"
    );
    // Execute transaction
    const committedTxn = await aptosClient.signAndSubmitTransaction({
      signer: account,
      transaction,
    });

    // Wait for confirmation
    const executedTransaction = await aptosClient.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    // Calculate gas fees
    const gasFeeInfo = calculateGasFee(executedTransaction);

    // Build success result
    const result = {
      success: true,
      transactionHash: executedTransaction.hash,
      fromAddress: account.accountAddress.toString(),
      toAddress: request?.toAddress,
      amount: request?.amount,
      assetType: assetType,
      tokenName: tokenData.metadata?.name,
      symbol: tokenData.metadata?.symbol,
      gasUsed: executedTransaction.gas_used,
      gasFee: gasFeeInfo,
      message: `✅ ${tokenData.metadata?.name || "Token"} transfer completed successfully! Gas fee: ${gasFeeInfo.gasFeeFormatted}`,
      explorerUrl: `https://explorer.aptoslabs.com/txn/${executedTransaction.hash}?network=${APTOS_CONFIG.network}`,
    };

    // Update state to completed
    const completedState: TransferState = {
      ...transferState,
      phase: "completed",
      result,
    };

    return {
      transferState: completedState,
    };
  } catch (error: any) {
    const errorState: TransferState = {
      ...transferState,
      phase: "error",
      error: error.message,
    };

    return {
      transferState: errorState,
    };
  }
}

// Update routeTransferFlow function
export function routeTransferFlow(
  state: typeof MessagesAnnotation.State & { transferState?: TransferState }
): string {
  if (!state.transferState) {
    return END;
  }

  switch (state.transferState.phase) {
    case "preparing":
      return "prepareTransfer";
    case "confirming":
      return "confirmTransfer";
    case "executing":
      return "executeTransfer";
    case "error":
      return END;
    case "completed":
      return END;
    default:
      return END;
  }
}

const TransferGraphAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  transferState: Annotation<TransferState>({
    reducer: (x, y) => y ?? x,
    default: () => ({
      phase: "preparing",
      request: {
        toAddress: "",
        amount: "",
      },
    }),
  }),
});

const graph = new StateGraph(TransferGraphAnnotation)
  .addNode("prepareTransfer", prepareTransferNode)
  .addNode("confirmTransfer", confirmTransferNode)
  .addNode("executeTransfer", executeTransferNode)

  .addEdge(START, "prepareTransfer")
  // Transfer workflow routing
  .addConditionalEdges("prepareTransfer", routeTransferFlow)
  .addConditionalEdges("confirmTransfer", routeTransferFlow)
  .addConditionalEdges("executeTransfer", routeTransferFlow)
  .addEdge("executeTransfer", END);

export const transferGraph = graph.compile();
