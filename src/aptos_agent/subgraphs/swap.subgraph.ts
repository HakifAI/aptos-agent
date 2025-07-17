import {
  END,
  GraphInterrupt,
  interrupt,
  MessagesAnnotation,
  Annotation,
  StateGraph,
  START,
} from "@langchain/langgraph";
import {
  Aptos,
  AptosConfig,
  Account,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import dexApi from "../apis/dex.api.js";
import walletApi from "../apis/wallet.api.js";
import tokenApi from "../apis/token.api.js";
import { APTOS_CONFIG } from "../config/aptos.config.js";
import { getTokenDecimals } from "../utils/tokens.utils.js";
import { AIMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { DexName } from "../types/function-type.enum.js";
import { DEXFactory } from "../services/dex.factory.js";
import { Pool } from "../types/dex.types.js";

type ToolCall = {
  name: string;
  args: Record<string, any>;
  id: string;
  type?: "tool_call";
};

interface SwapRequest {
  faAddressIn: string;
  faAddressOut: string;
  tokenAddressIn: string;
  tokenAddressOut: string;
  amountIn: string;
  address: string;
  slippage?: number;
}

interface PreparedSwapTransaction {
  swapAmount: number;
  accountAddress: string;
  decimals: number;
  tokenData: any;
  gasEstimation: {
    totalGasCostInAPT: number;
    maxGasCostInAPT: number;
  };
}

export interface SwapState {
  phase: "preparing" | "findPool" | "executing" | "completed" | "error";
  request?: SwapRequest;
  preparedTransaction?: PreparedSwapTransaction;
  pools?: any[];
  selectedPool?: any;
  result?: any;
  error?: string;
  swapTool: ToolCall;
}

interface SwapStateResponse {
  messages?: AIMessage[];
  swapState: SwapState;
}

async function getNetworkGasEstimation(
  account: Account,
  aptosClient: Aptos
): Promise<{ totalGasCostInAPT: number; maxGasCostInAPT: number }> {
  try {
    const simpleTransaction = await aptosClient.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: "0x1::aptos_account::transfer",
        functionArguments: [account.accountAddress, 1],
      },
    });

    const [simulationResult] = await aptosClient.transaction.simulate.simple({
      signerPublicKey: account.publicKey,
      transaction: simpleTransaction,
    });

    const gasUnitPrice = parseInt(simulationResult.gas_unit_price);
    const maxGasAmount = parseInt(simulationResult.max_gas_amount);

    const estimatedGasUsed = parseInt(simulationResult.gas_used);
    const estimatedMaxGas = Math.min(Math.ceil(maxGasAmount * 1.2), 50000);

    const totalGasCost = gasUnitPrice * estimatedGasUsed;
    const maxGasCost = gasUnitPrice * estimatedMaxGas;

    const totalGasCostInAPT = totalGasCost / 100_000_000;
    const maxGasCostInAPT = maxGasCost / 100_000_000;

    // Tăng cap để chính xác hơn
    const cappedTotalGas = Math.min(totalGasCostInAPT, 0.05);
    const cappedMaxGas = Math.min(maxGasCostInAPT, 0.1);

    return {
      totalGasCostInAPT: cappedTotalGas,
      maxGasCostInAPT: cappedMaxGas,
    };
  } catch (error) {
    return { totalGasCostInAPT: 0.005, maxGasCostInAPT: 0.01 };
  }
}

async function estimateSwapGas(
  account: Account,
  faAddressIn: string,
  faAddressOut: string,
  tokenAddressIn: string,
  tokenAddressOut: string,
  swapAmount: number,
  aptosClient: Aptos,
  pools: Pool[]
): Promise<{ totalGasCostInAPT: number; maxGasCostInAPT: number }> {
  const simulationPool = pools[0];
  if (!simulationPool) {
    return await getNetworkGasEstimation(account, aptosClient);
  }

  try {
    const dexService = DEXFactory.getService(
      simulationPool.dex.name as DexName
    );
    
    let swapParams: any = {
        account,
        aptosClient,
        faAddressIn,
        faAddressOut,
        amountIn: swapAmount,
        slippage: 0.5,
        toAddress: account.accountAddress.toString(),
    };

    // For PancakeSwap, use tokenAddressIn/Out
    if (simulationPool.dex.name === DexName.PANCAKESWAP) {
      swapParams.tokenAddressIn = tokenAddressIn || "";
      swapParams.tokenAddressOut = tokenAddressOut || "";
    }

    const swapResult = await dexService.createSwapTransaction(
      swapParams,
      simulationPool
    );

    const [simulationResult] = await aptosClient.transaction.simulate.simple({
      signerPublicKey: account.publicKey,
      transaction: swapResult.transaction,
    });

    const gasUnitPrice = parseInt(simulationResult.gas_unit_price);
    const gasUsed = parseInt(simulationResult.gas_used);
    const maxGasAmount = parseInt(simulationResult.max_gas_amount);
    const totalGasCost = gasUnitPrice * gasUsed;
    const maxGasCost = gasUnitPrice * maxGasAmount;

    const totalGasCostInAPT = totalGasCost / 100_000_000;
    const maxGasCostInAPT = maxGasCost / 100_000_000;

    // Tăng cap để chính xác hơn
    const cappedTotalGas = Math.min(totalGasCostInAPT, 0.05);
    const cappedMaxGas = Math.min(maxGasCostInAPT, 0.1);

    return {
      totalGasCostInAPT: cappedTotalGas,
      maxGasCostInAPT: cappedMaxGas,
    };
  } catch (error) {
    return await getNetworkGasEstimation(account, aptosClient);
  }
}

