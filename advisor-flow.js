(function(){
  if(!window.GuguSite || !window.StudentWealthPlanner){return;}

  var readJSON = GuguSite.readJSON;
  var writeJSON = GuguSite.writeJSON;
  var formatCurrency = GuguSite.formatCurrency;
  var clamp = GuguSite.clamp;
  var escapeHtml = GuguSite.escapeHtml;
  var STORAGE_KEY = GuguSite.STORAGE_KEYS.risk;
  var runStudentWealthPlanner = StudentWealthPlanner.runStudentWealthPlanner;
  var defaultMPTConfig = StudentWealthPlanner.demoMPTConfig;

  var riskAnswers = readJSON(STORAGE_KEY, {});
  var advisorState = { generated: false, step: "risk", plan: null, input: null };

  var RISK_LEVEL_META = {
    R1: { tag: "R1 · 现金防守", bars: 1, label: "现金防守" },
    R2: { tag: "R2 · 稳健保守", bars: 2, label: "稳健保守" },
    R3: { tag: "R3 · 稳健平衡", bars: 3, label: "稳健平衡" },
    R4: { tag: "R4 · 进取增长", bars: 4, label: "进取增长" },
    R5: { tag: "R5 · 高波动增长", bars: 5, label: "高波动增长" }
  };

  var STAGE_META = {
    cash_repair: {
      label: "现金修复期",
      glyph: "cash"
    },
    steady_accumulation: {
      label: "稳健积累期",
      glyph: "steady"
    },
    growth_ready: {
      label: "增长准备期",
      glyph: "growth"
    }
  };

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

  function riskLabel(level){
    return (RISK_LEVEL_META[level] || RISK_LEVEL_META.R3).tag;
  }

  function stageLabel(stage){
    return (STAGE_META[stage] || STAGE_META.steady_accumulation).label;
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
    var order = {
      lt_3m: 0,
      "3m_1y": 1,
      "1y_3y": 2,
      "3y_5y": 3,
      gt_5y: 4
    };
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

  function buildPlannerInput(){
    var raw = readRawInputs();
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
      expensePressure: mapExpensePressure(raw)
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
  }

  function renderRiskQuiz(){
    var progress = getRiskQuizScore();
    var count = Object.keys(riskAnswers).filter(function(key){ return riskAnswers[key] != null; }).length;
    qs("riskProgressLabel").textContent = count + " / 8";
    qs("riskProgressFill").style.width = (count / 8 * 100) + "%";
    qs("riskQuizHint").textContent = progress.complete ? "测评完成，结果会按真实边界收敛。" : "题目没做完也能生成，但结果会按更保守的默认值处理。";

    qsa("[data-risk-question]").forEach(function(group){
      var question = group.getAttribute("data-risk-question");
      group.querySelectorAll("button").forEach(function(btn){
        btn.classList.toggle("active", Number(btn.getAttribute("data-risk-value")) === Number(riskAnswers[question] || 0));
      });
    });
  }

  function renderRiskBars(level){
    var wrap = qs("riskBars");
    var bars = ["R1","R2","R3","R4","R5"];
    var activeIndex = Math.max(bars.indexOf(level), 0);
    var widths = ["100%","88%","76%","64%","52%"];

    wrap.innerHTML =
      '<div class="paper-rails">' +
      bars.map(function(item, index){
        return '<div class="paper-rail" style="width:' + widths[index] + '"><strong>' + escapeHtml(RISK_LEVEL_META[item].label) + "</strong></div>";
      }).join("") +
      "</div>" +
      '<div class="paper-marker" style="left:' + (10 + activeIndex * 17) + '%">' + escapeHtml(level) + "</div>";
  }

  function updateStageGlyph(stage){
    var key = (STAGE_META[stage] || STAGE_META.steady_accumulation).glyph;
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

  function renderBuckets(plan, input){
    var totalReference = Math.max(input.currentCash, plan.cashBuckets.livingBucket + plan.cashBuckets.stabilityBucket + plan.cashBuckets.growthBucket, 1);
    var items = [
      {
        label: "生活桶",
        amount: plan.cashBuckets.livingBucket,
        percent: plan.cashBuckets.livingBucket / totalReference,
        color: "#6f8193",
        hint: "先覆盖固定生活成本和近端日常支出，这部分不拿去承担市场波动。",
        pills: [
          "目标 " + plan.cashBuckets.livingBucketTargetMonths + " 个月",
          "优先级最高"
        ]
      },
      {
        label: "稳定桶",
        amount: plan.cashBuckets.stabilityBucket,
        percent: plan.cashBuckets.stabilityBucket / totalReference,
        color: "#8d9988",
        hint: "承接 3 个月内确定支出和 12 个月内已知大额安排，避免股票被迫在低点卖出。",
        pills: [
          "缓冲 " + plan.cashBuckets.stabilityBucketTargetMonths + " 个月",
          "先照顾已知支出"
        ]
      },
      {
        label: "增长桶",
        amount: plan.cashBuckets.growthBucket,
        percent: plan.cashBuckets.growthBucket / totalReference,
        color: "#bf8e40",
        hint: plan.cashBuckets.growthEligibleAmount > 0
          ? "只有真正不用急着花的钱，才放进可以拉长周期的增长仓。"
          : "当前增长桶先收缩为 0，等安全垫补足后再讨论更激进配置。",
        pills: [
          "安全可投 " + formatCurrency(plan.cashBuckets.growthEligibleAmount),
          plan.cashBuckets.growthEligibleAmount > 0 ? "才进入配置" : "暂不进入配置"
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

  function renderAllocation(plan){
    var target = plan.assetAllocation.target;
    qs("allocationList").innerHTML = [
      { label: "现金 / 货基", value: target.cash, color: "#6f8193" },
      { label: "债券 / 短中债", value: target.bonds, color: "#8d9988" },
      { label: "股票 / 宽基ETF", value: target.equities, color: "#bf8e40" }
    ].map(function(item){
      return (
        '<div class="allocation-row">' +
          "<span>" + escapeHtml(item.label) + "</span>" +
          '<div class="track"><span class="fill" style="width:' + (item.value * 100).toFixed(1) + '%;background:' + item.color + '"></span></div>' +
          "<strong>" + escapeHtml(formatPercent(item.value, 1)) + "</strong>" +
        "</div>"
      );
    }).join("");

    var estimatedDrawdown = estimateDrawdown(target);
    qs("allocationPills").innerHTML = [
      "阶段 " + stageLabel(plan.riskProfile.financialStage),
      "回撤约 -" + formatPercent(estimatedDrawdown, 1),
      "现金底线 " + formatPercent(target.cash, 1),
      plan.assetAllocation.mptTarget ? "MPT 微调已启用" : "规则优先输出"
    ].map(function(text){
      return '<span class="pill">' + escapeHtml(text) + "</span>";
    }).join("");
  }

  function buildAggressiveReasons(plan){
    var reasons = [];
    var risk = plan.riskProfile;
    var buckets = plan.cashBuckets;

    if(risk.financialStage !== "growth_ready"){
      reasons.push("你现在还处在" + stageLabel(risk.financialStage) + "，系统会先把安全垫和已知支出放在收益前面。");
    }
    if(buckets.growthEligibleAmount <= 0){
      reasons.push("当前没有真正可以拉长周期的增长资金，所以权益仓位不会被放大。");
    } else if(buckets.growthEligibleAmount < Math.max(plan.input.currentCash * 0.2, 1)){
      reasons.push("增长桶占现金比例还不高，系统只允许小比例风险资产慢慢试错。");
    }
    if(risk.maxPortfolioDrawdownCap <= 0.10){
      reasons.push("你的可接受回撤上限只有 " + formatPercent(risk.maxPortfolioDrawdownCap, 0) + "，更激进会直接越过承受边界。");
    }
    if(risk.objectiveCapacityScore + 8 < risk.subjectiveRiskScore){
      reasons.push("你主观上能接受更多波动，但客观现金和支出条件更紧，所以结果会向保守端收敛。");
    }
    if(plan.assetAllocation.constraintsApplied.length){
      reasons.push(plan.assetAllocation.constraintsApplied[0]);
    }

    return dedupe(reasons).slice(0, 3);
  }

  function renderRiskNarrative(plan){
    var risk = plan.riskProfile;
    var estimatedDrawdown = estimateDrawdown(plan.assetAllocation.target);
    var stageNote = risk.notes[risk.notes.length - 1] || plan.summary.headline;

    renderCardGrid("riskNarrative", [
      {
        title: "风险结论",
        paragraphs: [
          "当前有效风险分数是 " + Math.round(risk.effectiveRiskScore) + "，对应 " + riskLabel(risk.riskLevel) + "。",
          "主观意愿 " + Math.round(risk.subjectiveRiskScore) + " 分，但系统更看重客观承受力 " + Math.round(risk.objectiveCapacityScore) + " 分。"
        ],
        pills: [
          "流动性压力 " + Math.round(risk.liquidityStressScore) + " / 100",
          "回撤上限 " + formatPercent(risk.maxPortfolioDrawdownCap, 0)
        ]
      },
      {
        title: "当前属于什么阶段",
        paragraphs: [
          plan.summary.headline,
          stageNote
        ],
        pills: [
          stageLabel(risk.financialStage),
          "应急金 " + risk.emergencyFundMonths + " 个月"
        ]
      },
      {
        title: "为什么不能更激进",
        paragraphs: buildAggressiveReasons(plan),
        pills: [
          "目标回撤约 -" + formatPercent(estimatedDrawdown, 1),
          "不是只看主观偏好"
        ]
      },
      {
        title: "这页之后怎么读",
        paragraphs: dedupe(plan.summary.diagnosis).slice(0, 2),
        pills: [
          "先分桶再配置",
          "结果跟着约束走"
        ]
      }
    ]);
  }

  function renderBucketNarrative(plan){
    var buckets = plan.cashBuckets;
    var notes = dedupe(buckets.notes.concat([
      buckets.shortageToMinimumSafety > 0
        ? "当前至少还差 " + formatCurrency(buckets.shortageToMinimumSafety) + " 才能把生活桶和稳定桶补到最低安全线。"
        : "当前现金已经能覆盖最低安全线，可以开始考虑增长桶。"
    ]));

    renderCardGrid("bucketNarrative", [
      {
        title: "为什么这样分桶",
        paragraphs: [
          "学生阶段最怕的是还没到长期，就因为租房、学费、旅行或换设备被迫动用投资仓。",
          "所以这里先把生活桶和稳定桶单独锁出来，增长桶只吃真正不用急着花的钱。"
        ],
        pills: [
          "生活桶 " + buckets.livingBucketTargetMonths + " 个月",
          "稳定桶 " + buckets.stabilityBucketTargetMonths + " 个月"
        ]
      },
      {
        title: "当前阶段的分桶信号",
        paragraphs: notes.slice(0, 2),
        pills: [
          "增长可投 " + formatCurrency(buckets.growthEligibleAmount),
          buckets.shortageToMinimumSafety > 0 ? "先补安全垫" : "可进入增长配置"
        ]
      },
      {
        title: "为什么先留现金",
        paragraphs: [
          "不是因为现金收益高，而是因为它能防止你在时间还没到的时候被市场波动打断。",
          "只有现金边界清楚后，股票和债券的比例才有意义。"
        ],
        pills: [
          "先保留流动性",
          "避免被迫卖出"
        ]
      },
      {
        title: "新增资金优先顺序",
        paragraphs: dedupe(plan.summary.behaviorAdvice).slice(0, 2),
        pills: [
          "先生活桶",
          "再稳定桶"
        ]
      }
    ]);
  }

  function renderAllocationNarrative(plan){
    renderCardGrid("allocationNarrative", [
      {
        title: "为什么这样配",
        paragraphs: dedupe(plan.assetAllocation.rationale).slice(0, 2),
        pills: [
          "现金 " + formatPercent(plan.assetAllocation.target.cash, 1),
          "债券 " + formatPercent(plan.assetAllocation.target.bonds, 1),
          "股票 " + formatPercent(plan.assetAllocation.target.equities, 1)
        ]
      },
      {
        title: "约束怎么压住激进度",
        paragraphs: dedupe(plan.assetAllocation.constraintsApplied).slice(0, 3),
        pills: [
          "规则先于优化",
          "先守现金底线"
        ]
      },
      {
        title: "当前阶段下的解释",
        paragraphs: dedupe(plan.summary.diagnosis).slice(0, 2),
        pills: [
          stageLabel(plan.riskProfile.financialStage),
          "随阶段变化"
        ]
      },
      {
        title: "新增资金怎么落地",
        paragraphs: dedupe(plan.summary.behaviorAdvice).slice(0, 3),
        pills: [
          "按目标比例慢慢补",
          "不要一次性冲满"
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
        title: "规则起点",
        paragraphs: [
          "这页先从 " + riskLabel(plan.riskProfile.riskLevel) + " 的基础大类资产起步，不先追求漂亮的数学最优。",
          "先让阶段、现金安全垫和回撤上限把边界框出来。"
        ],
        pills: [
          "规则目标 现 " + formatPercent(simplified.cash, 0),
          "债 " + formatPercent(simplified.bonds, 0) + " / 股 " + formatPercent(simplified.equities, 0)
        ]
      },
      {
        title: "分桶约束",
        paragraphs: [
          "如果生活桶和稳定桶还没补够，优化器不会把这部分钱偷去做更高波动配置。",
          "所以这里的现金比例不是懒惰，而是被分桶和现金底线约束出来的。"
        ],
        pills: [
          "阶段 " + stageLabel(plan.riskProfile.financialStage),
          "现金底线优先"
        ]
      },
      {
        title: "MPT 轻量微调",
        paragraphs: [
          mptTarget
            ? "MPT-lite 只在规则允许的窄区间里微调，作用是细化，而不是推翻你的边界。"
            : "当前没有启用额外微调，结果完全按规则约束输出。"
        ],
        pills: mptTarget ? [
          "微调后 现 " + formatPercent(mptTarget.cash, 0),
          "债 " + formatPercent(mptTarget.bonds, 0) + " / 股 " + formatPercent(mptTarget.equities, 0)
        ] : [
          "规则优先",
          "不开极端解"
        ]
      },
      {
        title: "最终输出为什么可执行",
        paragraphs: [
          "最终配置把规则解放在前面、微调放在后面，所以不会出现看起来收益高、但学生阶段根本拿不住的极端权重。",
          "这也是为什么不同用户不会再得到几乎一样的模板结果。"
        ],
        pills: [
          "最终 现 " + formatPercent(target.cash, 0),
          "债 " + formatPercent(target.bonds, 0) + " / 股 " + formatPercent(target.equities, 0)
        ]
      }
    ]);
  }

  function renderEquityRules(plan){
    var equity = plan.equityAllocation;
    var equityShare = plan.assetAllocation.target.equities;

    renderCardGrid("stockRules", [
      {
        title: "股票部分怎么拆",
        paragraphs: [
          "整个组合里股票约占 " + formatPercent(equityShare, 1) + "，其中 " + formatPercent(equity.broadIndex, 0) + " 的股票仓先放在宽基和规则型指数。",
          "这样做的重点不是更花哨，而是先把个股和单一赛道风险压住。"
        ],
        pills: [
          "宽基底仓 " + formatPercent(equity.broadIndex, 0),
          "先分散后倾斜"
        ]
      },
      {
        title: "地域分散",
        paragraphs: [
          "股票内部建议按地域拆开，避免看起来买了很多，实际都押在同一市场周期上。"
        ],
        pills: [
          "中国 " + formatPercent(equity.china, 0),
          "美国 " + formatPercent(equity.us, 0),
          "发达市场 " + formatPercent(equity.developedExUS, 0),
          "新兴市场 " + formatPercent(equity.emergingExChina, 0)
        ]
      },
      {
        title: "风格倾向",
        paragraphs: [
          "你的偏好会影响股票仓更偏价值分红还是更偏成长，但这只是风格倾斜，不会推翻分散底层。"
        ],
        pills: [
          "价值/分红 " + formatPercent(equity.valueDividendTilt, 0),
          "成长 " + formatPercent(equity.growthTilt, 0)
        ]
      },
      {
        title: "集中度上限",
        paragraphs: dedupe(equity.rules).slice(1, 3),
        pills: [
          "单一行业上限 " + formatPercent(equity.sectorTiltMax, 0),
          "单一标的上限 " + formatPercent(equity.singleNameMax, 0)
        ]
      }
    ]);
  }

  function renderBondRules(plan){
    var bond = plan.bondAllocation;
    var bondShare = plan.assetAllocation.target.bonds;

    renderCardGrid("bondRules", [
      {
        title: "债券在组合里做什么",
        paragraphs: [
          "整个组合里债券约占 " + formatPercent(bondShare, 1) + "，它的任务不是去抢收益，而是当股票和现金之间的缓冲层。",
          "所以久期和信用等级会随着你的阶段与承受边界一起收敛。"
        ],
        pills: [
          "债券占比 " + formatPercent(bondShare, 0),
          "先缓冲后增厚"
        ]
      },
      {
        title: "久期节奏",
        paragraphs: [
          "短久期会更重，因为学生阶段要给未来支出留转身空间，中长久期只做少量补充。"
        ],
        pills: [
          "货基 " + formatPercent(bond.moneyMarket, 0),
          "短久期 " + formatPercent(bond.shortDuration, 0),
          "中久期 " + formatPercent(bond.mediumDuration, 0),
          "长久期 " + formatPercent(bond.longDuration, 0)
        ]
      },
      {
        title: "信用质量",
        paragraphs: [
          "这里默认先守高等级债，不鼓励为了多一点票息去承受你还没真正准备好的信用风险。"
        ],
        pills: [
          "高等级占比 " + formatPercent(bond.highGrade, 0),
          "低评级上限 " + formatPercent(bond.lowerGradeMax, 0)
        ]
      },
      {
        title: "为什么现在不能把债券做得更激进",
        paragraphs: dedupe(bond.rules).slice(0, 3),
        pills: [
          stageLabel(plan.riskProfile.financialStage),
          "保留流动性"
        ]
      }
    ]);
  }

  function renderConstraints(plan){
    var reasons = dedupe(plan.assetAllocation.constraintsApplied.concat(plan.riskProfile.notes)).slice(0, 4);
    var cards = reasons.map(function(text){
      return {
        title: "已触发约束",
        paragraphs: [text],
        pills: [
          "动态生成",
          "不是模板句子"
        ]
      };
    });

    while(cards.length < 4){
      cards.push({
        title: cards.length === 0 ? "当前约束" : "执行边界",
        paragraphs: [
          cards.length === 0
            ? "当前主要边界来自现金底线、可接受回撤、投资期限和增长桶占比。"
            : "这些边界会随着输入条件变化，不同用户不会再走向几乎一样的答案。"
        ],
        pills: [
          stageLabel(plan.riskProfile.financialStage),
          riskLabel(plan.riskProfile.riskLevel)
        ]
      });
    }

    renderCardGrid("constraintRules", cards.slice(0, 4));
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
    var items = [
      {
        title: "再平衡触发线",
        paragraphs: [
          "当前风险等级下，系统会以大约 " + formatPercent(threshold, 0) + " 的偏离作为再平衡参考线。",
          "不到线就不乱动，避免把长期策略做成短线操作。"
        ],
        pills: [
          "阈值 " + formatPercent(threshold, 0),
          plan.riskProfile.riskLevel
        ]
      },
      {
        title: "当前能不能直接给动作",
        paragraphs: dedupe(plan.rebalance.reasons).slice(0, 2),
        pills: [
          plan.rebalance.shouldRebalance ? "需要再平衡" : "先记录持仓",
          "先看偏离再动手"
        ]
      },
      {
        title: "执行顺序",
        paragraphs: dedupe(plan.rebalance.actions.concat([
          "如果当前页面还没录入真实持仓，就先把再平衡理解成执行原则，而不是立刻下指令。"
        ])).slice(0, 3),
        pills: [
          "先补现金",
          "再调债股"
        ]
      },
      {
        title: "为什么不建议频繁调",
        paragraphs: [
          "你现在的结果是按阶段、现金和回撤边界收敛出来的，频繁调仓容易把这些边界打乱。",
          "只有偏离足够大或阶段发生变化时，再平衡才真正有意义。"
        ],
        pills: [
          "避免过度交易",
          "按节奏检查"
        ]
      }
    ];

    renderCardGrid("rebalanceRules", items);
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
    var riskMeta = RISK_LEVEL_META[plan.riskProfile.riskLevel] || RISK_LEVEL_META.R3;
    var stageMeta = STAGE_META[plan.riskProfile.financialStage] || STAGE_META.steady_accumulation;
    var estimatedDrawdown = estimateDrawdown(plan.assetAllocation.target);

    plan.input = input;
    advisorState.generated = true;
    advisorState.plan = plan;
    advisorState.input = input;

    qs("riskTag").textContent = riskMeta.tag;
    qs("riskBarLabel").textContent = "主观 " + Math.round(plan.riskProfile.subjectiveRiskScore) + " · 客观 " + Math.round(plan.riskProfile.objectiveCapacityScore);
    renderRiskBars(plan.riskProfile.riskLevel);
    qs("riskPhase").textContent = stageMeta.label;
    qs("riskPhaseReason").textContent = plan.summary.headline;
    updateStageGlyph(plan.riskProfile.financialStage);
    qs("riskScore").textContent = String(Math.round(plan.riskProfile.effectiveRiskScore));
    qs("riskScoreHint").textContent = "题目意愿 " + Math.round(plan.riskProfile.subjectiveRiskScore) + " · 现金承受力 " + Math.round(plan.riskProfile.objectiveCapacityScore);
    qs("riskScoreGauge").querySelector(".score-ring").style.setProperty("--score", String(Math.round(plan.riskProfile.effectiveRiskScore)));
    qs("riskEmergency").textContent = "应急金 " + plan.riskProfile.emergencyFundMonths + " 个月 · 上限 " + formatPercent(plan.riskProfile.maxPortfolioDrawdownCap, 0);
    qs("riskDrawdown").textContent = "约-" + formatPercent(estimatedDrawdown, 1);
    qs("riskDrawdown").style.left = clamp(estimatedDrawdown * 400, 14, 92) + "%";

    renderRiskNarrative(plan);
    renderBuckets(plan, input);
    renderBucketNarrative(plan);
    renderAllocation(plan);
    renderAllocationNarrative(plan);
    renderMPT(plan);
    renderEquityRules(plan);
    renderBondRules(plan);
    renderConstraints(plan);
    renderRebalance(plan);
    unlockSpreads();
    GuguSite.showToast("结果已按真实字段重新生成。");
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
    bindPageTurns();
    bindStepScrollSync();
    renderRiskQuiz();
    renderRiskBars("R3");
    updateStageGlyph("steady_accumulation");
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
