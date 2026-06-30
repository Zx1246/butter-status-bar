/* ====================================================
 * 【重构核心】 butter_renderer.js
 * 状态渲染引擎
 *
 * 职责:
 * - 从 butter_state.js 获取最新的肉体档案。
 * - 将档案数据精确地渲染到 ui.html 的各个面板中。
 * - 处理所有视觉表现逻辑，如颜色变化、图片切换、文本拼接等。
 * ====================================================*/

import { getButterState } from "./butter_state.js";

// 【视觉配置】子宫与孕期图片映射表
const WOMB_IMAGES = {
  // 非孕期
  empty: new URL("./img/womb_empty.png", import.meta.url).href,
  partially: new URL("./img/womb_partially.png", import.meta.url).href,
  half: new URL("./img/womb_half.png", import.meta.url).href,
  full: new URL("./img/womb_full.png", import.meta.url).href,
  overflow: new URL("./img/womb_overflow.png", import.meta.url).href,
  // 孕期
  preg_fertilized_travel: new URL(
    "./img/preg_fertilized_travel.png",
    import.meta.url,
  ).href,
  preg_implanting: new URL("./img/preg_implanting.png", import.meta.url).href,
  preg_embryo: new URL("./img/preg_embryo.png", import.meta.url).href,
  preg_fetus: new URL("./img/preg_fetus.png", import.meta.url).href,
  preg_labor: new URL("./img/preg_labor.png", import.meta.url).href,
};

/**
 * 【核心渲染函数】更新所有状态面板的UI显示
 * 这是连接数据与视觉的唯一入口。
 */
export function updateStatusPanels() {
  const state = getButterState();
  const context = SillyTavern.getContext();

  // 如果未注册，不执行任何渲染，由 index.js 控制显示注册页
  if (!state) {
    return;
  }

  // ==== 数据渲染·华章奏响！====

  // A. 顶部状态栏
  renderTopBar(state, context);

  // B. 首页 - 子宫与情欲
  renderHomePage(state);

  // C. 概览页 - 基础信息与生理需求
  renderOverviewPage(state);

  // D. 身体开发页 - 经验与敏感度
  renderBodyDevPage(state);

  // E. 经历页 - 情史与繁衍
  renderHistoryPage(state);

  // F. 魅魔状态页 - 深渊生态
  renderSuccubusPage(state);

  // 【新增】G. 特殊技能页
  renderSkillsPage(state);

  console.log("[Butter Renderer] 所有面板数据已根据最新档案重绘。");
}

// ==========================================
// 各面板专属渲染函数
// ==========================================

/**
 * 【修正版】渲染顶栏
 * @param {object} state - The butter state object.
 * @param {object} context - The SillyTavern context.
 */
function renderTopBar(state, context) {
  // 【核心修正】每次渲染时，都从最新的 context 中获取 user 名称并更新。
  const masterName = context.name1 || "主人";
  $("#bs-user-title").text(`${masterName}@秘密花园`);

  const tracker = state.dynamic.time_tracker;

  // ... (后续时间渲染代码不变) ...
  const dateStr = tracker.date || "XXXX年XX月XX日";
  const weekdayStr = tracker.weekday || "星期X";
  const timeStr = tracker.time || "XX:XX";

  $("#bs-date-time").text(`${dateStr} ${weekdayStr} ${timeStr}`);
}

/**
 * 渲染首页 (Home) - [UI复刻+孕期图片版]
 * @param {object} state - The butter state object.
 */
