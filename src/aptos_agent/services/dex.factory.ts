import { DexName } from "../types/function-type.enum.js";
import { IDEXService } from "../types/dex.types.js";
import { HyperionService } from "./hyperion.service.js";
import { PancakeSwapService } from "./pancakeswap.service.js";
import { CellanaService } from "./cellana.service.js";

export class DEXFactory {
  private static services: Map<DexName, IDEXService> = new Map();

  static getService(dexName: DexName): IDEXService {
    if (!this.services.has(dexName)) {
      const service = this.createService(dexName);
      this.services.set(dexName, service);
    }
    return this.services.get(dexName)!;
  }

  static getAllServices(): IDEXService[] {
    return [
      this.getService(DexName.HYPERION),
      this.getService(DexName.PANCAKESWAP),
      this.getService(DexName.CELLANA),
    ];
  }

  static getSupportedDexes(): DexName[] {
    return [
      DexName.HYPERION,
      DexName.PANCAKESWAP,
      DexName.CELLANA,
    ];
  }

  private static createService(dexName: DexName): IDEXService {
    switch (dexName) {
      case DexName.HYPERION:
        return new HyperionService();
      case DexName.PANCAKESWAP:
        return new PancakeSwapService();
      case DexName.CELLANA:
        return new CellanaService();
      default:
        throw new Error(`Unsupported DEX: ${dexName}`);
    }
  }

  static isSupported(dexName: DexName): boolean {
    return this.getSupportedDexes().includes(dexName);
  }
} 