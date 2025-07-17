import baseApi from "./base.api.js";

const dexApi = {
  async getDexes() {
    const response = await baseApi.get("/dexes");
    return response.data;
  },
};

export default dexApi; 