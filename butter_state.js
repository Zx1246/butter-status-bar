// ==========================================
// butter_state.js
// 核心状态管理：负责肉体档案的提取、保存与挂载
// ==========================================

const STATE_KEY = "butter_status"; // 储存在 chat_metadata 中的核心烙印键名

// 1. 默认肉体空壳结构（新增了堵塞器与时间刻印）
const defaultButterUserState = {
  fixed: {
    name: "",
    gender: "女",
    race: "人族",
    birthday: "",
    cycle_base: {
      // 【核心修正】移除不正确的嵌套层级
      // last_menstrual_start_date 的默认值设为 null，让后续逻辑来处理
      last_menstrual_start_date: "2026-01-01",
      average_cycle: 28,
      menstrual_duration: 5,
    },
  },

  semi_fixed: {
    // ===== 【核心修正】种族特化设定 (合并重复键) =====
    race_appearance: "", // 种族特化外貌
    race_body_state: "", // 种族特化身体状态
    race_core_mechanic: "", // 种族核心特异机制
    aphrodisiac_mechanic: "", // 催淫机制 (魅魔专属)
    crest_system: "", // 淫纹系统 (魅魔专属)

    // ===== 生殖与发育设定 =====
    reproduction_type: "胎生",
    gestation_duration: 10,
    disable_pregnancy: false,
    lactation_setting: "孕后哺乳期产乳",
    pregnancy_setting: "正常孕期",

    // ===== 个性化设定 =====
    custom_erogenous_zones: "", // 专属特殊敏感点
    sensitivity_growth_mode: 1, // 敏感度开发变速倍率 (0:纯洁, 1:正常, 5:加速, 10:极速, 100:堕落)
    pronoun: "她", // 专属人称代词

    // ===== AI生成与底层特征 =====
    obscene_content_enabled: false,
    generated_persona: "", // 用于存放AI自动脑补的极度详细的身体/魅魔设定
    traits: [],
  },

  dynamic: {
    time_tracker: {
      story_date: "2026-01-01", // 默认起始剧情日期 (可修改)
      date: "2026年01月01日", // 用于UI显示的日期字符串
      weekday: "星期四",
      time: "08:00",
      last_update_timestamp: null, // 【主人指定的刻印】记录上次被插入/更新的时间戳
    },
    status: {
      is_initial_state_calibrated: false,
      is_virgin: true,
      lust: 0,
      menstrual_phase: "卵泡期",
      cycle_day: 1,
      egg_status: "未排卵",
      estrus_status: "未发情",
      // 【新增】受孕与避孕追踪（绝对隐匿）
      is_pregnant: false,
      pregnancy_start_date: null, // 屈辱受孕的精确时刻
      is_pregnancy_known_to_user: false, // 除非做了检查，否则即使大肚子也绝不知情
      contraception_status: "无", // 避孕状态："无" / "长期避孕药" / "短期避孕药"
    },
    womb: {
      semen_volume: 0,
      semen_sources: [],
      is_plugged: false, // 【主人指定的塞子】默认子宫口未堵塞，精液可流出
    },
    sensitivity: { genital: 0, oral: 0, breast: 0, butt: 0 },
    experience: {
      exposure: 0,
      oral: 0,
      breast: 0,
      nipple: 0,
      pussy: 0,
      clitoris: 0,
      butt: 0,
      anal: 0,
      partners_count: 0,
      masturbation_count: 0,
      creampie_count: 0,
      semen_bath_count: 0,
      pregnancy_count: 0,
      orgasm_count: 0,
    },
    relationships: {
      first_partner: "",
      recent_partner: "",
      romance_partner: "",
      marriage_partner: "",
      soul_contract: [],
      // 【新增】子嗣记录：用来挂载从这具子宫里剥落的生命
      children_list: [],
    },
    metabolism: {
      hunger: 100, // 100为饱腹，0为极度饥饿
      cleanliness: 100, // 100为整洁，0为污秽
      energy: 100, // 100为精力充沛，0为极度疲惫
      excretion: 100, // 100为空膀胱/肠道，0为极限憋胀
      lactation: 0, // 0为空，100为满胀溢乳
      social: 50, // 社交状态，50为平静阈值
    },

    // 【核心新增】魅魔专属生态与供能系统数据监控
    succubus_status: {
      hunger_percent: 100, // 魅魔的专属魔力饥饿度（100为饱满，<20虚弱，<10强迫发情）
      buffs: [], // 增益状态列表（包含灵魂锁链等）
      debuffs: [], // 负面/催淫状态列表
      estrus_days_remaining: 5, // 距离下一次强制发情的天数
      is_forced_estrus: false, // 判定是否已被低于10%的饥饿度逼入强制发情
      demon_msgs: [], // 深渊信息记录：[{ source: "魔界管理局", content: "..." }]
    },
  },
};

