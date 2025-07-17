import { Account, Aptos } from "@aptos-labs/ts-sdk";
import { DexName } from "./function-type.enum.js";

export interface Pool {
  id: string;
  dex: DexInfo;
  tokenA: string;
  tokenB: string;
  estimatedOutput?: number;
  minAmountOut?: number;
  fee?: number;
  [key: string]: any; // For DEX-specific properties
}

export interface DexInfo {
  name: DexName;
  displayName: string;
  methodAddress: string;
  functions: DexFunction[];
}

export interface DexFunction {
  functionType: string;
  functionName: string;
  isActive: boolean;
  description?: string;
}

export interface SwapParams {
  account: Account;
  aptosClient: Aptos;
  faAddressIn: string;
  faAddressOut: string;
  tokenAddressIn: string;
  tokenAddressOut: string;
  amountIn: number;
  slippage: number;
  toAddress: string;
}

export interface SwapResult {
  transaction: any;
  estimatedOutput: number;
  minAmountOut: number;
}

export interface PoolSearchParams {
  dex: DexInfo;
  faAddressIn: string;
  faAddressOut: string;
  tokenAddressIn: string;
  tokenAddressOut: string;
  aptosClient: Aptos;
}

export interface AmountEstimation {
  estimatedOutput: number;
  minAmountOut: number;
  slippage: number;
}

// Base interface for all DEX services
export interface IDEXService {
  getDexName(): DexName;
  findPools(params: PoolSearchParams): Promise<Pool[]>;
  estimateAmountOut(
    pool: Pool,
    amountIn: number,
    aptosClient: Aptos
  ): Promise<AmountEstimation>;
  createSwapTransaction(params: SwapParams, pool: Pool): Promise<SwapResult>;
  validatePool(pool: Pool, params: PoolSearchParams): boolean;
} 