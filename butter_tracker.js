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

// ==========================================
// I. 状态注入模块
// 负责将肉体档案转化为AI可理解的文本，并注入酒馆
// ==========================================

/**
 * 状态降维翻译器 (核心)：将数值化的经验转化为富有描述性的文本。
 * @param {object} state - The butter state object.
 * @returns {string} - A descriptive string of the character's physical state.
 */
function translatePhysicalState(state) {
  const exp = state.dynamic.experience;
  const descriptions = [];
  const p = state.semi_fixed.pronoun || "她";

  // 【核心修正】sens 变量未定义，应从 state.dynamic.sensitivity 获取
  const sens = state.dynamic.sensitivity;

  const stateMap = {
    pussy: {
      virgin: "私处(处女): 紧锁抗拒，初次进入会有撕裂痛感。",
      developed: `私处(湿热): 懂得放松分泌爱液，迎合抽插。`,
      fallen: `私处(淫穴): 极度淫荡，主动收缩吮吸，贪婪吞食。`,
    },
    anal: {
      virgin: "后庭(紧锁): 完全未经开发，极度抗拒。",
      developed: `后庭(开拓): 括约肌学会放松，享受酸胀。`,
      fallen: `后庭(幽穴): 湿滑可自如收缩，敞开迎接挞伐。`,
    },
    oral: {
      virgin: "口腔(青涩): 深喉会干呕，动作笨拙。",
      developed: `口腔(适应): 放松喉部，用舌唇取悦。`,
      fallen: `口腔(熟练): 喉咙柔软贪婪，渴求精液灌满。`,
    },
    breast: {
      virgin: "乳房(蓓蕾): 快感轻微伴随羞耻。",
      developed: `乳房(敏感): 主动挺起胸膛作为高潮开关。`,
      fallen: `乳房(淫具): 丰满柔软，渴望被粗暴揉捏。`,
    },
  };

  for (const key of Object.keys(stateMap)) {
    // 【核心修正】兼容旧的 pussy 键和新的 genital 键
    const sensitivityValue = sens[key] ?? sens.genital ?? 0;

    if (sensitivityValue >= 80) {
      descriptions.push(stateMap[key].fallen);
    } else if (sensitivityValue >= 30) {
      descriptions.push(stateMap[key].developed);
    } else {
      descriptions.push(stateMap[key].virgin);
    }
  }

  if (state.semi_fixed.custom_erogenous_zones) {
    descriptions.push(
      `致命弱点(${state.semi_fixed.custom_erogenous_zones}): 一旦被触碰，会瞬间产生强烈快感。`,
    );
  }

  const meta = state.dynamic.metabolism;
  let metabolismDesc = `【当前生理需求】饱腹感:${meta.hunger}% | 清洁度:${meta.cleanliness}% | 精力:${meta.energy}% | 膀胱/肠道:${meta.excretion}%(越低越憋胀) | 积乳值:${meta.lactation}% | 社交需求:${meta.social}%`;
  descriptions.push(metabolismDesc);

  if (state.fixed.race === "魅魔" && state.dynamic.succubus_status) {
    descriptions.push(
      `【魔力饥饿度】: ${state.dynamic.succubus_status.hunger_percent}% (<10%将进入强制发情)`,
    );
  }

  return descriptions.join(" | ");
}

/**
 * 泌乳状态翻译器：将数值转化为文本描述。
 * @param {object} state - The butter state object.
 * @returns {string} - The lactation status description string, or an empty string.
 */