interface TokenValidationResult {
  balance: number;
  decimals: number;
  tokenData: any;
}


class SwapPreparationService {
  constructor(
    private walletApi: any,
    private tokenApi: any,
    private aptosConfig: any
  ) {}

  async validateTokenBalance(
    account: Account,
    aptosClient: Aptos,
    tokenAddressIn: string | null
  ): Promise<TokenValidationResult> {
    const inputResources = await aptosClient.getAccountCoinsData({
      accountAddress: account.accountAddress,
      options: {
        where: { asset_type: { _eq: tokenAddressIn } },
      },
    });

    const inputTokenData = inputResources[0];
    if (!inputTokenData || !inputTokenData.amount) {
      throw new Error(
        `Input token not found or insufficient balance: ${tokenAddressIn}`
      );
    }

    return {
      balance: Number(inputTokenData.amount),
      decimals: inputTokenData.metadata?.decimals ?? 8,
      tokenData: inputTokenData,
    };
  }

  async validateSwapAmount(
    amountIn: string | number,
    tokenBalance: TokenValidationResult
  ): Promise<number> {
    const amountInNumber =
      typeof amountIn === "string" ? parseFloat(amountIn) : amountIn;

    if (isNaN(amountInNumber) || amountInNumber <= 0) {
      throw new Error("Invalid swap amount");
    }

    const { balance, decimals } = tokenBalance;
    
    // Precise calculation with rounding
    const swapAmount = Math.round(amountInNumber * 10 ** decimals);

    // Extensive logging for debugging
    if (swapAmount > balance) {
      throw new Error(`Insufficient balance. 
        Balance: ${(balance / 10 ** decimals).toFixed(decimals)}
        Swap Amount: ${amountInNumber.toFixed(decimals)}`);
    }

    return swapAmount;
  }

  async prepareSwap(
    swapState: SwapState,
    config: RunnableConfig
  ): Promise<SwapState> {
    const { request } = swapState;
    if (!request) {
      throw new Error("No swap request found");
    }


    const userId = this.extractUserId(config);
    const wallet = await this.walletApi.getWallet(userId);
    const account = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(wallet.privateKey),
    });

    const aptosClient = new Aptos(
      new AptosConfig({
        network: APTOS_CONFIG.network,
        ...(APTOS_CONFIG.rpcUrl && { fullnode: APTOS_CONFIG.rpcUrl }),
      })
    );

    // Xử lý địa chỉ token cho check balance
    let balanceTokenAddress = request.tokenAddressIn;
    
    // Nếu tokenAddressIn là null thì dùng faAddressIn
    if (!balanceTokenAddress) {
      balanceTokenAddress = request.faAddressIn;
    }
    
    // Nếu là APT token (0xa) thì chuyển thành 0x1::aptos_coin::AptosCoin để check balance
    if (balanceTokenAddress === '0xa') {
      balanceTokenAddress = '0x1::aptos_coin::AptosCoin';
    }
    

    const tokenBalance = await this.validateTokenBalance(
      account,
      aptosClient,
      balanceTokenAddress
    );

    const swapAmount = await this.validateSwapAmount(
      request.amountIn,
      tokenBalance
    );

    const gasEstimation = await getNetworkGasEstimation(account, aptosClient);

    return {
      phase: "findPool",
      request: {
        ...request,
      },
      preparedTransaction: {
        swapAmount,
        decimals: tokenBalance.decimals,
        tokenData: tokenBalance.tokenData,
        gasEstimation,
        accountAddress: account.accountAddress.toString(),
      },
      swapTool: swapState.swapTool,
    };
  }

  private extractUserId(config: RunnableConfig): number {
    return parseInt(
      config?.configurable?.["langgraph_auth_user_id"] ||
        config?.metadata?.["langgraph_auth_user_id"] ||
        "0"
    );
  }
}

export async function prepareSwapNode(
  state: { swapState: SwapState },
  config: RunnableConfig
): Promise<{ swapState: SwapState }> {
  try {
    const service = new SwapPreparationService(
      walletApi,
      tokenApi,
      APTOS_CONFIG
    );

    const swapState = await service.prepareSwap(state.swapState, config);

    return { swapState };
  } catch (error: any) {
    return {
      swapState: {
        phase: "error",
        swapTool: { name: "swap_tokens", args: {}, id: "" },
        error: error.message,
      },
    };
  }
}

