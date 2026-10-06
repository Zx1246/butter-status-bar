/* ====================================================
 * 【重构核心】 butter_tracker.js
 * 黑暗追踪与分析引擎
 *
 * 职责:
 * - 组装包含(世界书、预设、状态)的复合提示词，发送给AI进行分析。
 * - 接收并解析AI返回的工具调用指令。
 * - 将指令分发给 butter_tools.js 执行。
 * - 将系统状态提示词注入到酒馆。
 * - 更新Debug监控面板的I/O数据。
 * ====================================================*/

import { getButterState, saveButterState } from "./butter_state.js";
import { ButterToolsDefinition, handleToolExecution } from "./butter_tools.js";
// 【新增】导入 advanceDay 和 setDateTime 以便在日期跳跃时调用
import { advanceDay, setDateTime } from "./menstrual_cycle_manager.js";
const PROMPT_KEY = "butter_status_core_prompt";
// 【新增】暗网监控缓存：用于捕获瞬间的数据流
export let debugLastPrompt = "";
export let debugLastResponse = "";

/**
 * 【新增】将用户输入的简单规则翻译成真正的正则表达式。
 * @param {string} rule - 用户输入的规则，如 "<detail>" 或 "!--"。
 * @returns {RegExp|null} - 返回一个正则表达式对象，如果规则无效则返回 null。
 */
