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

  function readAsset(existingAssets, key){
    return Math.max(0, Number(existingAssets && existingAssets[key] || 0));
  }

  function buildCurrentHoldingsSummary(existingAssets){
    var assets = existingAssets || {};
    var cashLikeAmount =
      readAsset(assets, "bankCash") +
      readAsset(assets, "walletCash") +
      readAsset(assets, "moneyMarketFunds");
    var bondAmount =
      readAsset(assets, "bondFunds") +
      readAsset(assets, "bondsFixedIncome");
    var equityAmount =
      readAsset(assets, "individualStocks") +
      readAsset(assets, "stockFunds") +
      readAsset(assets, "etfIndexFunds");
    var otherAmount = readAsset(assets, "otherAssets");
    var totalTrackedAssets = cashLikeAmount + bondAmount + equityAmount + otherAmount;
    var divisor = totalTrackedAssets > 0 ? totalTrackedAssets : 1;

    return {
      totalTrackedAssets: round2(totalTrackedAssets),
      cashLikeAmount: round2(cashLikeAmount),
      bondAmount: round2(bondAmount),
      equityAmount: round2(equityAmount),
      otherAmount: round2(otherAmount),
      cashLikePct: round2(cashLikeAmount / divisor),
      bondPct: round2(bondAmount / divisor),
      equityPct: round2(equityAmount / divisor),
      otherPct: round2(otherAmount / divisor)
    };
  }

  function deriveCurrentAllocation(summary){
    var trackedMain = summary.cashLikeAmount + summary.bondAmount + summary.equityAmount;
    if(trackedMain <= 0){
      return null;
    }
    return normalizeAllocation({
      cash: summary.cashLikeAmount / trackedMain,
      bonds: summary.bondAmount / trackedMain,
      equities: summary.equityAmount / trackedMain
    });
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
      notes.push("你手上的安全现金不到 1 个月生活费，系统会自动把风险上限压低。");
    }
    if (input.investmentHorizon === "lt_3m") {
      objectiveCapacityScore = Math.min(objectiveCapacityScore, 15);
      notes.push("这笔钱太快会用到，不适合放进容易波动的资产。");
    }
    if (input.shortTermExpense3m > input.currentCash * 0.7) {
      objectiveCapacityScore = Math.min(objectiveCapacityScore, 25);
      notes.push("你最近 3 个月要花的钱占现在现金比例比较高，先保流动性更重要。");
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
      notes.push("你现在更像是在补安全垫，不适合把主要精力放在追收益上。");
    } else if (financialStage === "steady_accumulation") {
      notes.push("你已经可以开始做配置，但还是要先照顾接下来会用到的钱。");
    } else {
      notes.push("你已经不是完全不能投的状态，但也要先守住生活和已知支出。");
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

  function buildCashBuckets(input, risk, holdingsSummary){
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
      notes.push("最近会用到的钱不少，所以系统把要先留住的部分又抬高了一些。");
    }

    var requiredMinimumSafety = livingBucket + stabilityBucket;
    var shortageToMinimumSafety = Math.max(0, requiredMinimumSafety - input.currentCash);
    var growthBucket = Math.max(0, input.currentCash - requiredMinimumSafety);

    if (shortageToMinimumSafety > 0) {
      notes.push("你现在的现金还不够同时覆盖生活和近阶段要用的钱，能长期拿去波动的部分先收紧。");
    }

    var growthEligibleAmount = Math.min(growthBucket, input.investableAssets);
    if (holdingsSummary && holdingsSummary.cashLikeAmount < livingBucket) {
      notes.push("结合你现在已经持有的资产来看，真正稳的部分还不算厚，后面的建议会更偏稳。");
    }

    if (growthEligibleAmount <= 0) {
      notes.push("当前真正适合进入长期配置的钱还不多。");
    } else if (growthEligibleAmount < input.currentCash * 0.2) {
      notes.push("能拿去长期配置的钱占比还不高，所以增长部分会先放小一点。");
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
      constraintsApplied.push("你现在还在先补稳的阶段，所以增长类资产的比例被强制压到很低。");
      return { result: result, constraintsApplied: constraintsApplied };
    }

    var growthShare = input.currentCash > 0 ? buckets.growthEligibleAmount / input.currentCash : 0;

    if (growthShare < 0.10) {
      result.equities = Math.min(result.equities, 0.10);
      result.cash = Math.max(result.cash, 0.55);
      constraintsApplied.push("真正可以长期放着的钱占比很低，所以系统不让股票类资产超过 10%。");
    } else if (growthShare < 0.20) {
      result.equities = Math.min(result.equities, 0.20);
      result.cash = Math.max(result.cash, 0.40);
      constraintsApplied.push("可以长期放着的钱还不多，所以增长类资产比例被限制在更小的范围里。");
    }

    if (input.investmentHorizon === "3m_1y") {
      result.equities = Math.min(result.equities, 0.15);
      result.cash = Math.max(result.cash, 0.45);
      constraintsApplied.push("这笔钱 1 年内就可能要用，所以更容易波动的部分被明显下调。");
    } else if (input.investmentHorizon === "1y_3y") {
      result.equities = Math.min(result.equities, 0.35);
      constraintsApplied.push("这笔钱不是特别长的钱，增长类资产上限先压在 35%。");
    }

    if (risk.maxPortfolioDrawdownCap <= 0.05) {
      result.equities = Math.min(result.equities, 0.08);
      result.cash = Math.max(result.cash, 0.55);
      constraintsApplied.push("你能接受的下跌范围比较小，所以系统会把高波动资产压得更低。");
    } else if (risk.maxPortfolioDrawdownCap <= 0.10) {
      result.equities = Math.min(result.equities, 0.20);
      constraintsApplied.push("你可接受的下跌大概在 10% 以内，所以系统不会给太高的股票比例。");
    } else if (risk.maxPortfolioDrawdownCap <= 0.15) {
      result.equities = Math.min(result.equities, 0.35);
      constraintsApplied.push("你愿意接受一定波动，但系统还是会把增长类资产控制在更稳的区间里。");
    }

    if (input.investmentExperience === "none") {
      result.equities = Math.min(result.equities, 0.30);
      constraintsApplied.push("如果你还没真正做过投资，系统会避免一上来给太高的股票比例。");
    }

    var safetyCashFloor = input.currentCash > 0
      ? clamp((buckets.livingBucket + Math.min(buckets.stabilityBucket, input.currentCash)) / input.currentCash, 0, 1)
      : 1;

    result.cash = Math.max(result.cash, Math.min(safetyCashFloor, 0.85));
    constraintsApplied.push("生活和近阶段要用的钱会先被留出来，这部分钱最好先别动。");

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

  function buildAssetAllocation(input, risk, buckets, holdingsSummary, mptConfig){
    var rationale = [];
    var simplifiedBase = baseAllocationByRisk(risk.riskLevel);
    var constrained = applyStudentConstraints(simplifiedBase, input, risk, buckets);
    var mptTarget;

    rationale.push("系统会先看你现在适合承担多大波动，再决定现金、稳一点的资产和增长类资产分别放多少。");
    rationale.push("不是所有钱都一起上场，先照顾生活和已知支出，再安排真正能长期放着的钱。");

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

      rationale.push("系统会在安全边界里做一点点顺手的微调，但不会为了好看把比例算得太激进。");
    }

    var finalTarget = mptTarget ? normalizeAllocation({
      cash: constrained.result.cash * 0.7 + mptTarget.cash * 0.3,
      bonds: constrained.result.bonds * 0.7 + mptTarget.bonds * 0.3,
      equities: constrained.result.equities * 0.7 + mptTarget.equities * 0.3
    }) : constrained.result;

    if (input.currentCash < input.monthlyEssentialExpense * 2) {
      rationale.push("你手上的安全现金不算多，所以整体配置还会偏稳一些。");
    }
    if (holdingsSummary && holdingsSummary.totalTrackedAssets > 0) {
      rationale.push("这次建议不是把你当成从零开始，也会一起参考你现在已经持有的资产比例。");
    }
    if (input.investmentExperience === "none" || input.investmentExperience === "beginner") {
      rationale.push("如果你还在起步阶段，系统会更偏向分散，而不是鼓励集中押一个方向。");
    }

    return {
      target: finalTarget,
      simplifiedTarget: constrained.result,
      mptTarget: mptTarget,
      rationale: rationale,
      constraintsApplied: constrained.constraintsApplied
    };
  }

  function buildEquityAllocation(input, risk, assetAllocation, holdingsSummary){
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

    rules.push("股票部分会优先用一篮子分散开的股票来打底，而不是一开始就重压几家公司。");
    rules.push("同一个行业不建议压太多，避免看起来分散了，实际还是在押同一个方向。");
    rules.push("单一个股的比例会被压得比较小，特别是你还在起步阶段时更是这样。");
    rules.push("先把地域和风格分开，再考虑要不要做少量主题倾斜。");

    if (input.existingAssets && readAsset(input.existingAssets, "individualStocks") > 0) {
      rules.push("如果你现在已经持有较多个股，系统会更强调先把集中度降下来，而不是继续堆个股。");
    }
    if (holdingsSummary && holdingsSummary.equityPct > assetAllocation.equities + 0.08) {
      rules.push("你现在股票类占比已经偏高，后面的建议会更偏向先稳住，而不是继续往高波动资产加。");
    }

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
      rules: rules
    };
  }

  function buildBondAllocation(input, risk, assetAllocation, holdingsSummary){
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
      rules.push("这部分会优先放在更稳、对利率变化不那么敏感的债券类资产里。");
    } else if (risk.riskLevel === "R2" || risk.riskLevel === "R3") {
      moneyMarket = 0.20;
      shortDuration = 0.55;
      mediumDuration = 0.20;
      longDuration = 0.05;
      highGrade = 0.90;
      lowerGradeMax = 0.05;
      rules.push("稳一点的资产会以短久期为主，也就是价格通常没那么容易大起大落。");
    } else if (risk.riskLevel === "R4" || risk.riskLevel === "R5") {
      moneyMarket = 0.10;
      shortDuration = 0.45;
      mediumDuration = 0.30;
      longDuration = 0.15;
      highGrade = 0.85;
      lowerGradeMax = 0.10;
      rules.push("如果你的时间更长、阶段也更稳，才会少量放一些波动更大的中长久期债。");
    }

    if (input.investmentExperience === "none" || input.investmentExperience === "beginner") {
      longDuration = Math.min(longDuration, 0.05);
      lowerGradeMax = Math.min(lowerGradeMax, 0.05);
      rules.push("如果你刚开始做配置，系统会减少长久期和高风险债的比例。");
    }

    if (risk.financialStage !== "growth_ready") {
      moneyMarket = Math.max(moneyMarket, 0.25);
      longDuration = Math.min(longDuration, 0.05);
      rules.push("你现在还不是完全可以放手增长的阶段，所以稳一点的资产会保留更高流动性。");
    }

    if (holdingsSummary && holdingsSummary.bondPct < assetAllocation.bonds - 0.08) {
      rules.push("你现在稳一点的中间层偏少，所以系统会提醒你把现金和股票之间先补出一层缓冲。");
    }

    return {
      moneyMarket: round2(moneyMarket),
      shortDuration: round2(shortDuration),
      mediumDuration: round2(mediumDuration),
      longDuration: round2(longDuration),
      highGrade: round2(highGrade),
      lowerGradeMax: round2(lowerGradeMax),
      rules: rules
    };
  }

  function buildHoldingsDiagnosis(holdingsSummary, target, risk, buckets){
    if (!holdingsSummary || holdingsSummary.totalTrackedAssets <= 0) {
      return {
        status: "well_aligned",
        summary: "你还没有录入明显的已有资产，后面的建议会先按“从零开始配置”来理解。",
        details: [
          "等你把现在已经持有的钱填进去，系统才会进一步判断你现在是偏稳、偏激进，还是比例失衡。"
        ],
        actionHints: [
          "如果你已经有持仓，建议把它们录进来，后面的动作建议会更具体。"
        ]
      };
    }

    var details = [];
    var actionHints = [];
    var cashGap = round2(holdingsSummary.cashLikePct - target.cash);
    var bondGap = round2(holdingsSummary.bondPct - target.bonds);
    var equityGap = round2(holdingsSummary.equityPct - target.equities);
    var absoluteMainGap = Math.abs(equityGap) + Math.abs(bondGap) + Math.abs(cashGap);
    var status = "well_aligned";
    var summary = "你现在的持仓和当前阶段大致匹配，后面主要是微调。";

    details.push(
      "你现在现金类约 " + pct(holdingsSummary.cashLikePct) +
      "，稳一点的资产约 " + pct(holdingsSummary.bondPct) +
      "，增长类资产约 " + pct(holdingsSummary.equityPct) + "。"
    );
    details.push(
      "系统当前建议大致是：现金类 " + pct(target.cash) +
      "，稳一点的资产 " + pct(target.bonds) +
      "，增长类资产 " + pct(target.equities) + "。"
    );

    if (holdingsSummary.cashLikePct < target.cash - 0.08) {
      status = "cash_too_low";
      summary = "你现在手上真正稳的部分偏少，后面更容易被支出和波动打断。";
      actionHints.push("新增资金优先补现金和活期类，不建议继续往高波动资产加。");
      actionHints.push("如果要调，先把生活和近期会用到的钱补到更安心的位置。");
    } else if (holdingsSummary.equityPct > target.equities + 0.08) {
      status = "equity_too_high";
      summary = "你现在股票类资产偏高，和你当前阶段不太匹配。";
      actionHints.push("如果要调整，先从降低过高的股票比例开始。");
      actionHints.push("不需要一次性全卖全买，可以先停掉新增股票，把后续资金补到短板上。");
    } else if (
      holdingsSummary.bondPct < target.bonds - 0.08 &&
      holdingsSummary.equityPct > 0.10 &&
      holdingsSummary.cashLikePct > 0.10
    ) {
      status = "bond_too_low";
      summary = "你现在更像是“现金 + 股票”的结构，中间那层缓冲不太够。";
      actionHints.push("后续新增资金可以优先补稳一点的资产，让组合没那么跳。");
      actionHints.push("这样做不是为了保守，而是减少你心理上和现金流上的颠簸。");
    } else if (absoluteMainGap > 0.18) {
      summary = "你现在不是没在理财，而是比例还没有整理清楚。";
      actionHints.push("先用新增资金补短板，再决定是否需要主动调整已有持仓。");
    } else {
      actionHints.push("后续更多是看怎么微调，而不是大改。");
      actionHints.push("新增资金按目标比例慢慢补，就比频繁折腾更有效。");
    }

    if (risk.financialStage !== "growth_ready") {
      actionHints.push("你现在还不属于可以很激进的阶段，所以动作顺序仍然是先稳住，再考虑增长。");
    }
    if (buckets.growthEligibleAmount <= 0) {
      actionHints.push("结合你当前现金和持仓，真正适合进入长期配置的钱还不多，先补安全垫更重要。");
    }
    if (holdingsSummary.otherAmount > 0) {
      details.push("你还有一部分“其他资产”，它会单独显示，默认不直接并入主配置比较。");
    }

    return {
      status: status,
      summary: summary,
      details: details,
      actionHints: actionHints
    };
  }

  function buildRebalanceSuggestion(input, risk, target, holdingsSummary){
    var reasons = [];
    var actions = [];
    var current = input.currentAllocation ? normalizeAllocation({
      cash: input.currentAllocation.cash || 0,
      bonds: input.currentAllocation.bonds || 0,
      equities: input.currentAllocation.equities || 0
    }) : deriveCurrentAllocation(holdingsSummary);

    if (!current) {
      return {
        shouldRebalance: false,
        reasons: ["还没有足够的现有持仓数据，所以这一步先只给原则，不直接给调仓动作。"],
        actions: ["把你现在已有的现金类、债券类、股票类录进去后，这里就会开始比较偏差。"]
      };
    }

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
      reasons.push("你现在的比例和建议值没有偏太远，暂时不需要频繁去调。");
      actions.push("先维持现有比例，按月看一下就够了。");
      return {
        shouldRebalance: false,
        reasons: reasons,
        actions: actions,
        drift: drift
      };
    }

    reasons.push("你现在至少有一类资产和建议比例偏离超过 " + pct(threshold) + "。");

    if (drift.cash < -threshold) {
      actions.push("先把稳的部分补回来，再考虑要不要增加高波动资产。");
    }
    if (drift.equities > threshold) {
      actions.push("股票类现在偏高，如果要调，优先从这里慢慢降。");
    }
    if (drift.equities < -threshold && risk.financialStage === "growth_ready") {
      actions.push("如果你已经进入可以增长的阶段，股票类偏低时可以分批补，不需要一次性冲满。");
    }
    if (drift.bonds > threshold) {
      actions.push("稳一点的资产偏多时，可以把新增资金更多补到现金或增长类短板上。");
    }
    if (risk.financialStage !== "growth_ready") {
      actions.push("你现在还不属于可以很激进的阶段，所以调仓优先顺序仍然是先稳住，而不是先加股票。");
    }

    return {
      shouldRebalance: true,
      reasons: reasons,
      actions: actions,
      drift: drift
    };
  }

  function generateSummary(input, risk, buckets, allocation, holdingsSummary, holdingsDiagnosis){
    var diagnosis = [];
    var behaviorAdvice = [];
    var headline =
      risk.financialStage === "cash_repair" ? "当前重点：先修复生活和应急用的钱" :
      risk.financialStage === "steady_accumulation" ? "当前重点：先稳住，再慢慢往增长靠" :
      "当前重点：已经可以开始配置，但前提是先把边界守住";

    if (risk.emergencyFundMonths < 3) {
      diagnosis.push("你手上的安全现金大概只够 " + risk.emergencyFundMonths + " 个月基本生活，离更安心的线还有一点距离。");
    } else {
      diagnosis.push("你手上的安全现金大概能撑 " + risk.emergencyFundMonths + " 个月基本生活，已经有一定缓冲。");
    }

    if (buckets.growthEligibleAmount <= 0) {
      diagnosis.push("结合你现在已有的持仓和现金情况，当前真正适合进入增长配置的钱仍然不多，所以后面的建议会偏稳。");
    } else {
      diagnosis.push("当前真正能拿去做长期配置的钱大概有 " + round2(buckets.growthEligibleAmount) + "。");
    }

    if (holdingsSummary && holdingsSummary.totalTrackedAssets > 0) {
      diagnosis.push(holdingsDiagnosis.summary);
    }

    diagnosis.push(
      "这次系统最终建议大致是：现金类 " + pct(allocation.target.cash) +
      " / 稳一点的资产 " + pct(allocation.target.bonds) +
      " / 增长类资产 " + pct(allocation.target.equities) + "。"
    );

    if (input.existingAssets && readAsset(input.existingAssets, "individualStocks") > 0) {
      behaviorAdvice.push("如果你现在已经持有较多个股，后面优先做的是降低集中度，而不是再继续加同一类资产。");
    } else {
      behaviorAdvice.push("如果你还没开始配置股票，默认建议从更分散的一篮子资产开始。");
    }

    if (holdingsSummary && holdingsSummary.totalTrackedAssets > 0) {
      behaviorAdvice = behaviorAdvice.concat(holdingsDiagnosis.actionHints);
    }

    if (risk.financialStage !== "growth_ready") {
      behaviorAdvice.push("后续新增资金优先补生活和稳的部分，不用急着把增长类资产冲高。");
    } else {
      behaviorAdvice.push("如果后续要继续加，优先按建议比例慢慢补，不用一次性全上。");
    }

    behaviorAdvice.push("后面的建议不会把你当成从零开始，而是会看你现在已经有多少现金、多少稳的资产、多少高波动资产。");

    return {
      headline: headline,
      diagnosis: diagnosis,
      behaviorAdvice: behaviorAdvice
    };
  }

  function runStudentWealthPlanner(input, mptConfig){
    var holdingsSummary = buildCurrentHoldingsSummary(input.existingAssets);
    var derivedCurrentAllocation = input.currentAllocation || deriveCurrentAllocation(holdingsSummary);
    var enrichedInput = Object.assign({}, input, derivedCurrentAllocation ? { currentAllocation: derivedCurrentAllocation } : {});

    var riskProfile = buildRiskProfile(enrichedInput);
    var cashBuckets = buildCashBuckets(enrichedInput, riskProfile, holdingsSummary);
    var assetAllocation = buildAssetAllocation(enrichedInput, riskProfile, cashBuckets, holdingsSummary, mptConfig);
    var equityAllocation = buildEquityAllocation(enrichedInput, riskProfile, assetAllocation.target, holdingsSummary);
    var bondAllocation = buildBondAllocation(enrichedInput, riskProfile, assetAllocation.target, holdingsSummary);
    var holdingsDiagnosis = buildHoldingsDiagnosis(holdingsSummary, assetAllocation.target, riskProfile, cashBuckets);
    var rebalance = buildRebalanceSuggestion(enrichedInput, riskProfile, assetAllocation.target, holdingsSummary);
    var summary = generateSummary(enrichedInput, riskProfile, cashBuckets, assetAllocation, holdingsSummary, holdingsDiagnosis);

    return {
      riskProfile: riskProfile,
      cashBuckets: cashBuckets,
      assetAllocation: assetAllocation,
      equityAllocation: equityAllocation,
      bondAllocation: bondAllocation,
      currentHoldingsSummary: holdingsSummary,
      holdingsDiagnosis: holdingsDiagnosis,
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
    buildCurrentHoldingsSummary: buildCurrentHoldingsSummary,
    buildHoldingsDiagnosis: buildHoldingsDiagnosis,
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