export async function findPoolNode(
  state: typeof MessagesAnnotation.State & { swapState: SwapState },
  config: RunnableConfig
): Promise<{ swapState: SwapState }> {
  const swapState = state.swapState;

  
  if (swapState.pools && swapState.pools.length > 0) {
    
    let selectedPoolIndex = config?.configurable?.selectedPoolIndex;
    
    // Check for interrupt response in config (new approach)
    if (selectedPoolIndex === undefined) {
      const interruptResponse = config?.configurable?.interrupt_response;
      if (interruptResponse && typeof interruptResponse === 'object') {
        
        if (interruptResponse.cancelled === true) {
          return {
            swapState: {
              ...swapState,
              phase: "error",
              error: "User cancelled swap",
            },
          };
        }
        
        if (typeof interruptResponse.selectedPoolIndex === "number") {
          selectedPoolIndex = interruptResponse.selectedPoolIndex;
        }
      }
    }

    // Check for response in configurable (alternative approach)
    if (selectedPoolIndex === undefined) {
      const configResponse = config?.configurable?.response;
      if (configResponse && typeof configResponse === 'object') {
        
        if (configResponse.cancelled === true) {
          return {
            swapState: {
              ...swapState,
              phase: "error",
              error: "User cancelled swap",
            },
          };
        }
        
        if (typeof configResponse.selectedPoolIndex === "number") {
          selectedPoolIndex = configResponse.selectedPoolIndex;
        }
      }
    }

    // Check for response in messages (frontend sends response type)
    if (selectedPoolIndex === undefined && state?.messages) {
      // Log all recent messages for debugging
      const recentMessages = [...(state.messages || [])].slice(-5);
      // Try multiple approaches to find the response
      let lastResponseMsg = [...(state.messages || [])]
        .reverse()
        .find(
          (msg) => {
            const msgType = typeof msg.getType === "function" ? msg.getType() : 'unknown';
            const hasContent = !!(msg as any).content;
            // Check for "human" type messages with content
            return (msgType === "human") && hasContent;
          }
        );
      // If not found, try looking for tool call responses
      if (!lastResponseMsg) {
        lastResponseMsg = [...(state.messages || [])]
          .reverse()
          .find(
            (msg) => {
              const msgType = typeof msg.getType === "function" ? msg.getType() : 'unknown';
              const hasToolCalls = !!(msg as any).toolCalls && (msg as any).toolCalls.length > 0;
              return hasToolCalls;
            }
          );
      }
      // If still not found, try looking for interrupt responses
      if (!lastResponseMsg) {
        lastResponseMsg = [...(state.messages || [])]
          .reverse()
          .find(
            (msg) => {
              const msgType = typeof msg.getType === "function" ? msg.getType() : 'unknown';
              const hasContent = !!(msg as any).content;
              return hasContent;
            }
          );
      }
      if (lastResponseMsg) {
        // Try to extract selectedPoolIndex from different sources
        let parsed: any = null;
        // First try content
        const content = (lastResponseMsg as any).content;
        if (typeof content === "string") {
          try {
            parsed = JSON.parse(content);
          } catch (error) {}
        }
        // If not found, try additionalContent
        if (!parsed && (lastResponseMsg as any).additionalContent) {
          try {
            parsed = JSON.parse((lastResponseMsg as any).additionalContent);
          } catch (error) {}
        }
        // If not found, try tool calls
        if (!parsed && (lastResponseMsg as any).toolCalls) {
          const toolCalls = (lastResponseMsg as any).toolCalls;
          for (const toolCall of toolCalls) {
            if (toolCall.name === 'swap' && toolCall.args) {
              try {
                parsed = JSON.parse(toolCall.args);
                break;
              } catch (error) {}
            }
          }
        }
        if (parsed) {
          if (parsed.cancelled === true) {
            return {
              swapState: {
                ...swapState,
                phase: "error",
                error: "User cancelled swap",
              },
            };
          }
          if (typeof parsed.selectedPoolIndex === "number") {
            selectedPoolIndex = parsed.selectedPoolIndex;
          }
        }
      }
    }

    // Check for toolCall responses in messages
    if (selectedPoolIndex === undefined && state?.messages) {
      
      const toolCallMessages = [...(state.messages || [])]
        .reverse()
        .find(
          (msg) => {
            const msgType = typeof msg.getType === "function" ? msg.getType() : 'unknown';
            const hasToolCalls = !!(msg as any).toolCalls && (msg as any).toolCalls.length > 0;
            return hasToolCalls;
          }
        );
        
      if (toolCallMessages) {
        
        const toolCalls = (toolCallMessages as any).toolCalls;
        for (const toolCall of toolCalls) {
          if (toolCall.name === 'swap_tokens' && toolCall.args) {
            try {
              const parsed = JSON.parse(toolCall.args);
              
              if (parsed.cancelled === true) {
                return {
                  swapState: {
                    ...swapState,
                    phase: "error",
                    error: "User cancelled swap",
                  },
                };
              }
              
              if (typeof parsed.selectedPoolIndex === "number") {
                selectedPoolIndex = parsed.selectedPoolIndex;
                break;
              }
            } catch (error) {
            }
          }
        }
      }
    }
  }
  
  
  try {
    if (!swapState?.preparedTransaction || !swapState?.request)
      throw new Error("No prepared transaction found for pool search");

    const dexes = await dexApi.getDexes();
    const aptosClient = new Aptos(
      new AptosConfig({
      network: APTOS_CONFIG.network,
      ...(APTOS_CONFIG.rpcUrl && { fullnode: APTOS_CONFIG.rpcUrl }),
      })
    );

    const { faAddressIn, faAddressOut, tokenAddressIn, tokenAddressOut } =
      swapState.request || {};

    const dexServices = DEXFactory.getAllServices();
    const allPools: Pool[] = [];


    for (const dex of dexes) {
      if (!DEXFactory.isSupported(dex.name as DexName)) {
        continue;
      }

      try {
        // Get the specific service for this DEX
        const dexService = DEXFactory.getService(dex.name as DexName);
        
        // For PancakeSwap, we need to handle null token addresses differently
        const isPancakeSwap = dex.name.toLowerCase() === 'pancakeswap';
        let finalTokenAddressIn = tokenAddressIn;
        let finalTokenAddressOut = tokenAddressOut;
        
        // For PancakeSwap, if tokenAddress is null, we need to provide a valid address
        if (isPancakeSwap) {
          if (finalTokenAddressIn === null) {
            // For APT coin, use the full address for PancakeSwap
            finalTokenAddressIn = "0x1::aptos_coin::AptosCoin";
          }
          if (finalTokenAddressOut === null) {
            // For APT coin, use the full address for PancakeSwap
            finalTokenAddressOut = "0x1::aptos_coin::AptosCoin";
          }
        } else {
          // For other DEXes, use empty string if null
          finalTokenAddressIn = finalTokenAddressIn || "";
          finalTokenAddressOut = finalTokenAddressOut || "";
        }

        
        const pools = await dexService.findPools({
                dex,
                faAddressIn: faAddressIn || "",
                faAddressOut: faAddressOut || "",
          tokenAddressIn: finalTokenAddressIn,
          tokenAddressOut: finalTokenAddressOut,
                aptosClient,
              });

        
        allPools.push(...pools);
      } catch (error: any) {
      }
    }

    const filteredPools = allPools.filter((pool) => {
      const tokenA = (
        pool.token_a?.inner ||
        pool.token_a ||
        pool.token_x?.inner ||
        pool.token_x ||
        pool.fa_coin_x_metadata?.inner ||
        pool.fa_coin_x_metadata ||
        pool.fa_coin_x_address ||
        ""
      ).toLowerCase();
      const tokenB = (
        pool.token_b?.inner ||
        pool.token_b ||
        pool.token_y?.inner ||
        pool.token_y ||
        pool.fa_coin_y_metadata?.inner ||
        pool.fa_coin_y_metadata ||
        pool.fa_coin_y_address ||
        ""
      ).toLowerCase();

      const poolTokens = [tokenA, tokenB].sort().join(",");

      if (pool.dex?.name === DexName.PANCAKESWAP) {
        // For PancakeSwap, use tokenAddress if available, otherwise use faAddress
        let reqTokenIn = tokenAddressIn?.toLowerCase();
        let reqTokenOut = tokenAddressOut?.toLowerCase();

        if (reqTokenIn === "0xa") reqTokenIn = "0x1::aptos_coin::aptoscoin";
        if (reqTokenOut === "0xa") reqTokenOut = "0x1::aptos_coin::aptoscoin";

        const requestTokens = [reqTokenIn, reqTokenOut].sort().join(",");
        return poolTokens === requestTokens;
      } else {
        // Normalize APT token for other DEXes
        let reqFaIn = (faAddressIn || "").toLowerCase();
        let reqFaOut = (faAddressOut || "").toLowerCase();

        if (reqFaIn === "0x1::aptos_coin::aptoscoin") reqFaIn = "0xa";
        if (reqFaOut === "0x1::aptos_coin::aptoscoin") reqFaOut = "0xa";
        const requestTokens = [reqFaIn, reqFaOut].sort().join(",");
        return poolTokens === requestTokens;
      }
    });

    if (filteredPools.length === 0) {
      const partialMatchPools = allPools.filter((pool) => {
        const tokenA = (
          pool.token_a?.inner ||
          pool.token_a ||
          pool.token_x?.inner ||
          pool.token_x ||
          pool.fa_coin_x_metadata?.inner ||
          pool.fa_coin_x_metadata ||
          pool.fa_coin_x_address ||
          ""
        ).toLowerCase();
        const tokenB = (
          pool.token_b?.inner ||
          pool.token_b ||
          pool.token_y?.inner ||
          pool.token_y ||
          pool.fa_coin_y_metadata?.inner ||
          pool.fa_coin_y_metadata ||
          pool.fa_coin_y_address ||
          ""
        ).toLowerCase();

        const requestTokens = [
          faAddressIn?.toLowerCase() || "",
          faAddressOut?.toLowerCase() || "",
          tokenAddressIn?.toLowerCase() || "",
          tokenAddressOut?.toLowerCase() || "",
        ].filter((t) => t !== "");

        const hasMatch = requestTokens.some(
          (reqToken) =>
            tokenA.includes(reqToken) ||
            tokenB.includes(reqToken) ||
            reqToken.includes(tokenA) ||
            reqToken.includes(tokenB)
        );
        return hasMatch;
      });
      if (partialMatchPools.length > 0) {
        filteredPools.push(...partialMatchPools);
      }
    }

    const { slippage } = swapState.request || {};
    const slippageValue = slippage !== undefined ? slippage : 0.5;
    const { swapAmount } = swapState.preparedTransaction;

    // Estimate amount out for all pools
    for (const pool of filteredPools) {
      try {
        const dexService = DEXFactory.getService(pool.dex.name as DexName);
        const estimation = await dexService.estimateAmountOut(
          pool,
          swapAmount,
          aptosClient
        );

        // Update pool with estimation (applying actual slippage)
        pool.estimatedOutput = estimation.estimatedOutput;
        pool.minAmountOut = Math.floor(
          estimation.estimatedOutput * (1 - slippageValue / 100)
        );
      } catch (error) {
        // Set default values for failed estimation
        pool.estimatedOutput = 0;
        pool.minAmountOut = 0;
      }
    }

    // Sort pools by estimatedOutput (descending) and take top 5
    const sortedPools = filteredPools
      .filter(pool => (pool.estimatedOutput || 0) > 0) // Remove pools with zero output
      .sort((a, b) => (b.estimatedOutput || 0) - (a.estimatedOutput || 0))
      .slice(0, 5);

    if (sortedPools.length === 0) {
      return {
        swapState: {
          ...swapState,
          phase: "error" as const,
          error: "No pools with valid estimated output found",
        },
      };
    }



    let selectedPoolIndex = config?.configurable?.selectedPoolIndex;
    
    // Check for interrupt response in config (new approach)
    if (selectedPoolIndex === undefined) {
      // Check if we have an interrupt response with selectedPoolIndex
      const interruptResponse = config?.configurable?.interrupt_response;
      if (interruptResponse && typeof interruptResponse === 'object') {
        
        if (interruptResponse.cancelled === true) {
          return {
            swapState: {
              ...swapState,
              phase: "error",
              error: "User cancelled swap",
            },
          };
        }
        
        if (typeof interruptResponse.selectedPoolIndex === "number") {
          selectedPoolIndex = interruptResponse.selectedPoolIndex;
        }
      }
    }

    // Check for response in messages (frontend sends response type)
    if (selectedPoolIndex === undefined && state?.messages) {
      
      // Log all recent messages for debugging
      const recentMessages = [...(state.messages || [])].slice(-5);
      
      // Try multiple approaches to find the response
      let lastResponseMsg = [...(state.messages || [])]
        .reverse()
        .find(
          (msg) => {
            const msgType = typeof msg.getType === "function" ? msg.getType() : 'unknown';
            const hasContent = !!(msg as any).content;
            
            // Check for "human" type messages with content
            return (msgType === "human") && hasContent;
          }
        );
        
      // If not found, try looking for tool call responses
      if (!lastResponseMsg) {
        lastResponseMsg = [...(state.messages || [])]
          .reverse()
          .find(
            (msg) => {
              const msgType = typeof msg.getType === "function" ? msg.getType() : 'unknown';
              const hasToolCalls = !!(msg as any).toolCalls && (msg as any).toolCalls.length > 0;
              return hasToolCalls;
            }
          );
      }
      
      // If still not found, try looking for interrupt responses
      if (!lastResponseMsg) {
        lastResponseMsg = [...(state.messages || [])]
          .reverse()
          .find(
            (msg) => {
              const msgType = typeof msg.getType === "function" ? msg.getType() : 'unknown';
              const hasContent = !!(msg as any).content;
              return hasContent;
            }
          );
             }
        
              if (lastResponseMsg) {
          
          // Try to extract selectedPoolIndex from different sources
          let parsed: any = null;
          
          // First try content
          const content = (lastResponseMsg as any).content;
          if (typeof content === "string") {
            try {
              parsed = JSON.parse(content);
            } catch (error) {
            }
          }
          
          // If not found, try additionalContent
          if (!parsed && (lastResponseMsg as any).additionalContent) {
            try {
              parsed = JSON.parse((lastResponseMsg as any).additionalContent);
            } catch (error) {
            }
          }
          
          // If not found, try tool calls
          if (!parsed && (lastResponseMsg as any).toolCalls) {
            const toolCalls = (lastResponseMsg as any).toolCalls;
            
            for (const toolCall of toolCalls) {
              if (toolCall.name === 'swap' && toolCall.args) {
                try {
                  parsed = JSON.parse(toolCall.args);
                  break;
                } catch (error) {
                }
              }
            }
          }

          if (parsed) {
            if (parsed.cancelled === true) {
              return {
                swapState: {
                  ...swapState,
                  phase: "error",
                  error: "User cancelled swap",
                },
              };
            }
            
            if (typeof parsed.selectedPoolIndex === "number") {
              selectedPoolIndex = parsed.selectedPoolIndex;
            } else {
            }
          } else {
          }
        } else {
        }
    }

    // Legacy toolCall handling (keeping for backward compatibility)
    if (selectedPoolIndex === undefined && state?.messages) {
      
      const swapToolId = swapState?.swapTool?.id;
      const lastToolMsg = [...(state.messages || [])]
        .reverse()
        .find(
          (msg) =>
            typeof msg.getType === "function" &&
            msg.getType() === "tool" &&
            (msg as any).tool_call_id === swapToolId
        );
        
      if (lastToolMsg) {
        
        const content = (lastToolMsg as any).content;
        if (typeof content === "string") {
          try {
            const parsed = JSON.parse(content);
            
            if (parsed.cancelled === true) {
              return {
                swapState: {
                  ...swapState,
                  phase: "error",
                  error: "User cancelled swap",
                },
              };
            }
            
            if (typeof parsed.selectedPoolIndex === "number") {
              selectedPoolIndex = parsed.selectedPoolIndex;
            }
          } catch (error) {
          }
        }
      }
    }
    
    if (selectedPoolIndex === undefined) {
      // console.log('📋 No pool selected, showing pool options to user');
      // console.log('🔍 Available pools:', filteredPools.map((pool, index) => ({
      //   index,
      //   dex: pool.dex?.name,
      //   poolId: pool.id || pool.pool?.inner,
      //   estimatedOutput: pool.estimatedOutput,
      //   routeType: pool.routeType,
      //   routePath: pool.routePath
      // })));
      
      let poolsDescription = sortedPools
        .map((pool, index) => {
          let estimateInfo = "";
          if (pool.estimatedOutput) {
            // Lấy decimals của token output (mặc định 8 cho APT, 6 cho USDC, etc.)
            let outputDecimals = 8; // Default for APT
            let tokenSymbol = "APT"; // Default
            
            // Xác định token output và decimals
            const tokenOut = pool.tokenB || pool.token_b;
            if (tokenOut) {
              if (tokenOut.includes("aptos_coin") || tokenOut === "0xa") {
                outputDecimals = 8;
                tokenSymbol = "APT";
              } else if (tokenOut.includes("usdc")) {
                outputDecimals = 6;
                tokenSymbol = "USDC";
              } else if (tokenOut.includes("usdt")) {
                outputDecimals = 6;
                tokenSymbol = "USDT";
              } else {
                // Có thể lấy từ pool metadata nếu có
                outputDecimals = pool.token_b_metadata?.decimals || 8;
                tokenSymbol = pool.token_b_metadata?.symbol || "TOKEN";
              }
            }
            
            // Format số lượng với decimals đúng
            const estimatedOutputFormatted = (pool.estimatedOutput / 10 ** outputDecimals).toFixed(outputDecimals);
            const minAmountOutFormatted = ((pool.minAmountOut || 0) / 10 ** outputDecimals).toFixed(outputDecimals);
            
            estimateInfo = `\nEstimated output: ${estimatedOutputFormatted} ${tokenSymbol} (Min: ${minAmountOutFormatted} ${tokenSymbol} with ${slippageValue}% slippage)`;
          }

          // Add routing information
          let routingInfo = "";
          if (pool.routeType && pool.routePath) {
            const routeType = pool.routeType;
            const pathLength = pool.routePath.length;
            if (routeType === "direct") {
              routingInfo = `\nRoute: Direct swap`;
            } else if (routeType === "doublehop") {
              routingInfo = `\nRoute: Multi-hop (${pathLength} tokens)`;
            } else {
              routingInfo = `\nRoute: ${routeType} (${pathLength} tokens)`;
            }
          }

          // Add fee information
          let feeInfo = "";
          if (pool.fee !== undefined) {
            feeInfo = `\nFee: ${pool.fee}%`;
          }

          return `Pool ${index}: ${pool.dex?.name || "Unknown DEX"}${estimateInfo}${routingInfo}${feeInfo}`;
        })
        .join("\n\n");

      const description = `Please select a pool to proceed with the swap. You can also ignore to cancel the swap.
      
Slippage Protection: ${slippageValue}% (This protects you from price changes between transaction submission and execution)

Available Pools:
${poolsDescription}

💡 **Direct swaps** are usually faster and have lower fees, while **Multi-hop swaps** go through intermediate tokens for better liquidity.`;

      const humanResponses = interrupt({
        action_request: {
          action: "Select Pool",
          args: { pools: sortedPools },
        },
        description,
        config: {
          allow_ignore: true,
          allow_accept: true,
          allow_edit: false,
          allow_respond: false,
        },
      });

      // Process user response like transfer
      
      const responseType = humanResponses[0]?.type;
      
      if (responseType !== "accept") {
        return {
          swapState: {
            ...swapState,
            phase: "error",
            error: "User cancelled pool selection",
          },
        };
      }

      // User accepted - extract selectedPoolIndex from response
      const responseContent = humanResponses[0]?.args;
      
      if (responseContent) {
        try {
          const parsed = typeof responseContent === 'string' ? JSON.parse(responseContent) : responseContent;
          
          if (typeof parsed.selectedPoolIndex === "number") {
            selectedPoolIndex = parsed.selectedPoolIndex;
          } else {
          }
        } catch (error) {
        }
      }
    }
    
    // Validate selectedPoolIndex
    if (
      typeof selectedPoolIndex !== "number" ||
      selectedPoolIndex < 0 ||
      selectedPoolIndex >= sortedPools.length
    ) {
      throw new Error(`Invalid pool selection: selectedPoolIndex ${selectedPoolIndex} is out of range (0-${sortedPools.length - 1})`);
    }
    
    const selectedPool = sortedPools[selectedPoolIndex];
    if (!selectedPool) {
      throw new Error("Invalid pool selection: selectedPool is null");
    }
    

    const { request, preparedTransaction } = swapState;
    if (!request || !preparedTransaction) {
      throw new Error(
        "Missing request or preparedTransaction for gas estimation"
      );
    }

    const userId = parseInt(
      config?.configurable?.["langgraph_auth_user_id"] ||
      config?.metadata?.["langgraph_auth_user_id"] ||
      "0"
    );
    const wallet = await walletApi.getWallet(userId);
    if (!wallet || !wallet.privateKey) {
      throw new Error("Wallet not found for gas estimation");
    }

    const privateKey = new Ed25519PrivateKey(wallet.privateKey);
    const account = Account.fromPrivateKey({ privateKey });

    const gasEstimation = await estimateSwapGas(
      account,
      request.faAddressIn,
      request.faAddressOut,
      request.tokenAddressIn ?? "",
      request.tokenAddressOut ?? "",
      preparedTransaction.swapAmount,
      aptosClient,
      [selectedPool]
    );

    const initialGas = preparedTransaction.gasEstimation;

    const updatedState: SwapState = {
      ...swapState,
      phase: "executing",
      pools: sortedPools,
      selectedPool,
      preparedTransaction: {
        ...preparedTransaction,
        gasEstimation,
      },
    };

    return {
      ...state,
      swapState: updatedState,
    };
  } catch (error: any) {
    if (error instanceof GraphInterrupt) {
      throw error;
    }
    const errorState: SwapState = {
      ...state.swapState,
      phase: "error",
      error: error.message,
    };

    return {
      ...state,
      swapState: errorState,
    };
  }
}

