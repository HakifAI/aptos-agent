import { StructuredTool } from "@langchain/core/tools";
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import axios from "axios";

export class TokenMarketDataTool extends StructuredTool {
  name = "get_token_market_data";
  description = `Get comprehensive token market data from CoinGecko or CoinMarketCap. 
  
Use the coinGeckoId or coinMarketCapId from the get_token_list tool results to fetch price data.
Returns current price, market cap, volume, price changes, and supply information (total, circulating, max supply).`;

  schema = z.object({
    coinGeckoId: z
      .string()
      .optional()
      .describe("CoinGecko ID for the token (e.g., 'aptos', 'bitcoin')"),
    coinMarketCapId: z
      .number()
      .optional()
      .describe("CoinMarketCap ID for the token (e.g., 21794 for APT)"),
    currency: z
      .string()
      .optional()
      .default("usd")
      .describe("Currency to get price in (default: usd)"),
  });

  async _call(
    input: { coinGeckoId?: string; coinMarketCapId?: number; currency?: string },
    _runManager?: any,
    _parentConfig?: RunnableConfig
  ): Promise<string> {
    try {
      const { coinGeckoId, coinMarketCapId, currency = "usd" } = this.schema.parse(input);

      // Check if we have at least one ID
      if (!coinGeckoId && !coinMarketCapId) {
        return JSON.stringify({
          success: false,
          error: "Cannot get price for this token",
          message: "Token does not have CoinGecko ID or CoinMarketCap ID available",
        });
      }

      // Try CoinGecko first if available
      if (coinGeckoId) {
        try {
          const priceData = await this.fetchFromCoinGecko(coinGeckoId, currency);
          if (priceData) {
            return JSON.stringify({
              success: true,
              source: "CoinGecko",
              data: priceData,
            });
          }
        } catch (error) {
          console.warn("CoinGecko API failed, trying CoinMarketCap:", error);
        }
      }

      // Try CoinMarketCap if CoinGecko failed or not available
      if (coinMarketCapId) {
        try {
          const priceData = await this.fetchFromCoinMarketCap(coinMarketCapId, currency);
          if (priceData) {
            return JSON.stringify({
              success: true,
              source: "CoinMarketCap",
              data: priceData,
            });
          }
        } catch (error) {
          console.warn("CoinMarketCap API failed:", error);
        }
      }

      return JSON.stringify({
        success: false,
        error: "Cannot get price for this token",
        message: "Both CoinGecko and CoinMarketCap APIs are unavailable or token not found",
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        message: "Token price retrieval failed",
      });
    }
  }

  private async fetchFromCoinGecko(coinGeckoId: string, currency: string) {
    // Use the detailed coins endpoint to get total supply information
    const url = `https://api.coingecko.com/api/v3/coins/${coinGeckoId}`;
    const params = {
      localization: false,
      tickers: false,
      market_data: true,
      community_data: false,
      developer_data: false,
      sparkline: false,
    };

    const response = await axios.get(url, { params, timeout: 10000 });
    const coinData = response.data;

    if (!coinData || !coinData.market_data) {
      throw new Error("Token not found on CoinGecko");
    }

    const marketData = coinData.market_data;
    
    return {
      tokenId: coinGeckoId,
      name: coinData.name,
      symbol: coinData.symbol?.toUpperCase(),
      price: marketData.current_price[currency],
      marketCap: marketData.market_cap[currency],
      volume24h: marketData.total_volume[currency],
      priceChange24h: marketData.price_change_percentage_24h,
      totalSupply: marketData.total_supply,
      circulatingSupply: marketData.circulating_supply,
      maxSupply: marketData.max_supply,
      lastUpdated: marketData.last_updated,
      currency: currency.toUpperCase(),
    };
  }

  private async fetchFromCoinMarketCap(coinMarketCapId: number, currency: string) {
    // Note: CoinMarketCap requires API key for production use
    // This is a fallback implementation that uses their free endpoint
    const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest`;
    const params = {
      id: coinMarketCapId.toString(),
      convert: currency.toUpperCase(),
    };

    const headers: any = {
      'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY || 'demo-key',
    };

    // If no API key available, return error
    if (!process.env.COINMARKETCAP_API_KEY) {
      throw new Error("CoinMarketCap API key not configured");
    }

    const response = await axios.get(url, { params, headers, timeout: 10000 });
    const tokenData = response.data.data[coinMarketCapId.toString()];

    if (!tokenData) {
      throw new Error("Token not found on CoinMarketCap");
    }

    const quote = tokenData.quote[currency.toUpperCase()];
    
    return {
      tokenId: coinMarketCapId,
      name: tokenData.name,
      symbol: tokenData.symbol,
      price: quote.price,
      marketCap: quote.market_cap,
      volume24h: quote.volume_24h,
      priceChange24h: quote.percent_change_24h,
      totalSupply: tokenData.total_supply,
      circulatingSupply: tokenData.circulating_supply,
      maxSupply: tokenData.max_supply,
      lastUpdated: quote.last_updated,
      currency: currency.toUpperCase(),
    };
  }
} 