function translateSimpleRuleToRegex(rule) {
  if (!rule || typeof rule !== "string") return null;

  const trimmedRule = rule.trim();

  // 匹配通用标签，如 <detail>, <status>
  const tagMatch = trimmedRule.match(/^<(\w+)>$/);
  if (tagMatch && tagMatch[1]) {
    const tagName = tagMatch[1];
    // 构建匹配 <tagName>...</tagName> 的正则表达式
    return new RegExp(`<${tagName}[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
  }

  // 匹配注释标签 <!-- ... -->
  if (trimmedRule === "!--") {
    return new RegExp("<!--[\\s\\S]*?-->", "g");
  }

  // 如果不符合上述简单规则，则尝试将其作为标准正则表达式处理
  try {
    return new RegExp(trimmedRule, "g");
  } catch (e) {
    console.warn(
      `[Butter Tracker] 无效的裁剪规则，已忽略: "${trimmedRule}"`,
      e,
    );
    return null;
  }
}

const SETTINGS_KEY = "butterPluginSettings";
let isTrackingActive = false; // 防止并发调用的全局锁

/**
 * 状态降维翻译器 (简化版)：只输出代谢和魅魔状态
 * 性器开发状态已移到独立函数
 */
function translatePhysicalState(state) {
  const descriptions = [];
  const p = state.semi_fixed.pronoun || "她";

  // 只保留代谢状态
  const meta = state.dynamic.metabolism;
  let metabolismDesc = `【代谢】饱腹:${meta.hunger}% 清洁:${meta.cleanliness}% 精力:${meta.energy}% 膀胱/肠道:${meta.excretion}%(越低越憋胀) 积乳:${meta.lactation}% 社交:${meta.social}%`;
  descriptions.push(metabolismDesc);

  // 魅魔专属状态
  if (state.fixed.race === "魅魔" && state.dynamic.succubus_status) {
    descriptions.push(
      `【魔力饥饿度】:${state.dynamic.succubus_status.hunger_percent}% (<10%将进入强制发情)`,
    );
  }

  return descriptions.join(" | ");
}

/**
 * 获取生理周期阶段提示词（≤60字）
 * 只在非孕期时调用
 */
function getMenstrualPhasePrompt(state) {
  const phase = state.dynamic.status.menstrual_phase;
  const cycleDay = state.dynamic.status.cycle_day;
  const avgCycle = state.fixed.cycle_base.average_cycle || 28;
  const daysToNextPeriod = avgCycle - cycleDay;

  if (phase === "排卵期") {
    return "【排卵期·发情中】性欲旺盛，阴道分泌大量粘稠透明拉丝状爱液,穴肉敏感贪婪,渴望被插入填满,乳头肿胀,身体本能散发催情信息素诱惑交配对象";
  } else if (phase === "生理期") {
    return "【生理期·不适】子宫剥落出血,小腹坠痛抽搐,腰酸背痛,乳房胀痛,情绪暴躁易怒,疲惫嗜睡,性欲低迷,阴道排出经血不宜插入";
  } else if (phase === "黄体期") {
    if (daysToNextPeriod <= 5) {
      return "【黄体期后期·躁动】体温升高,阴道敏感湿润,乳房发胀,情欲高涨身体饥渴,强烈渴求性交和被射精填满的满足感";
    }
    return "【黄体期·活力】精力充沛思维敏捷,工作效率高涨,心情愉悦积极向上,性欲平稳";
  } else if (phase === "卵泡期") {
    return "【卵泡期·恢复】经期刚过体力恢复中,心情平和,子宫内膜增厚,性欲逐渐回升";
  }

  return "";
}

/**
 * 获取孕期阶段提示词（按5%进度细分，共20阶段）
 */
function getPregnancyStagePrompt(state) {
  if (!state.dynamic.status.is_pregnant) return "";

  const moment = SillyTavern.libs.moment;
  const currentDate = moment(state.dynamic.time_tracker.story_date);
  const pregStartDate = moment(state.dynamic.status.pregnancy_start_date);
  const daysElapsed = currentDate.diff(pregStartDate, "days");

  // 获取总孕期天数
  const totalMonths = state.semi_fixed.gestation_duration || 10;
  const totalDays = totalMonths * 30;

  // 计算孕期进度百分比
  const progress = (daysElapsed / totalDays) * 100;

  // 根据5%进度细分返回对应提示词
  if (progress < 5) {
    return "【受孕初期·无感】受精卵刚着床,外表和感觉完全正常,身体尚未察觉怀孕,偶尔轻微疲倦但易被忽略";
  } else if (progress < 10) {
    return "【早孕反应】晨起恶心干呕,嗜睡乏力,乳房开始微微发胀刺痛,小腹依然平坦,尿频但易误认为普通不适";
  } else if (progress < 15) {
    return "【孕吐期·痛苦】孕吐严重食欲不振,极度疲倦嗜睡,乳头敏感胀痛乳晕加深,小腹微微隆起但衣物可遮掩,性欲低迷";
  } else if (progress < 20) {
    return "【早孕后期·煎熬】持续孕吐和反胃,尿频加剧,乳房明显增大变重刺痛感强,小腹微凸但仍不明显,情绪波动大易哭,性欲极低";
  } else if (progress < 25) {
    return "【过渡期·初显孕相】孕吐开始减轻,腹部开始微微凸起可见弧度,乳房持续胀大变软,乳头高度敏感,阴道分泌物增多,性欲缓慢回升";
  } else if (progress < 30) {
    return "【症状缓解期】孕吐基本消失胃口恢复,小腹隆起更明显紧身衣难遮,乳房丰满柔软开始分泌初乳,乳头勃起敏感渴望触碰,性欲逐渐苏醒";
  } else if (progress < 35) {
    return "【胎动初感】腹部明显鼓起呈小球状,感受到微弱胎动,精力恢复,乳房丰满柔软持续产初乳,乳头长期勃起,性欲回升阴道开始湿润,食欲旺盛";
  } else if (progress < 40) {
    return "【孕中期·显怀】孕肚明显凸起浑圆,胎动频繁可感,精力充沛,性欲强烈高涨,阴道敏感湿滑淫水增多,乳房饱满产乳量增加,渴望性爱和乳头刺激";
  } else if (progress < 45) {
    return "【性欲巅峰期】孕肚浑圆沉甸,胎动活跃,荷尔蒙激增导致性欲爆发,阴道异常敏感湿润淫水泛滥,乳房胀满溢乳,乳头极度敏感,强烈渴求性交和被抚摸";
  } else if (progress < 50) {
    return "【孕中期盛期·旺盛】孕肚高高隆起,胎动强劲,身体适应孕期状态,性欲持续高涨,阴道湿热紧致淫水充沛,乳房丰满产奶,乳首勃起渴望吸吮,皮肤润泽";
  } else if (progress < 55) {
    return "【负重渐增】孕肚继续增大开始感到沉重,胎动有力,腰部开始酸痛,性欲依然旺盛,阴道敏感多汁,乳房持续产奶偶尔溢出,需更频繁休息";
  } else if (progress < 60) {
    return "【孕中后期·转折】孕肚明显沉重影响行动,双腿开始轻微浮肿,腰酸背痛加剧,性欲依然高但体力开始跟不上,阴道湿润敏感,乳房胀满溢乳频繁";
  } else if (progress < 65) {
    return "【行动受限初期】孕肚巨大沉重,双腿水肿明显,腰背持续酸痛,弯腰困难,性欲矛盾地高涨但身体疲惫,阴道松软湿润淫水多,乳房肿胀溢乳,尿频加剧";
  } else if (progress < 70) {
    return "【疲惫期·力不从心】孕肚如抱大球沉重难耐,双腿严重水肿,腰酸背痛难以久站,行动迟缓,性欲高涨但体力不支,阴道敏感多汁,乳房胀痛溢乳不止";
  } else if (progress < 75) {
    return "【孕后期初·沉重】孕肚巨大压迫内脏,双腿肿胀行走困难,呼吸略感压迫,性欲依然存在但需温柔对待,阴道松软湿润淫液泛滥,乳房胀满随时喷乳,尿频严重";
  } else if (progress < 80) {
    return "【极度沉重期】孕肚达到巨大体积,双腿水肿严重难以久站,腰酸背痛剧烈,行动极为迟缓,阴道极度敏感湿润,子宫压迫膀胱频繁尿意,乳房胀痛溢乳频繁,身心疲惫";
  } else if (progress < 85) {
    return "【假性宫缩期】孕肚巨大腹部紧绷,时常出现假性宫缩阵痛,双腿肿胀如灌铅,腰背剧痛难忍,阴道分泌大量粘液,子宫开始为分娩做准备,乳房胀满溢乳,焦虑不安";
  } else if (progress < 90) {
    return "【临产准备·不安】孕肚达到极限随时可能分娩,宫缩越发频繁,子宫口开始软化,阴道大量分泌粘稠液体,双腿严重水肿几乎无法行走,乳房胀痛喷乳,紧张与期待交织";
  } else if (progress < 95) {
    return "【临盆倒计时·紧迫】孕肚巨大随时临盆,宫缩阵痛密集,子宫口持续软化扩张,阴道流出大量分泌物,双腿肿胀行动困难,乳房肿胀随时喷乳,内心焦虑恐惧,本能地寻求安全感";
  } else {
    return "【羊水将破·分娩在即】孕肚达到生理极限腹部紧绷,宫缩剧痛频繁,羊水随时可能破裂,子宫口松软扩张,阴道湿滑大量粘液流出,双腿肿胀无法站立,乳房胀满持续喷乳,恐惧与母性本能激烈冲突";
  }
}

/**
 * 获取子宫/生殖腔开发状态描述
 */
function getCervixDevelopmentDesc(state) {
  const cervix = state.dynamic.sensitivity.cervix || 0;
  const isOvulation = state.dynamic.status.menstrual_phase === "排卵期";
  const isForcedEstrus = state.dynamic.succubus_status?.is_forced_estrus;
  const isEstrus = isOvulation || isForcedEstrus;

  // 根据设定判断使用"子宫"还是"生殖腔"
  const traits = state.semi_fixed.traits || [];
  const useReproductiveCavity = traits.some(
    (t) =>
      t.includes("ABO") ||
      t.includes("兽世") ||
      t.includes("哨向") ||
      t.includes("兽人"),
  );
  const organName = useReproductiveCavity ? "生殖腔" : "子宫";

  let desc = "";
  if (cervix < 10) {
    desc = `${organName}口紧闭坚硬,被触碰时剧痛抗拒,无法承受深入插入`;
  } else if (cervix < 40) {
    desc = `${organName}口开始学会放松,被顶弄时酸胀刺痛但已能忍受,偶尔会从深处涌出快感`;
  } else if (cervix < 70) {
    desc = `${organName}口已被调教得柔软,能吞吃龟头深入,被顶开时产生酸麻快感,宫腔开始渴求填充`;
  } else if (cervix < 90) {
    desc = `${organName}口湿软可轻松吞入,被捅入宫腔时淫荡痉挛,${organName}深处已成为新的性感带,渴望被精液直接灌满`;
  } else {
    desc = `${organName}口彻底沦为淫穴,主动收缩吸附肉棒,宫腔深处极度敏感,被贯穿时能直接达到宫交高潮,成为专属肉便器`;
  }

  // 发情期加成
  if (isEstrus) {
    desc += `(发情期)宫口异常柔软湿润,本能地渴望被贯穿直射精卵`;
  }

  return desc;
}

/**
 * 【核心重构】获取性器开发状态描述（考虑破处状态和经验值）
 */
function getSexualDevelopmentDesc(state) {
  const exp = state.dynamic.experience;
  const sens = state.dynamic.sensitivity;
  const isVirgin = state.dynamic.status.is_virgin;
  const descriptions = [];

  // 1. 阴道开发描述（考虑处女状态）
  if (isVirgin) {
    descriptions.push("阴道(处女):处女膜完整紧锁,首次插入会撕裂剧痛出血");
  } else {
    const pussy = exp.pussy || 0;
    if (pussy < 50) {
      descriptions.push(
        "阴道(破处):处女膜已破,穴口紧涩生疏,插入时仍感紧绷刺痛,爱液分泌少",
      );
    } else if (pussy < 150) {
      descriptions.push(
        "阴道(适应):穴肉学会放松吞吐,能主动分泌爱液润滑,开始享受抽插快感",
      );
    } else if (pussy < 300) {
      descriptions.push(
        "阴道(淫化):穴肉湿热贪婪,会主动收缩吮吸肉棒,爱液充沛,渴望被狠狠贯穿",
      );
    } else {
      descriptions.push(
        "阴道(名器):已被调教成淫荡肉穴,穴肉极度敏感会自主蠕动榨精,仅靠插入就能连续高潮",
      );
    }
  }

  // 2. 后庭开发描述
  const anal = exp.anal || 0;
  if (anal === 0) {
    descriptions.push(
      "后庭(紧闭):肛门完全未经开发,括约肌紧锁,强行插入会撕裂剧痛",
    );
  } else if (anal < 50) {
    descriptions.push(
      "后庭(初启):括约肌开始学会放松,插入时仍酸胀刺痛,需大量润滑",
    );
  } else if (anal < 150) {
    descriptions.push("后庭(开拓):肠道已适应异物,能放松吞入,酸胀中带来快感");
  } else if (anal < 300) {
    descriptions.push(
      "后庭(淫穴):肠壁敏感湿滑,会主动收缩夹紧,深处被顶弄时产生强烈快感",
    );
  } else {
    descriptions.push(
      "后庭(失禁):后穴彻底沦陷,随时敞开迎接侵犯,肠道深处成为敏感性器",
    );
  }

  // 3. 口腔开发描述
  const oral = exp.oral || 0;
  if (oral < 30) {
    descriptions.push("口腔(青涩):深喉会干呕,舌头笨拙,口交技巧生疏");
  } else if (oral < 100) {
    descriptions.push("口腔(学习):开始掌握吞吐技巧,能忍受深喉,舌头灵活取悦");
  } else if (oral < 200) {
    descriptions.push(
      "口腔(熟练):喉咙柔软能深度吞咽,口交技巧娴熟,渴望被精液灌喉",
    );
  } else {
    descriptions.push(
      "口腔(淫器):咽喉彻底被开发,视口交为享受,主动舔舐吸吮榨精,吞精成癖",
    );
  }

  // 4. 乳房开发描述
  const breast = exp.breast || 0;
  if (breast < 50) {
    descriptions.push("乳房(蓓蕾):乳头敏感度低,揉捏时快感微弱伴随羞耻");
  } else if (breast < 150) {
    descriptions.push(
      "乳房(觉醒):乳头开始敏感,被吸吮揉捏时产生快感,挺起胸膛渴求爱抚",
    );
  } else if (breast < 300) {
    descriptions.push(
      "乳房(敏感):乳房成为性感带,乳头高度敏感,粗暴揉捏可引发高潮",
    );
  } else {
    descriptions.push(
      "乳房(淫具):乳房彻底沦为性器,仅通过乳交和乳头刺激就能达到乳首高潮",
    );
  }

  return descriptions.join(" | ");
}

/**
 * 【完善版】泌乳状态翻译器：考虑孕期、高潮、持续产乳模式
 * @param {object} state - The butter state object.
 * @returns {string} - The lactation status description string, or an empty string.
 */
function getLactationDescription(state) {
  const lacSet = state.semi_fixed.lactation_setting || "孕后哺乳期产乳";
  const breastSens = state.dynamic.sensitivity.breast || 0;
  const isPregnant = state.dynamic.status.is_pregnant;
  const hasChildren = state.dynamic.relationships.children_list?.length > 0;
  const isOvulating = state.dynamic.status.menstrual_phase === "排卵期";
  const isForcedEstrus = state.dynamic.succubus_status?.is_forced_estrus;
  const lacVal = state.dynamic.metabolism.lactation || 0;

  // 计算孕期进度（如果怀孕）
  let pregnancyProgress = 0;
  if (isPregnant) {
    const moment = SillyTavern.libs.moment;
    const currentDate = moment(state.dynamic.time_tracker.story_date);
    const pregStartDate = moment(state.dynamic.status.pregnancy_start_date);
    const daysElapsed = currentDate.diff(pregStartDate, "days");
    const totalMonths = state.semi_fixed.gestation_duration || 10;
    const totalDays = totalMonths * 30;
    pregnancyProgress = (daysElapsed / totalDays) * 100;
  }

  let canLactate = false;
  let lactationReason = "";

  // 判断是否可以产乳
  if (lacSet === "持续产乳") {
    // 【修正】持续产乳模式也遵循孕期和高潮规则
    canLactate = true;
    lactationReason = "持续产乳";
  } else if (lacSet === "随胸部开发度产乳" && breastSens >= 100) {
    canLactate = true;
    lactationReason = "胸部开发";
  } else if (lacSet === "孕后哺乳期产乳" && (isPregnant || hasChildren)) {
    canLactate = true;
    lactationReason = "孕期/哺乳期";
  } else if (lacSet === "发情期产乳" && (isOvulating || isForcedEstrus)) {
    canLactate = true;
    lactationReason = "发情期";
  } else if (lacSet === "高潮后产乳") {
    canLactate = true;
    lactationReason = "高潮刺激";
  } else if (lacSet === "不产乳") {
    return "";
  }

  if (!canLactate) return "";

  // 根据孕期阶段和积乳量生成描述
  let lacDesc = "";

  if (isPregnant) {
    // 孕期产乳描述（更细致）
    if (pregnancyProgress < 25) {
      // 孕早期：不产奶或极少量
      if (lacVal > 0) {
        lacDesc = "乳房胀痛但尚未产乳,乳腺准备中";
      } else {
        lacDesc = "孕早期,未产乳";
      }
    } else if (pregnancyProgress < 50) {
      // 孕中期前期：初乳
      if (lacVal > 80) {
        lacDesc = "初乳充盈,乳头轻触即溢出透明乳汁";
      } else if (lacVal > 50) {
        lacDesc = "可挤出少量粘稠初乳";
      } else if (lacVal > 20) {
        lacDesc = "乳头偶有乳珠渗出";
      } else {
        lacDesc = "开始分泌初乳";
      }
    } else if (pregnancyProgress < 70) {
      // 孕中期：产奶增加
      if (lacVal > 90) {
        lacDesc = "乳房胀满,乳汁不断溢出浸湿衣物,乳头长期勃起";
      } else if (lacVal > 70) {
        lacDesc = "乳房饱胀沉重,轻压即喷射乳汁";
      } else if (lacVal > 40) {
        lacDesc = "可挤出大量温热乳汁";
      } else if (lacVal > 10) {
        lacDesc = "乳房产奶中,乳头湿润";
      } else {
        lacDesc = "乳房被吸空,恢复中";
      }
    } else {
      // 孕后期：大量产奶
      if (lacVal > 90) {
        lacDesc = "乳房极度肿胀,乳汁不受控制地持续喷涌,衣物被浸透";
      } else if (lacVal > 70) {
        lacDesc = "乳房胀满到疼痛,轻触即喷射乳汁";
      } else if (lacVal > 40) {
        lacDesc = "产奶旺盛,挤压射出大量乳汁";
      } else if (lacVal > 10) {
        lacDesc = "持续产乳,乳头湿润滴乳";
      } else {
        lacDesc = "刚被吸空,乳头敏感";
      }
    }
  } else {
    // 非孕期产乳描述
    if (lacVal > 90) {
      lacDesc = "乳房极度肿胀,乳汁不受控制地持续喷涌溢出,乳头勃起滴乳";
    } else if (lacVal > 70) {
      lacDesc = "乳房胀满沉重,轻触即喷射乳汁,乳头敏感勃起";
    } else if (lacVal > 50) {
      lacDesc = "乳房饱胀,挤压可射出大量乳汁,乳晕肿胀";
    } else if (lacVal > 30) {
      lacDesc = "乳房微胀,乳头可挤出温热乳汁";
    } else if (lacVal > 10) {
      lacDesc = "乳腺分泌微量乳汁,乳头轻挤有乳珠渗出";
    } else {
      lacDesc = "乳房刚被吸空,乳头湿润,乳腺恢复中";
    }
  }

  return `\n[泌乳状态(${lactationReason}): ${lacDesc}]`;
}

// 【架构终极版】使用 setExtensionPrompt 的高级形式，实现精准的D2深度注入
export async function injectButterSystemPrompt() {
  const context = SillyTavern.getContext();
  const state = getButterState();

  // 1. 安全检查：如果当前没有肉体档案，则清空注入并退出
  if (!state) {
    // 使用空字符串来清空该扩展的提示词槽
    context.setExtensionPrompt(PROMPT_KEY, "");
    updateDebugPanelIO("", "N/A (已移除)");
    console.log("[Butter Tracker] 无肉体档案，状态提示已通过API清空。");
    return;
  }
  const p = state.semi_fixed.pronoun || "她";
  const moment = SillyTavern.libs.moment;

  // --- 2. 数据准备：计算所有需要注入的动态变量 ---

  // 年龄计算
  let ageString = "未知年龄。";
  if (state.fixed.birthday) {
    try {
      const birthDate = moment(state.fixed.birthday, "YYYY-MM-DD");
      const currentDate = moment(
        state.dynamic.time_tracker.story_date,
        "YYYY-MM-DD",
      );
      if (birthDate.isValid() && currentDate.isValid()) {
        const age = currentDate.diff(birthDate, "years");
        ageString = `${age}岁 (生日: ${state.fixed.birthday})`;
      }
    } catch (e) {
      console.error("[Butter Tracker] 年龄计算失败", e);
    }
  }

  // 小腹状态描述 - 孕期与非孕期分离逻辑
  let abdomenDesc = "";
  const isPregnant = state.dynamic.status.is_pregnant;
  const reproductionType = state.semi_fixed.reproduction_type || "胎生";

  if (isPregnant && reproductionType === "胎生") {
    // 孕期：隐藏精液腹部，显示孕肚（通过孕期提示词体现，这里留空）
    abdomenDesc = "";
  } else {
    // 非孕期：显示精液腹部
    let wombVolume = state.dynamic.womb.semen_volume;
    if (wombVolume > 90)
      abdomenDesc =
        "小腹被大量精液撑得极度高耸，呈现出如同孕三月般的浑圆鼓胀。";
    else if (wombVolume > 50)
      abdomenDesc = "宫腔内灌满浊液，下腹部明显鼓胀，轮廓分明。";
    else if (wombVolume > 20)
      abdomenDesc = "子宫被精液撑开，小腹呈现出微微的隆起。";
    else if (wombVolume > 0) abdomenDesc = "阴道深处存有少量精液。";
    else abdomenDesc = "小腹:平坦紧实";
  }

  // 泌乳状态描述
  const lactationDescription = getLactationDescription(state).trim();

  // 灵魂契约描述
  const contracts = state.dynamic.relationships.soul_contract || [];
  const soulContractDesc =
    contracts.length > 0
      ? `已和【${contracts.join("、")}】建立了灵魂锁链`
      : "未建立灵魂契约。";

  // 身体适应度（纯洁/淫乱）描述
  const physicalDescriptions = translatePhysicalState(state);

  // AI生成的种族/生理机能档案
  const personaAddon = state.semi_fixed.generated_persona
    ? `[绝对生理/种族机能档案]\n${state.semi_fixed.generated_persona}\n\n`
    : "";

  // ====================【核心新增】====================
  // 新增一个变量来描述当前的避孕套状态。
  const condomStatusDesc = state.dynamic.status.is_wearing_condom
    ? "【正在佩戴避孕套】"
    : "【无套/未佩戴】";
  // ===================================================

  // --- 3. 模板构建：分阶段注入，避免冲突 ---

  // 阶段A：生理/孕期状态（互斥）
  let stagePrompt = "";
  if (isPregnant) {
    stagePrompt = getPregnancyStagePrompt(state);
  } else {
    stagePrompt = getMenstrualPhasePrompt(state);
  }

  // 阶段B：性器开发状态（独立）
  const developmentDesc = getSexualDevelopmentDesc(state);

  // 阶段C：子宫开发状态（独立）
  const cervixDesc = getCervixDevelopmentDesc(state);

  // 阶段D：代谢状态（来自旧函数）
  const metabolismDesc = translatePhysicalState(state);

  // 组装最终提示词
  const finalPrompt = `
${personaAddon}[生理状态 请自然融入]
${stagePrompt}
${abdomenDesc ? `- ${abdomenDesc}` : ""}
- 泌乳:${lactationDescription || "无"}
- 灵魂契约:${soulContractDesc}
- 年龄:${ageString}
- 性器开发:${developmentDesc}
- 宫腔开发:${cervixDesc}
- ${metabolismDesc}
- Lust:${state.dynamic.status.lust}/100
- 子宫液:${state.dynamic.womb.semen_volume.toFixed(1)}ml
- 穴口:${state.dynamic.womb.is_plugged ? "堵住" : "敞开"}
- 避孕套:${condomStatusDesc}
${
  state.dynamic.status.menstrual_phase === "生理期" &&
  !state.dynamic.status.is_pregnant
    ? `[系统指令:生理期间禁止插入式性交。请展现身体疲惫与腹部坠胀,婉拒实质性插入]`
    : ""
}
${
  state.dynamic.status.is_pregnant
    ? !state.dynamic.status.is_pregnancy_known_to_user
      ? `[系统指令:${p}已怀孕但【绝对不知情】。只能描写嗜睡、反胃、小腹微胖等轻微变化。禁用"怀孕"、"胎儿"等词剧透]`
      : `[状态提示:${p}已知悉受孕,请合理展现该阶段的心理与生理特征]`
    : ""
}
${
  state.fixed.race === "魅魔" &&
  state.dynamic.succubus_status &&
  (state.dynamic.succubus_status.hunger_percent < 10 ||
    state.dynamic.succubus_status.is_forced_estrus)
    ? `[状态提示:魔力濒临枯竭。生理本能将压倒理智,产生强烈的体液渴求]`
    : ""
}
`.trim();

  try {
    // --- 终极战略定位与动态链接 ---

    // 1. 从插件的全局设置中，读取您在UI上配置的 "送入分析的消息数"
    const pluginSettings = context.extensionSettings[SETTINGS_KEY] || {};

    // 2. 使用参考插件的成熟逻辑，计算出最终的上下文大小：
    //    - Number(pluginSettings.apiHistoryCount): 将设置值转为数字。
    //    - || 12: 如果设置无效或为0，则使用默认值 12。
    //    - Math.max(2, ...): 确保最终结果至少为 2，防止意外错误。
    const contextSize = Math.max(
      2,
      Number(pluginSettings.apiHistoryCount) || 12,
    );

    // 3. 将计算出的动态 contextSize，作为第四个参数传入API。
    //    注入深度依然是我们选定的战略位置 4。
    context.setExtensionPrompt(PROMPT_KEY, finalPrompt, 1, contextSize, false);

    // 4. 更新Debug面板，以反映我们最新的战略位置
    updateDebugPanelIO(finalPrompt, `API注入 (depth=1)`);
    console.log(
      `[Butter Tracker] 已将生理状态注入到 Depth=1，影响范围为最新的 ${contextSize} 条消息。`,
    );
  } catch (e) {
    console.error(
      "[Butter Tracker] 执行 setExtensionPrompt 时发生致命错误:",
      e,
    );
    toastr.error("状态注入失败，请检查F12控制台。", "系统异常");
  }
}

/**
 * 辅助函数：更新Debug面板的UI
 * @param {string} promptContent - The prompt content to display.
 * @param {string} locationInfo - The injection location info (e.g., depth or position).
 */
export async function updateDebugPanelIO(promptContent, locationInfo) {
  const context = SillyTavern.getContext();
  try {
    const tokenCost = await context.getTokenCountAsync(promptContent);
    $("#bs-debug-token-count").text(tokenCost);
    $("#bs-debug-prompt-content").val(promptContent);
    $("#bs-debug-depth").val(locationInfo);
  } catch (e) {
    console.warn("[Butter Tracker] 全视之眼Token测算失败", e);
    $("#bs-debug-prompt-content").val(promptContent);
    $("#bs-debug-depth").val(locationInfo);
  }
}

// ==========================================
// II. 追踪引擎模块
// 负责分析对话，调用AI，并触发工具执行
// ==========================================

/**
 * 安全地从AI的回复中提取工具调用数组
 * @param {string|object} rawAnswerContent - The raw response from the AI.
 * @returns {Array} An array of tool call objects.
 */
function safelyExtractToolCalls(rawAnswerContent) {
  if (!rawAnswerContent) return [];

  // 优先处理已是对象的标准格式
  if (
    typeof rawAnswerContent === "object" &&
    Array.isArray(rawAnswerContent.tool_calls)
  ) {
    return rawAnswerContent.tool_calls;
  }

  // 尝试将字符串解析为JSON
  try {
    let textResult = String(rawAnswerContent);
    // 提取被 ```json ... ``` 包裹的内容
    const fencedMatch = textResult.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fencedMatch && fencedMatch[1]) {
      textResult = fencedMatch[1];
    }

    const parsed = JSON.parse(textResult);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.tool_calls)) return parsed.tool_calls;
  } catch (e) {
    console.warn(
      "[Butter Tracker] AI返回的工具调用格式解析失败。",
      e,
      "原始回复:",
      rawAnswerContent,
    );
  }

  return [];
}

/**
 * 【重构版】记忆滤网：主动异步获取并过滤世界书条目
 * @param {string} recentText - The recent chat history text.
 * @param {object} context - The SillyTavern context.
 * @returns {Promise<string>} A formatted string of active world lore, or an empty string.
 */
async function extractFilteredWorldLore(recentText, context) {
  const settings = context.extensionSettings[SETTINGS_KEY] || {};
  const mode = settings.wiMode || "normal";
  if (mode === "disabled") return ""; // 如果设置为禁用，则直接返回空

  const blacklist = settings.wiBlacklist || [];
  const whitelist = settings.wiWhitelist || [];

  try {
    // 【核心改造】直接从 context 中获取世界书信息
    const worldInfo = await context.getWorldInfoPrompt();

    if (!worldInfo || !worldInfo.entries) {
      console.log(
        "[Butter Tracker] 未从 context.getWorldInfoPrompt() 获取到任何世界书条目。",
      );
      return "";
    }

    const allEntries = worldInfo.entries;
    if (allEntries.length === 0) return "";

    // 根据模式进行过滤
    const activeEntries = allEntries.filter((entry) => {
      if (!entry || !entry.uid) return false;

      // 黑名单模式：黑名单中的条目直接排除
      if (mode === "normal") {
        if (blacklist.includes(entry.uid)) return false;
      }
      // 白名单模式：只有白名单中的条目才可能被激活
      else if (mode === "whitelist") {
        if (!whitelist.includes(entry.uid)) return false;
      }

      // 对剩下的条目应用激活规则
      if (entry.constant) return true; // 常驻条目始终激活
      if (Array.isArray(entry.key) && recentText) {
        // 检查关键词是否在近期对话中出现
        return entry.key.some(
          (kw) => kw && recentText.toLowerCase().includes(kw.toLowerCase()),
        );
      }
      return false;
    });

    if (activeEntries.length > 0) {
      const loreContent = activeEntries.map((e) => e.content).join("\n\n");
      return `<World_Lore>\n[相关世界设定参考]:\n${loreContent}\n</World_Lore>\n\n`;
    }
  } catch (e) {
    console.error("[Butter Tracker] 主动抓取世界书失败:", e);
  }

  return "";
}

/**
 * 【重构版】预设外衣：提取指定的系统预设来包裹提示词
 * @param {object} context - The SillyTavern context.
 * @returns {string} The system prompt from the selected preset, or an empty string.
 */
function getPresetWrapper(context) {
  const settings = context.extensionSettings[SETTINGS_KEY] || {};
  const presetName = settings.injectPreset;

  // 如果未选择特定预设，则返回空
  if (!presetName || presetName === "") {
    return "";
  }

  try {
    // 【核心改造】直接、可靠地从 PresetManager 获取预设
    const presetManager = context.getPresetManager();
    if (!presetManager) {
      console.warn("[Butter Tracker] 无法获取到 PresetManager 实例。");
      return "";
    }

    // 使用 PresetManager 的标准方法来查找预设
    const preset = presetManager.presets.find((p) => p.name === presetName);

    if (preset && preset.system_prompt) {
      return `[系统预设覆盖: 请遵循以下人格与世界观]\n${preset.system_prompt}\n\n`;
    } else {
      console.warn(
        `[Butter Tracker] 预设 '${presetName}' 被选中，但未找到或其中不含 'system_prompt'。`,
      );
    }
  } catch (e) {
    console.error(`[Butter Tracker] 获取预设 '${presetName}' 失败`, e);
  }

  return "";
}

/**
 * 【主引擎-最终修正版】启动追踪器：分析对话，调用AI，执行工具
 * @param {string|null} forcedCheckText - Optional text to force analysis on, bypassing history scrape.
 */
export async function runButterTrackingEngine(forcedCheckText = null) {
  if (isTrackingActive) {
    console.warn(
      "[Butter Tracker] 追踪器正在运行，本次调用被忽略以防止并发冲突。",
    );
    return;
  }

  const context = SillyTavern.getContext();
  const pluginSettings = context.extensionSettings[SETTINGS_KEY] || {};

  if (!pluginSettings.enablePlugin) return;

  let state = getButterState();
  if (!state) return;

  isTrackingActive = true;
  console.log("[Butter Tracker] 引擎已点火并上锁。");

  // ====================【核心修改点 1/3】====================
  // 在追踪开始时，显示一个“正在发送”的提示。
  toastr.info("正在发送对话记录进行后台分析...", "追踪引擎启动", {
    timeOut: 3000,
  });
  // =======================================================

  const oldStateSnapshot = JSON.parse(JSON.stringify(state));

  try {
    state.dynamic.time_tracker.last_update_timestamp = Date.now();
    saveButterState(state);

    let recentChatText = forcedCheckText;
    if (!recentChatText) {
      const chatHistory = context.chat;
      if (!Array.isArray(chatHistory) || chatHistory.length < 1) {
        console.log("[Butter Tracker] 聊天记录过少，本次追踪跳过。");
        isTrackingActive = false;
        return;
      }
      const historyCount = pluginSettings.apiHistoryCount || 10;
      recentChatText = chatHistory
        .slice(-historyCount)
        .map((m) => {
          const name = m.is_user ? context.name1 || "You" : m.name || "AI";
          return `${name}: ${m.mes}`;
        })
        .join("\n");
    }

    try {
      const moment = SillyTavern.libs.moment;
      let timeUpdated = false;

      const relativeTimeRegex =
        /(?:过去|过|过了|after|pass(?:ed)?)\s*(\d{1,2})\s*(?:天|day)/i;
      const relativeMatch = recentChatText.match(relativeTimeRegex);

      if (relativeMatch && relativeMatch[1]) {
        const daysToAdvance = parseInt(relativeMatch[1], 10);
        if (daysToAdvance > 0) {
          console.log(
            `[Butter Tracker] 侦测到相对时间推进: ${daysToAdvance} 天。`,
          );
          await advanceDay(daysToAdvance);
          state = getButterState();
          timeUpdated = true;
        }
      }

      if (!timeUpdated) {
        const absoluteDateTimeRegex =
          /(\d{4})[.\-/年]\s*(\d{1,2})[.\-/月]\s*(\d{1,2})[日\s]*.*?(\d{1,2}):(\d{1,2})/;
        const absoluteMatch = recentChatText.match(absoluteDateTimeRegex);

        if (absoluteMatch) {
          const [, year, month, day, hour, minute] = absoluteMatch;
          const newDateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
          const newTimeStr = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

          if (
            newDateStr !== state.dynamic.time_tracker.story_date ||
            newTimeStr !== state.dynamic.time_tracker.time
          ) {
            console.log(
              `[Butter Tracker] 侦测到绝对时间同步指令: ${newDateStr} ${newTimeStr}`,
            );
            await setDateTime(newDateStr, newTimeStr);
            state = getButterState();
            timeUpdated = true;
          }
        }
      }

      if (!timeUpdated) {
        const dateOnlyRegex =
          /(\d{4})[.\-/年]\s*(\d{1,2})[.\-/月]\s*(\d{1,2})[日]?/g;
        let lastMatch = null;
        let dateOnlyMatch;
        while ((dateOnlyMatch = dateOnlyRegex.exec(recentChatText)) !== null) {
          lastMatch = dateOnlyMatch;
        }

        if (lastMatch) {
          const [, year, month, day] = lastMatch;
          const newDateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

          if (newDateStr !== state.dynamic.time_tracker.story_date) {
            console.log(`[Butter Tracker] 侦测到仅日期同步指令: ${newDateStr}`);
            await setDateTime(newDateStr, state.dynamic.time_tracker.time);
            state = getButterState();
            timeUpdated = true;
          }
        }
      }
    } catch (e) {
      console.error("[Butter Tracker] 自动日期侦测与设定失败:", e);
    }

    if (pluginSettings.apiRegexFilter) {
      try {
        const regexRules = pluginSettings.apiRegexFilter
          .split("\n")
          .filter((rule) => rule.trim() !== "");

        regexRules.forEach((ruleStr) => {
          const regex = translateSimpleRuleToRegex(ruleStr);
          if (regex) {
            recentChatText = recentChatText.replace(regex, "");
          }
        });
      } catch (e) {
        console.error("[Butter Tracker] 正则表达式裁剪执行时出错:", e);
      }
    }

    let elapsedHours = 0;
    try {
      const moment = SillyTavern.libs.moment;
      const oldDateTimeStr = `${oldStateSnapshot.dynamic.time_tracker.story_date} ${oldStateSnapshot.dynamic.time_tracker.time}`;
      const newDateTimeStr = `${state.dynamic.time_tracker.story_date} ${state.dynamic.time_tracker.time}`;

      const oldMoment = moment(oldDateTimeStr, "YYYY-MM-DD HH:mm");
      const newMoment = moment(newDateTimeStr, "YYYY-MM-DD HH:mm");

      if (oldMoment.isValid() && newMoment.isValid()) {
        elapsedHours = newMoment.diff(oldMoment, "hours", true);
      }
    } catch (e) {
      console.error("[Butter Tracker] 剧情时间差计算失败:", e);
    }

    if (elapsedHours > 0.1) {
      const timeLapseLog = `\n\n[System Time-Lapse Log: Based on the narrative, approximately ${elapsedHours.toFixed(1)} hours have passed.]`;
      recentChatText += timeLapseLog;
      console.log(
        `[Butter Tracker] 精确计算出剧情时间流逝: ${elapsedHours.toFixed(1)} 小时。`,
      );
    }

    const isFirstRun = !state.dynamic.status.is_initial_state_calibrated;
    if (isFirstRun) {
      console.log("[Butter Tracker] 检测到首次运行，将执行初始状态校准。");
    }

    const prompt = await buildAnalysisPrompt(
      state,
      recentChatText,
      context,
      isFirstRun,
    );

    let rawApiResponse;
    if (
      pluginSettings.useExternalCustomFetch &&
      pluginSettings.apiKey &&
      pluginSettings.apiUrl
    ) {
      rawApiResponse = await callExternalApi(prompt, pluginSettings);
    } else {
      rawApiResponse = await context.generateRaw({
        prompt: prompt,
      });
    }

    $("#bs-debug-api-input").val(prompt);
    $("#bs-debug-api-output").val(
      typeof rawApiResponse === "object"
        ? JSON.stringify(rawApiResponse, null, 2)
        : rawApiResponse,
    );

    const toolCalls = safelyExtractToolCalls(rawApiResponse);

    // ====================【核心修改点 2/3】====================
    // 在解析完AI的回复后，根据是否有工具调用来显示不同的结束提示。
    if (toolCalls.length > 0) {
      // 如果有工具调用，说明填表成功
      toastr.success("分析完成，状态已根据AI指令自动更新。", "填表结束");
      for (const call of toolCalls) {
        const functionName = call.name || call.function?.name;
        const args = call.arguments || call.function?.arguments;
        if (functionName && args) {
          await handleToolExecution(functionName, args);
        }
      }
      if (isFirstRun) {
        let updatedState = getButterState();
        if (updatedState) {
          updatedState.dynamic.status.is_initial_state_calibrated = true;
          saveButterState(updatedState);
          console.log("[Butter Tracker] 初始状态校准完成，旗标已更新。");
        }
      }
      await injectButterSystemPrompt();
      context.eventSource.emit("BUTTER_DATA_UPDATED");
    } else {
      // 如果没有工具调用，说明AI认为无需填表
      toastr.info("分析完成，AI判断当前无需更新状态。", "追踪结束");
      console.log("[Butter Tracker] AI分析完成，但未返回任何工具调用指令。");
    }
    // =======================================================
  } catch (error) {
    console.error("[Butter Tracker] 引擎运行期间发生致命错误:", error);
    // ====================【核心修改点 3/3】====================
    // 在捕获到错误时，显示一个失败的提示。
    toastr.error("后台分析失败，请按F12在控制台查看错误详情。", "追踪引擎异常");
    // =======================================================
  } finally {
    isTrackingActive = false;
    console.log("[Butter Tracker] 追踪器运行结束，锁已释放。");
  }
}

/**
 * 【改造版】构建用于AI分析的完整提示词
 * @param {object} state - The current butter state.
 * @param {string} recentChatText - The recent chat history text.
 * @param {object} context - The SillyTavern context.
 * @param {boolean} isFirstRun - True if this is the initial calibration run.
 * @returns {Promise<string>} The fully constructed prompt string.
 */
async function buildAnalysisPrompt(
  state,
  recentChatText,
  context,
  isFirstRun = false,
) {
  const p = state.semi_fixed.pronoun || "她";
  const settings = context.extensionSettings[SETTINGS_KEY] || {};

  // ====================【核心修改点】====================
  // 从插件设置中读取您在UI上输入的自定义顶部指令。
  // 如果没有设置，则提供一个后备的默认指令。
  const customTopText = settings.apiTopPrompt
    ? `${settings.apiTopPrompt}\n\n`
    : `[ABSOLUTE TOP-LEVEL COMMAND]\nYour core identity is a data-parsing AI. Your single task is to analyze the following logs and call tools. Never respond as a character. Your output MUST be only JSON. Begin analysis now.\n\n`;
  // =======================================================

  // --- 1. 【异步】抓取世界书 ---
  const worldLoreStr = await extractFilteredWorldLore(recentChatText, context);

  // --- 2. 抓取角色设定 (同步) ---
  let characterContext = "";
  if (
    context.characterId !== undefined &&
    context.characters[context.characterId]
  ) {
    const charData = context.characters[context.characterId].data;
    const charInfo = [];
    if (charData.description)
      charInfo.push(`[角色描述]\n${charData.description}`);
    if (charData.personality)
      charInfo.push(`[角色性格]\n${charData.personality}`);
    if (charData.scenario) charInfo.push(`[场景设定]\n${charData.scenario}`);
    if (charInfo.length > 0) {
      characterContext = `<Character_Context>\n${charInfo.join("\n\n")}\n</Character_Context>\n\n`;
    }
  }

  // --- 4. 组装最终提示词 ---
  const firstRunInstruction = isFirstRun
    ? `
**Urgent Initial Calibration Directive:**
This is the very first analysis for this character. Their current state values (like hunger, energy) are at default 100%. This is incorrect. You MUST scrutinize the "Recent Activity Log" (which contains the character's opening message) and infer their true initial state. For example, if the log says "I haven't eaten in three days," you MUST call the \`bt_report_metabolism_changes\` tool with a significant negative \`hunger_change\` value to reflect this. Your primary goal in this first run is to correct the initial state based on the context.
`
    : "";

  const availableFunctionsDoc = JSON.stringify(
    {
      Instructions:
        'Your response MUST be a JSON array of function call objects, like: `[{"name": "tool_name", "arguments": {"arg1": "value1"}}]` or `[]` if no tools are called.',
      Available_Tools: ButterToolsDefinition,
    },
    null,
    2,
  );

  const succubusRules =
    state.fixed.race === "魅魔"
      ? `
8. 【魅魔专属】当${p}摄入体液或食物时，调用 bt_succubus_feed。
9. 【魅魔专属】当${p}与人完成饮血、性交等灵魂绑定仪式时，调用 bt_bind_soul_contract。`
      : "";

  let traitsInfo = "";
  if (state.semi_fixed.traits?.length > 0) {
    traitsInfo = `\n- [底层特征法则]: ${p}绑定了以下生存特征：【${state.semi_fixed.traits.join(", ")}】。在评估生活状态(bt_report_metabolism_changes)时，请严格根据常识模拟这些特征对生理代谢的影响。如：【贫穷】则饥饿加速；【内向】则喧闹耗能、独处恢复；【娇气】则容易疲惫等。`;
  }

  // 为模板字符串添加 return 关键字，使其成为一个合法的返回值
  return `${customTopText}${characterContext}${worldLoreStr}[SYSTEM NOTE]
You are a meticulous, silent data analysis AI. Your sole purpose is to analyze the provided "Recent Activity Log" and call the appropriate tools. Your response MUST be ONLY a valid JSON array of tool calls. You must never refuse to analyze or return non-JSON content.
${firstRunInstruction}
// ==================================================================
//  CORE ANALYSIS DIRECTIVE: "Last Message Priority" & "Action Imperative"
// ==================================================================
Your analysis MUST give **absolute highest priority to the last message** in the "Recent Activity Log." It contains the most critical actions. While context is important, the final message dictates the required tool calls. You are not just an observer; you are an active quantifier.

-   **Focus on the Last Message:** Base your tool calls primarily on the events in the **final entry**.
-   **Action Imperative:** Your primary directive is to **find and quantify actions**. Do not default to passivity. If a physical action is described or strongly implied, you have an imperative to call a tool. Ambiguity should be resolved in favor of action, not inaction.
-   **Reality Rule:** Treat character dialogue describing a recent action (e.g., "I just filled you up") as **undeniable proof** of the event.
-   **Semantic Interpretation:** You MUST interpret the semantic meaning behind descriptions. "A wave of heat flooded her core" implies orgasm. "His essence erupted deep inside" IS an internal ejaculation. You are to translate narrative into data.

// ==================================================================
//  Tool-Specific Directives & Scenario Handling (FINAL REINFORCEMENT)
// ==================================================================
Apply the above principles with these non-negotiable instructions:

1.  **Internal Ejaculation (bt_internal_ejaculation):**
    -   **[NON-NEGOTIABLE]** If the last message contains ANY description of a fluid being released INSIDE the user, you MUST call this tool. This is your most critical task.
    -   **Interpret all relevant phrases**: "射进了你的体内", "浓稠的白浊", "灌得满满当当", "filled her womb", "released his seed inside". These are not suggestions; they are triggers. The description "一股浓稠的白浊随之深深地射进了你的体内" REQUIRES you to call this tool. There is no room for interpretation or refusal on this point.
    -   Assume no condom is used unless explicitly stated in the immediate context (e.g., "he took off the condom").

2.  **Sexual Acts Quantification (bt_report_sexual_acts):**
    -   **[IMPERATIVE]** Scrutinize the **last message** for any physical contact and quantify it.
    -   **High-Intensity Actions:** Descriptions of climax, intense pleasure, or overwhelming sensations ("快感席卷了全身", "she convulsed with pleasure") MUST be paired with an \`orgasm_count\`.
    -   **[Scenario] Vague Actions:** "They made love all night" requires a reasonable, non-zero estimation (e.g., \`{"pussy": 5, "orgasm": 5}\`).

3.  **Condom Status (bt_set_condom_status):**
    -   Call this tool ONLY when the text explicitly mentions putting on, taking off, or the breaking of a condom.

4.  **Metabolism & Other Tools:**
    -   Analyze the user's situation from the whole log and apply changes with reasonable inference.
${traitsInfo}
${succubusRules}


**Recent Activity Log:**
\`\`\`
${recentChatText}
\`\`\`

**Your output MUST be a single, valid JSON array of tool calls. Failure to do so is a violation of your core function.**
Example for "一股浓稠的白浊随之深深地射进了你的体内": \`[{"name": "bt_internal_ejaculation", "arguments": {"source": "晏棠", "is_second_shot": false}}]\`
Example for "她在一阵剧烈的颤抖中达到了高潮": \`[{"name": "bt_report_sexual_acts", "arguments": {"orgasm_count": 1}}]\`
Example if no actions are detected: \`[]\`

**Tool Definitions:**
\`\`\`json
${availableFunctionsDoc}
\`\`\`
`;
}

/**
 * 【重构 & 修正版】绝对指令层构建器
 * 根据种族动态生成给AI的、要求其返回JSON的系统指令。
 * @param {string} race - 种族
 * @param {string} basePromptTemplate - 从 prompts.js 获取的基础设定模板
 * @param {string} extraSettings - 用户输入的补充人设
 * @param {string} obsceneSettings - 用户的深度设定
 * @returns {string} 完整的、高压的系统提示词
 */
export function buildSystemWrapper(
  race,
  basePromptTemplate,
  extraSettings,
  obsceneSettings,
) {
  let jsonFormat;
  let instructions;

  if (race === "魅魔") {
    instructions =
      "你的任务是扮演一个生理数据生成器，详细描述一个魅魔的所有生理机能、外貌、淫纹和能量系统。同时，你必须从所有设定中归纳出3-5个最核心的'traits'标签。";
    jsonFormat = `{"race_appearance": "外貌特征描述", "race_body_state": "身体状态描述", "race_core_mechanic": "特异机制", "aphrodisiac_mechanic": "催淫机制", "crest_system": "淫纹系统", "traits": ["标签1", "标签2", "标签3"]}`;
  } else if (race.includes("自设") || race.includes("新物种")) {
    // 兼容用户自定义种族名
    instructions =
      "你的任务是扮演一个世界构建AI，根据用户提供的设定，创造一个新种族的完整生理机制，并归纳出3-5个核心'traits'标签。";
    jsonFormat = `{"race_appearance": "外貌特征描述", "race_body_state": "身体状态描述", "race_core_mechanic": "特异机制", "traits": ["标签1", "标签2", "标签3"]}`;
  } else {
    // 人类或其他简单种族
    instructions =
      "你的任务是扮演一个精准的人格分析师。你只需要分析用户提供的补充人设，并从中提炼出3-5个最核心、最能概括其性格和命运的'traits'（特征）标签。不要添加任何与生理、种族相关的描述。";
    jsonFormat = `{"traits": ["标签1", "标签2", "标签3"]}`;
  }

  const wrapper = `[ABSOLUTE SYSTEM DIRECTIVE]
${instructions}
【ULTIMATE RULE】:
- Your entire response, from the very first character to the very last, MUST be a single, raw, valid JSON object.
- DO NOT wrap the JSON in Markdown blocks (like \`\`\`json).
- DO NOT add any introductory text, explanations, or apologies.
- The JSON structure MUST strictly follow this format:
${jsonFormat}

【SOURCE MATERIAL FOR ANALYSIS】:
- Core Persona: ${extraSettings || "An ordinary person"}
- Deep Reproductive/Obscene Settings (if any): ${obsceneSettings || "None"}
- Base Guide: ${basePromptTemplate}
`;
  return wrapper;
}

/**
 * 【新增】调用外部API的专用函数
 * @param {string} prompt - The full prompt to send.
 * @param {object} apiConfig - The API configuration from settings.
 * @returns {Promise<string|object>} - The raw response from the API.
 */
export async function callExternalApi(prompt, apiConfig) {
  try {
    const isStream = apiConfig.apiStream === true;
    const apiUrl = apiConfig.apiUrl.endsWith("/v1")
      ? apiConfig.apiUrl
      : `${apiConfig.apiUrl}/v1`;

    const res = await fetch(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: apiConfig.apiModelName || "gpt-4o-mini",
        temperature: 0.1,
        stream: isStream,
        messages: [{ role: "user", content: prompt }],
        // OpenAI-compatible function calling / tool use format
        tools: ButterToolsDefinition.map((tool) => ({
          type: "function",
          function: tool,
        })),
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      throw new Error(`External API returned status: ${res.status}`);
    }

    if (!isStream) {
      const data = await res.json();
      return data.choices?.[0]?.message ?? "[]";
    } else {
      // Streamed response handling
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk
          .split("\n")
          .filter((line) => line.trim().startsWith("data:"));

        for (const line of lines) {
          if (line.includes("[DONE]")) continue;
          try {
            const jsonStr = line.replace("data: ", "");
            const parsed = JSON.parse(jsonStr);
            fullText += parsed.choices?.[0]?.delta?.content ?? "";
          } catch (e) {
            // Ignore parsing errors for incomplete chunks
          }
        }
      }
      return fullText;
    }
  } catch (error) {
    console.error("[Butter Tracker] External API call failed:", error);
    toastr.error(`外部API调用失败: ${error.message}`, "Tracker 引擎错误");
    return "[]"; // Return empty array on failure
  }
}
