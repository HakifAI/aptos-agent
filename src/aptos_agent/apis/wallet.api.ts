import type { Wallet } from "../types/wallet.type.js";
import baseApi from "./base.api.js";

const walletApi = {
  getWallet: async (userId: number) => {
    const response = await baseApi.get<Wallet>(`/wallet/${userId}`);
    return response.data;
  },
};

export default walletApi;
