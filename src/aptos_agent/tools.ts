/**
 * This file defines the tools available to the ReAct agent.
 * Tools are functions that the agent can use to interact with external systems or perform specific tasks.
 */
import { BalanceTool } from "./tools/balance.tool.js";
import { initiateTransferTool } from "./tools/transfer.tool.js";
import { GasEstimationTool } from "./tools/gas-estimation.tool.js";
import { TokenListTool } from "./tools/token-list.tool.js";
import { TokenMarketDataTool } from "./tools/token-market-data.tool.js";
import { WalletInfoTool } from "./tools/wallet-info.tool.js";
import { TransactionInfoTool } from "./tools/transaction-info.tool.js";
import { initiateSwapTool } from "./tools/swap.tool.js";
import { FindPoolsTool } from "./tools/find-pools.tool.js";
import { searchTavilyTool } from "../shared/tools/tavily-search.tool.js";

/**
 * Aptos blockchain interaction tools
 * These tools allow the agent to interact with the Aptos blockchain
 * The userId is automatically retrieved from the LangGraph context - no need to pass it manually
 *
 * Available tools:
 * - getBalance: Get balance for APT or any coin type (unified tool)
 * - transfer: Transfer APT or other coins (unified tool)
 * - estimateGas: Estimate gas costs for various transaction types
 * - getTokenList: Look up token information and get list of available tokens
 * - getTokenMarketData: Get comprehensive token market data including price, volume, and supply from CoinGecko or CoinMarketCap
 * - getWalletInfo: Get wallet information including address, public key, and account details
 * - getTransactionInfo: Get detailed information about a transaction by its hash
 * - swapTokens: Swap between APT and other tokens
 */
const getBalance = new BalanceTool();
const estimateGas = new GasEstimationTool();
const getTokenList = new TokenListTool();
const getTokenMarketData = new TokenMarketDataTool();
const getWalletInfo = new WalletInfoTool();
const getTransactionInfo = new TransactionInfoTool();
const swapTokens = initiateSwapTool;
// const findPools = new FindPoolsTool();

/**
 * Export an array of all available tools
 * Add new tools to this array to make them available to the agent
 *
 * Note: You can create custom tools by implementing the Tool interface from @langchain/core/tools
 * and add them to this array.
 * See https://js.langchain.com/docs/how_to/custom_tools/#tool-function for more information.
 */
export const TOOLS = [
  getBalance,
  initiateTransferTool,
  estimateGas,
  getTokenList,
  getTokenMarketData,
  getWalletInfo,
  getTransactionInfo,
  swapTokens,
  // Common tools
  searchTavilyTool,
];
