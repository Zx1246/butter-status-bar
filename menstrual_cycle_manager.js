/* ====================================================
 * menstrual_cycle_manager.js (最终修正版)
 * 世界时钟、生理周期与暗影演算的统一引擎
 * ====================================================*/

import {
    getButterState,
    saveButterState,
    SETTINGS_KEY,
} from "./butter_state.js";
import { callExternalApi } from "./butter_tracker.js";

/**
 * 【终极版】生理周期计算引擎
 * 根据当前剧情日期和用户的周期设定，精确计算出所有周期状态。
 * @param {string} currentStoryDateStr - 当前的剧情日期 (YYYY-MM-DD)
 * @param {object} cycleBase - 包含周期设定的对象 { last_menstrual_start_date, average_cycle, menstrual_duration }
 * @returns {object} - 返回一个包含所有周期信息的对象
 */
function calculateMenstrualCycle(currentStoryDateStr, cycleBase) {
    const moment = SillyTavern.libs.moment;

    // 1. 安全校验，确保所有输入有效
    const baseDate = moment(cycleBase.last_menstrual_start_date, "YYYY-MM-DD");
    const currentDate = moment(currentStoryDateStr, "YYYY-MM-DD");
    if (!baseDate.isValid() || !currentDate.isValid()) {
        console.error("[Cycle Engine] 无效的基准日期或当前日期。");
        return {
            cycle_day: 1,
            menstrual_phase: "未知",
            day_in_phase: 1,
            total_in_phase: 0,
        };
    }

    const avgCycle = cycleBase.average_cycle || 28;
    const menstrualDuration = cycleBase.menstrual_duration || 5;

    // 2. 计算从基准日到今天总共过去了多少天
    const totalDaysElapsed = currentDate.diff(baseDate, "days");

    // 3. 计算当前在第几个周期的第几天（确保结果在 1 到 avgCycle 之间）
    let cycle_day = totalDaysElapsed % avgCycle;
    if (cycle_day < 0) {
        cycle_day += avgCycle; // 处理日期在基准日之前的情况
    }
    cycle_day += 1;

    // 4. 定义固定的排卵期和黄体期长度
    const LUTEAL_PHASE_LENGTH = 14;
    const OVULATION_WINDOW_LENGTH = 4;

    // 5. 动态计算各个阶段的起止点
    const menstrualEnd = menstrualDuration;
    const ovulationDay = avgCycle - LUTEAL_PHASE_LENGTH;
    const ovulationStart =
        ovulationDay - Math.floor(OVULATION_WINDOW_LENGTH / 2);
    const ovulationEnd = ovulationStart + OVULATION_WINDOW_LENGTH - 1;
    const follicularEnd = ovulationStart - 1;

    // 6. 判断当前阶段和阶段内天数
    let menstrual_phase = "";
    let day_in_phase = 0;
    let total_in_phase = 0;

    if (cycle_day <= menstrualEnd) {
        menstrual_phase = "生理期";
        day_in_phase = cycle_day;
        total_in_phase = menstrualDuration;
    } else if (cycle_day <= follicularEnd) {
        menstrual_phase = "卵泡期";
        day_in_phase = cycle_day - menstrualEnd;
        total_in_phase = follicularEnd - menstrualEnd;
    } else if (cycle_day <= ovulationEnd) {
        menstrual_phase = "排卵期";
        day_in_phase = cycle_day - follicularEnd;
        total_in_phase = OVULATION_WINDOW_LENGTH;
    } else {
        menstrual_phase = "黄体期";
        day_in_phase = cycle_day - ovulationEnd;
        total_in_phase = LUTEAL_PHASE_LENGTH;
    }

    // 7. 返回完整的计算结果
    return {
        cycle_day,
        menstrual_phase,
        day_in_phase,
        total_in_phase,
    };
}

/**
 * 独立的后台暗影演算函数
 * @param {number} daysToCalculate - 需要进行推演的天数
 * @param {object} initialState - 推演前的状态对象
 * @returns {Promise<{newState: object, log: string}>} - 返回经过演算后的新状态对象和日志
 */
