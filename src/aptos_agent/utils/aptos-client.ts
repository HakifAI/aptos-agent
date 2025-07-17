import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk";
import { APTOS_CONFIG } from "../config/aptos.config.js";

/**
 * Singleton class for managing Aptos client instances
 */
class AptosClientManager {
  private static instance: AptosClientManager;
  private aptosClient: Aptos | null = null;

  private constructor() {}

  public static getInstance(): AptosClientManager {
    if (!AptosClientManager.instance) {
      AptosClientManager.instance = new AptosClientManager();
    }
    return AptosClientManager.instance;
  }

  public getClient(): Aptos {
    if (!this.aptosClient) {
      const config = new AptosConfig({
        network: APTOS_CONFIG.network,
        ...(APTOS_CONFIG.rpcUrl && { fullnode: APTOS_CONFIG.rpcUrl }),
      });
      this.aptosClient = new Aptos(config);
    }
    return this.aptosClient;
  }

  public resetClient(): void {
    this.aptosClient = null;
  }
}

/**
 * Get the singleton Aptos client instance
 */
export const getAptosClient = (): Aptos => {
  return AptosClientManager.getInstance().getClient();
};

/**
 * Reset the Aptos client (useful for testing or config changes)
 */
export const resetAptosClient = (): void => {
  AptosClientManager.getInstance().resetClient();
};