export async function executeSwapNode(
  state: { swapState: SwapState },
  config: RunnableConfig
): Promise<{ swapState: SwapState }> {
  const swapState = state.swapState;
  try {
    if (
      !swapState?.preparedTransaction ||
      !swapState?.selectedPool ||
      !swapState?.request
    )
      throw new Error("No prepared transaction or pool for execution");
    const { preparedTransaction, request, selectedPool } = swapState;
    const { swapAmount } = preparedTransaction;
    const {
      faAddressIn,
      faAddressOut,
      tokenAddressIn,
      tokenAddressOut,
      slippage,
    } = request;

    const slippageValue = slippage !== undefined ? slippage : 0.5;

    const userId = parseInt(
      config?.configurable?.["langgraph_auth_user_id"] ||
      config?.metadata?.["langgraph_auth_user_id"] ||
      "0"
    );
    const wallet = await walletApi.getWallet(userId);
    if (!wallet || !wallet.privateKey)
      throw new Error("Wallet not found or private key not available");
    const account = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(wallet.privateKey),
    });
    const aptosConfig = new AptosConfig({
      network: APTOS_CONFIG.network,
      ...(APTOS_CONFIG.rpcUrl && { fullnode: APTOS_CONFIG.rpcUrl }),
    });
    const aptosClient = new Aptos(aptosConfig);
    const assetType =
      selectedPool.dex?.name === DexName.PANCAKESWAP
        ? tokenAddressIn
        : faAddressIn;
    const resources = await aptosClient.getAccountCoinsData({
      accountAddress: account.accountAddress,
      options: {
        where: {
          asset_type: {
            _eq: assetType === "0xa" ? "0x1::aptos_coin::AptosCoin" : assetType,
          },
        },
      },
    });
    const tokenData = resources[0];
    const decimals = tokenData?.metadata?.decimals ?? 8;
    const balance = Number(tokenData?.amount || 0);
    const gasEstimation = preparedTransaction.gasEstimation;
    const gasReserveInOctas = Math.ceil(
      gasEstimation.maxGasCostInAPT * 100_000_000
    );

    if (assetType === "0xa" || assetType === "0x1::aptos_coin::AptosCoin") {
      const maxSwappableAmount = balance - gasReserveInOctas;

      if (swapAmount > maxSwappableAmount) {
        const originalAmountInAPT = parseFloat(request.amountIn);
        throw new Error(
          `Insufficient balance for swap. 
💰 Total APT balance: ${(balance / 10 ** decimals).toFixed(6)} APT
🔄 Amount you want to swap: ${originalAmountInAPT.toFixed(6)} APT
⛽ Estimated gas cost: ${gasEstimation.totalGasCostInAPT.toFixed(6)} APT
🛡️ Max gas reserve: ${gasEstimation.maxGasCostInAPT.toFixed(6)} APT
✅ Maximum you can swap: ${(maxSwappableAmount / 10 ** decimals).toFixed(6)} APT

Please reduce your swap amount to ${(maxSwappableAmount / 10 ** decimals).toFixed(6)} APT or less.`
        );
      }
    } else {
      if (swapAmount > balance) {
        const originalAmountInAPT = parseFloat(request.amountIn);
        throw new Error(
          `Insufficient token balance. 
💰 Total balance: ${(balance / 10 ** decimals).toFixed(6)}
🔄 Amount you want to swap: ${originalAmountInAPT.toFixed(6)}
❌ You don't have enough tokens for this swap.`
        );
      }
    }
    // Use DEX service to create swap transaction
    const dexService = DEXFactory.getService(selectedPool.dex?.name as DexName);
    
    // Prepare parameters based on DEX type
    let swapParams: any = {
        account,
        aptosClient,
        faAddressIn,
        faAddressOut,
        amountIn: swapAmount,
        slippage: slippageValue,
        toAddress: account.accountAddress.toString(),
    };

    // For PancakeSwap, use tokenAddressIn/Out
    if (selectedPool.dex?.name === DexName.PANCAKESWAP) {
      swapParams.tokenAddressIn = tokenAddressIn || "";
      swapParams.tokenAddressOut = tokenAddressOut || "";
    }
    // For other DEXes (Hyperion, Cellana), use faAddressIn/Out (already set above)

    const swapResult = await dexService.createSwapTransaction(
      swapParams,
      selectedPool
    );

    const transaction = swapResult.transaction;
    const committedTxn = await aptosClient.signAndSubmitTransaction({
      signer: account,
      transaction,
    });
    const executedTransaction = await aptosClient.waitForTransaction({
      transactionHash: committedTxn.hash,
    });
    const result = {
      success: true,
      transactionHash: executedTransaction.hash,
      fromAddress: account.accountAddress.toString(),
      tokenIn:
        selectedPool.dex?.name === DexName.PANCAKESWAP
          ? tokenAddressIn || ""
          : faAddressIn,
      tokenOut:
        selectedPool.dex?.name === DexName.PANCAKESWAP
          ? tokenAddressOut || ""
          : faAddressOut,
      amountIn: request.amountIn,
      amountOut: swapResult.estimatedOutput,
      minAmountOut: swapResult.minAmountOut,
      assetType: assetType,
      pool: selectedPool,
      slippage: slippageValue,
      gasEstimation: gasEstimation,
      message: `✅ Swap completed successfully!
💰 Amount In: ${request.amountIn}
📈 Estimated Amount Out: ${(swapResult.estimatedOutput / 10 ** decimals).toFixed(decimals)}
🛡️ Min Amount Out: ${(swapResult.minAmountOut / 10 ** decimals).toFixed(decimals)}
⛽ Gas Cost: ${gasEstimation.totalGasCostInAPT.toFixed(6)} APT`,
      explorerUrl: `https://explorer.aptoslabs.com/txn/${executedTransaction.hash}?network=${APTOS_CONFIG.network}`,
    };
    const completedState: SwapState = {
      ...swapState,
      phase: "completed",
      result,
    };
    return { swapState: completedState };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const errorState: SwapState = {
      ...swapState,
      phase: "error",
      error: errorMsg,
      result: {
        success: false,
        error: errorMsg,
        message: `Swap failed: ${errorMsg}`,
      },
    };
    return { swapState: errorState };
  }
}