async function performShadowCalculation(daysToCalculate, initialState) {
    let state = JSON.parse(JSON.stringify(initialState));
    let log = `正在进行时间推演，补全这 ${daysToCalculate} 天的遭遇档案...\n`;
    const context = SillyTavern.getContext();
    const moment = SillyTavern.libs.moment;

    try {
        if (
            !state.dynamic.womb.is_plugged &&
            state.dynamic.womb.semen_volume > 0
        ) {
            const LEAKAGE_RATE_PER_HOUR = 5;
            const totalLeakage = daysToCalculate * 24 * LEAKAGE_RATE_PER_HOUR;
            const oldVolume = state.dynamic.womb.semen_volume;
            state.dynamic.womb.semen_volume = Math.max(
                0,
                oldVolume - totalLeakage,
            );
            const actualLeakage = oldVolume - state.dynamic.womb.semen_volume;
            if (actualLeakage > 0) {
                log += `【后台演算】在这 ${daysToCalculate} 天里，体内浊液因重力自然流失了 ${actualLeakage.toFixed(1)}ml。\n`;
            }
        }
        const p = state.semi_fixed.pronoun || "她";
        const traits = state.semi_fixed.traits?.join(", ") || "无";
        const sensMode = state.semi_fixed.sensitivity_growth_mode;
        let sensDesc = "正常";
        if (sensMode === 0) sensDesc = "纯洁(几乎不增长)";
        else if (sensMode === 5) sensDesc = "加速";
        else if (sensMode === 10) sensDesc = "极速";
        else if (sensMode === 100) sensDesc = "已堕落(锁定全满)";
        const currentStoryDate = moment(
            state.dynamic.time_tracker.story_date,
        ).add(daysToCalculate, "days");
        const ageString = state.fixed.birthday
            ? `${currentStoryDate.diff(moment(state.fixed.birthday, "YYYY-MM-DD"), "years")}岁`
            : "未知";
        const characterProfileForAI = `- 种族: ${state.fixed.race}\n- 年龄: ${ageString}\n- 核心特征(Traits): ${traits}\n- 敏感度开发模式: ${sensDesc}\n- 当前孕期状态: ${state.dynamic.status.is_pregnant ? "怀孕中" : "未怀孕"}\n- 最近的性伴侣: ${state.dynamic.relationships.recent_partner || "无"}\n- 恋爱关系: ${state.dynamic.relationships.romance_partner || "无"}`;
        let shadowPrompt = `[系统底层暗影推演指令：时间跳跃]\n宿主的剧情时间被突然快进了 ${daysToCalculate} 天。\n你必须根据以下提供的宿主档案，推断${p}在这段空白期内最可能发生的遭遇。\n\n【宿主档案】\n${characterProfileForAI}\n\n【你的任务】\n基于以上档案，脑补这 ${daysToCalculate} 天内${p}在后台可能遭遇了多少次隐秘的性交、调教或自慰。\n请你务-必返回一个纯 JSON 对象，用来表示这几天内${p}各项肉体经验和敏感度的【增加量】。绝对不要输出任何其他解释文本！\nJSON 格式要求如下：\n{\n  "exp_add": { "oral": 5, "pussy": 10, "anal": 2, "creampie_count": 10, "orgasm_count": 15 },\n  "sens_add": { "genital": 20, "breast": 10 }\n}`;
        const pluginSettings = context.extensionSettings[SETTINGS_KEY] || {};
        let shadowRes;
        if (
            pluginSettings.useExternalCustomFetch &&
            pluginSettings.apiKey &&
            pluginSettings.apiUrl
        ) {
            shadowRes = await callExternalApi(shadowPrompt, pluginSettings);
        } else {
            shadowRes = await context.generateRaw({ prompt: shadowPrompt });
        }
        let responseText =
            typeof shadowRes === "object"
                ? JSON.stringify(shadowRes)
                : String(shadowRes);
        let match = responseText.match(/\{[\s\S]*\}/);
        if (match) {
            let calcData = JSON.parse(match[0]);
            if (calcData.exp_add) {
                for (let k in calcData.exp_add) {
                    if (state.dynamic.experience[k] !== undefined) {
                        state.dynamic.experience[k] += Number(
                            calcData.exp_add[k],
                        );
                    }
                }
            }
            if (calcData.sens_add) {
                for (let k in calcData.sens_add) {
                    if (state.dynamic.sensitivity[k] !== undefined) {
                        state.dynamic.sensitivity[k] += Number(
                            calcData.sens_add[k],
                        );
                    }
                }
            }
            log += `【推演完成】这段空白时光的经历已被静默记录。\n`;
        } else {
            log += "【推演失败】AI未能提供有效的后台记录。\n";
        }
    } catch (e) {
        log += `【推演异常】后台演算引擎出现故障: ${e.message}\n`;
    }
    return { newState: state, log };
}

/**
 * 推进时间，计算生理周期的轮转、魅魔饥饿度衰减，以及执行后台暗影推演
 * @param {number} days - 要推进的天数
 * @param {string | null} newTime - 可选参数，用于在跨天时直接设置新的时间 (格式 HH:mm)
 * @returns {Promise<string>} - 返回给系统的执行日志
 */