function renderHomePage(state) {
  // 1. 渲染情欲条及装饰滑块 (逻辑不变)
  const lust = state.dynamic.status.lust || 0;
  const lustProgress = Math.min(100, Math.max(0, lust));
  $("#bs-lust-fill").css("width", `${lustProgress}%`);
  $("#bs-lust-value").text(`情欲值 ${lust}/100`);

  // 2. 【核心最终修正】渲染子宫/孕期图像，并根据设定动态计算阶段
  let currentImgUrl;
  const isPregnant = state.dynamic.status.is_pregnant;
  const reproductionType = state.semi_fixed.reproduction_type || "胎生";
  // ====================【手术切口】====================
  // 不再使用 context.timestampToMoment，而是直接获取 moment 库。
  // SillyTavern.libs.moment 是官方文档推荐的安全访问方式。
  const moment = SillyTavern.libs.moment;

  if (isPregnant && reproductionType === "胎生") {
    const totalGestationMonths = state.semi_fixed.gestation_duration || 10;
    const totalGestationDays = totalGestationMonths * 30;

    // moment可以直接解析'YYYY-MM-DD'格式的字符串，无需任何转换。
    const currentStoryDate = moment(state.dynamic.time_tracker.story_date);
    const pregnancyStartDate = moment(
      state.dynamic.status.pregnancy_start_date,
    );

    // 使用.diff()方法计算两个日期之间相差的天数，结果精确可靠。
    const elapsedDays = currentStoryDate.diff(pregnancyStartDate, "days");
    // ===================================================

    // 根据总孕期长度，按比例划分各个阶段
    const laborThresholdDays = totalGestationDays * 0.95;
    const embryoEndDays = 7 + (totalGestationDays - 7) * 0.25;

    if (elapsedDays >= totalGestationDays) {
      currentImgUrl = WOMB_IMAGES.preg_labor;
    } else if (elapsedDays >= laborThresholdDays) {
      currentImgUrl = WOMB_IMAGES.preg_labor;
    } else if (elapsedDays > embryoEndDays) {
      currentImgUrl = WOMB_IMAGES.preg_fetus;
    } else if (elapsedDays > 7) {
      currentImgUrl = WOMB_IMAGES.preg_embryo;
    } else if (elapsedDays > 3) {
      currentImgUrl = WOMB_IMAGES.preg_implanting;
    } else {
      currentImgUrl = WOMB_IMAGES.preg_fertilized_travel;
    }
  } else {
    // 非“胎生”怀孕，或未怀孕时，显示精液量
    let currentVolume = state.dynamic.womb.semen_volume;
    if (currentVolume <= 4) {
      currentImgUrl = WOMB_IMAGES.empty;
    } else if (currentVolume < 30) {
      currentImgUrl = WOMB_IMAGES.partially;
    } else if (currentVolume < 60) {
      currentImgUrl = WOMB_IMAGES.half;
    } else if (currentVolume < 100) {
      currentImgUrl = WOMB_IMAGES.full;
    } else {
      currentImgUrl = WOMB_IMAGES.overflow;
    }
  }
  $("#bs-womb-image").attr("src", currentImgUrl);

  // 3. 渲染子宫状态文本 (它依赖的逻辑与上方一致，也将被间接修复)
  renderWombStatusText(state);

  // 4. 渲染播种来源 (逻辑不变)
  const sourcesHtml =
    state.dynamic.womb.semen_sources &&
    state.dynamic.womb.semen_sources.length > 0
      ? `<h4>近期播种来源:</h4><ul>${state.dynamic.womb.semen_sources
          .slice(-5)
          .map(
            (s) =>
              `<li>${s.source}: <b>${s.volume.toFixed(1)}ml</b> <small>(${s.time})</small></li>`,
          )
          .join("")}</ul>`
      : "<h4>近期播种来源:</h4><span>暂为一片纯粹之净处。</span>";
  $("#bs-womb-sources").html(sourcesHtml);
}

/**
 * 渲染首页的子宫状态细节文本
 * @param {object} state - The butter state object.
 */