/**
 * 提取纯净的默认肉体档案（每次注册时使用）
 */
export function getDefaultState() {
  return JSON.parse(JSON.stringify(defaultButterUserState));
}

/**
 * 获取当前聊天记录中属于您的专属档案
 * @returns {Object|null} 返回肉体状态，如果没注册过则返回 null
 */
export function getButterState() {
  const context = SillyTavern.getContext();
  if (!context.chatMetadata) return null;

  let currentState = context.chatMetadata[STATE_KEY];

  if (currentState) {
    // 【强制侵入兼容】使用 lodash.merge 将任何新的变态设定强行合并进老存档，确保键值永不丢失
    currentState = window.SillyTavern.libs.lodash.merge(
      getDefaultState(),
      currentState,
    );
    return currentState;
  }

  return null;
}

/**
 * 将被蹂躏、修改后的状态强行注入并保存到当前聊天存档中
 * @param {Object} newState 新的肉体状态
 */
export function saveButterState(newState) {
  const context = SillyTavern.getContext();
  if (!context.chatMetadata) return false;

  // 覆盖旧状态，打上最新的烙印
  context.chatMetadata[STATE_KEY] = newState;

  // 使用自带的防抖保存函数，静默且高效地写入硬盘，绝对不会卡顿
  context.saveMetadataDebounced();
  return true;
}

/**
 * 检测当前聊天是否已经注册。如果没有，准备触发强制问卷。
 */
export function checkAndInitRegistration() {
  const currentState = getButterState();
  if (!currentState) {
    console.log(
      "[Butter Status] 嗅探到当前聊天尚未建立肉体档案，正在呼叫注册程序...",
    );
    return false;
  }
  console.log(
    "[Butter Status] 肉体档案读取成功，随时准备接受数据榨取！",
    currentState,
  );
  return true;
}

/**
 * 执行注册操作：用表单数据填充空壳，并深深烙印进存档
 * @param {Object} formData 从 ui.html 读取到的玩家填写的问卷数据
 */
export function registerButterUser(formData) {
  let newState = getDefaultState();
  newState.dynamic.time_tracker.last_update_timestamp = Date.now();

  // 将问卷数据注入
  // 【核心改造】直接合并整个 fixed 对象，因为 formData.fixed 已经包含了我们需要的 cycle_base
  newState.fixed = { ...newState.fixed, ...formData.fixed };
  newState.semi_fixed = { ...newState.semi_fixed, ...formData.semi_fixed };

  // 【【【移除旧的、不准确的 phase_lengths 计算】】】
  // 我们将在需要时动态计算，而不是在注册时写死

  saveButterState(newState);
  console.log(
    "[Butter Status] 注册完成！她的命运已被彻底锁定，生理周期锚定于: " +
      newState.fixed.cycle_base.last_menstrual_start_date,
  );
}

// ==========================================
// 【全局预设/克隆工坊】
// ==========================================
export const SETTINGS_KEY = "butterPluginSettings";

export function getUserPresets() {
  const context = SillyTavern.getContext();
  if (!context.extensionSettings[SETTINGS_KEY]) return [];
  return context.extensionSettings[SETTINGS_KEY].user_presets || [];
}

