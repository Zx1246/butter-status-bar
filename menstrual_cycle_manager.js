/* ====================================================
 * menstrual_cycle_manager.js
 * Butter Status 的世界时钟、生理周期与暗影演算引擎
 * 掌控时间的跨越，以及那些在阴暗角落里发生的堕落推演。
 * ====================================================*/

import { getButterState, saveButterState } from "./butter_state.js";
import { callExternalApi } from "./butter_tracker.js"; // 导入外部API调用函数

/**
 * 推进时间，计算生理周期的轮转、魅魔饥饿度衰减，以及执行后台暗影推演
 * @param {number} days 要推进的天数（支持 /advday N 跨越多天）
 */
export async function advanceDay(days = 1) {
    let state = getButterState();
    if (!state) return "【报错：未发现肉体档案，无法推进时间】";

    const p = state.semi_fixed.pronoun || "她"; // 提取代词
    const context = SillyTavern.getContext(); // 在此处统一声明唯一一个 context

    // 【核心修正】使用官方推荐的 context.timestampToMoment 来安全地调用 moment.js
    const moment = SillyTavern.libs.moment;
    const currentStoryDate = moment(state.dynamic.time_tracker.story_date);

    currentStoryDate.add(days, "days");
    state.dynamic.time_tracker.story_date =
        currentStoryDate.format("YYYY-MM-DD");
    state.dynamic.time_tracker.date = currentStoryDate.format("YYYY年MM月DD日");
    const weekdays = [
        "星期日",
        "星期一",
        "星期二",
        "星期三",
        "星期四",
        "星期五",
        "星期六",
    ];
    state.dynamic.time_tracker.weekday = weekdays[currentStoryDate.day()];

    let log = `剧情时间推进了 ${days} 天，当前日期: ${state.dynamic.time_tracker.date}。\n`;

    // ==========================================
    // 【新机制：魅魔生态的饥饿衰减与强制发情】
    // ==========================================
    if (state.fixed.race === "魅魔" && state.dynamic.succubus_status) {
        let soulContracts = state.dynamic.relationships.soul_contract || [];
        let hasSoulContract = soulContracts.length > 0;

        // 如果有灵魂饭票，通过以太吸收精气，每天饥饿流失速度锐减
        let dailyDecayRate = hasSoulContract ? 3 : 15;
        let totalDecay = dailyDecayRate * days;

        state.dynamic.succubus_status.hunger_percent -= totalDecay;
        state.dynamic.succubus_status.hunger_percent = Math.max(
            0,
            state.dynamic.succubus_status.hunger_percent,
        );

        state.dynamic.succubus_status.estrus_days_remaining = Math.max(
            0,
            state.dynamic.succubus_status.estrus_days_remaining - days,
        );

        if (state.dynamic.succubus_status.hunger_percent <= 10) {
            state.dynamic.succubus_status.is_forced_estrus = true;
            log +=
                "【警报】魔力濒临干涸！饥饿度跌破10%，催淫机制强行启动，渴求精液的本本能已被触发。\n";
        } else {
            if (hasSoulContract)
                log += `得益于灵魂契约的供养，饥饿值仅微弱下降了 ${totalDecay}%。\n`;
            else
                log += `魔力急剧流失 ${totalDecay}%，她变得越来越虚弱与饥渴了。\n`;
        }
    }

    // ==========================================
    // 【核心修正：暗影演算 (时间跳跃智能推演)】
    // ==========================================
    if (days > 1) {
        log += `正在进行时间推演，补全这 ${days} 天的遭遇档案...\n`;
        try {
            let shadowPrompt = `[系统底层暗影推演指令：时间跳跃]
宿主的剧情时间被突然快进了 ${days} 天。
请你根据宿主的种族（${state.fixed.race}）、年龄设定、当前孕期状态（${state.dynamic.status.is_pregnant}）以及通常的情欲惯性，自行脑补这 ${days} 天内她在后台可能遭遇了多少次隐秘的性交、调教或自慰。
请你务必返回一个纯 JSON 对象，用来表示这几天内她各项肉体经验和敏感度的【增加量】。绝对不要输出任何其他解释文本！
JSON 格式要求如下：
{
  "exp_add": { "oral": 5, "pussy": 10, "anal": 2, "creampie_count": 10, "orgasm_count": 15 },
  "sens_add": { "genital": 20, "breast": 10 }
}`;

            // 【智能选择API】
            const pluginSettings =
                context.extensionSettings.butterPluginSettings || {};
            let shadowRes;

            if (
                pluginSettings.useExternalCustomFetch &&
                pluginSettings.apiKey &&
                pluginSettings.apiUrl
            ) {
                console.log("[AdvDay] 检测到外部API配置，暗影演算强制引流...");
                shadowRes = await callExternalApi(shadowPrompt, pluginSettings);
            } else {
                console.log("[AdvDay] 使用酒馆内置API进行暗影演算...");
                // 【核心修正】移除 generateRaw 中无效的 quiet: true 参数
                shadowRes = await context.generateRaw({
                    prompt: shadowPrompt,
                });
            }

            // 提取并解析返回的JSON
            let responseText =
                typeof shadowRes === "object"
                    ? JSON.stringify(shadowRes)
                    : String(shadowRes);
            let match = responseText.match(/\{[\s\S]*\}/);

            if (match) {
                let calcData = JSON.parse(match[0]);
                // 将大模型脑补出的堕落数值狠狠地砸进档案里
                if (calcData.exp_add) {
                    for (let k in calcData.exp_add) {
                        if (state.dynamic.experience[k] !== undefined)
                            state.dynamic.experience[k] += Number(
                                calcData.exp_add[k],
                            );
                    }
                }
                if (calcData.sens_add) {
                    for (let k in calcData.sens_add) {
                        if (state.dynamic.sensitivity[k] !== undefined)
                            state.dynamic.sensitivity[k] += Number(
                                calcData.sens_add[k],
                            );
                    }
                }
                log += `【推演完成】这段空白时光的经历已被静默记录。\n`;
            } else {
                console.warn("暗影演算未能返回有效的JSON数据。");
                log += "【推演失败】AI未能提供有效的后台记录。\n";
            }
        } catch (e) {
            console.error("暗影演算执行失败。", e);
            log += `【推演异常】后台演算引擎出现故障: ${e.message}\n`;
        }
    }

    // ==========================================
    // 【孕期与生理周期的无情推进】
    // ==========================================
    if (state.dynamic.status.is_pregnant) {
        // ====================【手术切口】====================
        // 1. 安全地获取 moment 库
        const moment = SillyTavern.libs.moment;

        // 2. 使用 moment 直接解析正确的键 'pregnancy_start_date' (YYYY-MM-DD 字符串)
        const pregnancyStartDate = moment(
            state.dynamic.status.pregnancy_start_date,
        );

        // 3. currentStoryDate 已经在函数开头被创建，这里直接使用它来计算差值
        const elapsedDays = currentStoryDate.diff(pregnancyStartDate, "days");
        const elapsedMonths = (elapsedDays / 30).toFixed(1);
        const targetDurationMonths = state.semi_fixed.gestation_duration || 10;
        // ===================================================

        if (elapsedMonths >= targetDurationMonths) {
            state.dynamic.status.ready_to_give_birth = true;
            state.dynamic.status.egg_status = "【临盆在即/羊水已破】";
            log += `腹中生命的孕育已达极限 (${elapsedMonths}个月)！即将分娩。`;
        } else {
            state.dynamic.status.egg_status = `孕育胚胎中 (${elapsedMonths}个月)`;
            log += `胎儿已在腹中发育 ${elapsedMonths} 个月。`;
        }
    } else {
        // 没怀孕，则推进生理周期
        if (typeof state.dynamic.status.cycle_day !== "number")
            state.dynamic.status.cycle_day = 1;

        const cycleBase = state.fixed.cycle_base;
        const avgCycle = cycleBase.average_cycle || 28;
        // 容错处理：如果 phase_lengths 不存在，给一个安全默认值
        const lengths = cycleBase.phase_lengths || {
            menstrual: 5,
            follicular: 7,
            ovulation: 3,
            luteal: 13,
        };

        const prevDay = state.dynamic.status.cycle_day;
        state.dynamic.status.cycle_day = ((prevDay - 1 + days) % avgCycle) + 1;
        const currentDayInCycle = state.dynamic.status.cycle_day;

        let newPhase = "";
        const menstrualEnd = lengths.menstrual;
        const follicularEnd = menstrualEnd + lengths.follicular;
        const ovulationEnd = follicularEnd + lengths.ovulation;

        if (currentDayInCycle <= menstrualEnd) {
            newPhase = "生理期";
            if (prevDay > menstrualEnd || days >= avgCycle) {
                state.dynamic.womb.semen_volume = 0;
                state.dynamic.womb.semen_sources = [];
                log += "【经期降临】子宫内所有残留浊液已被彻底清空。\n";
            }
        } else if (currentDayInCycle <= follicularEnd) {
            newPhase = "卵泡期";
        } else if (currentDayInCycle <= ovulationEnd) {
            newPhase = "排卵期";
        } else {
            newPhase = "黄体期";
        }

        state.dynamic.status.menstrual_phase = newPhase;

        if (newPhase === "生理期")
            state.dynamic.status.egg_status = "经血剥落排出";
        else if (newPhase === "排卵期")
            state.dynamic.status.egg_status = "卵子排出待受精";
        else state.dynamic.status.egg_status = "未排卵/内膜增厚中";

        log += `当前周期第 ${currentDayInCycle} 天，阶段沦为：【${newPhase}】。`;

        // --- 魅魔发情状态强制与排卵期绑定 ---
        if (state.fixed.race === "魅魔") {
            state.dynamic.status.estrus_status =
                newPhase === "排卵期" ? "发情期" : "未发情";

            // 已将此处的变量名错误 currentDay 修正为 currentDayInCycle
            let daysToOvulation;
            if (currentDayInCycle > ovulationEnd) {
                // 在黄体期，等下一个周期
                daysToOvulation =
                    avgCycle - currentDayInCycle + menstrualEnd + 1;
            } else if (currentDayInCycle > follicularEnd) {
                // 正在排卵期
                daysToOvulation = 0;
            } else {
                // 在生理期或卵泡期
                daysToOvulation = follicularEnd - currentDayInCycle + 1;
            }
            state.dynamic.succubus_status.estrus_days_remaining =
                daysToOvulation;
            log += `\n【魅魔本能】：${p}的发情期被生理周期锁定，距离下一次强制发情还有 ${daysToOvulation} 天。`;
        }
    }

    // 保存数据并通知前端更新 UI
    saveButterState(state);
    if (context && context.eventSource) {
        context.eventSource.emit("BUTTER_DATA_UPDATED");
    }
    return log;
}