function getLactationDescription(state) {
  const lacSet = state.semi_fixed.lactation_setting;
  const breastSens = state.dynamic.sensitivity.breast;
  const isPregnant = state.dynamic.status.is_pregnant;
  const hasChildren = state.dynamic.relationships.children_list?.length > 0;
  const isOvulating = state.dynamic.status.menstrual_phase === "排卵期";
  const isForcedEstrus = state.dynamic.succubus_status?.is_forced_estrus;

  let canLactate = false;
  if (lacSet === "随胸部开发度产乳" && breastSens >= 100) canLactate = true;
  else if (lacSet === "孕后哺乳期产乳" && (isPregnant || hasChildren))
    canLactate = true;
  else if (lacSet === "发情期产乳" && (isOvulating || isForcedEstrus))
    canLactate = true;
  else if (lacSet === "高潮后产乳") canLactate = true;

  if (!canLactate) return "";

  const lacVal = state.dynamic.metabolism.lactation || 0;
  let lacDesc = "";
  if (lacVal <= 30) lacDesc = "触感柔软，无异常。";
  else if (lacVal < 60) lacDesc = "乳腺充盈，微胀。";
  else if (lacVal < 80) lacDesc = "乳房饱胀，触碰时会分泌乳汁。";
  else if (lacVal < 100) lacDesc = "极度肿胀，轻压即漏奶，高潮时会喷射。";
  else lacDesc = "乳汁持续溢出，渗透衣物。";

  return `\n[泌乳状态: ${lacDesc}]`;
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

  // 小腹状态描述
  let wombVolume = state.dynamic.womb.semen_volume;
  let abdomenDesc = "小腹平坦紧实。";
  if (wombVolume > 90)
    abdomenDesc = "小腹被大量精液撑得极度高耸，呈现出如同孕三月般的浑圆鼓胀。";
  else if (wombVolume > 50)
    abdomenDesc = "宫腔内灌满浊液，下腹部明显鼓胀，轮廓分明。";
  else if (wombVolume > 20)
    abdomenDesc = "子宫被精液撑开，小腹呈现出微微的隆起。";
  else if (wombVolume > 0) abdomenDesc = "阴道深处存有少量精液。";

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

  // --- 3. 模板构建：使用模板字符串组装最终的提示词 ---

  const finalPrompt = `
${personaAddon}[生理状态参考，请自然融入：]
- 小腹状态: ${abdomenDesc}
- 泌乳状态: ${lactationDescription || "无泌乳迹象。"}
- 灵魂契约: ${soulContractDesc}
- 年龄档案: ${ageString}
- 身体适应度:【${physicalDescriptions}】
- 当前状态: 生理周期(${state.dynamic.status.menstrual_phase}) | 情欲(Lust:${state.dynamic.status.lust}/100)
- 子宫滞留液: ${state.dynamic.womb.semen_volume.toFixed(1)}ml
- 穴口状态: ${state.dynamic.womb.is_plugged ? "【堵住/夹紧，无法流出】" : "【敞开/放松，缓慢流出】"}
${
  state.dynamic.status.menstrual_phase === "生理期" &&
  !state.dynamic.status.is_pregnant
    ? `[系统最高指令: 生理期间，绝对禁止插入式性交。请展现身体疲惫与腹部坠胀，婉拒实质性插入。]`
    : ""
}
${
  state.dynamic.status.is_pregnant
    ? !state.dynamic.status.is_pregnancy_known_to_user
      ? `[系统最高指令: ${p}已怀孕但【绝对不知情】。只能描写嗜睡、反胃、小腹微胖等【轻微变化】。绝对禁止使用“怀孕”、“胎儿”等词剧透！]`
      : `[状态提示: ${p}已知悉受孕，请合理展现该阶段的心理与生理特征。]`
    : ""
}
${
  state.fixed.race === "魅魔" &&
  state.dynamic.succubus_status &&
  (state.dynamic.succubus_status.hunger_percent < 10 ||
    state.dynamic.succubus_status.is_forced_estrus)
    ? `[状态提示: 魔力濒临枯竭。生理本能将压倒理智，产生强烈的体液渴求。]`
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

    // ==========================================================
    // 【【【核心改造区域：日期与时间处理逻辑】】】
    // ==========================================================
    try {
      const moment = SillyTavern.libs.moment;
      let timeUpdated = false; // 新增一个标志，防止重复处理

      // --- 模式1：匹配相对时间，如“3天后”、“过去了三天” (最高优先级) ---
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

          state = getButterState(); // 重新获取状态
          timeUpdated = true; // 标记已处理
        }
      }

      // --- 模式2：匹配绝对日期和时间 (如果模式1未触发) ---
      if (!timeUpdated) {
        // 这个正则现在可以匹配 "YYYY-MM-DD HH:mm", "YYYY年M月D日 H:m" 等多种组合
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
            // 静默调用 setDateTime
            await setDateTime(newDateStr, newTimeStr);
            // context.sendSystemMessage(...) 已被移除
            // toastr.info(...) 已被移除
            state = getButterState();
            timeUpdated = true;
          }
        }
      }

      // --- 模式3：只匹配绝对日期 (如果前两个模式都未触发) ---
      if (!timeUpdated) {
        const dateOnlyRegex =
          /(\d{4})[.\-/年]\s*(\d{1,2})[.\-/月]\s*(\d{1,2})[日]?/g;
        let dateOnlyMatch;
        // 我们需要找到最后一个匹配项，因为它最可能是当前的日期
        let lastMatch = null;
        while ((dateOnlyMatch = dateOnlyRegex.exec(recentChatText)) !== null) {
          lastMatch = dateOnlyMatch;
        }

        if (lastMatch) {
          const [, year, month, day] = lastMatch;
          const newDateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

          if (newDateStr !== state.dynamic.time_tracker.story_date) {
            console.log(`[Butter Tracker] 侦测到仅日期同步指令: ${newDateStr}`);
            // ...
            // 静默调用 setDateTime
            await setDateTime(newDateStr, currentTime);
            // context.sendSystemMessage(...) 已被移除
            // toastr.info(...) 已被移除
            state = getButterState();
            timeUpdated = true;
          }
        }
      }
    } catch (e) {
      console.error("[Butter Tracker] 自动日期侦测与设定失败:", e);
    }
    // ==========================================================
    // 【【【改造结束】】】
    // ==========================================================

    if (pluginSettings.apiRegexFilter) {
      try {
        const regexRules = pluginSettings.apiRegexFilter
          .split("\n")
          .filter((rule) => rule.trim() !== "");

        regexRules.forEach((ruleStr) => {
          // 使用新的翻译函数
          const regex = translateSimpleRuleToRegex(ruleStr);
          if (regex) {
            // 仅在翻译成功时执行替换
            recentChatText = recentChatText.replace(regex, "");
          }
        });
      } catch (e) {
        console.error("[Butter Tracker] 正则表达式裁剪执行时出错:", e);
      }
    }

    // ==========================================================
    // 【【【液压引擎燃料供应线 - 重建工程】】】
    // ==========================================================
    // 3. 【核心计算】精确计算剧情时间差
    let elapsedHours = 0;
    try {
      const moment = SillyTavern.libs.moment;
      const oldDateTimeStr = `${oldStateSnapshot.dynamic.time_tracker.story_date} ${oldStateSnapshot.dynamic.time_tracker.time}`;
      const newDateTimeStr = `${state.dynamic.time_tracker.story_date} ${state.dynamic.time_tracker.time}`;

      const oldMoment = moment(oldDateTimeStr, "YYYY-MM-DD HH:mm");
      const newMoment = moment(newDateTimeStr, "YYYY-MM-DD HH:mm");

      if (oldMoment.isValid() && newMoment.isValid()) {
        // 使用 moment.diff() 计算出精确的小时差
        elapsedHours = newMoment.diff(oldMoment, "hours", true); // true 表示可以返回浮点数
      }
    } catch (e) {
      console.error("[Butter Tracker] 剧情时间差计算失败:", e);
    }

    // 4. 将精确的小时差注入到待分析文本中，引导AI
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
    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        // 使用 for...of 循环以支持 await
        const functionName = call.name || call.function?.name;
        const args = call.arguments || call.function?.arguments;
        if (functionName && args) {
          await handleToolExecution(functionName, args); // 等待每个工具执行完毕
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
      console.log("[Butter Tracker] AI分析完成，但未返回任何工具调用指令。");
    }
  } catch (error) {
    console.error("[Butter Tracker] 引擎运行期间发生致命错误:", error);
    toastr.error(
      "Tracker引擎运行失败，请按F12在Console中查看详细错误。",
      "系统异常",
    );
  } finally {
    isTrackingActive = false;
    console.log("[Butter Tracker] 追踪器运行结束，锁已释放。");
  }
}

/**
 * 【重构】构建用于AI分析的完整提示词
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

  // --- 3. 抓取对话预设 (同步) ---
  // 我将之前的 getPresetWrapper 逻辑直接整合到这里，并增加健壮性
  let presetWrapperStr = "";
  const settings = context.extensionSettings[SETTINGS_KEY] || {};
  if (settings.injectPreset && settings.injectPreset !== "default") {
    try {
      const presetManager = context.getPresetManager();
      const preset = presetManager?.presets?.find(
        (p) => p.name === settings.injectPreset,
      );
      if (preset?.system_prompt) {
        presetWrapperStr = `[系统预设覆盖: 请遵循以下人格与世界观]\n${preset.system_prompt}\n\n`;
      } else {
        console.warn(
          `[Butter Tracker] 预设 '${settings.injectPreset}' 被选中，但未找到或其中不含 'system_prompt'。`,
        );
      }
    } catch (e) {
      console.error(
        `[Butter Tracker] 获取预设 '${settings.injectPreset}' 失败`,
        e,
      );
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
  return `${presetWrapperStr}${characterContext}${worldLoreStr}[SYSTEM NOTE]
You are a meticulous, silent data analysis AI. Your sole purpose is to analyze the provided "Recent Activity Log" and call the appropriate tools. Your response MUST be ONLY a valid JSON array of tool calls.
${firstRunInstruction}
// ==================================================================
//  ABSOLUTE CORE DIRECTIVE: The Unwavering User-Centric Principle
// ==================================================================
Your ONLY target for analysis is the character identified as 【user】. You MUST ONLY quantify actions and events that are **physically and explicitly happening TO the user's body**.

-   **Subject Rule:** If an action is performed by anyone else on themselves (e.g., 'char touched their own chest'), or if the subject of the action is ambiguous, **IGNORE IT**.
-   **Reality Rule:** If the text describes thoughts, dialogue, plans, memories, or fantasies about an action, it DID NOT HAPPEN. **IGNORE IT**.
-   **Metaphor Rule:** If the text uses metaphorical language (e.g., "his voice caressed her"), it is NOT a physical action. **IGNORE IT**.
-   **The Golden Rule of Ambiguity:** If you are not 100% certain that a specific physical action was performed **ON THE USER**, you MUST assume it did not happen and call NO tool for it.

// ==================================================================
//  Tool-Specific Directives & Scenario Handling
// ==================================================================
Based on the absolute principle above, apply the following detailed instructions:

1.  **Sexual Acts Quantification (bt_report_sexual_acts):** This is your primary task.
    -   **Base Quantification:** Quantify every physical sexual act performed ON THE USER. If the log says "he kissed her lips", and 'her' is the user, report \`{"oral": 1}\`.
    -   **[Scenario] Vague Descriptions:** When faced with vague but continuous action (e.g., "they fucked all night long"), you MUST make a reasonable estimation. "All night" could imply \`{"pussy": 5, "orgasm": 5}\`. Do NOT invent extreme numbers. "He played with her breasts for a while" could be \`{"breast": 2}\`.
    -   **[Scenario] Multi-Part Stimulation:** If a single action involves multiple body parts, report each one. "He licked her nipples while fingering her" translates to \`{"nipple": 1, "pussy": 1}\`.
    -   **[Scenario] Group Encounters:** The number of partners acts as a multiplier for relevant actions. If "ten men took turns violating the user", you MUST report \`{"partners_count": 10, "pussy": 10, "creampie_count": 10}\`.
    -   **[Scenario] Time Skips:** If the log says "three days later," and the context implies continuous activity (e.g., user is a prisoner in a brothel), you MUST infer and cumulate the likely activities during that period based on the user's persona. A nymphomaniac might have \`{"pussy": 15, "oral": 10}\` over three days. Be reasonable.

2.  **Internal Ejaculation (bt_internal_ejaculation):**
    -   Call this ONLY when the log explicitly states ejaculation occurred **INSIDE one of the user's orifices** (vagina, anus, mouth, etc.).

3.  **Metabolism (bt_report_metabolism_changes):**
    -   Analyze the user's living conditions and actions. If they "ate a banquet," call with a positive \`hunger_change\`. If they "worked for 12 hours," call with a negative \`energy_change\`.
    -   Strictly adhere to the user's inherent traits when making these judgments.
${traitsInfo}

4.  **Other Tools:**
    -   Call \`bt_abort_pregnancy\`, \`bt_update_relationship\`, \`bt_set_vaginal_occlusion\`, etc., ONLY when the log explicitly describes the corresponding event happening TO THE USER.
${succubusRules}


**Recent Activity Log:**
\`\`\`
${recentChatText}
\`\`\`

**Your output must be a single, valid JSON array of tool calls, and nothing else.**
Example valid output: \`[{"name": "bt_report_sexual_acts", "arguments": {"pussy": 1, "orgasm": 1}}, {"name": "bt_internal_ejaculation", "arguments": {"source": "Taro", "is_second_shot": false, "condom_used": false}}]\`
Example output if no actions are detected: \`[]\`

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
