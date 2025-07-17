import axios, { AxiosInstance } from "axios";

/**
 * Base API configuration with default settings
 */
const baseApi: AxiosInstance = axios.create({
  baseURL: process.env.BACKEND_BASE_URL ?? "http://localhost:3000/api",
  headers: {
    "X-API-KEY": process.env.BACKEND_API_KEY ?? "123456a@",
    "Content-Type": "application/json",
  },
  timeout: 10000, // 10 seconds timeout
});

export default baseApi;