function renderWombStatusText(state) {
  const p = state.semi_fixed.pronoun || "她";
  // ====================【手术切口】====================
  const moment = SillyTavern.libs.moment; // 同样使用安全的 moment 访问方式
  // ===================================================

  // 1. 拼接卵子与发情状态
  let eggStatusDisplay = "未知";
  let estrusStatusDisplay = "未发情 ";
  const isOvulation = state.dynamic.status.menstrual_phase === "排卵期";

  if (state.dynamic.status.is_pregnant) {
    // 复用与主图像相同的、基于剧情时间的计算逻辑
    const currentStoryDate = moment(state.dynamic.time_tracker.story_date);
    const pregnancyStartDate = moment(
      state.dynamic.status.pregnancy_start_date,
    );
    const elapsedDays = currentStoryDate.diff(pregnancyStartDate, "days");
    const elapsedMonths = (elapsedDays / 30).toFixed(1);

    if (state.dynamic.status.ready_to_give_birth) {
      eggStatusDisplay = `<span style="color:var(--butter-danger-color); font-weight:bold;">羊水已破 / 临盆中</span>`;
    } else if (elapsedDays <= 3) {
      eggStatusDisplay = `<span style="color:pink;">受精卵: 向子宫壁游走 (${elapsedDays}天)</span>`;
    } else if (elapsedDays <= 7) {
      eggStatusDisplay = `<span style="color:hotpink;">受精卵: 正在子宫着床 (${elapsedDays}天)</span>`;
    } else {
      eggStatusDisplay = `<span style="color:purple; font-weight:bold;">胎儿: 发育中 (${elapsedMonths}个月)</span>`;
    }
  } else {
    // ... (未怀孕时的逻辑保持不变) ...
    if (!isOvulation) {
      eggStatusDisplay = `沉睡于卵巢中`;
    } else {
      const day = state.dynamic.status.cycle_day;
      const lengths = state.fixed.cycle_base.phase_lengths || {
        menstrual: 5,
        follicular: 9,
        ovulation: 4,
        luteal: 10,
      };
      const ovulationStart = lengths.menstrual + lengths.follicular + 1;
      const ovulationEnd = ovulationStart + lengths.ovulation - 1;

      if (day === ovulationStart)
        eggStatusDisplay = `<span style="color:pink;">刚排出卵巢</span>`;
      else if (day < ovulationEnd)
        eggStatusDisplay = `<span style="color:hotpink;">游走于输卵管中 (极易受孕)</span>`;
      else
        eggStatusDisplay = `<span style="color:red; font-weight:bold;">已抵达子宫 (等待受精)</span>`;
    }
  }

  // ... (后续的发情、积乳、周期文本拼接逻辑保持不变，我将它们折叠以保持清晰) ...
  if (
    state.fixed.race === "魅魔" &&
    state.dynamic.succubus_status?.is_forced_estrus
  ) {
    estrusStatusDisplay = `<span style="color:var(--butter-danger-color); font-weight:bold;">强制发情 (魔力渴求)</span>`;
  } else if (isOvulation) {
    estrusStatusDisplay = `<span style="color:hotpink; font-weight:bold;">生理性发情 (排卵驱动)</span>`;
  }

  const lacVal = state.dynamic.metabolism.lactation || 0;
  let lactationDisplay;
  if (lacVal <= 30) lactationDisplay = `无感 (${lacVal}ml)`;
  else if (lacVal < 60)
    lactationDisplay = `<span style="color:pink;">微胀 (${lacVal}ml)</span>`;
  else if (lacVal < 80)
    lactationDisplay = `<span style="color:hotpink;">胀痛 (${lacVal}ml)</span>`;
  else if (lacVal < 100)
    lactationDisplay = `<span style="color:deeppink; font-weight:bold;">濒喷 (${lacVal}ml)</span>`;
  else
    lactationDisplay = `<span style="color:red; font-weight:bold;">溢乳 (${lacVal}ml)</span>`;

  const phase = state.dynamic.status.menstrual_phase;
  const currentDayInCycle = state.dynamic.status.cycle_day;

  // 1. 直接从 state 中获取最原始、最可靠的周期基础数据
  const avgCycle = state.fixed.cycle_base.average_cycle || 28;
  const menstrualDuration = state.fixed.cycle_base.menstrual_duration || 5;

  // 2. 动态实时计算各个阶段的长度，不再依赖旧的 phase_lengths 结构
  const LUTEAL_PHASE_LENGTH = 14;
  const OVULATION_WINDOW_LENGTH = 4;
  const ovulationDay = avgCycle - LUTEAL_PHASE_LENGTH;
  const ovulationStart = ovulationDay - Math.floor(OVULATION_WINDOW_LENGTH / 2);
  const follicularEnd = ovulationStart - 1;

  let dayInPhase = 0;
  let totalInPhase = 0;

  // 3. 使用动态计算的结果来填充 switch 语句，实现自给自足
  switch (phase) {
    case "生理期":
      dayInPhase = currentDayInCycle;
      totalInPhase = menstrualDuration; // 直接使用原始数据
      break;
    case "卵泡期":
      dayInPhase = currentDayInCycle - menstrualDuration;
      totalInPhase = follicularEnd - menstrualDuration; // 动态计算卵泡期长度
      break;
    case "排卵期":
      dayInPhase = currentDayInCycle - follicularEnd;
      totalInPhase = OVULATION_WINDOW_LENGTH; // 使用常量
      break;
    case "黄体期":
      dayInPhase =
        currentDayInCycle - (follicularEnd + OVULATION_WINDOW_LENGTH);
      totalInPhase = LUTEAL_PHASE_LENGTH; // 使用常量
      break;
  }

  dayInPhase = Math.max(1, dayInPhase);
  const cycleText = `${phase} (${dayInPhase}/${totalInPhase}天)`;

  $("#bs-womb-volume").text(state.dynamic.womb.semen_volume.toFixed(1));
  $("#bs-menstrual-phase").text(cycleText);
  $("#bs-egg-status").html(eggStatusDisplay);
  $("#bs-estrus-status").html(estrusStatusDisplay);
  $("#bs-womb-plug-status").html(
    state.dynamic.womb.is_plugged
      ? `<span style='color:red;'>被堵死</span>`
      : `<span style='color:lightgreen;'>敞开</span>`,
  );
  $("#bs-lactation-status").html(lactationDisplay);
}