export function routeSwapFlow(
  state: typeof MessagesAnnotation.State & { swapState?: SwapState }
): string {
  if (!state.swapState) return END;

  const phase = state.swapState.phase;
  let nextNode = END;

  switch (phase) {
    case "preparing":
      nextNode = "prepareSwap";
      break;
    case "findPool":
      nextNode = "findPool";
      break;
    case "executing":
      nextNode = "executeSwap";
      break;
    case "completed":
      nextNode = "callModel";
      break;
    case "error":
      nextNode = END;
      break;
    default:
      nextNode = END;
      break;
  }

  return nextNode;
}

const SwapGraphAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  swapState: Annotation<SwapState>({
    reducer: (x, y) => y ?? x,
    default: () => ({
      phase: "preparing",
      swapTool: { name: "swap_tokens", args: {}, id: "" },
    }),
  }),
});

const swapGraph = new StateGraph(SwapGraphAnnotation)
  .addNode("prepareSwap", prepareSwapNode)
  .addNode("findPool", findPoolNode)
  .addNode("executeSwap", executeSwapNode)
  .addEdge(START, "prepareSwap")
  .addConditionalEdges("prepareSwap", routeSwapFlow)
  .addConditionalEdges("findPool", routeSwapFlow)
  .addConditionalEdges("executeSwap", routeSwapFlow)
  .addEdge("executeSwap", END);

export const swapGraphCompiled = swapGraph.compile();