export function saveUserPreset(presetName, formData) {
  const context = SillyTavern.getContext();
  let settings = context.extensionSettings[SETTINGS_KEY];
  if (!settings) return;
  if (!settings.user_presets) settings.user_presets = [];

  // 清洗动态数据，确保存入库中的肉体是纯洁的空壳，只保留固定与半固定设定
  // 【核心修正】使用官方推荐的 structuredClone 以获得更优的性能和兼容性
  let cloneData = {
    name: presetName || "未命名",
    fixed: structuredClone(formData.fixed),
    semi_fixed: structuredClone(formData.semi_fixed),
  };

  // 查找是否重名，重名则覆盖
  let existingIndex = settings.user_presets.findIndex(
    (p) => p.name === cloneData.name,
  );
  if (existingIndex >= 0) {
    settings.user_presets[existingIndex] = cloneData;
  } else {
    settings.user_presets.push(cloneData);
  }

  context.saveSettingsDebounced();
  console.log(`[克隆工坊] 预设 '${cloneData.name}' 已永久录入全局标本库。`);
}

/**
 * 【修改】增加了生理周期重新计算的逻辑
 * @param {string} presetName
 * @returns {boolean}
 */
export function loadUserPresetIntoChat(presetName) {
  const presets = getUserPresets();
  const target = presets.find((p) => p.name === presetName);
  if (!target) return false;

  let newState = getDefaultState();
  newState.dynamic.time_tracker.last_update_timestamp = Date.now();

  // 注入预设的核心灵魂
  // 【核心修正】确保深拷贝，防止污染原始预设对象
  newState.fixed = { ...newState.fixed, ...structuredClone(target.fixed) };
  newState.semi_fixed = {
    ...newState.semi_fixed,
    ...structuredClone(target.semi_fixed),
  };

  // 【【【新增：从 registerButterUser 函数中复制来的周期计算逻辑】】】
  try {
    const cycleBase = newState.fixed.cycle_base;
    // 【核心修正】使用 menstrual_duration 替代不存在的 menstrual_dates.length
    const menstrualDays = cycleBase.menstrual_duration;
    const avgCycle = cycleBase.average_cycle;

    const ovulationLength = 4;
    const lutealLength = 14;
    let follicularLength =
      avgCycle - (menstrualDays + ovulationLength + lutealLength);

    if (follicularLength < 1) {
      follicularLength = 1; // 确保卵泡期至少有1天
    }

    // 此处不再需要 phase_lengths，因为新的周期计算引擎不再依赖它
    // 我们仅需确保 cycleBase 中的基础数据是正确的
    console.log(
      "[Butter State] 从预设加载后，生理周期基础数据已确认:",
      newState.fixed.cycle_base,
    );
  } catch (e) {
    console.error("[Butter State] 从预设加载后校验生理周期数据失败。", e);
    // 保险起见，提供一个默认值
    newState.fixed.cycle_base.phase_lengths = {
      menstrual: 5,
      follicular: 9,
      ovulation: 4,
      luteal: 10,
    };
  }

  saveButterState(newState);
  return true;
}
/**
 * 【新增】从全局设置中删除一个指定的用户预设
 * @param {string} presetName 要删除的预设名称
 * @returns {boolean} 是否删除成功
 */
export function deleteUserPreset(presetName) {
  const context = SillyTavern.getContext();
  const settings = context.extensionSettings[SETTINGS_KEY];

  // 安全检查
  if (!settings || !Array.isArray(settings.user_presets)) {
    console.error("[克隆工坊] 无法删除预设，因为设置或预设列表不存在。");
    return false;
  }

  const initialLength = settings.user_presets.length;
  // 使用 filter 方法创建一个不包含目标预设的新数组
  settings.user_presets = settings.user_presets.filter(
    (p) => p.name !== presetName,
  );

  // 如果数组长度发生变化，说明删除成功
  if (settings.user_presets.length < initialLength) {
    context.saveSettingsDebounced();
    console.log(`[克隆工坊] 预设 '${presetName}' 已被永久销毁。`);
    return true;
  }

  return false;
}