/**
 * 渲染概览页 (Overview)
 * @param {object} state - The butter state object.
 */
function renderOverviewPage(state) {
  $("#bs-race").text(state.fixed.race);
  $("#bs-gender").text(state.fixed.gender);
  $("#bs-birthday").text(state.fixed.birthday || "未记录");

  // 【【【新增】】】渲染底层生存特征 (Traits)
  const traitsContainer = $("#bs-traits-display"); // 对应你HTML中的ID
  traitsContainer.empty(); // 清空旧标签
  if (state.semi_fixed.traits && state.semi_fixed.traits.length > 0) {
    state.semi_fixed.traits.forEach((trait) => {
      traitsContainer.append(`<span class="butter-trait-tag">${trait}</span>`);
    });
  } else {
    traitsContainer.append(
      `<span class="butter-trait-tag-empty">无特殊特征</span>`,
    );
  }

  // 渲染生理需求方块图
  renderFillBox("hunger", state.dynamic.metabolism.hunger);
  renderFillBox("cleanliness", state.dynamic.metabolism.cleanliness);
  renderFillBox("energy", state.dynamic.metabolism.energy);
  renderFillBox("excretion", 100 - state.dynamic.metabolism.excretion, false); // 排泄度反转显示
  renderFillBox("lactation", state.dynamic.metabolism.lactation, true); // 反转逻辑
  renderFillBox("social", state.dynamic.metabolism.social);
}

/**
 * 渲染身体开发页 (Body Development)
 * @param {object} state - The butter state object.
 */
function renderBodyDevPage(state) {
  const isVirgin = state.dynamic.status.is_virgin ?? true;
  $("#bs-virgin-status")
    .text(isVirgin ? "纯洁" : "百战")
    .toggleClass("virgin", isVirgin)
    .toggleClass("not-virgin", !isVirgin);

  // 遍历经验值并填充
  for (const [key, value] of Object.entries(state.dynamic.experience)) {
    const id = mapExpToId(key);
    if (id) {
      $(`#${id}`).text(value ?? 0);
    }
  }

  // 遍历敏感度并填充
  for (const [key, value] of Object.entries(state.dynamic.sensitivity)) {
    $(`#bs-sens-${key}`).text(value ?? 0);
  }
}

/**
 * 渲染经历页 (History)
 * @param {object} state - The butter state object.
 */
