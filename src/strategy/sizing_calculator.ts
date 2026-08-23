import { SizingResult, StrategyConfig } from '../types/strategy.types.js';
import { SymbolMetadata } from '../types/execution.types.js';

export class SizingCalculator {
  /**
   * Calculates strictly quantized order sizing for a target notional.
   * Guarantees that:
   * 1. Sizing never rounds upward (floor quantization only).
   * 2. Resulting notional strictly <= maxNotionalCap.
   * 3. Honors contract lot multiples when quantityPrecision < 0.
   * 4. Rejects if normalized size < minOrderSize or > maxOrderSize.
   */
  static calculate(
    targetNotionalUsd: number,
    markPrice: number,
    meta: SymbolMetadata,
    config: StrategyConfig
  ): SizingResult {
    if (markPrice <= 0) {
      return {
        symbol: meta.symbol,
        markPrice,
        contractVal: meta.contractVal,
        minOrderSize: meta.minOrderSize,
        quantityPrecision: meta.quantityPrecision,
        pricePrecision: meta.pricePrecision,
        rawQuantity: 0,
        quantizedQuantity: 0,
        quantityStr: "0",
        resultingNotional: 0,
        requiredMargin: 0,
        valid: false,
        rejectReason: "INVALID_MARK_PRICE"
      };
    }

    // Ensure requested notional does not exceed strategy cap
    const safeTargetNotional = Math.min(targetNotionalUsd, config.maxNotionalCapUsd);
    const rawQuantity = safeTargetNotional / markPrice;

    let quantizedQuantity: number;
    let quantityStr: string;

    if (meta.quantityPrecision >= 0) {
      const factor = Math.pow(10, meta.quantityPrecision);
      quantizedQuantity = Math.floor(rawQuantity * factor) / factor;
      quantityStr = quantizedQuantity.toFixed(meta.quantityPrecision);
    } else {
      // Negative precision indicates contract lot size multiples (e.g. -2 -> multiples of 100)
      const lotSize = Math.pow(10, -meta.quantityPrecision);
      quantizedQuantity = Math.floor(rawQuantity / lotSize) * lotSize;
      quantityStr = quantizedQuantity.toString();
    }

    const resultingNotional = quantizedQuantity * markPrice;
    const requiredMargin = resultingNotional / config.leverage;

    // Safety Validations
    if (quantizedQuantity < meta.minOrderSize) {
      return {
        symbol: meta.symbol,
        markPrice,
        contractVal: meta.contractVal,
        minOrderSize: meta.minOrderSize,
        quantityPrecision: meta.quantityPrecision,
        pricePrecision: meta.pricePrecision,
        rawQuantity,
        quantizedQuantity,
        quantityStr,
        resultingNotional,
        requiredMargin,
        valid: false,
        rejectReason: `SIZE_BELOW_MINIMUM: Normalized size ${quantizedQuantity} < minimum ${meta.minOrderSize}`
      };
    }

    if (quantizedQuantity > meta.maxOrderSize) {
      return {
        symbol: meta.symbol,
        markPrice,
        contractVal: meta.contractVal,
        minOrderSize: meta.minOrderSize,
        quantityPrecision: meta.quantityPrecision,
        pricePrecision: meta.pricePrecision,
        rawQuantity,
        quantizedQuantity,
        quantityStr,
        resultingNotional,
        requiredMargin,
        valid: false,
        rejectReason: `SIZE_EXCEEDS_MAXIMUM: Normalized size ${quantizedQuantity} > maximum ${meta.maxOrderSize}`
      };
    }

    if (resultingNotional > config.maxNotionalCapUsd + 1e-6) {
      return {
        symbol: meta.symbol,
        markPrice,
        contractVal: meta.contractVal,
        minOrderSize: meta.minOrderSize,
        quantityPrecision: meta.quantityPrecision,
        pricePrecision: meta.pricePrecision,
        rawQuantity,
        quantizedQuantity,
        quantityStr,
        resultingNotional,
        requiredMargin,
        valid: false,
        rejectReason: `NOTIONAL_EXCEEDS_CAP: Resulting notional $${resultingNotional.toFixed(2)} exceeds cap $${config.maxNotionalCapUsd}`
      };
    }

    return {
      symbol: meta.symbol,
      markPrice,
      contractVal: meta.contractVal,
      minOrderSize: meta.minOrderSize,
      quantityPrecision: meta.quantityPrecision,
      pricePrecision: meta.pricePrecision,
      rawQuantity,
      quantizedQuantity,
      quantityStr,
      resultingNotional,
      requiredMargin,
      valid: true
    };
  }
}
