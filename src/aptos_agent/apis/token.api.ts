import baseApi from "./base.api.js";

const tokenApi = {
  getTokenList: async (query: {
    symbol?: string;
    name?: string;
    address?: string;
    tags?: string[];
  }) => {
    const response = await baseApi.get<
      {
        tokenAddress: string;
        faAddress: string;
        symbol: string;
        name: string;
        decimals: number;
        bridge: string | null;
        logoUrl: string | null;
        websiteUrl: string | null;
        tags: string[];
        coinGeckoId: string | null;
        coinMarketCapId: number | null;
      }[]
    >(`/token/list`, {
      params: {
        ...query,
        tags: query.tags?.join(","),
      },
    });
    return response.data;
  },
};

export default tokenApi;
