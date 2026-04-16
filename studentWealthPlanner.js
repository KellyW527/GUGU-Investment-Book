(function(global){
  "use strict";

  var clamp = function(n, min, max){ return Math.max(min, Math.min(max, n)); };
  var round2 = function(n){ return Math.round(n * 100) / 100; };
  var pct = function(n){ return round2(n * 100) + "%"; };

  function sumAllocation(allocation){
    return allocation.cash + allocation.bonds + allocation.equities;
  }

  function normalizeAllocation(allocation){
    var total = sumAllocation(allocation);
    if(total <= 0){
      return { cash: 1, bonds: 0, equities: 0 };
    }
    return {
      cash: allocation.cash / total,
      bonds: allocation.bonds / total,
      equities: allocation.equities / total
    };
  }

  function mapHorizonToScore(horizon){
    switch (horizon) {
      case "lt_3m": return 5;
      case "3m_1y": return 20;
      case "1y_3y": return 45;
      case "3y_5y": return 70;
      case "gt_5y": return 85;
      default: return 45;
    }
  }

  function mapLossActionToScore(action){
    switch (action) {
      case "sell_now": return 10;
      case "wait_and_see": return 35;
      case "hold": return 65;
      case "buy_more": return 85;
      default: return 35;
    }
  }

  function mapPriorityToScore(priority){
    switch (priority) {
      case "capital_preservation": return 15;
      case "low_volatility": return 35;
      case "balanced_growth": return 60;
      case "higher_return": return 80;
      default: return 60;
    }
  }

  function mapExperienceToScore(experience){
    switch (experience) {
      case "none": return 10;
      case "beginner": return 30;
      case "intermediate": return 60;
      case "advanced": return 80;
      default: return 30;
    }
  }

  function mapDiversificationUnderstandingToScore(level){
    switch (level) {
      case "none": return 10;
      case "basic": return 30;
      case "good": return 60;
      case "strong": return 80;
      default: return 30;
    }
  }

  function mapIncomeStabilityToScore(stability){
    switch (stability) {
      case "very_unstable": return 10;
      case "casual_only": return 30;
      case "relatively_stable": return 60;
      case "stable": return 80;
      default: return 30;
    }
  }

  function mapExpensePressureToScore(pressure){
    switch (pressure) {
      case "very_high": return 10;
      case "some": return 30;
      case "temporary_not_many": return 55;
      case "almost_none": return 80;
      default: return 30;
    }
  }

  function scoreDrawdownTolerance(maxDrawdownPct){
    if (maxDrawdownPct <= 0.05) return 10;
    if (maxDrawdownPct <= 0.10) return 30;
    if (maxDrawdownPct <= 0.15) return 50;
    if (maxDrawdownPct <= 0.20) return 70;
    return 85;
  }

  function emergencyMonths(currentCash, monthlyExpense){
    if (monthlyExpense <= 0) return 12;
    return currentCash / monthlyExpense;
  }

  function inferRiskLevel(score){
    if (score < 20) return "R1";
    if (score < 40) return "R2";
    if (score < 60) return "R3";
    if (score < 80) return "R4";
    return "R5";
  }

  function inferFinancialStage(emergencyMonthsValue, growthEligibleAmount){
    if (emergencyMonthsValue < 1.5) return "cash_repair";
    if (emergencyMonthsValue < 3 || growthEligibleAmount <= 0) return "steady_accumulation";
    return "growth_ready";
  }

  function buildRiskProfile(input){
    var notes = [];
    var eMonths = emergencyMonths(input.currentCash, input.monthlyEssentialExpense);

    var subjectiveRiskScore = round2(
      mapLossActionToScore(input.lossAction) * 0.25 +
      mapHorizonToScore(input.investmentHorizon) * 0.20 +
      mapPriorityToScore(input.priorityPreference) * 0.20 +
      scoreDrawdownTolerance(input.maxAcceptableDrawdownPct) * 0.20 +
      mapExperienceToScore(input.investmentExperience) * 0.10 +
      mapDiversificationUnderstandingToScore(input.diversificationUnderstanding) * 0.05
    );

    var shortTermLiability = input.shortTermExpense3m + input.plannedLargeExpense12m * 0.5;
    var freeCashAfterKnownNeeds = input.currentCash - shortTermLiability;
    var freeCashRatio = input.currentCash > 0 ? freeCashAfterKnownNeeds / input.currentCash : -1;

    var objectiveCapacityScoreBase = round2(
      mapIncomeStabilityToScore(input.incomeStability) * 0.22 +
      mapExpensePressureToScore(input.expensePressure) * 0.18 +
      clamp(eMonths / 6, 0, 1) * 100 * 0.25 +
      (clamp(freeCashRatio, -1, 1) * 50 + 50) * 0.20 +
      clamp(input.investableAssets / Math.max(input.monthlyEssentialExpense * 6, 1), 0, 1) * 100 * 0.15
    );

    var objectiveCapacityScore = clamp(objectiveCapacityScoreBase, 0, 100);

    if (eMonths < 1) {
      objectiveCapacityScore = Math.min(objectiveCapacityScore, 20);
      notes.push("应急金不足 1 个月，客观承受能力被强制压低。");
    }
    if (input.investmentHorizon === "lt_3m") {
      objectiveCapacityScore = Math.min(objectiveCapacityScore, 15);
      notes.push("投资期限不足 3 个月，不适合承担股票波动。");
    }
    if (input.shortTermExpense3m > input.currentCash * 0.7) {
      objectiveCapacityScore = Math.min(objectiveCapacityScore, 25);
      notes.push("3 个月内支出占当前现金比例较高，先保流动性。");
    }

    var effectiveRiskScore = round2(subjectiveRiskScore * 0.40 + objectiveCapacityScore * 0.60);

    if (objectiveCapacityScore < 30) effectiveRiskScore = Math.min(effectiveRiskScore, 35);
    if (eMonths < 3) effectiveRiskScore = Math.min(effectiveRiskScore, 55);
    if (input.maxAcceptableDrawdownPct <= 0.10) effectiveRiskScore = Math.min(effectiveRiskScore, 45);

    var riskLevel = inferRiskLevel(effectiveRiskScore);
    var liquidityStressScore = round2(
      clamp((input.shortTermExpense3m + input.plannedLargeExpense12m) / Math.max(input.currentCash, 1), 0, 3) / 3 * 100
    );

    var minimumSafetyReserve = Math.max(
      input.monthlyEssentialExpense * 3,
      input.shortTermExpense3m + input.plannedLargeExpense12m * 0.5
    );
    var growthEligibleAmount = Math.max(0, input.currentCash - minimumSafetyReserve);
    var financialStage = inferFinancialStage(eMonths, growthEligibleAmount);

    var maxPortfolioDrawdownCap = input.maxAcceptableDrawdownPct;
    if (riskLevel === "R1") maxPortfolioDrawdownCap = Math.min(maxPortfolioDrawdownCap, 0.04);
    if (riskLevel === "R2") maxPortfolioDrawdownCap = Math.min(maxPortfolioDrawdownCap, 0.08);
    if (riskLevel === "R3") maxPortfolioDrawdownCap = Math.min(maxPortfolioDrawdownCap, 0.12);
    if (riskLevel === "R4") maxPortfolioDrawdownCap = Math.min(maxPortfolioDrawdownCap, 0.18);

    if (financialStage === "cash_repair") {
      notes.push("当前阶段优先补足安全垫，不建议把主要精力放在收益最大化。");
    } else if (financialStage === "steady_accumulation") {
      notes.push("当前可以做配置，但仍需先照顾未来支出。");
    } else {
      notes.push("已经具备进入增长配置阶段的基本条件。");
    }

    return {
      subjectiveRiskScore: subjectiveRiskScore,
      objectiveCapacityScore: objectiveCapacityScore,
      effectiveRiskScore: effectiveRiskScore,
      riskLevel: riskLevel,
      financialStage: financialStage,
      emergencyFundMonths: round2(eMonths),
      liquidityStressScore: liquidityStressScore,
      maxPortfolioDrawdownCap: round2(maxPortfolioDrawdownCap),
      notes: notes
    };
  }

  function buildCashBuckets(input, risk){
    var notes = [];

    var livingBucketTargetMonths =
      risk.riskLevel === "R1" || risk.financialStage === "cash_repair" ? 3 :
      risk.riskLevel === "R2" ? 2.5 :
      risk.riskLevel === "R3" ? 2 :
      1.5;

    var stabilityBucketTargetMonths =
      input.investmentHorizon === "lt_3m" ? 0 :
      input.investmentHorizon === "3m_1y" ? 6 :
      input.investmentHorizon === "1y_3y" ? 4 :
      3;

    var livingBucket = input.monthlyEssentialExpense * livingBucketTargetMonths;
    var stabilityBucket = Math.max(
      input.shortTermExpense3m + input.plannedLargeExpense12m * 0.7,
      input.monthlyEssentialExpense * stabilityBucketTargetMonths * 0.5
    );

    if (input.expensePressure === "very_high") {
      livingBucket += input.monthlyEssentialExpense * 0.5;
      stabilityBucket += input.monthlyEssentialExpense * 0.5;
      notes.push("未来支出压力高，现金桶额外上调。");
    }

    var requiredMinimumSafety = livingBucket + stabilityBucket;
    var shortageToMinimumSafety = Math.max(0, requiredMinimumSafety - input.currentCash);
    var growthBucket = Math.max(0, input.currentCash - requiredMinimumSafety);

    if (shortageToMinimumSafety > 0) {
      notes.push("当前现金不足以同时覆盖生活桶与稳定桶，增长桶设为 0。");
    }

    var growthEligibleAmount = Math.min(growthBucket, input.investableAssets);

    if (growthEligibleAmount <= 0) {
      notes.push("当前没有可进入增长配置的安全资金。");
    } else if (growthEligibleAmount < input.currentCash * 0.2) {
      notes.push("增长桶占比较小，应以稳健配置为主。");
    }

    return {
      livingBucket: round2(livingBucket),
      stabilityBucket: round2(stabilityBucket),
      growthBucket: round2(growthBucket),
      livingBucketTargetMonths: round2(livingBucketTargetMonths),
      stabilityBucketTargetMonths: round2(stabilityBucketTargetMonths),
      shortageToMinimumSafety: round2(shortageToMinimumSafety),
      growthEligibleAmount: round2(growthEligibleAmount),
      notes: notes
    };
  }

  function baseAllocationByRisk(riskLevel){
    switch (riskLevel) {
      case "R1": return { cash: 0.75, bonds: 0.20, equities: 0.05 };
      case "R2": return { cash: 0.50, bonds: 0.35, equities: 0.15 };
      case "R3": return { cash: 0.30, bonds: 0.40, equities: 0.30 };
      case "R4": return { cash: 0.15, bonds: 0.30, equities: 0.55 };
      case "R5": return { cash: 0.10, bonds: 0.20, equities: 0.70 };
      default: return { cash: 0.30, bonds: 0.40, equities: 0.30 };
    }
  }

  function applyStudentConstraints(base, input, risk, buckets){
    var constraintsApplied = [];
    var result = {
      cash: base.cash,
      bonds: base.bonds,
      equities: base.equities
    };

    if (risk.financialStage === "cash_repair") {
      result = { cash: 0.85, bonds: 0.15, equities: 0.00 };
      constraintsApplied.push("现金修复期：股票仓位强制降为 0。");
      return { result: result, constraintsApplied: constraintsApplied };
    }

    var growthShare = input.currentCash > 0 ? buckets.growthEligibleAmount / input.currentCash : 0;

    if (growthShare < 0.10) {
      result.equities = Math.min(result.equities, 0.10);
      result.cash = Math.max(result.cash, 0.55);
      constraintsApplied.push("增长桶占比很低：权益仓位限制在 10% 以内。");
    } else if (growthShare < 0.20) {
      result.equities = Math.min(result.equities, 0.20);
      result.cash = Math.max(result.cash, 0.40);
      constraintsApplied.push("增长桶占比偏低：权益仓位限制在 20% 以内。");
    }

    if (input.investmentHorizon === "3m_1y") {
      result.equities = Math.min(result.equities, 0.15);
      result.cash = Math.max(result.cash, 0.45);
      constraintsApplied.push("投资期限 3-12 个月：权益仓位显著下调。");
    } else if (input.investmentHorizon === "1y_3y") {
      result.equities = Math.min(result.equities, 0.35);
      constraintsApplied.push("投资期限 1-3 年：权益仓位上限 35%。");
    }

    if (risk.maxPortfolioDrawdownCap <= 0.05) {
      result.equities = Math.min(result.equities, 0.08);
      result.cash = Math.max(result.cash, 0.55);
      constraintsApplied.push("最大可接受回撤 <= 5%：权益仓位上限 8%。");
    } else if (risk.maxPortfolioDrawdownCap <= 0.10) {
      result.equities = Math.min(result.equities, 0.20);
      constraintsApplied.push("最大可接受回撤 <= 10%：权益仓位上限 20%。");
    } else if (risk.maxPortfolioDrawdownCap <= 0.15) {
      result.equities = Math.min(result.equities, 0.35);
      constraintsApplied.push("最大可接受回撤 <= 15%：权益仓位上限 35%。");
    }

    if (input.investmentExperience === "none") {
      result.equities = Math.min(result.equities, 0.30);
      constraintsApplied.push("无投资经验：权益仓位上限 30%。");
    }

    var safetyCashFloor = input.currentCash > 0
      ? clamp((buckets.livingBucket + Math.min(buckets.stabilityBucket, input.currentCash)) / input.currentCash, 0, 1)
      : 1;

    result.cash = Math.max(result.cash, Math.min(safetyCashFloor, 0.85));
    constraintsApplied.push("现金底线来自分桶安全垫：至少保留 " + pct(Math.min(safetyCashFloor, 0.85)) + "。");

    result = normalizeAllocation(result);
    result.equities = Math.min(result.equities, 0.75);
    result.cash = Math.max(result.cash, 0.05);
    result.bonds = Math.max(result.bonds, 0.05);

    return {
      result: normalizeAllocation(result),
      constraintsApplied: constraintsApplied
    };
  }

  function optimizeMPTLite(risk, bounds, config){
    var mu = [config.expectedReturns.cash, config.expectedReturns.bonds, config.expectedReturns.equities];
    var cov = config.covariance;
    var lambda =
      risk.riskLevel === "R1" ? 10 :
      risk.riskLevel === "R2" ? 7 :
      risk.riskLevel === "R3" ? 5 :
      risk.riskLevel === "R4" ? 3 :
      2;

    var bestScore = -Infinity;
    var best = { cash: 1, bonds: 0, equities: 0 };
    var cash;
    var bonds;

    for (cash = bounds.cashMin; cash <= bounds.cashMax + 1e-9; cash += 0.05) {
      for (bonds = bounds.bondsMin; bonds <= bounds.bondsMax + 1e-9; bonds += 0.05) {
        var equities = 1 - cash - bonds;
        if (equities < bounds.equitiesMin - 1e-9 || equities > bounds.equitiesMax + 1e-9) continue;

        var weights = [cash, bonds, equities];
        var portReturn = weights[0] * mu[0] + weights[1] * mu[1] + weights[2] * mu[2];
        var portVar =
          weights[0] * (cov[0][0] * weights[0] + cov[0][1] * weights[1] + cov[0][2] * weights[2]) +
          weights[1] * (cov[1][0] * weights[0] + cov[1][1] * weights[1] + cov[1][2] * weights[2]) +
          weights[2] * (cov[2][0] * weights[0] + cov[2][1] * weights[1] + cov[2][2] * weights[2]);

        var score = portReturn - lambda * portVar;
        if (score > bestScore) {
          bestScore = score;
          best = { cash: cash, bonds: bonds, equities: equities };
        }
      }
    }

    return normalizeAllocation(best);
  }

  function buildAssetAllocation(input, risk, buckets, mptConfig){
    var rationale = [];
    var simplifiedBase = baseAllocationByRisk(risk.riskLevel);
    var constrained = applyStudentConstraints(simplifiedBase, input, risk, buckets);
    var mptTarget;

    rationale.push("以 " + risk.riskLevel + " 的基础配置为起点，再根据学生阶段的流动性约束做调整。");
    rationale.push("先满足生活桶和稳定桶，再让增长桶进入股票和债券配置。");

    if (
      mptConfig &&
      mptConfig.enabled &&
      mptConfig.expectedReturns &&
      mptConfig.covariance &&
      risk.financialStage !== "cash_repair"
    ) {
      var cashMin = Math.max(constrained.result.cash - 0.10, 0.05);
      var cashMax = Math.min(constrained.result.cash + 0.15, 0.90);
      var bondsMin = Math.max(constrained.result.bonds - 0.15, 0.05);
      var bondsMax = Math.min(constrained.result.bonds + 0.15, 0.80);
      var equitiesMin = Math.max(constrained.result.equities - 0.15, 0.00);
      var equitiesMax = Math.min(constrained.result.equities + 0.15, 0.75);

      mptTarget = optimizeMPTLite(risk, {
        cashMin: cashMin,
        cashMax: cashMax,
        bondsMin: bondsMin,
        bondsMax: bondsMax,
        equitiesMin: equitiesMin,
        equitiesMax: equitiesMax
      }, {
        expectedReturns: mptConfig.expectedReturns,
        covariance: mptConfig.covariance
      });

      rationale.push("MPT-lite 只在规则边界内微调，不允许优化器给出极端权重。");
    }

    var finalTarget = mptTarget ? normalizeAllocation({
      cash: constrained.result.cash * 0.7 + mptTarget.cash * 0.3,
      bonds: constrained.result.bonds * 0.7 + mptTarget.bonds * 0.3,
      equities: constrained.result.equities * 0.7 + mptTarget.equities * 0.3
    }) : constrained.result;

    if (input.currentCash < input.monthlyEssentialExpense * 2) {
      rationale.push("当前现金覆盖月数偏低，整体组合继续偏保守。");
    }
    if (input.investmentExperience === "none" || input.investmentExperience === "beginner") {
      rationale.push("新手优先规则化分散，而不是集中押注单一个股。");
    }

    return {
      target: finalTarget,
      simplifiedTarget: constrained.result,
      mptTarget: mptTarget,
      rationale: rationale,
      constraintsApplied: constrained.constraintsApplied
    };
  }

  function buildEquityAllocation(input, risk, assetAllocation){
    var rules = [];
    var broadIndex =
      risk.riskLevel === "R1" ? 1.0 :
      risk.riskLevel === "R2" ? 0.95 :
      risk.riskLevel === "R3" ? 0.85 :
      risk.riskLevel === "R4" ? 0.75 :
      0.70;

    if (input.investmentExperience === "none") broadIndex = Math.max(broadIndex, 0.90);
    if (input.diversificationUnderstanding === "none") broadIndex = Math.max(broadIndex, 0.95);

    var china = 0.35;
    var us = 0.35;
    var developedExUS = 0.20;
    var emergingExChina = 0.10;

    if (risk.riskLevel === "R1" || risk.riskLevel === "R2") {
      china = 0.30;
      us = 0.40;
      developedExUS = 0.20;
      emergingExChina = 0.10;
    } else if (risk.riskLevel === "R4" || risk.riskLevel === "R5") {
      china = 0.35;
      us = 0.35;
      developedExUS = 0.15;
      emergingExChina = 0.15;
    }

    var valueDividendTilt =
      input.priorityPreference === "capital_preservation" ? 0.65 :
      input.priorityPreference === "low_volatility" ? 0.55 :
      input.priorityPreference === "balanced_growth" ? 0.45 :
      0.30;

    var growthTilt = 1 - valueDividendTilt;
    var sectorTiltMax =
      risk.riskLevel === "R1" ? 0.15 :
      risk.riskLevel === "R2" ? 0.20 :
      risk.riskLevel === "R3" ? 0.25 :
      0.30;

    var singleNameMax =
      (input.investmentExperience === "advanced" && (risk.riskLevel === "R4" || risk.riskLevel === "R5")) ? 0.08 :
      input.investmentExperience === "intermediate" ? 0.05 :
      0.03;

    rules.push("股票部分的 " + pct(broadIndex) + " 默认放入宽基和规则型指数资产。");
    rules.push("单一行业上限 " + pct(sectorTiltMax) + "，避免表面分散、实则同一赛道。");
    rules.push("单一标的上限 " + pct(singleNameMax) + "，新手不建议重仓个股。");
    rules.push("优先做地域分散和风格分散，再考虑少量主题倾斜。");

    return {
      broadIndex: round2(broadIndex),
      china: round2(china),
      us: round2(us),
      developedExUS: round2(developedExUS),
      emergingExChina: round2(emergingExChina),
      valueDividendTilt: round2(valueDividendTilt),
      growthTilt: round2(growthTilt),
      sectorTiltMax: round2(sectorTiltMax),
      singleNameMax: round2(singleNameMax),
      rules: rules,
      equityShareOfPortfolio: round2(assetAllocation.equities)
    };
  }

  function buildBondAllocation(input, risk, assetAllocation){
    var rules = [];
    var moneyMarket = 0.20;
    var shortDuration = 0.55;
    var mediumDuration = 0.20;
    var longDuration = 0.05;
    var highGrade = 0.90;
    var lowerGradeMax = 0.10;

    if (risk.riskLevel === "R1" || input.investmentHorizon === "3m_1y") {
      moneyMarket = 0.35;
      shortDuration = 0.55;
      mediumDuration = 0.10;
      longDuration = 0.00;
      highGrade = 0.95;
      lowerGradeMax = 0.00;
      rules.push("短期限或低风险用户：债券部分以货币、短久期和高等级为主。");
    } else if (risk.riskLevel === "R2" || risk.riskLevel === "R3") {
      moneyMarket = 0.20;
      shortDuration = 0.55;
      mediumDuration = 0.20;
      longDuration = 0.05;
      highGrade = 0.90;
      lowerGradeMax = 0.05;
      rules.push("稳健型用户：维持短久期为主，少量中久期。");
    } else if (risk.riskLevel === "R4" || risk.riskLevel === "R5") {
      moneyMarket = 0.10;
      shortDuration = 0.45;
      mediumDuration = 0.30;
      longDuration = 0.15;
      highGrade = 0.85;
      lowerGradeMax = 0.10;
      rules.push("较长投资期限且进入增长阶段后，可少量增加中长久期，但不宜过重。");
    }

    if (input.investmentExperience === "none" || input.investmentExperience === "beginner") {
      longDuration = Math.min(longDuration, 0.05);
      lowerGradeMax = Math.min(lowerGradeMax, 0.05);
      rules.push("新手限制长久期与低评级债暴露。");
    }

    if (risk.financialStage !== "growth_ready") {
      moneyMarket = Math.max(moneyMarket, 0.25);
      longDuration = Math.min(longDuration, 0.05);
      rules.push("未进入完全增长阶段：债券部分保留更高流动性。");
    }

    return {
      moneyMarket: round2(moneyMarket),
      shortDuration: round2(shortDuration),
      mediumDuration: round2(mediumDuration),
      longDuration: round2(longDuration),
      highGrade: round2(highGrade),
      lowerGradeMax: round2(lowerGradeMax),
      rules: rules,
      bondShareOfPortfolio: round2(assetAllocation.bonds)
    };
  }

  function buildRebalanceSuggestion(input, risk, target){
    var reasons = [];
    var actions = [];

    if (!input.currentAllocation) {
      return {
        shouldRebalance: false,
        reasons: ["没有当前持仓数据，暂不生成再平衡动作。"],
        actions: ["先录入当前现金、债券、股票实际比例。"]
      };
    }

    var current = normalizeAllocation({
      cash: input.currentAllocation.cash || 0,
      bonds: input.currentAllocation.bonds || 0,
      equities: input.currentAllocation.equities || 0
    });

    var drift = {
      cash: round2(current.cash - target.cash),
      bonds: round2(current.bonds - target.bonds),
      equities: round2(current.equities - target.equities)
    };

    var threshold =
      risk.riskLevel === "R1" ? 0.04 :
      risk.riskLevel === "R2" ? 0.05 :
      risk.riskLevel === "R3" ? 0.06 :
      0.08;

    var needs =
      Math.abs(drift.cash) > threshold ||
      Math.abs(drift.bonds) > threshold ||
      Math.abs(drift.equities) > threshold;

    if (!needs) {
      reasons.push("当前偏离度未超过 " + pct(threshold) + " 阈值。");
      actions.push("维持现有配置，按月检查即可。");
      return {
        shouldRebalance: false,
        reasons: reasons,
        actions: actions,
        drift: drift
      };
    }

    reasons.push("当前持仓至少一个大类资产偏离目标超过 " + pct(threshold) + "。");

    if (drift.cash < -threshold) {
      actions.push("先补回现金安全垫，再考虑增加风险资产。");
    }
    if (drift.equities > threshold) {
      actions.push("股票仓位高于目标，分批降低权益，优先回到债券或现金。");
    }
    if (drift.equities < -threshold && risk.financialStage === "growth_ready") {
      actions.push("权益仓位低于目标，可分批补至目标，不建议一次性加满。");
    }
    if (drift.bonds > threshold) {
      actions.push("债券比例偏高，可根据目标逐步转回现金或权益。");
    }
    if (risk.financialStage !== "growth_ready") {
      actions.push("由于当前不属于完全增长阶段，再平衡优先方向是回补现金，而不是提高股票。");
    }

    return {
      shouldRebalance: true,
      reasons: reasons,
      actions: actions,
      drift: drift
    };
  }

  function generateSummary(input, risk, buckets, allocation){
    var diagnosis = [];
    var behaviorAdvice = [];
    var headline =
      risk.financialStage === "cash_repair" ? "当前重点：先修复现金安全垫" :
      risk.financialStage === "steady_accumulation" ? "当前重点：稳健积累，不急着把风险开大" :
      "当前重点：可以进入增长配置，但仍要守住边界";

    if (risk.emergencyFundMonths < 3) {
      diagnosis.push("你的应急金约覆盖 " + risk.emergencyFundMonths + " 个月，低于更稳妥的 3 个月线。");
    } else {
      diagnosis.push("你的应急金约覆盖 " + risk.emergencyFundMonths + " 个月，已经有一定缓冲。");
    }

    if (buckets.growthEligibleAmount <= 0) {
      diagnosis.push("当前没有足够安全的增长桶资金，所以投资建议会非常保守。");
    } else {
      diagnosis.push("当前可进入增长配置的安全资金约为 " + round2(buckets.growthEligibleAmount) + "。");
    }

    diagnosis.push(
      "最终大类资产建议为：现金 " + pct(allocation.target.cash) +
      " / 债券 " + pct(allocation.target.bonds) +
      " / 股票 " + pct(allocation.target.equities) + "。"
    );

    if (input.investmentExperience === "none" || input.investmentExperience === "beginner") {
      behaviorAdvice.push("先把分散和纪律做好，比追热点更重要。");
      behaviorAdvice.push("股票部分默认先用宽基和规则型分散，不建议从重仓个股开始。");
    }

    if (risk.financialStage !== "growth_ready") {
      behaviorAdvice.push("近期新增资金优先补生活桶和稳定桶。");
    } else {
      behaviorAdvice.push("新增资金可优先按目标比例定投，而不是一次性押注。");
    }

    behaviorAdvice.push("只有超过再平衡阈值时才调整，避免频繁操作。");

    return {
      headline: headline,
      diagnosis: diagnosis,
      behaviorAdvice: behaviorAdvice
    };
  }

  function runStudentWealthPlanner(input, mptConfig){
    var riskProfile = buildRiskProfile(input);
    var cashBuckets = buildCashBuckets(input, riskProfile);
    var assetAllocation = buildAssetAllocation(input, riskProfile, cashBuckets, mptConfig);
    var equityAllocation = buildEquityAllocation(input, riskProfile, assetAllocation.target);
    var bondAllocation = buildBondAllocation(input, riskProfile, assetAllocation.target);
    var rebalance = buildRebalanceSuggestion(input, riskProfile, assetAllocation.target);
    var summary = generateSummary(input, riskProfile, cashBuckets, assetAllocation);

    return {
      riskProfile: riskProfile,
      cashBuckets: cashBuckets,
      assetAllocation: assetAllocation,
      equityAllocation: equityAllocation,
      bondAllocation: bondAllocation,
      rebalance: rebalance,
      summary: summary
    };
  }

  global.StudentWealthPlanner = {
    runStudentWealthPlanner: runStudentWealthPlanner,
    buildRiskProfile: buildRiskProfile,
    buildCashBuckets: buildCashBuckets,
    buildAssetAllocation: buildAssetAllocation,
    buildEquityAllocation: buildEquityAllocation,
    buildBondAllocation: buildBondAllocation,
    buildRebalanceSuggestion: buildRebalanceSuggestion,
    demoMPTConfig: {
      enabled: true,
      expectedReturns: {
        cash: 0.02,
        bonds: 0.035,
        equities: 0.075
      },
      covariance: [
        [0.0001, 0.00005, 0.0001],
        [0.00005, 0.0025, 0.0015],
        [0.0001, 0.0015, 0.0225]
      ]
    }
  };
})(window);