function renderHistoryPage(state) {
  const rel = state.dynamic.relationships;
  $("#bs-rel-first").text(rel.first_partner || "无人采撷");
  $("#bs-rel-recent").text(rel.recent_partner || "尚无痕迹");
  $("#bs-rel-romance").text(rel.romance_partner || "[空缺]");
  $("#bs-rel-marriage").text(rel.marriage_partner || "[空缺]");

  const soulContracts = rel.soul_contract || [];
  $("#bs-rel-soul").text(
    soulContracts.length > 0 ? soulContracts.join(", ") : "无",
  );

  // 渲染繁衍记录
  const childrenContainer = $("#bs-children-container");
  childrenContainer.empty();
  let childHtml = "";

  // ====================【手术切口】====================
  const moment = SillyTavern.libs.moment;
  const currentStoryDate = moment(state.dynamic.time_tracker.story_date);
  // ===================================================

  const childrenList = rel.children_list || [];
  if (childrenList.length > 0) {
    childrenList.forEach((child) => {
      // 使用 moment 计算当前剧情日期与出生剧情日期之间的天数差
      const birthDate = moment(child.birth_date);
      const childAgeDays = currentStoryDate.diff(birthDate, "days");

      childHtml += `
                <div class="bs-child-record">
                    <div class="bs-data-pair">
                        <span>子嗣: <b>${child.name || "未命名"}</b> (${child.gender || "未知"})</span>
                        <span style="color:var(--butter-success-color);">已出生 ${childAgeDays} 天</span>
                    </div>
                </div>`;
    });
  }

  if (state.dynamic.status.is_pregnant) {
    // 此处的孕期渲染逻辑已在之前的修复中同步，无需再次修改
    const pregnancyStartDate = moment(
      state.dynamic.status.pregnancy_start_date,
    );
    const elapsedDays = currentStoryDate.diff(pregnancyStartDate, "days");
    const months = Math.floor(elapsedDays / 30);
    const days = elapsedDays % 30;
    childHtml += `
            <div class="bs-child-record pregnant">
                <div class="bs-data-pair">
                    <span>【耻辱的孕期中】</span>
                    <span>已历经 ${months}月 ${days}天</span>
                </div>
            </div>`;
  }

  if (childHtml) {
    childrenContainer.html(
      `<h4><i class="fa-solid fa-baby"></i> 繁衍记录</h4>${childHtml}`,
    );
  }
}

/**
 * 渲染魅魔状态页 (Succubus)
 * @param {object} state - The butter state object.
 */
function renderSuccubusPage(state) {
  if (state.fixed.race !== "魅魔" || !state.dynamic.succubus_status) {
    // 如果不是魅魔，或者没有魅魔数据，则不显示任何内容
    // 侧边栏的显示/隐藏已在 index.js 中处理
    return;
  }

  const suc = state.dynamic.succubus_status;

  // 1. 饥饿度
  const hunger = suc.hunger_percent ?? 100;
  $("#bs-suc-hunger-val").text(`${hunger}%`);
  let hungerDesc = "饱足";
  if (hunger < 10) hungerDesc = "魔力枯竭";
  else if (hunger < 20) hungerDesc = "极度虚弱";
  else if (hunger < 50) hungerDesc = "饥饿";
  else if (hunger < 80) hungerDesc = "正常";
  $("#bs-suc-hunger-desc").text(hungerDesc);

  // 2. 发情倒计时
  const eDays = suc.estrus_days_remaining ?? 5;
  $("#bs-suc-estrus-days").text(`${Math.max(0, eDays)}天`);
  let eStatus = "安全期";
  if (eDays <= 0) eStatus = "今夜爆发";
  else if (eDays <= 2) eStatus = "迫近";
  $("#bs-suc-estrus-status").text(eStatus);

  // 3. Buffs (包括灵魂契约)
  let buffs = suc.buffs ? [...suc.buffs] : [];
  const contracts = state.dynamic.relationships.soul_contract || [];
  contracts.forEach((c) => buffs.push(`[🔮灵魂锁链: ${c}]`));
  $("#bs-suc-buffs").text(buffs.length > 0 ? buffs.join(" / ") : "无");

  // 4. Debuffs (包括强制发情)
  let debuffs = suc.debuffs ? [...suc.debuffs] : [];
  if (suc.is_forced_estrus) debuffs.push("[🔥催淫机制启动]");
  $("#bs-suc-debuffs").text(debuffs.length > 0 ? debuffs.join(" / ") : "无");

  // 5. 魔界通讯
  if (suc.demon_msgs && suc.demon_msgs.length > 0) {
    const lastMsg = suc.demon_msgs[suc.demon_msgs.length - 1];
    $("#bs-suc-msg-src").text(lastMsg.source || "魔界通讯");
    $("#bs-suc-msg-content").text(lastMsg.content || "...");
  } else {
    $("#bs-suc-msg-src").text("魔界棱镜观测系统");
    $("#bs-suc-msg-content").text("一切平稳，暂无新消息...");
  }
}

