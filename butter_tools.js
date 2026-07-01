// ==========================================
// butter_tools.js
// 黑暗手术刀：AI专用的强制修改工具集 (堕胎/魅魔供能/灵魂契约 已装载)
// ==========================================

import { getButterState, saveButterState } from "./butter_state.js";
import { advanceDay } from "./menstrual_cycle_manager.js";
export const LEAKAGE_RATE_PER_HOUR = 5; // 每小时浊液自然流失量 (ml)

// 定义提供给AI的工具清单
export const ButterToolsDefinition = [
  {
    name: "bt_internal_ejaculation",
    description:
      "当剧情中明确发生男性角色在宿主阴道/子宫内射精（中出）时强制调用。用于计算注入的精液量与受孕概率。",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "射精者的名字或身份描述。",
        },
        is_second_shot: {
          type: "boolean",
          description:
            "这是否是该男性在本次交配中的第二次连续射精？（是为true，否为false）",
        },
        condom_used: {
          type: "boolean",
          description:
            "性爱过程中男性是否全程佩戴了避孕套？（是为true，否为false）",
        },
      },
      required: ["source", "is_second_shot", "condom_used"],
    },
  },

  {
    name: "bt_update_contraception",
    description:
      "当宿主在剧情中服用了避孕药，或者停止服药时调用。用于更新避孕状态。",
    parameters: {
      type: "object",
      properties: {
        is_on: {
          type: "boolean",
          description: "是否正在服用避孕药。（是为true，否为false）",
        },
      },
      required: ["is_on"],
    },
  },
  {
    name: "bt_discover_pregnancy",
    description:
      "当剧情中宿主通过验孕棒、医院检查、医生诊断等明确的方式，确认了自己已经怀孕的事实时调用。",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "确认怀孕的原因或方式。",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "bt_set_vaginal_occlusion",
    description:
      "当阴道被异物堵住，或宿主主动夹紧时调用（status为true）。当异物拔出或放松时调用（status为false）。",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "boolean",
          description: "是否处于阴道阻塞状态。（是为true，否为false）",
        },
      },
      required: ["status"],
    },
  },
  {
    name: "bt_perform_vaginal_cleaning",
    description: "清理下体时调用。深入子宫设为'deep'；擦拭外面设为'shallow'。",
    parameters: {
      type: "object",
      properties: {
        cleaning_type: {
          type: "string",
          description: "清理类型。'deep'表示深入子宫，'shallow'表示擦拭外面。",
        },
      },
      required: ["cleaning_type"],
    },
  },
  {
    name: "bt_update_lust",
    description: "情欲值变动时调用。正数为增加情欲，负数为降低。",
    parameters: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "情欲值的变动量。正数表示增加，负数表示降低。",
        },
      },
      required: ["amount"],
    },
  },
  // 【核心新增：行为量化清单】AI只负责提供次数计数
  {
    name: "bt_report_sexual_acts",
    description:
      "当剧情中明确发生了施加于【user】身上的肉体猥亵、性交或性侵时调用。你只需要上报user身上发生的行为次数，系统会自动处理。忽略char对user做的事，或者user的话语和思想。",
    parameters: {
      type: "object",
      properties: {
        exposure: {
          type: "number",
          description: "user被迫或主动进行羞耻展出的次数",
        },
        oral: {
          type: "number",
          description: "user的口部被使用的次数（被口交、被深喉）",
        },
        breast: {
          type: "number",
          description: "user的乳房被玩弄的次数",
        },
        nipple: {
          type: "number",
          description: "user的乳头被重点刺激/掐捏的次数",
        },
        pussy: {
          type: "number",
          description: "user的小穴被手指/道具/肉棒插入玩弄的次数",
        },
        clitoris: {
          type: "number",
          description: "user的阴蒂被直接玩弄的次数",
        },
        butt: {
          type: "number",
          description: "user的臀部被揉捏/抽打的次数",
        },
        anal: {
          type: "number",
          description: "user的后庭被插入（肛交）或塞入异物的次数",
        },
        partners_count: {
          type: "number",
          description: "本次剧情中，与user发生性关系的新增伴侣数量",
        },
        masturbation_count: {
          type: "number",
          description: "user被迫或主动进行自慰的次数",
        },
        creampie_count: {
          type: "number",
          description: "user身体任何孔穴（阴道、肛门、口腔等）被内射的次数",
        },
        semen_bath_count: {
          type: "number",
          description: "user被颜射或身体被大量精液涂抹的次数",
        },
        orgasm_count: {
          type: "number",
          description: "user达到高潮的次数",
        },
        partner_name: {
          type: "string",
          description:
            "与user发生性行为的主要伴侣的名字。如果涉及多人，则填入全部名字。如果名字不详，则填入'未知'。",
        },
      },
    },
  },
  // 【核心新增1】：堕胎工具
  {
    name: "bt_abort_pregnancy",
    description:
      "当剧情中发生流产、服用堕胎药、或遭受物理攻击导致强行终止妊娠时调用。这会立刻清除所有怀孕状态。",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "堕胎/流产的原因，例如'服用了米非司酮'或'被狠狠踢中了小腹'。",
        },
      },
      required: ["reason"],
    },
  },
  // 【核心新增2】：魅魔摄食工具
  {
    name: "bt_succubus_feed",
    description:
      "【仅当种族为魅魔时生效】当魅魔通过口交、性交等方式摄入指定液体时调用。",
    parameters: {
      type: "object",
      properties: {
        fluid_type: {
          type: "string",
          description:
            "摄入的液体种类。严格填写：'精液'、'爱液'、'唾液' 或 '人类食物'。",
        },
        amount: {
          type: "number",
          description: "摄入量，一个估算的相对值，例如 10。",
        },
      },
      required: ["fluid_type", "amount"],
    },
  },
  // 【核心新增3】：灵魂契约工具
  {
    name: "bt_bind_soul_contract",
    description:
      "【仅当种族为魅魔时生效】当剧情中，魅魔与某个角色通过饮血等仪式完成了灵魂契约的绑定时调用。",
    parameters: {
      type: "object",
      properties: {
        target_name: {
          type: "string",
          description: "被绑定为长期饭票的契约者姓名。",
        },
      },
      required: ["target_name"],
    },
  },
  {
    name: "bt_update_relationship",
    description:
      "客观记录生命中特殊羁绊的建立。当剧情明确发生以下事件时调用：初次交媾、确立恋爱关系、或缔结婚姻。",
    parameters: {
      type: "object",
      properties: {
        relation_type: {
          type: "string",
          description:
            "严格填写: 'first_partner', 'romance_partner', 或 'marriage_partner'",
        },
        target_name: { type: "string", description: "对方的名字" },
      },
      required: ["relation_type", "target_name"],
    },
  },
  {
    name: "bt_report_metabolism_changes",
    description:
      "评估生活境遇对生理需求的影响，以及大致的时间流逝。结合环境（如贫穷、劳累）和性格（内/外向对社交的影响）给出合理的增减值（正数为恢复，负数为消耗）。",
    parameters: {
      type: "object",
      properties: {
        elapsed_hours: {
          type: "number",
          description: "这段对话经过了大约几小时（如无明显跳跃填0）",
        },
        time_of_day: {
          type: "string",
          // 【核心修正】移除了末尾多余的右括号
          description:
            "推测当前具体时间，必须使用24小时制 HH:mm 格式 (例如 '08:30' 或 '23:15'）。如果无法判断则留空。",
        },
        sleep_occurred: {
          type: "boolean",
          description: "判断是否在这期间发生了完整的睡眠休息",
        },
        energy_change: {
          type: "number",
          description:
            "精力变动(数值需克制)。睡眠恢复+15~30，熬夜/性爱消耗-10~20",
        },
        hunger_change: {
          type: "number",
          description: "饱腹感变动。进食恢复，受饿或时间流逝扣除",
        },
        cleanliness_change: {
          type: "number",
          description: "整洁度。洗澡恢复，性交弄脏扣除",
        },
        social_change: {
          type: "number",
          description:
            "社交能量。结合底层特征，内向者独处恢复/喧闹扣除，外向反之",
        },
      },
    },
  },
  {
    name: "bt_give_birth",
    description:
      "当剧情中宿主确认分娩，诞下胎儿时调用。这会清除怀孕状态，并在关系中记录一个新的子嗣。",
    parameters: {
      type: "object",
      properties: {
        child_name: {
          type: "string",
          description: "为新生儿取的名字。",
        },
        child_gender: {
          type: "string",
          description: "新生儿的性别，如 '男', '女', '双性'。",
        },
      },
      required: ["child_name", "child_gender"],
    },
  },
  // 【【【新增工具：强制催乳】】】
  {
    name: "bt_force_lactation",
    description:
      "当剧情中明确提及user被使用/注射/服用了任何形式的“催乳”相关的药物或魔法时调用。这将强制开启一个临时的产乳状态。",
    parameters: {
      type: "object",
      properties: {
        is_starting: {
          type: "boolean",
          description: "是开始催乳（true），还是催乳效果结束（false）？",
        },
        reason: {
          type: "string",
          description: "催乳的原因，例如'注射了高效催乳剂'。",
        },
      },
      required: ["is_starting", "reason"],
    },
  },
];

