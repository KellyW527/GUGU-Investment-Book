(function(){
  if(!window.GuguSite || !window.StudentWealthPlanner){return;}

  var readJSON = GuguSite.readJSON;
  var writeJSON = GuguSite.writeJSON;
  var formatCurrency = GuguSite.formatCurrency;
  var clamp = GuguSite.clamp;
  var escapeHtml = GuguSite.escapeHtml;
  var STORAGE_KEY = GuguSite.STORAGE_KEYS.risk;
  var runStudentWealthPlanner = StudentWealthPlanner.runStudentWealthPlanner;
  var buildCurrentHoldingsSummary = StudentWealthPlanner.buildCurrentHoldingsSummary;
  var defaultMPTConfig = StudentWealthPlanner.demoMPTConfig;

  var riskAnswers = readJSON(STORAGE_KEY, {});
  var advisorState = { generated: false, step: "risk", plan: null, input: null };

  var RISK_LEVEL_META = {
    R1: { tag: "R1 · 非常保守", position: "更适合把稳放在第一位", bars: 1 },
    R2: { tag: "R2 · 偏稳", position: "能接受一点波动，但还是更看重安全", bars: 2 },
    R3: { tag: "R3 · 中间偏稳", position: "可以开始做配置，但不会走得太激进", bars: 3 },
    R4: { tag: "R4 · 稍偏进取", position: "可以承担更多波动，但前提还是边界清楚", bars: 4 },
    R5: { tag: "R5 · 波动更高", position: "主观上能承担较多波动，但系统仍会看现实条件", bars: 5 }
  };

  var STAGE_META = {
    cash_repair: {
      label: "先补安全垫",
      explain: "说明现在最重要的是把生活和应急的钱留够。",
      chip: "安全垫优先",
      glyph: "cash"
    },
    steady_accumulation: {
      label: "先稳住再慢慢配",
      explain: "说明已经可以开始配置，但还是要先看接下来会不会用钱。",
      chip: "先稳后进",
      glyph: "steady"
    },
    growth_ready: {
      label: "增长准备期",
      explain: "说明你已经不是完全不能投，但也还没到可以很激进的时候。",
      chip: "增长准备期",
      glyph: "growth"
    }
  };

  var ASSET_FIELD_IDS = [
    "assetBankCash",
    "assetWalletCash",
    "assetMoneyMarketFunds",
    "assetBondFunds",
    "assetBondsFixedIncome",
    "assetIndividualStocks",
    "assetStockFunds",
    "assetEtfIndexFunds",
    "assetOtherAssets"
  ];

  function qs(id){ return document.getElementById(id); }
  function qsa(selector){ return Array.prototype.slice.call(document.querySelectorAll(selector)); }

  function formatPercent(value, digits){
    return (Number(value || 0) * 100).toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits == null ? 1 : digits
    }) + "%";
  }

  function numberValue(value){
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function dedupe(items){
    return Array.from(new Set((items || []).filter(Boolean)));
  }

  function riskTag(level){
    return (RISK_LEVEL_META[level] || RISK_LEVEL_META.R3).tag;
  }

  function stageMeta(stage){
    return STAGE_META[stage] || STAGE_META.steady_accumulation;
  }

  function estimateDrawdown(target){
    return target.equities * 0.38 + target.bonds * 0.10 + target.cash * 0.01;
  }

  function getRiskQuizScore(){
    var required = ["q1","q2","q3","q4","q5","q6","q7","q8"];
    var answered = required.filter(function(key){ return riskAnswers[key] != null; });
    if(!answered.length){
      return { score: 50, complete: false };
    }
    var weights = { q1:.16, q2:.14, q3:.14, q4:.16, q5:.10, q6:.10, q7:.10, q8:.10 };
    var totalWeight = answered.reduce(function(sum, key){ return sum + weights[key]; }, 0);
    var weighted = answered.reduce(function(sum, key){ return sum + Number(riskAnswers[key]) * weights[key]; }, 0);
    var average = totalWeight > 0 ? weighted / totalWeight : 2.5;
    return {
      score: clamp((average - 1) / 3 * 100, 0, 100),
      complete: answered.length === required.length
    };
  }

  function mapLossAction(){
    switch (Number(riskAnswers.q1 || 2)) {
      case 1: return "sell_now";
      case 2: return "wait_and_see";
      case 3: return "hold";
      case 4: return "buy_more";
      default: return "wait_and_see";
    }
  }

  function horizonRank(horizon){
    var order = { lt_3m: 0, "3m_1y": 1, "1y_3y": 2, "3y_5y": 3, gt_5y: 4 };
    return order[horizon] == null ? 2 : order[horizon];
  }

  function mapSelectHorizon(){
    var years = Number(qs("advisorHorizon").value || 1);
    if(years <= 1){ return "3m_1y"; }
    if(years <= 3){ return "1y_3y"; }
    if(years <= 5){ return "3y_5y"; }
    return "gt_5y";
  }

  function mapQuizHorizon(){
    switch (Number(riskAnswers.q2 || 0)) {
      case 1: return "lt_3m";
      case 2: return "3m_1y";
      case 3: return "1y_3y";
      case 4: return "3y_5y";
      default: return null;
    }
  }

  function conservativeHorizon(){
    var fromForm = mapSelectHorizon();
    var fromQuiz = mapQuizHorizon();
    if(!fromQuiz){ return fromForm; }
    return horizonRank(fromQuiz) < horizonRank(fromForm) ? fromQuiz : fromForm;
  }

  function mapPriorityPreference(){
    switch (Number(riskAnswers.q3 || 3)) {
      case 1: return "capital_preservation";
      case 2: return "low_volatility";
      case 3: return "balanced_growth";
      case 4: return "higher_return";
      default: return "balanced_growth";
    }
  }

  function mapExperience(){
    switch (Number(qs("advisorExperience").value || 2)) {
      case 1: return "none";
      case 2: return "beginner";
      case 3: return "intermediate";
      case 4: return "advanced";
      default: return "beginner";
    }
  }

  function mapIncomeStability(){
    var selectValue = Number(qs("advisorIncomeStability").value || 2);
    var quizValue = Number(riskAnswers.q5 || selectValue);
    var effective = Math.min(selectValue, quizValue);
    switch (effective) {
      case 1: return "very_unstable";
      case 2: return "casual_only";
      case 3: return "relatively_stable";
      case 4: return "stable";
      default: return "casual_only";
    }
  }

  function mapDiversificationUnderstanding(){
    var answer = Number(riskAnswers.q8 || 0);
    if(!answer){
      return mapExperience() === "advanced" ? "good" : "basic";
    }
    switch (answer) {
      case 1: return "none";
      case 2: return "basic";
      case 3: return "good";
      case 4: return "strong";
      default: return "basic";
    }
  }

  function mapMaxDrawdownPct(){
    var fieldPct = Number(qs("advisorMaxLoss").value || 8) / 100;
    var quizMap = { 1: 0.05, 2: 0.08, 3: 0.12, 4: 0.20 };
    var quizPct = quizMap[Number(riskAnswers.q4 || 0)] || fieldPct;
    return Math.min(fieldPct, quizPct);
  }

  function mapExpensePressure(raw){
    var currentCash = Math.max(raw.currentCash, 1);
    var monthlyExpense = Math.max(raw.monthlyEssentialExpense, 1);
    var pressureRatio = (raw.shortTermExpense3m + raw.plannedLargeExpense12m * 0.7) / currentCash;
    var monthPressure = raw.shortTermExpense3m / monthlyExpense;
    var derived =
      pressureRatio > 1 || monthPressure > 3 ? "very_high" :
      pressureRatio > 0.55 || monthPressure > 1.8 ? "some" :
      pressureRatio > 0.25 ? "temporary_not_many" :
      "almost_none";

    var quizMap = { 1: "very_high", 2: "some", 3: "temporary_not_many", 4: "almost_none" };
    var quizValue = quizMap[Number(riskAnswers.q6 || 0)];
    if(!quizValue){ return derived; }

    var severity = {
      very_high: 0,
      some: 1,
      temporary_not_many: 2,
      almost_none: 3
    };
    return severity[quizValue] < severity[derived] ? quizValue : derived;
  }

  function readRawInputs(){
    return {
      monthlyEssentialExpense: numberValue(qs("advisorMonthlyExpense").value || 0),
      currentCash: numberValue(qs("advisorLiquidCash").value || 0),
      shortTermExpense3m: numberValue(qs("advisorNearExpense").value || 0),
      plannedLargeExpense12m: numberValue(qs("advisorFutureExpense").value || 0),
      investableAssets: numberValue(qs("advisorInvestableCash").value || 0)
    };
  }

  function readExistingAssets(){
    return {
      bankCash: numberValue(qs("assetBankCash").value || 0),
      walletCash: numberValue(qs("assetWalletCash").value || 0),
      moneyMarketFunds: numberValue(qs("assetMoneyMarketFunds").value || 0),
      bondFunds: numberValue(qs("assetBondFunds").value || 0),
      bondsFixedIncome: numberValue(qs("assetBondsFixedIncome").value || 0),
      individualStocks: numberValue(qs("assetIndividualStocks").value || 0),
      stockFunds: numberValue(qs("assetStockFunds").value || 0),
      etfIndexFunds: numberValue(qs("assetEtfIndexFunds").value || 0),
      otherAssets: numberValue(qs("assetOtherAssets").value || 0)
    };
  }

  function buildPlannerInput(){
    var raw = readRawInputs();
    var existingAssets = readExistingAssets();
    var holdingsSummary = buildCurrentHoldingsSummary(existingAssets);
    var trackedMain = holdingsSummary.cashLikeAmount + holdingsSummary.bondAmount + holdingsSummary.equityAmount;
    var currentAllocation = trackedMain > 0 ? {
      cash: holdingsSummary.cashLikeAmount / trackedMain,
      bonds: holdingsSummary.bondAmount / trackedMain,
      equities: holdingsSummary.equityAmount / trackedMain
    } : null;
    var cappedInvestable = Math.max(0, Math.min(raw.investableAssets, raw.currentCash));

    return {
      monthlyEssentialExpense: raw.monthlyEssentialExpense,
      currentCash: raw.currentCash,
      investableAssets: cappedInvestable,
      shortTermExpense3m: raw.shortTermExpense3m,
      plannedLargeExpense12m: raw.plannedLargeExpense12m,
      lossAction: mapLossAction(),
      investmentHorizon: conservativeHorizon(),
      priorityPreference: mapPriorityPreference(),
      maxAcceptableDrawdownPct: mapMaxDrawdownPct(),
      incomeStability: mapIncomeStability(),
      investmentExperience: mapExperience(),
      diversificationUnderstanding: mapDiversificationUnderstanding(),
      expensePressure: mapExpensePressure(raw),
      existingAssets: existingAssets,
      currentAllocation: currentAllocation
    };
  }

  function populateFields(){
    var defaults = {
      advisorMonthlyExpense: 3200,
      advisorLiquidCash: 12000,
      advisorNearExpense: 2500,
      advisorFutureExpense: 6000,
      advisorInvestableCash: 10000
    };
    Object.keys(defaults).forEach(function(id){
      if(qs(id) && !qs(id).value){
        qs(id).value = defaults[id];
      }
    });
    ASSET_FIELD_IDS.forEach(function(id){
      if(qs(id) && !qs(id).value){
        qs(id).value = 0;
      }
    });
  }

  function renderRiskQuiz(){
    var progress = getRiskQuizScore();
    var count = Object.keys(riskAnswers).filter(function(key){ return riskAnswers[key] != null; }).length;
    qs("riskProgressLabel").textContent = count + " / 8";
    qs("riskProgressFill").style.width = (count / 8 * 100) + "%";
    qs("riskQuizHint").textContent = progress.complete ? "测评完成，系统会结合你的选择、现金流和已有资产一起判断。" : "题目没做完也能生成，但系统会用更保守的默认值保护你。";

    qsa("[data-risk-question]").forEach(function(group){
      var question = group.getAttribute("data-risk-question");
      group.querySelectorAll("button").forEach(function(btn){
        btn.classList.toggle("active", Number(btn.getAttribute("data-risk-value")) === Number(riskAnswers[question] || 0));
      });
    });
  }

  function renderAssetSummary(){
    var summary = buildCurrentHoldingsSummary(readExistingAssets());
    qs("assetTotalTracked").textContent = formatCurrency(summary.totalTrackedAssets);
    qs("assetCashPct").textContent = formatPercent(summary.cashLikePct, 0);
    qs("assetBondPct").textContent = formatPercent(summary.bondPct, 0);
    qs("assetEquityPct").textContent = formatPercent(summary.equityPct, 0);
  }

  function renderRiskBars(level){
    var wrap = qs("riskBars");
    var bars = ["R1","R2","R3","R4","R5"];
    var labels = [
      "更适合把稳放在第一位",
      "能承受一点波动",
      "中间偏稳",
      "可以承担更多波动",
      "主观上更进取"
    ];
    var widths = ["100%","88%","76%","64%","52%"];
    var activeIndex = Math.max(bars.indexOf(level), 0);

    wrap.innerHTML =
      '<div class="paper-rails">' +
      bars.map(function(item, index){
        return '<div class="paper-rail" style="width:' + widths[index] + '"><strong>' + escapeHtml(labels[index]) + "</strong></div>";
      }).join("") +
      "</div>" +
      '<div class="paper-marker" style="left:' + (10 + activeIndex * 17) + '%">' + escapeHtml(level) + "</div>";
  }

  function updateStageGlyph(stage){
    var key = stageMeta(stage).glyph;
    qsa("[data-stage-dot]").forEach(function(dot){
      var dotKey = dot.getAttribute("data-stage-dot");
      var active = dotKey === key || (key === "growth" && dotKey === "extra");
      dot.classList.toggle("active", active);
    });
  }

  function makeCard(item, index){
    var paragraphs = (item.paragraphs || []).filter(Boolean).map(function(text){
      return "<p>" + escapeHtml(text) + "</p>";
    }).join("");
    var pills = (item.pills || []).filter(Boolean).map(function(text){
      return '<span class="pill">' + escapeHtml(text) + "</span>";
    }).join("");

    return (
      '<div class="rule-sheet">' +
        '<span class="index">' + String(index + 1).padStart(2, "0") + "</span>" +
        "<strong>" + escapeHtml(item.title) + "</strong>" +
        paragraphs +
        (pills ? '<div class="meta">' + pills + "</div>" : "") +
      "</div>"
    );
  }

  function renderCardGrid(containerId, items){
    var node = qs(containerId);
    if(!node){return;}
    node.innerHTML = (items || []).map(makeCard).join("");
  }

  function buildAggressiveReasons(plan){
    var reasons = [];
    if(plan.cashBuckets.growthEligibleAmount <= 0){
      reasons.push("不是你不能投资，而是你现在真正可以拿去长期波动的钱还不多。");
    } else if(plan.cashBuckets.growthEligibleAmount < Math.max(plan.input.currentCash * 0.2, 1)){
      reasons.push("现在可以长期放着的钱占比还不高，所以系统会限制高波动资产的比例。");
    }
    if(plan.currentHoldingsSummary.totalTrackedAssets > 0 && plan.holdingsDiagnosis.status === "equity_too_high"){
      reasons.push("你现在已经把比较多的钱放在高波动资产里了，后面更需要先稳住。");
    }
    if(plan.riskProfile.maxPortfolioDrawdownCap <= 0.12){
      reasons.push("你大概能接受的下跌范围本来就不算大，更激进会更容易超出承受边界。");
    }
    reasons.push("理财最怕的不是短期赚得慢，而是要用钱时刚好碰上市场下跌，只能被迫卖掉。");
    return dedupe(reasons).slice(0, 3);
  }

  function renderRiskNarrative(plan){
    var estimatedDrawdown = estimateDrawdown(plan.assetAllocation.target);
    var stage = stageMeta(plan.riskProfile.financialStage);

    renderCardGrid("riskNarrative", [
      {
        title: "风险结论",
        paragraphs: [
          "你现在的整体风险等级是 " + plan.riskProfile.riskLevel + "（" + riskTag(plan.riskProfile.riskLevel).split(" · ")[1] + "）。这不是只看你敢不敢冒险，还会看你现在有没有足够现金、未来有没有要花的钱、这笔钱多久会用到。",
          "你自己主观上愿意承担一定波动，但系统还会看你的现实情况。所以最终结果不是“你想多激进就多激进”，而是“你现在实际适合到哪一步”。",
          "流动性压力：简单说，就是你最近会不会经常要动用这笔钱。压力越大，越不适合把钱放进波动大的资产里。",
          "回撤上限：就是你看到账户下跌时，最多大概能接受到什么程度。"
        ],
        pills: [
          "流动性压力：未来要花钱的压力有多大",
          "回撤上限 " + formatPercent(plan.riskProfile.maxPortfolioDrawdownCap, 0) + "：你大概能接受的下跌范围"
        ]
      },
      {
        title: "你现在更适合哪种节奏",
        paragraphs: [
          "你现在处在 " + stage.label + "。意思不是已经可以大胆加仓，而是：你已经可以开始做一些配置，但前提是先把生活和已知支出照顾好。",
          "这个阶段最重要的，不是追收益，而是先把边界守住。有些钱可以开始为以后增长做准备，但还不是“全力往高波动资产冲”的阶段。",
          stage.chip + "：说明你已经不是“完全不能投”的状态了，但也还没到“可以很激进”的程度。",
          "应急金约 " + plan.riskProfile.emergencyFundMonths + " 个月：意思是如果暂时没有新增收入，你手上的安全现金大概够支撑这么久的基本生活。"
        ],
        pills: [
          stage.chip,
          "应急金约 " + plan.riskProfile.emergencyFundMonths + " 个月"
        ]
      },
      {
        title: "为什么现在不建议更冲",
        paragraphs: buildAggressiveReasons(plan).concat([
          "目标波动约 -" + formatPercent(estimatedDrawdown, 1) + "：可以理解成，这套配置想控制在一个相对更稳的波动区间里。",
          "不只是看主观偏好：你想冲是一回事，你现在能不能承受是另一回事，系统会更看后者。"
        ]),
        pills: [
          "目标波动约 -" + formatPercent(estimatedDrawdown, 1),
          "不只是看主观偏好"
        ]
      },
      {
        title: "接下来这些页面怎么看",
        paragraphs: [
          "后面不是在教你怎么买得更猛，而是在一步一步告诉你：哪些钱先别动、哪些钱可以留作稳一点的配置、真正适合拿去增长的钱有多少、现有持仓该不该调整。",
          "你可以把后面理解成一条顺序：先留生活钱 → 再看稳妥的钱 → 最后才看增长怎么配。",
          "分桶：就是先把钱按用途分开，而不是所有钱混在一起。",
          "安全边界：就是系统设的安全线，比如短期要用的钱不要进股票。"
        ],
        pills: [
          "先把钱按用途分开",
          "结果跟着安全边界走"
        ]
      }
    ]);
  }

  function renderHoldingsNarrative(plan){
    var summary = plan.currentHoldingsSummary;
    renderCardGrid("holdingsNarrative", [
      {
        title: "你现在的钱主要放在哪里",
        paragraphs: [
          "系统会先看你现在已经持有的资产，再决定后面是继续补安全垫，还是先调整比例。",
          "这不是说你现在的配置一定错了，而是先看它和你当前阶段是否匹配。"
        ],
        pills: [
          "当前现金类 " + formatPercent(summary.cashLikePct, 0),
          "当前债券类 " + formatPercent(summary.bondPct, 0),
          "当前股票类 " + formatPercent(summary.equityPct, 0),
          "其他资产 " + formatPercent(summary.otherPct, 0)
        ]
      },
      {
        title: "你现在的持仓更像哪种情况",
        paragraphs: [plan.holdingsDiagnosis.summary].concat(dedupe(plan.holdingsDiagnosis.details).slice(0, 2)),
        pills: [
          plan.holdingsDiagnosis.status === "cash_too_low" ? "稳的部分偏少" :
          plan.holdingsDiagnosis.status === "equity_too_high" ? "股票比例偏高" :
          plan.holdingsDiagnosis.status === "bond_too_low" ? "中间缓冲偏少" :
          "整体大致匹配",
          "会和建议比例一起比较"
        ]
      },
      {
        title: "系统会怎么用你现在的持仓继续算",
        paragraphs: [
          "后面的建议不会假设你是从零开始的，而是会一起看：你已经有多少现金、多少稳一点的资产、多少高波动资产、你离当前建议比例还差多少。",
          "所以系统给你的不是模板答案，而是更接近“下一步该怎么动”的建议。"
        ].concat(dedupe(plan.holdingsDiagnosis.actionHints).slice(0, 2)),
        pills: [
          "会比较当前比例和建议比例",
          "先看下一步该怎么动"
        ]
      }
    ]);
  }

  function renderBuckets(plan){
    var targetBase = Math.max(plan.input.currentCash, plan.cashBuckets.livingBucket + plan.cashBuckets.stabilityBucket + plan.cashBuckets.growthBucket, 1);
    var items = [
      {
        label: "最近生活要用的钱",
        amount: plan.cashBuckets.livingBucket,
        percent: plan.cashBuckets.livingBucket / targetBase,
        color: "#6f8193",
        hint: "这部分钱最好先别动，主要是给吃住交通和最近的生活安排留出来。",
        pills: [
          "大概留 " + plan.cashBuckets.livingBucketTargetMonths + " 个月",
          "先保生活"
        ]
      },
      {
        label: "这段时间内大概率会用到的钱",
        amount: plan.cashBuckets.stabilityBucket,
        percent: plan.cashBuckets.stabilityBucket / targetBase,
        color: "#8d9988",
        hint: "可以理解成给学费、房租、换设备、旅行或其他已知支出留出来的缓冲层。",
        pills: [
          "大概看 " + plan.cashBuckets.stabilityBucketTargetMonths + " 个月",
          "避免要用钱时被市场打断"
        ]
      },
      {
        label: "暂时用不上、可以拿去长期配置的钱",
        amount: plan.cashBuckets.growthBucket,
        percent: plan.cashBuckets.growthBucket / targetBase,
        color: "#bf8e40",
        hint: plan.cashBuckets.growthEligibleAmount > 0
          ? "只有真正暂时不用急着花的钱，才适合慢慢放进更长期的配置里。"
          : "结合你现在已有的持仓和现金情况，当前真正适合进入增长配置的钱仍然不多。"
        ,
        pills: [
          "当前安全可投 " + formatCurrency(plan.cashBuckets.growthEligibleAmount),
          plan.cashBuckets.growthEligibleAmount > 0 ? "可以开始慢慢配" : "先别急着加波动"
        ]
      }
    ];

    qs("bucketList").innerHTML = items.map(function(item){
      return (
        '<div class="bucket-sheet">' +
          "<strong>" + escapeHtml(item.label) + "</strong>" +
          "<p>" + escapeHtml(item.hint) + "</p>" +
          '<div class="meta">' +
            '<span class="pill">' + escapeHtml(formatCurrency(item.amount)) + "</span>" +
            item.pills.map(function(text){ return '<span class="pill">' + escapeHtml(text) + "</span>"; }).join("") +
          "</div>" +
          '<div class="track"><span class="fill" style="width:' + (item.percent * 100).toFixed(1) + '%;background:' + item.color + '"></span></div>' +
        "</div>"
      );
    }).join("");
  }

  function renderBucketNarrative(plan){
    renderCardGrid("bucketNarrative", [
      {
        title: "为什么要先把钱按用途分开",
        paragraphs: [
          "不是所有钱都该承担同样的波动。先把生活钱和近期会用到的钱分出去，后面的建议才不会把你逼到要用钱时低位卖出。",
          "你可以把这一步理解成：先把不会让你慌张的钱袋理出来，再看剩下的钱能不能走更远。"
        ],
        pills: [
          "先留生活钱",
          "再看长期钱"
        ]
      },
      {
        title: "结合你现在的持仓，这一步怎么看",
        paragraphs: dedupe(plan.cashBuckets.notes).slice(0, 3),
        pills: [
          "当前安全可投 " + formatCurrency(plan.cashBuckets.growthEligibleAmount),
          plan.holdingsDiagnosis.status === "cash_too_low" ? "现有稳的部分偏少" : "现有持仓也一起纳入"
        ]
      },
      {
        title: "为什么有些钱最好先别动",
        paragraphs: [
          "这不是说现金收益更好，而是这部分钱承担的是生活和确定支出的任务，不适合拿去冒市场波动。",
          "先把这部分留住，后面稳一点的资产和增长类资产才不会乱。"
        ],
        pills: [
          "生活和应急优先",
          "避免要用钱时被动"
        ]
      },
      {
        title: "下一步会怎么接着算",
        paragraphs: [
          "后面系统会拿这三个用途和你现在已经持有的比例一起比较，判断你是应该补稳、补中间层，还是微调增长配置。",
          "也就是说，后面看的不只是“理论上怎么配”，而是“结合你手上已经有的东西，下一步更适合怎么动”。"
        ],
        pills: [
          "现有持仓也会一起算",
          "不是从零开始"
        ]
      }
    ]);
  }

  function renderAllocation(plan){
    var target = plan.assetAllocation.target;
    qs("allocationList").innerHTML = [
      { label: "现金类", explain: "这部分钱最好先别动", value: target.cash, color: "#6f8193" },
      { label: "稳一点的资产", explain: "主要是债券类，负责当中间缓冲层", value: target.bonds, color: "#8d9988" },
      { label: "增长类资产", explain: "主要是股票类，适合更长期去看", value: target.equities, color: "#bf8e40" }
    ].map(function(item){
      return (
        '<div class="allocation-row">' +
          "<span>" + escapeHtml(item.label + " · " + item.explain) + "</span>" +
          '<div class="track"><span class="fill" style="width:' + (item.value * 100).toFixed(1) + '%;background:' + item.color + '"></span></div>' +
          "<strong>" + escapeHtml(formatPercent(item.value, 1)) + "</strong>" +
        "</div>"
      );
    }).join("");

    qs("allocationPills").innerHTML = [
      "你现在更适合 " + stageMeta(plan.riskProfile.financialStage).label,
      "大概最多可能经历的下跌约 -" + formatPercent(estimateDrawdown(target), 1),
      plan.holdingsDiagnosis.status === "well_aligned" ? "现有持仓和建议差得不算远" : "现有持仓会一起影响动作建议",
      plan.assetAllocation.mptTarget ? "系统会在安全边界里做一点小优化" : "先按规则给更稳的结果"
    ].map(function(text){
      return '<span class="pill">' + escapeHtml(text) + "</span>";
    }).join("");
  }

  function renderAllocationNarrative(plan){
    renderCardGrid("allocationNarrative", [
      {
        title: "为什么这样分",
        paragraphs: [
          "这一步先看你现在适合多大波动，再把钱拆成现金类、稳一点的资产和增长类资产。",
          "后面的比例不是为了看起来专业，而是为了让你在要用钱的时候不容易被市场打断。"
        ].concat(dedupe(plan.assetAllocation.rationale).slice(0, 2)),
        pills: [
          "现金类 " + formatPercent(plan.assetAllocation.target.cash, 0),
          "稳一点的资产 " + formatPercent(plan.assetAllocation.target.bonds, 0),
          "增长类资产 " + formatPercent(plan.assetAllocation.target.equities, 0)
        ]
      },
      {
        title: "系统给你的安全边界",
        paragraphs: [
          "如果有些钱最近就会用到，或者你当前阶段还没完全站稳，系统就不会把它们放进更高波动的部分。"
        ].concat(dedupe(plan.assetAllocation.constraintsApplied).slice(0, 3)),
        pills: [
          "不是越激进越好",
          "先守住底线"
        ]
      },
      {
        title: "现有持仓会怎么影响这里",
        paragraphs: [
          plan.holdingsDiagnosis.summary,
          "所以系统看的不是抽象比例，而是你手上已经有什么、离当前建议差多少。"
        ].concat(dedupe(plan.holdingsDiagnosis.details).slice(0, 1)),
        pills: [
          "当前持仓也一起比较",
          "不是模板答案"
        ]
      },
      {
        title: "后续动作建议",
        paragraphs: dedupe(plan.holdingsDiagnosis.actionHints.concat(plan.summary.behaviorAdvice)).slice(0, 3),
        pills: [
          "优先用新增资金补短板",
          "不用一次性全换"
        ]
      }
    ]);
  }

  function renderMPT(plan){
    var target = plan.assetAllocation.target;
    var simplified = plan.assetAllocation.simplifiedTarget;
    var mptTarget = plan.assetAllocation.mptTarget;

    renderCardGrid("mptList", [
      {
        title: "系统先怎么定大方向",
        paragraphs: [
          "系统不会一上来就算最花哨的比例，而是先看你当前阶段、现金流和已有持仓，把不能碰的边界先划出来。",
          "这也是为什么它不会只听“你想不想冲”。"
        ],
        pills: [
          "规则初稿：现金类 " + formatPercent(simplified.cash, 0),
          "稳一点的资产 " + formatPercent(simplified.bonds, 0) + " / 增长类资产 " + formatPercent(simplified.equities, 0)
        ]
      },
      {
        title: "什么叫在安全边界里做小幅优化",
        paragraphs: [
          "可以理解成：先把生活钱、短期用钱和可接受下跌范围守住，再在这个小框里微调比例，让结果更顺一点。",
          "不是为了算出最复杂的答案，而是为了避免明明条件不允许，却给你一个看起来很激进的漂亮数字。"
        ],
        pills: [
          "先守边界",
          "再做微调"
        ]
      },
      {
        title: "你现在的持仓为什么会影响这里",
        paragraphs: [
          "如果你现在已经偏稳、偏激进，或者中间缓冲层太薄，系统在微调时也会把这些现实情况一起带进去。",
          "所以它不是只看问卷，还会看你现在的钱已经放在哪里。"
        ],
        pills: [
          "当前持仓一起算",
          "不是纸面建议"
        ]
      },
      {
        title: "最后给你的结果为什么更可执行",
        paragraphs: [
          mptTarget
            ? "最后结果是在规则解的基础上再做一点小修整，所以既不会太死板，也不会冲得太过。"
            : "当前阶段更需要规则优先，所以系统直接按更稳的边界输出结果。"
          ,
          "这也是为什么不同用户不会再得到几乎一样的模板答案。"
        ],
        pills: [
          "最终：现金类 " + formatPercent(target.cash, 0),
          "稳一点的资产 " + formatPercent(target.bonds, 0) + " / 增长类资产 " + formatPercent(target.equities, 0)
        ]
      }
    ]);
  }

  function renderEquityRules(plan){
    var equity = plan.equityAllocation;
    var existing = plan.input.existingAssets || {};

    renderCardGrid("stockRules", [
      {
        title: "放在股票类资产里的比例怎么理解",
        paragraphs: [
          "股票类是增长类资产里最容易波动的一部分，所以这里不是在鼓励你去猜哪只股票涨，而是先看怎样把波动分散开。",
          "系统当前建议把整个组合里大约 " + formatPercent(plan.assetAllocation.target.equities, 1) + " 放在股票类资产里。"
        ],
        pills: [
          "增长类资产占比 " + formatPercent(plan.assetAllocation.target.equities, 0),
          "先想能不能拿得住"
        ]
      },
      {
        title: "什么叫一篮子分散开的股票",
        paragraphs: [
          "可以理解成一次买很多公司，而不是押某一家公司。这样做的重点，是让一家公司出问题时，不会把整个组合拖得太厉害。",
          "股票部分里大约 " + formatPercent(equity.broadIndex, 0) + " 会优先放在这种更分散的一篮子资产上。"
        ],
        pills: [
          "更分散的一篮子股票 " + formatPercent(equity.broadIndex, 0),
          "不是重押单一公司"
        ]
      },
      {
        title: existing.individualStocks > 0 ? "如果你现在已经有不少个股" : "如果你还没开始配股票",
        paragraphs: existing.individualStocks > 0 ? [
          "如果你现在已经持有较多个股，系统会提醒你先降低集中度，而不是继续往同一个方向加。",
          "简单说，就是不要把太多钱压在同一个地方。"
        ] : [
          "如果你还没开始配置股票，默认建议从更分散的一篮子资产开始，而不是一上来就挑个股。",
          "这样更适合刚起步、还在建立节奏的人。"
        ],
        pills: [
          "单一行业上限 " + formatPercent(equity.sectorTiltMax, 0),
          "单一个股上限 " + formatPercent(equity.singleNameMax, 0)
        ]
      },
      {
        title: "后面系统会怎么提醒你别太集中",
        paragraphs: dedupe(equity.rules).slice(0, 3),
        pills: [
          "先地域分散",
          "再风格分散"
        ]
      }
    ]);
  }

  function renderBondRules(plan){
    var bond = plan.bondAllocation;

    renderCardGrid("bondRules", [
      {
        title: "稳一点的资产在这里是做什么的",
        paragraphs: [
          "你可以把它理解成组合里的中间缓冲层。它没有现金那么稳，也没有股票那么跳，主要任务是把体验拉平一点。",
          "系统当前建议把整个组合里大约 " + formatPercent(plan.assetAllocation.target.bonds, 1) + " 放在这类资产上。"
        ],
        pills: [
          "稳一点的资产占比 " + formatPercent(plan.assetAllocation.target.bonds, 0),
          "负责中间缓冲"
        ]
      },
      {
        title: "债券对利率变化有多敏感，是什么意思",
        paragraphs: [
          "简单说，越敏感，价格波动可能越大；越不敏感，一般越稳。所以系统会优先把更多比例放在不那么敏感的短久期部分。"
        ],
        pills: [
          "货基 " + formatPercent(bond.moneyMarket, 0),
          "短久期 " + formatPercent(bond.shortDuration, 0),
          "中久期 " + formatPercent(bond.mediumDuration, 0),
          "长久期 " + formatPercent(bond.longDuration, 0)
        ]
      },
      {
        title: "信用更稳的债券，是什么意思",
        paragraphs: [
          "可以理解成违约风险更低、通常更适合做底层缓冲的债券。系统会优先给这种更稳的部分更高比例。"
        ],
        pills: [
          "信用更稳的债券 " + formatPercent(bond.highGrade, 0),
          "风险更高的债券上限 " + formatPercent(bond.lowerGradeMax, 0)
        ]
      },
      {
        title: "如果你现在稳一点的资产偏少",
        paragraphs: dedupe(bond.rules).slice(0, 3),
        pills: [
          plan.holdingsDiagnosis.status === "bond_too_low" ? "你现在中间缓冲偏少" : "会一起参考现有持仓",
          "不是只看问卷"
        ]
      }
    ]);
  }

  function renderConstraints(plan){
    var items = [
      {
        title: "这部分钱最好先别动",
        paragraphs: [
          "这是给生活、应急和已知支出留出来的钱，不建议拿去冒波动。",
          "系统会优先把这部分安全线守住，再去想增长怎么配。"
        ],
        pills: [
          "生活和应急优先",
          "短期要用的钱先不进股票"
        ]
      },
      {
        title: "你现在现实中能承受多少波动",
        paragraphs: [
          "系统最后不是只看你自己愿不愿意承担波动，还会看你的现金、支出、时间和已有资产一起判断。"
        ].concat(dedupe(plan.riskProfile.notes).slice(0, 2)),
        pills: [
          "不是只看主观选择",
          "会一起看现实条件"
        ]
      },
      {
        title: "不要把太多钱压在同一个地方",
        paragraphs: [
          "如果你现在已经有不少个股，或者股票类比例已经偏高，系统会更强调先把结构拉回到更分散的位置。",
          "这样做不是让你变保守，而是避免一个判断错了就把组合拖得太重。"
        ],
        pills: [
          "不要重压单一方向",
          "先分散后增长"
        ]
      },
      {
        title: "为什么结果会跟着安全边界走",
        paragraphs: dedupe(plan.assetAllocation.constraintsApplied).slice(0, 3),
        pills: [
          "结果先看能不能拿得住",
          "不是算得最激进"
        ]
      }
    ];
    renderCardGrid("constraintRules", items);
  }

  function rebalanceThreshold(level){
    switch (level) {
      case "R1": return 0.04;
      case "R2": return 0.05;
      case "R3": return 0.06;
      default: return 0.08;
    }
  }

  function renderRebalance(plan){
    var threshold = rebalanceThreshold(plan.riskProfile.riskLevel);
    renderCardGrid("rebalanceRules", [
      {
        title: "什么时候把比例调回去",
        paragraphs: [
          "如果股票涨太多、现金变太少，或者某一类和建议比例差太远，系统才会提醒你把比例拉回更稳的位置。",
          "不到线就不乱动，避免把长期配置做成短线操作。"
        ],
        pills: [
          "参考偏离线 " + formatPercent(threshold, 0),
          "不是天天调"
        ]
      },
      {
        title: "你现在要不要调",
        paragraphs: dedupe(plan.rebalance.reasons).slice(0, 2),
        pills: [
          plan.rebalance.shouldRebalance ? "已经偏离较多" : "暂时不用频繁调",
          "会比较当前持仓"
        ]
      },
      {
        title: "如果要动，先动哪里",
        paragraphs: dedupe(plan.rebalance.actions).slice(0, 3),
        pills: [
          "先补稳的部分",
          "再看要不要动股票"
        ]
      },
      {
        title: "为什么不建议一次性全卖全买",
        paragraphs: [
          "大多数时候，更适合的做法是用新增资金去补短板，或者分批把过高的比例慢慢降下来。",
          "这样更贴近真实生活，也更不容易做出情绪化动作。"
        ],
        pills: [
          "分批更稳",
          "新增资金也能调整结构"
        ]
      }
    ]);
  }

  function unlockSpreads(){
    qsa('[data-step-panel="bucket"], [data-step-panel="allocation"], [data-step-panel="execute"]').forEach(function(section){
      section.classList.remove("locked");
    });
    qsa("[data-step-btn]").forEach(function(btn){
      btn.classList.add("done");
    });
  }

  function renderPlan(){
    var input = buildPlannerInput();
    var mptConfig = defaultMPTConfig ? JSON.parse(JSON.stringify(defaultMPTConfig)) : { enabled: false };
    var plan = runStudentWealthPlanner(input, mptConfig);
    var stage = stageMeta(plan.riskProfile.financialStage);
    var estimatedDrawdown = estimateDrawdown(plan.assetAllocation.target);

    plan.input = input;
    advisorState.generated = true;
    advisorState.plan = plan;
    advisorState.input = input;

    qs("riskTag").textContent = riskTag(plan.riskProfile.riskLevel);
    qs("riskBarLabel").textContent = "它不是收益高低排名，而是系统综合判断你现在更适合站在哪个位置。";
    renderRiskBars(plan.riskProfile.riskLevel);
    qs("riskPhase").textContent = stage.label;
    qs("riskPhaseReason").textContent = "意思是：已经可以开始做一些配置，但前提是先把生活和已知支出照顾好。";
    updateStageGlyph(plan.riskProfile.financialStage);
    qs("riskScore").textContent = String(Math.round(plan.riskProfile.effectiveRiskScore));
    qs("riskScoreHint").textContent = "系统最后不是只听你主观选择，还会结合现金、支出、时间和已有资产一起判断。";
    qs("riskScoreGauge").querySelector(".score-ring").style.setProperty("--score", String(Math.round(plan.riskProfile.effectiveRiskScore)));
    qs("riskEmergency").textContent = "应急金约 " + plan.riskProfile.emergencyFundMonths + " 个月 · 回撤上限 " + formatPercent(plan.riskProfile.maxPortfolioDrawdownCap, 0);
    qs("riskDrawdown").textContent = "约-" + formatPercent(estimatedDrawdown, 1);
    qs("riskDrawdown").style.left = clamp(estimatedDrawdown * 400, 14, 92) + "%";

    renderRiskNarrative(plan);
    renderHoldingsNarrative(plan);
    renderBuckets(plan);
    renderBucketNarrative(plan);
    renderAllocation(plan);
    renderAllocationNarrative(plan);
    renderMPT(plan);
    renderEquityRules(plan);
    renderBondRules(plan);
    renderConstraints(plan);
    renderRebalance(plan);
    unlockSpreads();
    GuguSite.showToast("结果已按你的问卷、现金流和现有持仓一起更新。");
  }

  function scrollToSection(step){
    var targetMap = {
      risk: "#advisor-risk",
      bucket: "#advisor-bucket",
      allocation: "#advisor-allocation",
      execute: "#advisor-diversify"
    };
    var target = document.querySelector(targetMap[step]);
    if(target){
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function openStep(step){
    if(step !== "risk" && !advisorState.generated){
      GuguSite.showToast("先生成结果，再往下读。");
      return;
    }
    advisorState.step = step;
    scrollToSection(step);
  }

  function syncActiveStep(step){
    advisorState.step = step;
    qsa("[data-step-btn]").forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-step-btn") === step);
    });
  }

  function switchExecution(mode){
    qsa("[data-execution-switch]").forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-execution-switch") === mode);
    });
    qs("executionSplit").classList.toggle("hide", mode !== "split");
    qs("executionRebalance").classList.toggle("hide", mode !== "rebalance");
  }

  function switchDiversify(mode){
    qsa("[data-diversify-switch]").forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-diversify-switch") === mode);
    });
    qs("stockRulesWrap").classList.toggle("hide", mode !== "stock");
    qs("bondRulesWrap").classList.toggle("hide", mode !== "bond");
  }

  function bindRiskQuiz(){
    qsa("[data-risk-question] button").forEach(function(btn){
      btn.addEventListener("click", function(){
        var question = btn.closest("[data-risk-question]").getAttribute("data-risk-question");
        riskAnswers[question] = Number(btn.getAttribute("data-risk-value"));
        writeJSON(STORAGE_KEY, riskAnswers);
        renderRiskQuiz();
      });
    });
  }

  function bindAssetInputs(){
    ASSET_FIELD_IDS.forEach(function(id){
      var field = qs(id);
      if(!field){return;}
      field.addEventListener("input", renderAssetSummary);
    });
  }

  function bindPageTurns(){
    qsa("[data-next-step]").forEach(function(link){
      link.addEventListener("click", function(event){
        var step = link.getAttribute("data-next-step");
        if(step !== "risk" && !advisorState.generated){
          event.preventDefault();
          GuguSite.showToast("先生成结果，再往下读。");
        }
      });
    });
  }

  function bindStepScrollSync(){
    var sections = qsa("[data-step-panel]");
    if(!sections.length){return;}
    var observer = new IntersectionObserver(function(entries){
      var visible = entries.filter(function(entry){ return entry.isIntersecting; })
        .sort(function(a, b){ return b.intersectionRatio - a.intersectionRatio; });
      if(!visible.length){return;}
      syncActiveStep(visible[0].target.getAttribute("data-step-panel"));
    }, { threshold: [0.25, 0.5, 0.7] });
    sections.forEach(function(section){ observer.observe(section); });
  }

  document.addEventListener("DOMContentLoaded", function(){
    if(!qs("advisorPage")){return;}
    populateFields();
    bindRiskQuiz();
    bindAssetInputs();
    bindPageTurns();
    bindStepScrollSync();
    renderRiskQuiz();
    renderAssetSummary();
    renderRiskBars("R3");
    updateStageGlyph("growth_ready");
    switchDiversify("stock");
    switchExecution("split");

    qs("generatePlanBtn").addEventListener("click", renderPlan);
    qsa("[data-step-btn]").forEach(function(btn){
      btn.addEventListener("click", function(){
        openStep(btn.getAttribute("data-step-btn"));
      });
    });
    qsa("[data-diversify-switch]").forEach(function(btn){
      btn.addEventListener("click", function(){
        switchDiversify(btn.getAttribute("data-diversify-switch"));
      });
    });
    qsa("[data-execution-switch]").forEach(function(btn){
      btn.addEventListener("click", function(){
        switchExecution(btn.getAttribute("data-execution-switch"));
      });
    });
  });
})();
