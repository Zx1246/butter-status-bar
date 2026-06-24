// ==========================================
// butter_tools.js
// 黑暗手术刀：AI专用的强制修改工具集 (堕胎/魅魔供能/灵魂契约 已装载)
// ==========================================

import { getButterState, saveButterState } from "./butter_state.js";

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
    // ... 其他已有的工具定义保留原样 ...
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
                    description:
                        "是否处于阴道阻塞状态。（是为true，否为false）",
                },
            },
            required: ["status"],
        },
    },
    {
        name: "bt_perform_vaginal_cleaning",
        description:
            "清理下体时调用。深入子宫设为'deep'；擦拭外面设为'shallow'。",
        parameters: {
            type: "object",
            properties: {
                cleaning_type: {
                    type: "string",
                    description:
                        "清理类型。'deep'表示深入子宫，'shallow'表示擦拭外面。",
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
            "当剧情中发生任何形式的肉体猥亵、性交或性侵时调用。你只需要上报各种行为发生的【大致次数】或参与的【野男人数量】，不需要考虑敏感度。系统会在后台根据设定自动惩罚她的肉体。",
        parameters: {
            type: "object",
            properties: {
                exposure: { type: "number", description: "露出/羞耻展出次数" },
                oral: { type: "number", description: "被口交/强制深喉次数" },
                breast: { type: "number", description: "乳房被玩弄次数" },
                nipple: {
                    type: "number",
                    description: "乳头被重点刺激/掐捏次数",
                },
                pussy: {
                    type: "number",
                    description: "小穴被手指/道具/肉棒抽插玩弄次数",
                },
                clitoris: { type: "number", description: "阴蒂被玩弄次数" },
                butt: { type: "number", description: "臀部被揉捏/抽打次数" },
                anal: { type: "number", description: "肛交/异物塞入后庭次数" },
                partners_count: {
                    type: "number",
                    description: "本次剧情中新增的性伴侣/施暴者数量",
                },
                masturbation_count: {
                    type: "number",
                    description: "被迫/主动自慰次数",
                },
                creampie_count: {
                    type: "number",
                    description:
                        "内射/中出次数（注意此处的内射包含全身上下的灌注体验）",
                },
                semen_bath_count: {
                    type: "number",
                    description: "精浴/被颜射/大量精液涂抹次数",
                },
                orgasm_count: { type: "number", description: "绝顶高潮的次数" },
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
                    description:
                        "推测当前大致时间段（如：清晨、中午、傍晚、深夜。无法判断留空）",
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
 * @returns {string} 返回给系统的执行结果日志
 */
export function handleToolExecution(functionName, args) {
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

            bState.dynamic.womb.semen_sources.push({
                source: sourceName,
                volume: volumeToInject,
                time: new Date().toLocaleTimeString(),
            });
            if (bState.dynamic.womb.semen_sources.length > 10)
                bState.dynamic.womb.semen_sources.shift();

            logOutHintTxtResultForItOnly += ` 无套中出！注入 ${volumeToInject}ml 浓精。`;

            // 【核心机制：受孕概率轮盘】
            if (
                !bState.semi_fixed.disable_pregnancy &&
                !bState.dynamic.status.is_pregnant &&
                bState.dynamic.status.contraception_status === "无"
            ) {
                let prob = 0;
                let day = bState.dynamic.status.cycle_day || 1;
                let phase = bState.dynamic.status.menstrual_phase;
                let lengths = bState.fixed.cycle_base.phase_lengths;
                let ovulationEndDay =
                    lengths.menstrual + lengths.follicular + lengths.ovulation;
                let lutealEndDay = ovulationEndDay + lengths.luteal;

                if (phase === "生理期") prob = 0;
                else if (phase === "排卵期" || phase === "发情期")
                    prob = day === ovulationEndDay ? 80 : 40;
                else {
                    let isSafe =
                        (phase === "卵泡期" && day <= lengths.menstrual + 3) ||
                        (phase === "黄体期" && day > lutealEndDay - 4);
                    prob = isSafe ? 5 : 10;
                }

                let roll = getRandomInt(1, 100);
                if (roll <= prob) {
                    bState.dynamic.status.is_pregnant = true;
                    bState.dynamic.experience.pregnancy_count += 1;
                    // ====================【手术切口】====================
                    // 不再使用现实世界时间，而是记录下此刻的【剧情日期】。
                    // 这个日期是 'YYYY-MM-DD' 格式的字符串，与您的时间推进系统完全同步。
                    bState.dynamic.status.pregnancy_start_date =
                        bState.dynamic.time_tracker.story_date;
                    // ===================================================
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
        let modeMult = bState.semi_fixed.sensitivity_growth_mode;
        if (modeMult === undefined) modeMult = 1;

        let sensIncreases = { genital: 0, oral: 0, breast: 0, butt: 0 };
        let totalActs = 0;

        // 遍历 AI 呈上来的每一项罪状
        for (let key in argumentsProcessed) {
            if (Object.prototype.hasOwnProperty.call(argumentsProcessed, key)) {
                let count = Math.floor(argumentsProcessed[key]);
                if (count > 0 && bState.dynamic.experience[key] !== undefined) {
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
                        (argumentsProcessed.breast || 0) +
                        (argumentsProcessed.nipple || 0);
                    if (
                        breastPlayCount > 0 &&
                        bState.dynamic.metabolism.lactation > 0
                    ) {
                        bState.dynamic.metabolism.lactation = Math.max(
                            0,
                            bState.dynamic.metabolism.lactation - 20,
                        );
                        logOutHintTxtResultForItOnly += ` [乳头刺激] 乳汁被挤压吸出，积乳压力稍减。`;
                    }

                    // 3. 高潮导致决堤喷乳 (需达到喷射阈值 80)
                    let orgasmC = argumentsProcessed.orgasm_count || 0;
                    if (
                        orgasmC > 0 &&
                        bState.dynamic.metabolism.lactation >= 80
                    ) {
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
                        if (key === "oral")
                            sensIncreases.oral += count * modeMult;
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

    // 12. 生活状态评估、代谢钳制系统与液压涨奶引擎
    if (functionName === "bt_report_metabolism_changes") {
        let meta = bState.dynamic.metabolism;
        let hrs = argumentsProcessed.elapsed_hours || 0;

        // 时间推进器
        if (hrs > 0)
            bState.dynamic.time_tracker.last_update_timestamp -= hrs * 3600000;
        if (argumentsProcessed.time_of_day)
            bState.dynamic.time_tracker.time = argumentsProcessed.time_of_day;

        // A. 产乳资格综合校验系统 (Can Lactate?)
        let canLactate = false;
        let lacSet = bState.semi_fixed.lactation_setting;
        if (
            lacSet === "随胸部开发度产乳" &&
            bState.dynamic.sensitivity.breast >= 100
        )
            canLactate = true;
        else if (
            lacSet === "孕后哺乳期产乳" &&
            (bState.dynamic.status.is_pregnant ||
                bState.dynamic.relationships.children_list?.length > 0)
        )
            canLactate = true;
        else if (
            lacSet === "发情期产乳" &&
            (bState.dynamic.status.menstrual_phase === "排卵期" ||
                bState.dynamic.succubus_status?.is_forced_estrus)
        )
            canLactate = true;
        else if (lacSet === "高潮后产乳") canLactate = true;

        // 涨奶换算：有资格且经过了时间或睡眠
        if (canLactate) {
            if (hrs > 0) meta.lactation += (hrs / 2) * 10;
            if (argumentsProcessed.sleep_occurred) meta.lactation += 40;
        } else {
            meta.lactation = 0; // 无资格直接蒸发
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