// ==========================================
// 辅助工具函数
// ==========================================

/**
 * 渲染生理需求方块的水位和颜色
 * @param {string} id - The base ID of the fill box (e.g., 'hunger').
 * @param {number} value - The current value (0-100).
 * @param {boolean} [inverse=false] - If true, higher values are considered "danger".
 */
function renderFillBox(id, value, inverse = false) {
  let percent = Math.max(0, Math.min(100, Number(value) || 0));

  // 使用CSS变量，便于主题切换
  let colorSafe = "var(--butter-success-color)";
  let colorWarn = "var(--butter-warning-color)";
  let colorDanger = "var(--butter-danger-color)";

  // 对于积乳和排泄，使用特定的颜色方案
  if (id === "lactation" || id === "excretion") {
    colorSafe = "var(--butter-info-color)"; // 使用蓝色系
    colorWarn = "#ffcc80"; // 橙黄色
  }

  let color = colorSafe;

  if (!inverse) {
    // 常规逻辑：数值越低越危险
    if (percent < 25) color = colorDanger;
    else if (percent <= 60) color = colorWarn;
  } else {
    // 反转逻辑：数值越高越危险 (积乳、排泄)
    if (percent > 75) color = colorDanger;
    else if (percent > 40) color = colorWarn;
  }

  $(`#fill-${id}`).css({
    height: `${percent}%`,
    "background-color": color,
  });

  $(`#val-${id}`).text(Math.floor(percent));
}

/**
 * 将经验值的 key 映射到对应的 DOM ID
 * @param {string} key - The experience key from the state object.
 * @returns {string} - The corresponding DOM element ID.
 */
function mapExpToId(key) {
  const map = {
    exposure: "bs-exp-exposure",
    oral: "bs-exp-oral",
    breast: "bs-exp-breast",
    nipple: "bs-exp-nipple",
    pussy: "bs-exp-pussy",
    clitoris: "bs-exp-clitoris",
    butt: "bs-exp-butt",
    anal: "bs-exp-anal",
    partners_count: "bs-partners-count",
    masturbation_count: "bs-masturbation-count",
    creampie_count: "bs-creampie-count",
    semen_bath_count: "bs-semen-bath-count",
    pregnancy_count: "bs-pregnancy-count",
    orgasm_count: "bs-orgasm-count",
  };
  return map[key] || "";
}

/**
 * 【新增】渲染特殊技能页 (Skills)
 * @param {object} state - The butter state object.
 */
function renderSkillsPage(state) {
  const race = state.fixed.race;
  const semiFixed = state.semi_fixed;

  // 根据种族填充对应的数据
  if (race === "魅魔") {
    $("#bs-skill-race-appearance").val(semiFixed.race_appearance || "");
    $("#bs-skill-race-body-state").val(semiFixed.race_body_state || "");
    $("#bs-skill-race-core-mechanic").val(semiFixed.race_core_mechanic || "");
    $("#bs-skill-aphrodisiac-mechanic").val(
      semiFixed.aphrodisiac_mechanic || "",
    );
    $("#bs-skill-crest-system").val(semiFixed.crest_system || "");
  } else if (race === "自设") {
    $("#bs-skill-custom-race-appearance").val(semiFixed.race_appearance || "");
    $("#bs-skill-custom-race-body-state").val(semiFixed.race_body_state || "");
    $("#bs-skill-custom-race-core-mechanic").val(
      semiFixed.race_core_mechanic || "",
    );
  }
}