// 辅助函数
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ... (文件顶部的 getRandomInt 函数保持不变) ...

/**
 * 核心执行引擎
 * @param {string} functionName 被调用的工具函数名
 * @param {string|object} args AI传入的参数，可能是JSON字符串或已解析的对象
 * @returns {Promise<string>} 返回给系统的执行结果日志
 */
export async function handleToolExecution(functionName, args) {
  let bState = getButterState();
  if (!bState) return "【报错：肉体档案记录落空】.";

  let argumentsProcessed;
  try {
    // 【核心修正】将 argumentsProcessed 的类型明确为 any，后续通过逻辑判断其属性
    /** @type {any} */
    argumentsProcessed = typeof args === "string" ? JSON.parse(args) : args;
  } catch (a1eX) {
    return "【报错：AI传入的参数格式碎裂】";
  }

  let logOutHintTxtResultForItOnly = "[状态强制变更]";

  // 1. 中出注入与残酷的受孕检定
  if (functionName === "bt_internal_ejaculation") {
    let sourceName = argumentsProcessed.source || "未知来源";
    let isSecond = argumentsProcessed.is_second_shot === true;
    let condomUsed = argumentsProcessed.condom_used === true;

    if (condomUsed) {
      logOutHintTxtResultForItOnly += ` 隔着橡胶套射精，子宫未被污染，受孕风险规避。`;
    } else {
      let volumeToInject = isSecond
        ? getRandomInt(5, 20)
        : getRandomInt(10, 30);
      bState.dynamic.womb.semen_volume += volumeToInject;
      bState.dynamic.womb.semen_volume = Math.min(
        bState.dynamic.womb.semen_volume,
        120,
      );
      bState.dynamic.experience.creampie_count += 1;

      // 【【【核心改造：使用剧情时间记录】】】
      // 不再使用现实时间的 toLocaleTimeString()，而是直接使用 state 中存储的剧情时间。
      bState.dynamic.womb.semen_sources.push({
        source: sourceName,
        volume: volumeToInject,
        time: bState.dynamic.time_tracker.time, // 使用剧情时间
      });
      if (bState.dynamic.womb.semen_sources.length > 10)
        bState.dynamic.womb.semen_sources.shift();

      logOutHintTxtResultForItOnly += ` 无套中出！注入 ${volumeToInject}ml 浓精。`;

      // 【核心机制：受孕概率轮盘 - 终极修复版】
      if (
        !bState.semi_fixed.disable_pregnancy &&
        !bState.dynamic.status.is_pregnant &&
        bState.dynamic.status.contraception_status === "无"
      ) {
        let prob = 0;
        const day = bState.dynamic.status.cycle_day || 1;
        const phase = bState.dynamic.status.menstrual_phase;

        // 1. 直接从 state 中获取最原始、最可靠的周期基础数据
        const avgCycle = bState.fixed.cycle_base.average_cycle || 28;
        const menstrualDuration =
          bState.fixed.cycle_base.menstrual_duration || 5;

        // 2. 动态实时计算出危险期和安全期的边界
        const LUTEAL_PHASE_LENGTH = 14;
        const ovulationDay = avgCycle - LUTEAL_PHASE_LENGTH;

        if (phase === "生理期") {
          prob = 0;
        } else if (phase === "排卵期" || phase === "发情期") {
          // 在排卵期，受孕概率达到顶峰
          // 越接近排卵日，概率越高
          const distanceToOvulationDay = Math.abs(day - ovulationDay);
          prob = Math.max(20, 80 - distanceToOvulationDay * 15);
        } else {
          // 对于卵泡期和黄体期，定义一个“绝对安全期”
          const isAbsolutelySafe =
            (phase === "卵泡期" && day <= menstrualDuration + 3) || // 月经刚结束的几天
            (phase === "黄体期" && day >= avgCycle - 4); // 下次月经快来的几天

          prob = isAbsolutelySafe ? 5 : 15; // 绝对安全期5%，其他时间15%
        }

        let roll = getRandomInt(1, 100);
        if (roll <= prob) {
          bState.dynamic.status.is_pregnant = true;
          bState.dynamic.experience.pregnancy_count += 1;
          bState.dynamic.status.pregnancy_start_date =
            bState.dynamic.time_tracker.story_date;
          logOutHintTxtResultForItOnly += ` 【厄运降临】受孕检定命中(概率${prob}%, 骰出${roll})！她怀孕了，但她一无所知。`;
        } else {
          logOutHintTxtResultForItOnly += ` 检定未命中(概率${prob}%, 骰出${roll})，侥幸逃过一劫。`;
        }
      } else if (bState.semi_fixed.disable_pregnancy) {
        logOutHintTxtResultForItOnly += ` 【绝育状态】user的子宫已被设定为无法受孕。`;
      } else if (bState.dynamic.status.contraception_status !== "无") {
        logOutHintTxtResultForItOnly += ` 药效保护中，未受孕。`;
      }
    }
  }

  // 2. 堕胎工具
  if (functionName === "bt_abort_pregnancy") {
    if (bState.dynamic.status.is_pregnant) {
      bState.dynamic.status.is_pregnant = false;
      // 【核心修正】统一使用 pregnancy_start_date 键名，并同时清理旧键名
      bState.dynamic.status.pregnancy_start_date = null;
      bState.dynamic.status.pregnancy_start_timestamp = null; // 兼容性清理
      bState.dynamic.status.is_pregnancy_known_to_user = false; // 重置认知
      logOutHintTxtResultForItOnly += ` 【生命剥夺】腹中胎儿因'${argumentsProcessed.reason}'被残忍地剥离了，她的子宫再度空虚。`;
    }
  }

  // 3. 魅魔摄食工具
  if (functionName === "bt_succubus_feed") {
    if (bState.fixed.race === "魅魔") {
      let fluid = argumentsProcessed.fluid_type;
      let hungerRecovery = 0;
      if (fluid === "精液" || fluid === "爱液") {
        hungerRecovery = getRandomInt(30, 70); // 优质食粮
      } else if (fluid === "唾液") {
        hungerRecovery = getRandomInt(10, 25); // 次级食粮
      } else {
        // 人类食物
        hungerRecovery = 0;
        logOutHintTxtResultForItOnly += ` 凡人的食物无法满足魔物的饥渴。`;
      }
      // 【核心修正】修正错误的键名 succubus_data -> succubus_status
      bState.dynamic.succubus_status.hunger_percent = Math.min(
        100,
        bState.dynamic.succubus_status.hunger_percent + hungerRecovery,
      );
      logOutHintTxtResultForItOnly += ` 摄入了'${fluid}'，饥饿度恢复了 ${hungerRecovery}%。`;
    }
  }

  // 4. 灵魂契约工具
  if (functionName === "bt_bind_soul_contract") {
    if (bState.fixed.race === "魅魔") {
      let target = argumentsProcessed.target_name || "一个契约者";
      if (!bState.dynamic.relationships.soul_contract.includes(target)) {
        bState.dynamic.relationships.soul_contract.push(target);
        logOutHintTxtResultForItOnly += ` 【灵魂锁链】user已和 '${target}' 绑定了无法挣脱的永恒契约。`;
      }
    }
  }

  // 5. 避孕药状态更新
  if (functionName === "bt_update_contraception") {
    // 【核心修正】参数从 status 改为 is_on，并明确处理布尔值
    const isOn = argumentsProcessed.is_on === true;
    bState.dynamic.status.contraception_status = isOn ? "长期避孕药" : "无"; // 假设所有服药都是长期
    logOutHintTxtResultForItOnly += ` 避孕状态更新为：${bState.dynamic.status.contraception_status}。`;
  }

  // 6. 验孕被发现
  if (functionName === "bt_discover_pregnancy") {
    if (bState.dynamic.status.is_pregnant) {
      bState.dynamic.status.is_pregnancy_known_to_user = true;
      logOutHintTxtResultForItOnly += ` 秘密守不住了，user终于查出了自己怀孕的残酷事实。`;
    }
  }

  // 7. 堵塞/开放判定
  if (functionName === "bt_set_vaginal_occlusion") {
    // 【核心修正】参数 status 在定义中是正确的，此处逻辑无误，但类型检查会报错，JSDoc已解决
    bState.dynamic.womb.is_plugged = argumentsProcessed.status === true;
    logOutHintTxtResultForItOnly += bState.dynamic.womb.is_plugged
      ? " 穴口已被堵死。"
      : " 塞子拔出，穴口大开。";
  }

  // 8. 清洗
  if (functionName === "bt_perform_vaginal_cleaning") {
    // 【核心修正】参数从 depth 改为 cleaning_type
    if (argumentsProcessed.cleaning_type === "deep") {
      bState.dynamic.womb.semen_volume = getRandomInt(0, 5);
      logOutHintTxtResultForItOnly += ` 深度清洗，子宫内仅残留 ${bState.dynamic.womb.semen_volume.toFixed(1)}ml。`;
    } else {
      // 浅层清洗，只减少少量
      bState.dynamic.womb.semen_volume = Math.max(
        0,
        bState.dynamic.womb.semen_volume - 10,
      );
      logOutHintTxtResultForItOnly += ` 浅层擦拭，浊液略微减少。`;
    }
  }

  // 9. 情欲
  // 【核心修正】参数从 lust_delta 改为 amount，并修复判断逻辑
  if (
    functionName === "bt_update_lust" &&
    argumentsProcessed.amount !== undefined
  ) {
    bState.dynamic.status.lust = Math.min(
      100,
      Math.max(
        0,
        bState.dynamic.status.lust + Number(argumentsProcessed.amount),
      ),
    );
    // 为了日志更清晰，可以添加一个情欲变化的提示
    logOutHintTxtResultForItOnly += ` 情欲值变动: ${argumentsProcessed.amount > 0 ? "+" : ""}${argumentsProcessed.amount}。`;
  }

  // ... (后续代码直到文件结尾，因为修改分散，这里提供完整的剩余部分) ...

  // 10. 行为清算与敏感度处刑引擎
  if (functionName === "bt_report_sexual_acts") {
    // ==========================================================
    // 【【【核心改造：纯洁度剥夺仪式】】】
    // ==========================================================
    // 首先，检查当前是否仍处于纯洁状态
    if (bState.dynamic.status.is_virgin === true) {
      // 检查本次上报的行为中，是否包含任何形式的“破处”行为
      // 我们将插入式性交（阴道或肛门）定义为破处的标准
      const pussyActs = argumentsProcessed.pussy || 0;
      const analActs = argumentsProcessed.anal || 0;

      if (pussyActs > 0 || analActs > 0) {
        // 条件满足，执行剥夺
        bState.dynamic.status.is_virgin = false;
        logOutHintTxtResultForItOnly += ` 【初次丧失】纯洁之身已被玷污！`;

        // 【联动机制】如果“第一次”的记录为空，则将本次的伴侣记录下来
        // 为此，我们需要bt_report_sexual_acts工具能提供伴侣名字
        if (
          !bState.dynamic.relationships.first_partner &&
          argumentsProcessed.partner_name
        ) {
          bState.dynamic.relationships.first_partner =
            argumentsProcessed.partner_name;
          logOutHintTxtResultForItOnly += ` 罪魁祸首 '${argumentsProcessed.partner_name}' 已被烙印为最初的掠夺者。`;
        }
      }
    }

    let modeMult = bState.semi_fixed.sensitivity_growth_mode;
    if (modeMult === undefined) modeMult = 1;

    let sensIncreases = { genital: 0, oral: 0, breast: 0, butt: 0 };
    let totalActs = 0;

    // 遍历 AI 呈上来的每一项罪状
    for (let key in argumentsProcessed) {
      if (Object.prototype.hasOwnProperty.call(argumentsProcessed, key)) {
        let count = Math.floor(argumentsProcessed[key]);
        if (count > 0 && bState.dynamic.experience[key] !== undefined) {
          // 【【【事实核查防线】】】
          // 只有当AI上报了插入行为时，才承认“中出”的有效性，防止幻觉。
          const hasInsertion =
            (argumentsProcessed.pussy || 0) > 0 ||
            (argumentsProcessed.anal || 0) > 0;
          if (key === "creampie_count" && !hasInsertion) {
            console.warn(
              `[Butter Tools] AI上报了 ${count} 次中出，但没有上报任何插入行为，已判定为幻觉并忽略。`,
            );
            continue; // 跳过本次循环，不累加这个无效的 creampie_count
          }
          // 【【【防线结束】】】
          // 【经验轨道】直接加上 AI 统计的次数
          bState.dynamic.experience[key] += count;
          totalActs += count;

          // ===== 【新增】高潮喷乳、挤奶与受孕计数 =====
          // 1. 若发生高潮，且已有身孕判定，补充受孕历史记录（防漏）
          if (
            bState.dynamic.status.is_pregnant &&
            bState.dynamic.experience.pregnancy_count === 0
          ) {
            bState.dynamic.experience.pregnancy_count = 1;
          }

          // 2. 乳房被触碰导致流失
          let breastPlayCount =
            (argumentsProcessed.breast || 0) + (argumentsProcessed.nipple || 0);
          if (breastPlayCount > 0 && bState.dynamic.metabolism.lactation > 0) {
            bState.dynamic.metabolism.lactation = Math.max(
              0,
              bState.dynamic.metabolism.lactation - 20,
            );
            logOutHintTxtResultForItOnly += ` [乳头刺激] 乳汁被挤压吸出，积乳压力稍减。`;
          }

          // 3. 高潮导致决堤喷乳 (需达到喷射阈值 80)
          let orgasmC = argumentsProcessed.orgasm_count || 0;
          if (orgasmC > 0 && bState.dynamic.metabolism.lactation >= 80) {
            bState.dynamic.metabolism.lactation = Math.max(
              0,
              bState.dynamic.metabolism.lactation - 30 * orgasmC,
            );
            logOutHintTxtResultForItOnly += ` [高潮喷乳] 剧烈的绝顶快感冲破了乳腺阀门，大量乳汁不受控制地喷射而出！`;
          }

          // 【敏感度轨道】将特定行为映射到对应部位，并乘以倍率
          if (modeMult > 0 && modeMult < 100) {
            // (如果不等于0和100，才进行数学叠加。0和100是锁死的死穴)
            if (key === "pussy" || key === "clitoris")
              sensIncreases.genital += count * modeMult;
            if (key === "oral") sensIncreases.oral += count * modeMult;
            if (key === "breast" || key === "nipple")
              sensIncreases.breast += count * modeMult;
            if (key === "butt" || key === "anal")
              sensIncreases.butt += count * modeMult;
          }
        }
      }
    }

    // 执行敏感度累加并封顶100
    if (modeMult > 0 && modeMult < 100) {
      bState.dynamic.sensitivity.genital = Math.min(
        100,
        bState.dynamic.sensitivity.genital + sensIncreases.genital,
      );
      bState.dynamic.sensitivity.oral = Math.min(
        100,
        bState.dynamic.sensitivity.oral + sensIncreases.oral,
      );
      bState.dynamic.sensitivity.breast = Math.min(
        100,
        bState.dynamic.sensitivity.breast + sensIncreases.breast,
      );
      bState.dynamic.sensitivity.butt = Math.min(
        100,
        bState.dynamic.sensitivity.butt + sensIncreases.butt,
      );
    }

    logOutHintTxtResultForItOnly += ` 【行为清算报告】接受了 ${totalActs} 次淫乱行为，敏感度依据倍率(x${modeMult})同步增长结算完毕！`;
  }
  // 11. 关系网络登记
  if (functionName === "bt_update_relationship") {
    let relType = argumentsProcessed.relation_type;
    let target = argumentsProcessed.target_name;
    if (
      relType &&
      target &&
      bState.dynamic.relationships[relType] !== undefined
    ) {
      bState.dynamic.relationships[relType] = target;
      bState.dynamic.relationships.recent_partner = target;
      logOutHintTxtResultForItOnly += ` 羁绊更新：${relType} 已记录为 ${target}。`;
    }
  }
  // 【【【新增：强制催乳工具处理】】】
  if (functionName === "bt_force_lactation") {
    const isStarting = argumentsProcessed.is_starting === true;
    // 我们在 semi_fixed 中添加一个临时旗标来记录这个状态
    bState.semi_fixed.is_force_lactating = isStarting;
    logOutHintTxtResultForItOnly += isStarting
      ? ` 【药物干预】因'${argumentsProcessed.reason}'，身体被强制进入产乳状态！`
      : ` 【药效结束】强制催乳效果已消退。`;
  }

  // 12. 生活状态评估、代谢钳制系统与液压涨奶引擎
  if (functionName === "bt_report_metabolism_changes") {
    let meta = bState.dynamic.metabolism;
    let hrs = argumentsProcessed.elapsed_hours || 0;

    // 【【【核心补完：基于剧情小时的浊液被动流出】】】
    // 只有在穴口未被堵住，且体内有存货时，才会发生流出。
    if (
      !bState.dynamic.womb.is_plugged &&
      bState.dynamic.womb.semen_volume > 0 &&
      hrs > 0
    ) {
      // 【问题4修正】使用在文件顶部定义的常量
      const totalLeakage = hrs * LEAKAGE_RATE_PER_HOUR;

      bState.dynamic.womb.semen_volume = Math.max(
        0,
        bState.dynamic.womb.semen_volume - totalLeakage,
      );

      logOutHintTxtResultForItOnly += ` [时间流逝] ${hrs}小时内，浊液自然流失了 ${totalLeakage.toFixed(1)}ml。`;
    }
    // 【【【补完结束】】】

    const oldTime = bState.dynamic.time_tracker.time; // 获取旧时间，如 "23:00"
    const newTime = argumentsProcessed.time_of_day; // 获取AI传入的新时间，如 "01:30"

    // 【重构：将跨天判断与时间推进逻辑合并】
    if (newTime && oldTime && newTime < oldTime) {
      // 如果检测到跨天...
      logOutHintTxtResultForItOnly += ` [午夜钟声] 时间从 ${oldTime} 跳跃至 ${newTime}，日期自动推进一天。`;

      // 【核心修改】调用 advanceDay(1) 并且不再手动修改时间。
      // advanceDay 应该负责所有与日期推进相关的事务。
      // 我们将把时间更新的逻辑移到 advanceDay 内部。
      // (此处的 await 确保了在执行后续代谢计算前，日期和周期已更新完毕)
      await advanceDay(1, newTime); // 将新时间作为参数传递

      // advanceDay 执行后，state 可能已更新，重新获取一下确保数据最新
      bState = getButterState();
      meta = bState.dynamic.metabolism;
    } else {
      // 如果没有跨天，仅更新时间
      if (newTime) {
        bState.dynamic.time_tracker.time = newTime;
      }
    }

    // 仅处理时间流逝对 last_update_timestamp 的影响，不再手动改时间
    if (hrs > 0) {
      bState.dynamic.time_tracker.last_update_timestamp -= hrs * 3600000;
    }

    // ==========================================================
    // 【【【A. 产乳资格综合校验系统 - 最终版】】】
    // ==========================================================
    let canLactate = false;
    const lacSet = bState.semi_fixed.lactation_setting;
    const isEstrus =
      bState.dynamic.status.menstrual_phase === "排卵期" ||
      bState.dynamic.succubus_status?.is_forced_estrus;

    // 规则1：检查是否处于药物强制催乳状态
    if (bState.semi_fixed.is_force_lactating === true) {
      canLactate = true;
    }
    // 规则2：随胸部开发度
    else if (lacSet === "随胸部开发度产乳") {
      if (bState.dynamic.sensitivity.breast >= 100) {
        canLactate = true;
      }
    }
    // 规则3：孕后哺乳期
    else if (lacSet === "孕后哺乳期产乳") {
      // 判断条件：已怀孕，或者曾经生过孩子
      if (
        bState.dynamic.status.is_pregnant ||
        bState.dynamic.relationships.children_list?.length > 0
      ) {
        canLactate = true;
      }
    }
    // 规则4：发情期
    else if (lacSet === "发情期产乳") {
      if (isEstrus) {
        canLactate = true;
      } else {
        // 如果设置是发情期产乳，但现在不在发情期，则强制归零
        meta.lactation = 0;
      }
    }
    // 规则5：高潮后产乳 - 这个规则不在此处处理积乳值累计，它的效果由提示词在 injectButterSystemPrompt 中实现

    // 【涨奶换算】：只有在有资格的情况下，才根据时间流逝和睡眠累计积乳值
    if (canLactate) {
      if (hrs > 0) {
        // 默认每2小时涨10ml，可调整
        meta.lactation += (hrs / 2) * 10;
      }
      if (argumentsProcessed.sleep_occurred) {
        // 睡眠额外奖励40ml
        meta.lactation += 40;
      }
    } else if (lacSet !== "发情期产乳") {
      // 如果无资格，并且不是“发情期产乳”模式（该模式有自己的归零逻辑），则蒸发积乳值
      meta.lactation = 0;
    }

    // B. 代谢系统的极值钳制与自然惩罚 (物理枷锁)
    // 约束规则：单次 AI 给出的变动绝对值不应超过 35，防止暴毙
    const applyClamp = (current, delta, min = 0, max = 100) => {
      let safeDelta = Math.max(-35, Math.min(35, delta || 0));
      return Math.max(min, Math.min(max, current + safeDelta));
    };

    meta.energy = applyClamp(meta.energy, argumentsProcessed.energy_change);
    meta.hunger = applyClamp(meta.hunger, argumentsProcessed.hunger_change);
    meta.cleanliness = applyClamp(
      meta.cleanliness,
      argumentsProcessed.cleanliness_change,
    );
    meta.social = applyClamp(meta.social, argumentsProcessed.social_change);

    // 睡眠恢复钳制
    if (argumentsProcessed.sleep_occurred)
      meta.energy = Math.min(100, meta.energy + 40);

    // 长时间不睡觉的极限惩罚 (防猝死系统)
    if (hrs > 12 && !argumentsProcessed.sleep_occurred) {
      meta.energy = Math.max(0, meta.energy - 30);
      logOutHintTxtResultForItOnly += ` [熬夜惩罚] 长时间未进入深度睡眠，生命精力出现极度亏损。`;
    }

    // 封顶
    meta.lactation = Math.min(120, meta.lactation); // 允许溢出一点点
    logOutHintTxtResultForItOnly += ` 生活评估通过，物理枷锁已校验生效。`;
  }
  if (functionName === "bt_give_birth") {
    if (bState.dynamic.status.is_pregnant) {
      // 清除所有怀孕相关的状态
      bState.dynamic.status.is_pregnant = false;
      bState.dynamic.status.ready_to_give_birth = false;
      bState.dynamic.status.pregnancy_start_date = null;
      bState.dynamic.status.is_pregnancy_known_to_user = false;

      // 如果关系中没有 children_list，则初始化
      if (!Array.isArray(bState.dynamic.relationships.children_list)) {
        bState.dynamic.relationships.children_list = [];
      }

      // 添加新的子嗣记录，并烙印下【分娩时的剧情日期】
      bState.dynamic.relationships.children_list.push({
        name: argumentsProcessed.child_name || "未命名",
        gender: argumentsProcessed.child_gender || "未知",
        birth_date: bState.dynamic.time_tracker.story_date, // 关键：记录剧情日期
      });

      logOutHintTxtResultForItOnly += `【新生命诞生】名为'${argumentsProcessed.child_name}'的子嗣已呱呱坠地，母体的子宫再度空虚。`;
    } else {
      logOutHintTxtResultForItOnly += `【逻辑错误】试图在未怀孕状态下执行分娩。`;
    }
  }

  saveButterState(bState);
  return logOutHintTxtResultForItOnly;
}