export async function advanceDay(days = 1, newTime = null) {
    let state = getButterState();
    if (!state) return "【报错：未发现肉体档案，无法推进时间】";

    let log = "";
    const p = state.semi_fixed.pronoun || "她";

    if (days > 1) {
        const calculationResult = await performShadowCalculation(days, state);
        state = calculationResult.newState;
        log += calculationResult.log;
    }

    const moment = SillyTavern.libs.moment;
    const currentStoryDate = moment(state.dynamic.time_tracker.story_date);
    const oldDateBeforeAdvance = currentStoryDate.clone(); // 保存推进前的日期
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

    log += `剧情时间推进了 ${days} 天，当前日期: ${state.dynamic.time_tracker.date}。\n`;

    if (state.fixed.race === "魅魔" && state.dynamic.succubus_status) {
        let soulContracts = state.dynamic.relationships.soul_contract || [];
        let hasSoulContract = soulContracts.length > 0;
        let dailyDecayRate = hasSoulContract ? 3 : 15;
        let totalDecay = dailyDecayRate * days;
        state.dynamic.succubus_status.hunger_percent = Math.max(
            0,
            state.dynamic.succubus_status.hunger_percent - totalDecay,
        );
        if (state.dynamic.succubus_status.hunger_percent <= 10) {
            state.dynamic.succubus_status.is_forced_estrus = true;
            log += "【警报】魔力在时间流逝中耗尽，强制发情启动！\n";
        }
    }

    if (state.dynamic.status.is_pregnant) {
        const pregnancyStartDate = moment(
            state.dynamic.status.pregnancy_start_date,
        );
        const elapsedDays = currentStoryDate.diff(pregnancyStartDate, "days");
        const elapsedMonths = (elapsedDays / 30).toFixed(1);
        const targetDurationMonths = state.semi_fixed.gestation_duration || 10;
        if (elapsedMonths >= targetDurationMonths) {
            state.dynamic.status.ready_to_give_birth = true;
            log += `腹中生命的孕育已达极限 (${elapsedMonths}个月)！即将分娩。\n`;
        } else {
            log += `胎儿已在腹中发育 ${elapsedMonths} 个月。\n`;
        }
    } else {
        const cycleInfo = calculateMenstrualCycle(
            state.dynamic.time_tracker.story_date,
            state.fixed.cycle_base,
        );
        state.dynamic.status.cycle_day = cycleInfo.cycle_day;
        state.dynamic.status.menstrual_phase = cycleInfo.menstrual_phase;

        if (cycleInfo.menstrual_phase === "生理期" && days > 0) {
            const oldCycleInfo = calculateMenstrualCycle(
                oldDateBeforeAdvance.format("YYYY-MM-DD"),
                state.fixed.cycle_base,
            );
            if (oldCycleInfo.menstrual_phase !== "生理期") {
                state.dynamic.womb.semen_volume = 0;
                state.dynamic.womb.semen_sources = [];
                log += "【经期降临】子宫内所有残留浊液已被彻底清空。\n";
            }
        }

        if (cycleInfo.menstrual_phase === "排卵期") {
            state.dynamic.status.egg_status = "卵子排出待受精";
        } else if (cycleInfo.menstrual_phase === "生理期") {
            state.dynamic.status.egg_status = "经血剥落排出";
        } else {
            state.dynamic.status.egg_status = "未排卵/内膜增厚中";
        }

        log += `生理周期已更新至【${cycleInfo.menstrual_phase}】(${cycleInfo.day_in_phase}/${cycleInfo.total_in_phase}天)。\n`;

        if (state.fixed.race === "魅魔") {
            const avgCycle = state.fixed.cycle_base.average_cycle || 28;
            const ovulationDay = avgCycle - 14;
            const ovulationStart = ovulationDay - 2;
            let daysToOvulation = 0;
            if (cycleInfo.cycle_day <= ovulationStart) {
                daysToOvulation = ovulationStart - cycleInfo.cycle_day;
            } else if (cycleInfo.cycle_day > ovulationStart + 3) {
                // 假设排卵窗口4天
                daysToOvulation =
                    avgCycle - cycleInfo.cycle_day + ovulationStart;
            }
            state.dynamic.succubus_status.estrus_days_remaining =
                daysToOvulation;
            log += `【魅魔本能】：${p}的发情期被生理周期锁定，距离下一次强制发情还有 ${daysToOvulation} 天。\n`;
        }
    }

    if (newTime) {
        state.dynamic.time_tracker.time = newTime;
    }

    saveButterState(state);
    const context = SillyTavern.getContext();
    if (context && context.eventSource) {
        context.eventSource.emit("BUTTER_DATA_UPDATED");
    }

    return log;
}

/**
 * 时间强制同步函数 (智能时间手术刀)
 * @param {string} newDateStr - 目标日期字符串
 * @param {string} newTimeStr - 目标时间字符串
 * @returns {Promise<string>} - 返回给系统的执行日志
 */
export async function setDateTime(newDateStr, newTimeStr) {
    let state = getButterState();
    if (!state) return "【报错：未发现肉体档案，无法设定时间】";

    const moment = SillyTavern.libs.moment;
    const newDateTime = moment(
        `${newDateStr} ${newTimeStr}`,
        "YYYY-MM-DD HH:mm",
    );

    if (!newDateTime.isValid()) {
        return `【时间设定失败】无效的日期或时间格式: ${newDateStr} ${newTimeStr}`;
    }

    const oldDateTime = moment(
        state.dynamic.time_tracker.story_date,
        "YYYY-MM-DD",
    );
    const daysDiff = newDateTime.diff(oldDateTime, "days");

    let log = `【时间强制同步】剧情时间线已重置为: ${newDateTime.format("YYYY年MM月DD日 HH:mm")}。\n`;

    if (daysDiff > 0) {
        log += `时间向前跳跃了 ${daysDiff} 天，开始同步身体状态...\n`;

        if (daysDiff >= 7) {
            const calculationResult = await performShadowCalculation(
                daysDiff,
                state,
            );
            state = calculationResult.newState;
            log += calculationResult.log;
        }

        if (!state.dynamic.status.is_pregnant) {
            const cycleInfo = calculateMenstrualCycle(
                newDateTime.format("YYYY-MM-DD"),
                state.fixed.cycle_base,
            );
            state.dynamic.status.cycle_day = cycleInfo.cycle_day;
            state.dynamic.status.menstrual_phase = cycleInfo.menstrual_phase;

            if (cycleInfo.menstrual_phase === "生理期") {
                const oldCycleInfo = calculateMenstrualCycle(
                    oldDateTime.format("YYYY-MM-DD"),
                    state.fixed.cycle_base,
                );
                if (oldCycleInfo.menstrual_phase !== "生理期") {
                    state.dynamic.womb.semen_volume = 0;
                    state.dynamic.womb.semen_sources = [];
                    log += "【经期降临】子宫内所有残留浊液已被彻底清空。\n";
                }
            }

            if (cycleInfo.menstrual_phase === "排卵期") {
                state.dynamic.status.egg_status = "卵子排出待受精";
            } else if (cycleInfo.menstrual_phase === "生理期") {
                state.dynamic.status.egg_status = "经血剥落排出";
            } else {
                state.dynamic.status.egg_status = "未排卵/内膜增厚中";
            }

            log += `生理周期已同步至【${cycleInfo.menstrual_phase}】(${cycleInfo.day_in_phase}/${cycleInfo.total_in_phase}天)。\n`;
        }

        if (state.fixed.race === "魅魔" && state.dynamic.succubus_status) {
            let soulContracts = state.dynamic.relationships.soul_contract || [];
            let hasSoulContract = soulContracts.length > 0;
            let dailyDecayRate = hasSoulContract ? 3 : 15;
            let totalDecay = dailyDecayRate * daysDiff;
            state.dynamic.succubus_status.hunger_percent = Math.max(
                0,
                state.dynamic.succubus_status.hunger_percent - totalDecay,
            );
            if (state.dynamic.succubus_status.hunger_percent <= 10) {
                state.dynamic.succubus_status.is_forced_estrus = true;
                log += "【魅魔警报】魔力在时间流逝中耗尽，强制发情启动！\n";
            } else {
                log += `魅魔饥饿度因时间流逝下降了 ${totalDecay}%。\n`;
            }
        }
    } else if (daysDiff < 0) {
        if (!state.dynamic.status.is_pregnant) {
            const cycleInfo = calculateMenstrualCycle(
                newDateTime.format("YYYY-MM-DD"),
                state.fixed.cycle_base,
            );
            state.dynamic.status.cycle_day = cycleInfo.cycle_day;
            state.dynamic.status.menstrual_phase = cycleInfo.menstrual_phase;
            log += `警告：时间发生倒流，生理周期已重新校准至【${cycleInfo.menstrual_phase}】(${cycleInfo.day_in_phase}/${cycleInfo.total_in_phase}天)。\n`;
        }
    }

    state.dynamic.time_tracker.story_date = newDateTime.format("YYYY-MM-DD");
    state.dynamic.time_tracker.date = newDateTime.format("YYYY年MM月DD日");
    state.dynamic.time_tracker.time = newDateTime.format("HH:mm");
    const weekdays = [
        "星期日",
        "星期一",
        "星期二",
        "星期三",
        "星期四",
        "星期五",
        "星期六",
    ];
    state.dynamic.time_tracker.weekday = weekdays[newDateTime.day()];

    saveButterState(state);
    const context = SillyTavern.getContext();
    if (context && context.eventSource) {
        context.eventSource.emit("BUTTER_DATA_UPDATED");
    }

    return log;
}
