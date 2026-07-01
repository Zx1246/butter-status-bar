/* ====================================================
 * 【最终重构版】 index.js
 * 主逻辑控制器
 *
 * 设计理念:
 * 1. 引导程序优先: 采用 bootstrap() 作为唯一的、可靠的初始化入口，管理所有核心功能的加载与事件绑定。
 * 2. 状态驱动UI: 所有UI的更新都由后台状态的变化驱动，确保数据的一致性。
 * 3. 无损注入: 使用官方推荐的 /inject 命令注入状态，不干扰作者笔记。
 * 4. 可靠追踪: 监听 generation_ended 事件，确保每次对话后都能成功触发后台状态分析。
 * 5. 动态同步: 监听全局设置和世界书的更新事件，实时刷新注入面板。
 * ====================================================*/

// 导入依赖模块
import { updateStatusPanels } from "./butter_renderer.js";
import {
    deleteUserPreset,
    getButterState,
    getUserPresets,
    loadUserPresetIntoChat,
    registerButterUser,
    saveButterState,
    saveUserPreset,
    SETTINGS_KEY, // 【问题7修正】从 state.js 导入唯一的常量
} from "./butter_state.js";
import {
    buildSystemWrapper,
    callExternalApi,
    injectButterSystemPrompt,
    runButterTrackingEngine,
    updateDebugPanelIO, // 使用新的专用函数更新Debug IO
} from "./butter_tracker.js";
import { advanceDay, setDateTime } from "./menstrual_cycle_manager.js";
import { succubusPrompts } from "./prompts.js";

// 获取酒馆核心上下文
const context = SillyTavern.getContext();
const { eventSource, event_types, extensionSettings } = context;

// 定义常量
const PLUGIN_DIR = "scripts/extensions/third-party/butter-status-bar";
// 【问题7修正】移除了本地的 SETTINGS_KEY 定义
const ROOT_CONTAINER_ID = "butter-root-container";
const BOOTSTRAP_RUNTIME_KEY = "__butter_bootstrap_runtime__";
const APP_READY_HANDLER_KEY = "__butter_app_ready_handler__";

/**
 * 【新增的辅助函数】
 * 异步获取当前角色链接的世界书和已启用的全局世界书列表。
 * @returns {Promise<{characterBooks: string[], globalBooks: string[]}>}
 */
async function getAvailableWorldBooks() {
    const context = SillyTavern.getContext();
    const characterId = context.characterId;
    const character = context.characters[characterId];

    // 1. 同步获取角色世界书列表
    const characterBooks =
        character && character.world_books ? character.world_books : [];

    // 2. 异步获取全局世界书列表
    let globalBooks = [];
    try {
        // 执行酒馆内部命令，查询全局世界书变量
        const result = await context.executeSlashCommandsWithOptions(
            // <--- 正确的调用方式
            "/getvar name=world_info.globalSelect",
        );

        // 命令成功执行且管道中有返回数据
        if (result && !result.isError && result.pipe) {
            // 返回的通常是一个JSON字符串数组，需要解析
            const parsedPipe = JSON.parse(result.pipe);
            if (Array.isArray(parsedPipe)) {
                globalBooks = parsedPipe;
            }
        }
    } catch (e) {
        console.error("[Butter] 使用/getvar获取全局世界书列表时发生错误:", e);
    }

    console.log("[Butter] 世界书扫描完成:", { characterBooks, globalBooks });
    return { characterBooks, globalBooks };
}

// ==========================================
// 1. UI管理器 (View Manager)
// (保留您原有的优秀设计)
// ==========================================
const uiManager = {
    isInjectPanelInitialized: false,

    switchView(targetId) {
        const root = $(`#${ROOT_CONTAINER_ID}`);
        if (!root.length) return;

        try {
            const titleMap = {
                "butter-tab-home": "系统首页",
                "butter-tab-overview": "档案概览",
                "butter-tab-body": "肉体开发",
                "butter-tab-history": "底层经历",
                "butter-tab-special": "特殊设定",
                "butter-tab-skills": "特殊技能",
                "butter-tab-succubus": "魅魔状态",
                "butter-tab-inject": "属性注入",
                "butter-tab-register": "特征登入",
                "butter-tab-api": "外部链路",
                "butter-tab-debug": "状态监控",
                "butter-tab-theme": "视觉微调",
            };

            const activeId = root.find(`#${targetId}`).length
                ? targetId
                : "butter-tab-home";
            let finalTitle = titleMap[activeId] || "系统首页";
            root.find("#butter-page-title-tag").text(finalTitle.trim());
        } catch (e) {
            console.error("[Butter UI] 动态标题提前同步失败:", e);
        }

        root.find(".butter-tab-content").hide();
        root.find(".butter-tab").removeClass("active");

        const targetPanel = root.find(`#${targetId}`);
        if (targetPanel.length) {
            targetPanel.fadeIn(200);
        } else {
            console.warn(
                `[Butter UI] 视图切换失败，未找到目标面板: #${targetId}`,
            );
            root.find("#butter-tab-home").fadeIn(200);
            root.find('.butter-tab[data-target="butter-tab-home"]').addClass(
                "active",
            );
            return;
        }

        const correspondingTab = root.find(
            `.butter-tab[data-target="${targetId}"]`,
        );
        if (correspondingTab.length) {
            correspondingTab.addClass("active");
        }

        // 逻辑修正：不再使用 isInjectPanelInitialized 标志，每次都强制刷新
        if (targetId === "butter-tab-inject") {
            initInjectPanel();
        }
        if (targetId === "butter-tab-register") {
            refreshPresetList();
        }
    },
};

// ==========================================
// 2. 核心功能组件 (拖拽与响应式) - 【移动端抗干扰完美修复版】
// ==========================================
function makeDraggable(triggerEl, targetEl) {
    if (!triggerEl || !targetEl) return;

    // 【新增】强制告知浏览器，此区域的触摸事件由我JS接管，不要自作主张滚动页面
    triggerEl.style.touchAction = "none";

    let pos = { x: 0, y: 0, startX: 0, startY: 0 };
    let isDragging = false;
    const noDragTags = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"];

    function onPointerDown(e) {
        if (
            noDragTags.includes(e.target.tagName) ||
            $(e.target).closest(
                ".menu_button, .butter-nav-btn, .butter-tab, #butter-page-title-tag",
            ).length > 0
        ) {
            return;
        }

        // 【修正】在开始拖拽时，如果元素还在使用transform，先清除它
        if (targetEl.style.transform) {
            targetEl.style.transform = "none";
        }

        const rect = targetEl.getBoundingClientRect();
        pos.startX = e.clientX;
        pos.startY = e.clientY;
        pos.x = rect.left;
        pos.y = rect.top;

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        triggerEl.style.cursor = "grabbing";
        targetEl.style.userSelect = "none";

        if (e.cancelable) e.preventDefault();
    }

    function onPointerMove(e) {
        if (
            !isDragging &&
            (Math.abs(e.clientX - pos.startX) > 5 ||
                Math.abs(e.clientY - pos.startY) > 5)
        ) {
            isDragging = true;
            targetEl.style.position = "fixed";
            targetEl.style.margin = "0";
            // 确保在拖动开始时清除 transform
            if (targetEl.style.transform) {
                targetEl.style.transform = "none";
            }
        }

        if (isDragging) {
            const dx = e.clientX - pos.startX;
            const dy = e.clientY - pos.startY;
            let newLeft = pos.x + dx;
            let newTop = pos.y + dy;
            const rect = targetEl.getBoundingClientRect();

            // 【核心优化】移动端自适应边界流溢处理，防止大组件在小视口中计算出 0 导致死锁
            const maxLeft = window.innerWidth - rect.width;
            const maxTop = window.innerHeight - rect.height;

            if (maxLeft > 0) {
                newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            } else {
                // 允许超宽组件在负坐标滑动，以便用户能看到所有内容
                newLeft = Math.max(maxLeft, Math.min(newLeft, 0));
            }

            if (maxTop > 0) {
                newTop = Math.max(0, Math.min(newTop, maxTop));
            } else {
                // 允许超高组件上下滑动，绝不死锁在0
                newTop = Math.max(maxTop, Math.min(newTop, 0));
            }

            targetEl.style.left = `${newLeft}px`;
            targetEl.style.top = `${newTop}px`;
            targetEl.style.right = "auto";
            targetEl.style.bottom = "auto";
        }
    }

    function onPointerUp() {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        triggerEl.style.cursor = "grab";
        targetEl.style.userSelect = "";

        if (isDragging) {
            const rect = targetEl.getBoundingClientRect();
            // 在拖动结束后，不再使用百分比定位，因为这会导致resize时的跳动。
            // 直接保持像素定位即可。
            targetEl.style.left = `${rect.left}px`;
            targetEl.style.top = `${rect.top}px`;
        }

        setTimeout(() => {
            isDragging = false;
        }, 50);
    }

    triggerEl.style.cursor = "grab";
    triggerEl.addEventListener("pointerdown", onPointerDown);
}

// 【核心优化】规避移动端软键盘唤起、手机工具栏缩进导致的强制吸顶误杀
window.addEventListener("resize", () => {
    // 移动端若检测到输入框正在聚焦（证明键盘拉起），直接跳过防止布局踩踏吸顶
    if (
        /Mobi|Android|iPhone/i.test(navigator.userAgent) &&
        (document.activeElement.tagName === "INPUT" ||
            document.activeElement.tagName === "TEXTAREA")
    ) {
        return;
    }

    const modal = document.getElementById("butter-status-modal");
    if (!modal || modal.style.display === "none") return;

    // 清理可能残留的transform属性
    if (modal.style.transform) {
        const rect = modal.getBoundingClientRect();
        modal.style.transform = "none";
        modal.style.left = `${rect.left}px`;
        modal.style.top = `${rect.top}px`;
    }

    const rect = modal.getBoundingClientRect();

    // 如果面板完全在视口内，则不做任何处理
    if (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight
    ) {
        return;
    }

    // 否则，进行边界修正
    let newLeft = Math.max(
        0,
        Math.min(rect.left, window.innerWidth - rect.width),
    );
    let newTop = Math.max(
        0,
        Math.min(rect.top, window.innerHeight - rect.height),
    );

    modal.style.left = `${newLeft}px`;
    modal.style.top = `${newTop}px`;
});

window.addEventListener("resize", () => {
    const modal = document.getElementById(ROOT_CONTAINER_ID);
    if (!modal || modal.style.display === "none") return;
    const rect = modal.getBoundingClientRect();
    if (modal.style.margin && modal.style.margin !== "0px") {
        return;
    }
    let currentLeft = rect.left;
    let currentTop = rect.top;
    let changed = false;
    if (currentLeft + rect.width > window.innerWidth) {
        currentLeft = Math.max(0, window.innerWidth - rect.width - 10);
        changed = true;
    }
    if (currentTop + rect.height > window.innerHeight) {
        currentTop = Math.max(0, window.innerHeight - rect.height - 10);
        changed = true;
    }
    if (changed) {
        modal.style.left = `${(currentLeft / window.innerWidth) * 100}%`;
        modal.style.top = `${(currentTop / window.innerHeight) * 100}%`;
    }
});

// ==========================================
// 3. 插件生命周期管理 (全新引导程序)
// ==========================================

/**
 * 插件的唯一入口和主电源开关。
 * APP_READY 后执行，负责加载UI，绑定所有核心事件。
 */
async function bootstrap() {
    // 防止重复初始化
    if (globalThis[BOOTSTRAP_RUNTIME_KEY]) return;
    globalThis[BOOTSTRAP_RUNTIME_KEY] = true;

    console.log("[Butter Status] Bootstrap sequence initiated...");

    try {
        await ensureSettings();
        await ensureModalAndBindEvents();
        registerButterCommands();

        // 绑定所有必需的全局事件
        bindGlobalEventListeners();

        // 首次加载，执行一次状态检查与UI刷新
        onChatOrLoad();

        console.log(
            "[Butter Status] Bootstrap complete. System is fully operational.",
        );
    } catch (error) {
        console.error(
            "[Butter Status] Bootstrap failed catastrophically:",
            error,
        );
        toastr.error(
            "Butter Status 插件引导失败，请检查F12控制台。",
            "致命错误",
        );
        globalThis[BOOTSTRAP_RUNTIME_KEY] = false; // 允许重试
    }
}

/**
 * 确保插件设置存在
 */
async function ensureSettings() {
    // 【核心修正】实时获取最新的 settings 对象，而非使用文件顶部的陈旧快照。
    const liveSettings = SillyTavern.getContext().extensionSettings;
    if (!liveSettings[SETTINGS_KEY]) {
        liveSettings[SETTINGS_KEY] = {
            enablePlugin: true,
            useExternalCustomFetch: false,
            apiUrl: "",
            apiKey: "",
            apiModelName: "",
            apiStream: false,
            apiHistoryCount: 10,
            apiRegexFilter: "",
            injectPreset: "default",
            wiMode: "normal",
            wiBlacklist: [],
            wiWhitelist: [],
            user_presets: [],
        };
        // 使用全局的 context 引用进行保存
        context.saveSettingsDebounced();
    }
}

/**
 * 确保UI模态框被加载并绑定所有内部事件
 */
async function ensureModalAndBindEvents() {
    if ($(`#${ROOT_CONTAINER_ID}`).length) return;

    const mainUiHtml = await $.get(`/${PLUGIN_DIR}/ui.html`);
    $("body").append(mainUiHtml);

    // 绑定所有UI面板的交互事件
    bindMasterUIEvents();
    populateDefaultPrompts();
}

/**
 * 切换聊天或首次加载时触发的函数
 */
function onChatOrLoad() {
    console.log(
        "[Butter Status] CHAT_CHANGED/LOAD event triggered. Refreshing state...",
    );
    const state = getButterState();

    if (state) {
        uiManager.switchView("butter-tab-home");
    } else {
        uiManager.switchView("butter-tab-register");
        toastr.info(
            "当前角色尚未注册肉体档案，请先完成烙印。",
            "Butter Status",
        );
    }

    updateAllDynamicUI(state);
    injectButterSystemPrompt();

    // 强制刷新注入面板的数据
    initInjectPanel();
}

/**
 * 统一更新所有依赖于state的UI元素
 * @param {object | null} state - The current butter state object.
 */
function updateAllDynamicUI(state) {
    // 渲染所有面板
    updateStatusPanels();

    // 如果未注册，隐藏非注册相关的功能
    if (!state) {
        $(
            "#butter-tab-succubus-nav, #bs-skills-succubus-section, #bs-skills-custom-section, #bs-skills-none-section",
        ).hide();
        return;
    }

    // --- 同步 "特殊设定" 面板 ---
    $("#bs-setting-pronoun").val(state.semi_fixed.pronoun || "她");
    $("#bs-setting-custom-sens").val(
        state.semi_fixed.custom_erogenous_zones || "",
    );
    $("#bs-setting-sensitivity-mode").val(
        state.semi_fixed.sensitivity_growth_mode ?? 1,
    );
    $("#bs-disable-pregnancy").prop(
        "checked",
        state.semi_fixed.disable_pregnancy || false,
    );

    // --- 同步 "概览" 面板的特征标签 ---
    if (state.semi_fixed.traits && Array.isArray(state.semi_fixed.traits)) {
        $("#bs-setting-traits").val(state.semi_fixed.traits.join(", "));
    }

    // --- 同步 "特殊技能" 面板 ---
    initSkillsPanel(state.fixed.race, state.semi_fixed);

    // --- 同步 "繁衍法则" ---
    const isHuman = state.fixed.race === "人类";
    const reproSection = $("#b-reg-nonhuman-repro-section");
    $("#bs-setting-repro").prop("disabled", isHuman);
    $("#bs-setting-gestation").prop("disabled", isHuman);

    if (isHuman) {
        $("#bs-setting-repro").val("胎生");
        $("#bs-setting-gestation").val(10);
        reproSection.slideUp(200);
    } else {
        $("#bs-setting-repro").val(
            state.semi_fixed.reproduction_type || "胎生",
        );
        $("#bs-setting-gestation").val(
            state.semi_fixed.gestation_duration || 10,
        );
        reproSection.slideDown(200);
    }

    // --- 同步“魅魔状态”侧边栏标签 ---
    $("#butter-tab-succubus-nav").toggle(state.fixed.race === "魅魔");

    // 【核心修正】此行已被证明不再需要，因为注入位置是固定的。
    // 但为了保留结构，我们只是注释掉对 settings 的读取。
    // const settings = extensionSettings[SETTINGS_KEY];
    $("#bs-debug-depth").val("position: after");
}

// ==========================================
// 4. 事件绑定核心代理 (UI交互)
// ==========================================
function bindMasterUIEvents() {
    const root = $(`#${ROOT_CONTAINER_ID}`);
    if (!root.length) return;

    const modal = $("#butter-status-modal");
    const eye = $("#butter-floating-eye");

    eye.on("click", function (e) {
        e.stopPropagation();
        modal.fadeIn(200);
        eye.fadeOut(200);
        updateStatusPanels();
    });

    $(document).on("click", function (e) {
        if (
            modal.is(":visible") &&
            !modal.is(e.target) &&
            modal.has(e.target).length === 0 &&
            !eye.is(e.target)
        ) {
            modal.fadeOut(200);
            eye.fadeIn(200);
        }
    });

    root.on("click", ".butter-tab, .butter-nav-btn", function (e) {
        e.stopPropagation();
        const targetId = $(this).data("target");
        if (targetId) {
            uiManager.switchView(targetId);
        }
    });

    makeDraggable(root.find(".butter-top-bar")[0], modal[0]);
    makeDraggable(eye[0], eye[0]);

    // 初始化各个面板的专属事件
    initRegistrationPanelEvents(root);
    initSpecialSettingsPanelEvents(root);
    initApiPanelEvents(root);
    initDebugPanelEvents(root);
    initCalendar();
}

/**
 * 填充注册面板的默认提示词 (从prompts.js)
 */
function populateDefaultPrompts() {
    $("#b-reg-suc-prompt").val(succubusPrompts.prompt);
    $("#b-reg-suc-world").val(succubusPrompts.world);
    $("#b-reg-suc-diet").val(succubusPrompts.diet);
    $("#b-reg-suc-race").val(succubusPrompts.race);
    $("#b-reg-suc-crest").val(succubusPrompts.crest);
    $("#b-reg-suc-mech").val(succubusPrompts.mechanism);
    $("#b-reg-suc-soul").val(succubusPrompts.soul);
}

/**
 * 注册所有斜杠命令
 */
function registerButterCommands() {
    try {
        context.SlashCommandParser.addCommandObject(
            context.SlashCommand.fromProps({
                name: "advday",
                callback: async (args, value) => {
                    let days = parseInt(value);
                    if (isNaN(days) || days < 1) days = 1;

                    if (days > 1) {
                        toastr.info(`正在强制跳跃 ${days} 天...`, "世界时钟", {
                            timeOut: 5000,
                        });
                    }
                    const msg = await advanceDay(days);
                    toastr.success(`时间跳跃完成。`, "世界时钟");
                    context.sendSystemMessage("generic", msg);
                    return "";
                },
                helpString:
                    "【Butter Status】手动推进时间。用法：/advday [天数]。",
            }),
        );
        context.SlashCommandParser.addCommandObject(
            context.SlashCommand.fromProps({
                name: "bset",
                callback: async (args, value) => {
                    let state = getButterState();
                    if (!state) {
                        return toastr.error(
                            "【错误】未找到肉体档案，无法执行修改。",
                        );
                    }

                    // 1. 解析命令：将 "key.path=value" 格式的字符串拆解
                    const parts = value.split("=");
                    if (parts.length !== 2) {
                        return toastr.error(
                            "【格式错误】请使用 '路径=值' 格式，例如: /bset exp.pussy=100",
                        );
                    }

                    const pathString = parts[0].trim();
                    let newValue = parts[1].trim();
                    const path = pathString.split(".");

                    // 2. 特殊处理日期：如果路径是 'date'，则调用 setDateTime
                    if (path.length === 1 && path[0] === "date") {
                        const time = state.dynamic.time_tracker.time || "00:00";
                        const log = setDateTime(newValue, time); // newValue 应该是 'YYYY-MM-DD'
                        context.sendSystemMessage("generic", log);
                        return; // 日期处理完毕，直接退出
                    }

                    // 3. 递归寻找并修改目标值
                    let currentStateLayer = state;
                    for (let i = 0; i < path.length - 1; i++) {
                        if (currentStateLayer[path[i]] === undefined) {
                            return toastr.error(
                                `【路径错误】找不到路径: ${path.slice(0, i + 1).join(".")}`,
                            );
                        }
                        currentStateLayer = currentStateLayer[path[i]];
                    }

                    const finalKey = path[path.length - 1];
                    if (currentStateLayer[finalKey] === undefined) {
                        return toastr.error(
                            `【键名错误】在路径 '${path.slice(0, -1).join(".")}' 下找不到键: ${finalKey}`,
                        );
                    }

                    // 4. 根据原始值的类型，对新值进行转换
                    const originalValue = currentStateLayer[finalKey];
                    if (typeof originalValue === "number") {
                        newValue = parseFloat(newValue);
                        if (isNaN(newValue)) {
                            return toastr.error(
                                `【类型错误】'${parts[1]}' 无法转换为数字。`,
                            );
                        }
                    } else if (typeof originalValue === "boolean") {
                        newValue = newValue.toLowerCase() === "true";
                    }
                    // 字符串类型则直接使用

                    // 5. 执行修改
                    currentStateLayer[finalKey] = newValue;

                    // 6. 保存状态并反馈
                    saveButterState(state);
                    context.eventSource.emit("BUTTER_DATA_UPDATED");

                    const successMsg = `【档案篡改】: '${pathString}' 已被强制覆写为 '${newValue}'。`;
                    toastr.success(successMsg, "Butter 指令");
                    context.sendSystemMessage("generic", successMsg);

                    return ""; // 指令成功执行，返回空字符串
                },
                helpString: `【Butter】强制修改肉体档案。
用法: /bset <路径>=<值>
示例:
/bset exp.pussy=100
/bset sens.genital=50
/bset status.is_virgin=false
/bset date=2025-12-25
`,
            }),
        );
    } catch (e) {
        console.error("Failed to register slash command", e);
    }
}

// ==========================================
// 5. 全局事件监听器绑定 (新框架核心)
// ==========================================
function bindGlobalEventListeners() {
    console.log("[Butter Status] Binding global event listeners...");

    // 当聊天切换时，重新加载所有状态
    eventSource.on(event_types.CHAT_CHANGED, onChatOrLoad);

    // 当酒馆主设置或预设更新时，刷新注入面板
    eventSource.on(event_types.SETTINGS_UPDATED, () => {
        if ($("#butter-status-modal").is(":visible")) {
            console.log("[Butter Sync] 检测到设置更新，正在刷新预设列表...");
            initInjectPanel();
        }
    });

    // 当世界书更新时，刷新注入面板
    eventSource.on(event_types.WORLDINFO_UPDATED, () => {
        if ($("#butter-status-modal").is(":visible")) {
            console.log("[Butter Sync] 检测到世界书更新，正在刷新条目列表...");
            initInjectPanel();
        }
    });

    // 当AI生成回合结束时，触发后台追踪
    eventSource.on(event_types.GENERATION_ENDED, () => {
        console.log(
            "[Butter Tracker] generation_ended 事件触发，即将执行后台追踪...",
        );
        setTimeout(() => {
            runButterTrackingEngine();
        }, 500); // 延迟以确保所有数据已写入
    });

    // 当插件内部工具更新了状态时，刷新UI
    eventSource.on("BUTTER_DATA_UPDATED", () => {
        if ($("#butter-status-modal").is(":visible")) {
            updateStatusPanels();
        }
    });
}
// ==========================================
// 6. 各面板子模块控制器 (UI交互逻辑)
// ==========================================

/**
 * 绑定“注册”面板的所有事件
 * @param {JQuery} root - The root container jQuery object.
 */
function initRegistrationPanelEvents(root) {
    // 加载预设按钮的事件
    root.on("click", "#b-reg-load-preset-btn", async () => {
        const pName = $("#b-reg-preset-loader").val();
        if (!pName) return toastr.warning("请先选择一个预设。");

        // 【修正：加载后刷新UI】
        if (await loadUserPresetIntoChat(pName)) {
            toastr.success(
                `肉体克隆成功！预设 [${pName}] 已覆盖当前角色。`,
                "深渊降临",
            );
            onChatOrLoad(); // 强制刷新所有UI以显示新状态
        }
    });

    // 【新增】删除预设按钮的事件
    root.on("click", "#b-reg-delete-preset-btn", async () => {
        const pName = $("#b-reg-preset-loader").val();
        if (!pName) return toastr.warning("请先选择一个预设进行删除。");

        const result = await context.Popup.show.confirm(
            "确认销毁",
            `您确定要永久销毁预设【${pName}】吗？此操作无法撤销。`,
        );

        if (result) {
            if (deleteUserPreset(pName)) {
                toastr.success(`预设【${pName}】已成功销毁。`, "操作完成");
                refreshPresetList(); // 刷新下拉菜单
            } else {
                toastr.error(`未能找到并销毁预设【${pName}】。`, "删除失败");
            }
        }
    });

    // （保留您原有的其他事件绑定）
    root.on("change", "#b-reg-race", function () {
        const race = $(this).val();
        const succubusSection = $("#b-reg-succubus-lore-section");
        const customSection = $("#b-reg-custom-race-section");
        const reproSection = $("#b-reg-nonhuman-repro-section");

        succubusSection.hide();
        customSection.hide();

        if (race === "魅魔") succubusSection.slideDown(200);
        else if (race === "自设") customSection.slideDown(200);

        if (race === "人类") {
            reproSection.slideUp(200);
        } else {
            reproSection.slideDown(200);
        }
    });

    root.on("change", "#b-reg-obscene-toggle", function () {
        $("#b-reg-obscene-section").slideToggle($(this).is(":checked"));
    });

    root.on("click", "#b-reg-submit-btn", handleRegistrationSubmit);
}

/**
 * 刷新用户创建的预设列表
 */
function refreshPresetList() {
    const list = getUserPresets();
    const dropdown = $("#b-reg-preset-loader");
    dropdown.empty();
    if (list.length === 0) {
        dropdown.append('<option value="">暂无克隆预设</option>');
    } else {
        dropdown.append('<option value="">-- 选择一个预设 --</option>');
        list.forEach((p) =>
            dropdown.append(`<option value="${p.name}">${p.name}</option>`),
        );
    }
}

/**
 * 绑定“特殊设定”面板的所有事件
 * @param {JQuery} root - The root container jQuery object.
 */
function initSpecialSettingsPanelEvents(root) {
    const settingsToSave = [
        "#bs-setting-pronoun",
        "#bs-setting-custom-sens",
        "#bs-setting-sensitivity-mode",
        "#bs-setting-repro",
        "#bs-setting-gestation",
        "#bs-setting-traits", // 将特征标签也加入自动保存
    ];

    root.on("change", "#bs-disable-pregnancy", async function () {
        let state = getButterState();
        if (!state) return;
        state.semi_fixed.disable_pregnancy = $(this).is(":checked");
        await saveButterState(state); // 使用 await 确保保存
        toastr.success(
            `强制绝育状态已${$(this).is(":checked") ? "开启" : "关闭"}。`,
        );
    });

    // 为多个设置输入框绑定通用保存逻辑
    root.on("change", settingsToSave.join(","), async function () {
        let state = getButterState();
        if (!state) return;

        state.semi_fixed.pronoun = $("#bs-setting-pronoun").val();
        state.semi_fixed.custom_erogenous_zones = $("#bs-setting-custom-sens")
            .val()
            .trim();
        state.semi_fixed.sensitivity_growth_mode = parseInt(
            $("#bs-setting-sensitivity-mode").val(),
        );
        state.semi_fixed.reproduction_type = $("#bs-setting-repro").val();
        state.semi_fixed.gestation_duration =
            parseInt($("#bs-setting-gestation").val()) || 10;
        state.semi_fixed.traits = ($("#bs-setting-traits").val() || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);

        // 人类种族的特殊限制
        if (state.fixed.race === "人类") {
            state.semi_fixed.reproduction_type = "胎生";
            state.semi_fixed.gestation_duration = 10;
            $("#bs-setting-repro").val("胎生");
            $("#bs-setting-gestation").val(10);
        }

        // ====================【强制堕落指令】====================
        // 在保存前，检查敏感度模式是否被切换为“堕落”(值为100)
        if (state.semi_fixed.sensitivity_growth_mode === 100) {
            // 如果是，则立即将所有敏感度数值强制设为100
            Object.keys(state.dynamic.sensitivity).forEach((key) => {
                state.dynamic.sensitivity[key] = 100;
            });
            toastr.warning(
                "【堕落指令已执行】所有感官已被改造至极限！",
                "系统警告",
            );
        }
        // =======================================================

        await saveButterState(state); // 保存所有修改，包括可能被覆写的敏感度
        toastr.success("特殊设定已更新并保存。");
        updateStatusPanels(); // 立即刷新UI，让您看到敏感度数值的变化
        injectButterSystemPrompt(); // 设定变化后，立即重新注入系统提示词
    });
}

/**
 * 绑定“API设置”(神枢控制台)面板的所有事件
 * @param {JQuery} root - The root container jQuery object.
 */
function initApiPanelEvents(root) {
    // 【核心修正】在函数开始时，实时获取最新的设置对象，用于初始化UI。
    const settings =
        SillyTavern.getContext().extensionSettings[SETTINGS_KEY] || {};

    // 恢复UI状态
    $("#bs-api-enable-plugin").prop("checked", settings.enablePlugin ?? true);
    $("#bs-api-use-external").prop(
        "checked",
        settings.useExternalCustomFetch ?? false,
    );
    $("#bs-api-stream-toggle").prop("checked", settings.apiStream ?? false);
    $("#bs-api-url").val(settings.apiUrl || "");
    $("#bs-api-key").val(settings.apiKey || "");
    $("#bs-api-model-name").val(settings.apiModelName || "");
    $("#bs-api-history-count").val(settings.apiHistoryCount || 10);
    $("#bs-api-regex-filter").val(settings.apiRegexFilter || "");

    // 事件绑定
    root.on("change", "#bs-api-regex-filter", function () {
        // 【核心修正】在事件处理器内部，再次实时获取设置对象进行修改。
        const liveSettings =
            SillyTavern.getContext().extensionSettings[SETTINGS_KEY];
        if (liveSettings) {
            liveSettings.apiRegexFilter = $(this).val();
            context.saveSettingsDebounced();
            toastr.info("API聊天记录裁剪规则已即时保存。");
        }
    });

    root.on(
        "change",
        "#bs-api-enable-plugin, #bs-api-use-external, #bs-api-stream-toggle",
        function () {
            // 【核心修正】在事件处理器内部，再次实时获取设置对象进行修改。
            const liveSettings =
                SillyTavern.getContext().extensionSettings[SETTINGS_KEY];
            if (liveSettings) {
                liveSettings.enablePlugin = $("#bs-api-enable-plugin").is(
                    ":checked",
                );
                liveSettings.useExternalCustomFetch = $(
                    "#bs-api-use-external",
                ).is(":checked");
                liveSettings.apiStream = $("#bs-api-stream-toggle").is(
                    ":checked",
                );
                context.saveSettingsDebounced();
                toastr.info("API核心设定已即时保存。");
            }
        },
    );

    root.on("click", "#bs-api-save-btn", function () {
        // 【核心修正】在事件处理器内部，再次实时获取设置对象进行修改。
        const liveSettings =
            SillyTavern.getContext().extensionSettings[SETTINGS_KEY];
        if (liveSettings) {
            liveSettings.apiUrl = $("#bs-api-url").val().trim();
            liveSettings.apiKey = $("#bs-api-key").val().trim();
            liveSettings.apiModelName = $("#bs-api-model-name").val().trim();
            liveSettings.apiHistoryCount =
                parseInt($("#bs-api-history-count").val()) || 10;
            liveSettings.apiRegexFilter = $("#bs-api-regex-filter").val();
            context.saveSettingsDebounced();
            toastr.success(
                "神枢控制台的 API 设定已强行覆写并永久保存。",
                "Butter Status",
            );
        }
    });

    root.on("click", "#bs-api-fetch-models", async function () {
        const url = $("#bs-api-url").val().trim();
        const key = $("#bs-api-key").val().trim();
        if (!url || !key) {
            return toastr.error("请先填入完整的 API Base URL 和 API Key！");
        }

        const fetchBtn = $(this);
        fetchBtn
            .prop("disabled", true)
            .html('<i class="fa-solid fa-spinner fa-spin"></i> 正在连接...');

        try {
            const baseUrl = url.endsWith("/v1") ? url : `${url}/v1`;
            const response = await fetch(`${baseUrl}/models`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                },
            });
            if (!response.ok)
                throw new Error(`服务器返回状态: ${response.status}`);
            const data = await response.json();
            const modelList = $("#bs-api-model-list");
            modelList
                .empty()
                .append('<option value="">-- 请选择一个模型 --</option>');
            if (data && Array.isArray(data.data)) {
                data.data.forEach((model) => {
                    modelList.append(
                        `<option value="${model.id}">${model.id}</option>`,
                    );
                });
                toastr.success(`成功拉取到 ${data.data.length} 个模型。`);
            } else {
                toastr.warning("API返回了数据，但格式不正确或未找到模型列表。");
            }
        } catch (error) {
            console.error("[Butter API] 拉取模型失败:", error);
            toastr.error(`拉取模型失败: ${error.message}`, "连接错误");
        } finally {
            fetchBtn
                .prop("disabled", false)
                .html('<i class="fa-solid fa-rotate"></i> 连接并拉取模型');
        }
    });

    root.on("change", "#bs-api-model-list", function () {
        const selectedModel = $(this).val();
        if (selectedModel) {
            $("#bs-api-model-name").val(selectedModel);
        }
    });
}

/**
 * 绑定“监控”面板的所有事件
 * @param {JQuery} root - The root container jQuery object.
 */
function initDebugPanelEvents(root) {
    // 深度调整功能已被 position=after 替代，此处的事件监听不再需要修改 depth，
    // 但可以保留以显示当前固定的注入策略。
    root.on("focus", "#bs-debug-depth", function () {
        toastr.info("当前使用无损注入模式，位置固定在主设定之后，此项不可调。");
        $(this).blur();
    });
}

/**
 * 【重构核心】初始化“属性注入”面板，现在改造为API指令和世界书控制中心
 */
async function initInjectPanel() {
    const root = $(`#${ROOT_CONTAINER_ID}`);

    if (!uiManager.isInjectPanelInitialized) {
        // 1. API顶部指令输入框的事件绑定
        root.on("input", "#butter-api-top-prompt", function () {
            // 使用防抖，避免频繁写入设置
            clearTimeout(this.timer);
            this.timer = setTimeout(() => {
                const liveSettings =
                    SillyTavern.getContext().extensionSettings[SETTINGS_KEY];
                if (liveSettings) {
                    // 保存到一个新的键名下，例如 'apiTopPrompt'
                    liveSettings.apiTopPrompt = $(this).val();
                    context.saveSettingsDebounced();
                    console.log(`[Butter] API 顶部指令已更新。`);
                }
            }, 500); // 500毫秒防抖
        });

        // 2. 世界书传输模式下拉菜单的事件绑定 (不变)
        root.on("change", "#butter-inject-mode-select", function () {
            const liveSettings =
                SillyTavern.getContext().extensionSettings[SETTINGS_KEY];
            if (liveSettings) {
                liveSettings.wiMode = $(this).val();
                context.saveSettingsDebounced();
                console.log(
                    `[Butter] 世界书传输模式已切换为: ${liveSettings.wiMode}`,
                );
            }
        });

        // 3. 角色/全局世界书标签页切换事件 (不变)
        root.on("click", ".butter-wi-tab-btn", function () {
            if ($(this).hasClass("active")) return;
            root.find(".butter-wi-tab-btn").removeClass("active");
            $(this).addClass("active");
            $(
                "#butter-inject-char-wb-list, #butter-inject-global-wb-list",
            ).hide();
            const targetListId = $(this).data("target");
            $(`#${targetListId}`).show();
        });

        // 4. 世界书搜索框的实时输入过滤事件 (不变)
        root.on("input", "#butter-inject-search-input", function () {
            const keyword = $(this).val().toLowerCase();
            $(
                ".butter-worldbook-container:visible .butter-worldbook-item",
            ).each(function () {
                const itemName = $(this)
                    .find(".butter-worldbook-name")
                    .text()
                    .toLowerCase();
                $(this).toggle(itemName.includes(keyword));
            });
        });

        uiManager.isInjectPanelInitialized = true;
    }

    // 每次打开或调用此函数时，都强制刷新所有数据
    await updateInjectPanelData();
}

/**
 * 【改造版】负责从设置中读取数据并更新 "属性注入" 面板的UI
 */
async function updateInjectPanelData() {
    const root = $(`#${ROOT_CONTAINER_ID}`);

    // --- 1. 加载并填充API顶部指令输入框 ---
    try {
        const currentSettings = extensionSettings[SETTINGS_KEY] || {};
        // 从新的键名 'apiTopPrompt' 读取内容，如果不存在则提供一个默认值
        const currentPrompt =
            currentSettings.apiTopPrompt ||
            `[ABSOLUTE TOP-LEVEL COMMAND]\nYour core identity is a data-parsing AI. Your single task is to analyze the following logs and call tools. Never respond as a character. Your output MUST be only JSON. Begin analysis now.`;
        $("#butter-api-top-prompt").val(currentPrompt);

        // 恢复世界书传输模式的选择
        $("#butter-inject-mode-select").val(currentSettings.wiMode || "normal");
    } catch (e) {
        console.error("[Butter] 更新API指令输入框失败:", e);
    }

    // --- 2. 加载并填充世界书列表 (这部分逻辑不变) ---
    const charListContainer = $("#butter-inject-char-wb-list");
    const globalListContainer = $("#butter-inject-global-wb-list");

    charListContainer.html(
        '<div class="butter-no-item-msg">正在扫描角色世界书...</div>',
    );
    globalListContainer.html(
        '<div class="butter-no-item-msg">正在扫描全局世界书...</div>',
    );

    try {
        const characterId = context.characterId;
        const character = context.characters[characterId];
        const characterBooks = character?.world_books || [];
        renderWorldInfoList(characterBooks, charListContainer);

        const globalInfoResult = await context.executeSlashCommandsWithOptions(
            "/getvar var_name=world_info.globalSelect",
        );
        let globalBooks = [];
        if (
            globalInfoResult &&
            !globalInfoResult.isError &&
            globalInfoResult.pipe
        ) {
            try {
                const parsedPipe = JSON.parse(globalInfoResult.pipe);
                if (Array.isArray(parsedPipe)) {
                    globalBooks = parsedPipe;
                }
            } catch (jsonError) {
                console.error(
                    "[Butter] 解析全局世界书列表JSON失败:",
                    jsonError,
                );
            }
        }
        renderWorldInfoList(globalBooks, globalListContainer);
    } catch (e) {
        console.error("[Butter] 更新世界书数据时发生严重错误:", e);
        charListContainer.html(
            '<div class="butter-no-item-msg">加载角色世界书失败，请检查控制台。</div>',
        );
        globalListContainer.html(
            '<div class="butter-no-item-msg">加载全局世界书失败，请检查控制台。</div>',
        );
    }
}

/**
 * 【重构版 & 绝对根治版】渲染世界书条目列表
 * @param {string[]} bookList - 从可靠API获取的书籍名称数组
 * @param {jQuery} listContainer - 要渲染到的jQuery容器对象
 */
function renderWorldInfoList(bookList = [], listContainer) {
    const blacklist =
        SillyTavern.getContext().extensionSettings?.[SETTINGS_KEY]
            ?.wiBlacklist || [];
    listContainer.empty();

    if (bookList.length === 0) {
        // 【真正的病根在此！安全获取ID】
        // 如果DOM尚未完全挂载，listContainer为空，attr("id")会是undefined。
        // 使用 || "" 确保它始终是一个字符串，防止 .includes() 崩溃。
        const containerId = listContainer.attr("id") || "";

        const message = containerId.includes("char")
            ? "未检测到角色链接的世界书。"
            : "未检测到启用的全局世界书。";
        return listContainer.html(
            `<div class="butter-no-item-msg">${message}</div>`,
        );
    }

    bookList.forEach((bookName) => {
        const isEnabled = !blacklist.includes(bookName);

        const itemHtml = `
            <div class="butter-worldbook-item">
                <span class="butter-worldbook-name">${bookName}</span>
                <label class="butter-toggle-switch">
                    <input type="checkbox" class="butter-wi-toggle" data-book-name="${bookName}" ${isEnabled ? "checked" : ""}>
                    <span class="butter-slider"></span>
                </label>
            </div>`;
        listContainer.append(itemHtml);
    });

    // 绑定黑名单切换事件
    listContainer
        .off("change.butter")
        .on("change.butter", ".butter-wi-toggle", function () {
            const bookName = $(this).data("book-name");

            const currentSettings = SillyTavern.getContext().extensionSettings;

            if (!currentSettings[SETTINGS_KEY]) {
                currentSettings[SETTINGS_KEY] = {};
            }
            if (!currentSettings[SETTINGS_KEY].wiBlacklist) {
                currentSettings[SETTINGS_KEY].wiBlacklist = [];
            }

            let currentBlacklist = currentSettings[SETTINGS_KEY].wiBlacklist;

            if (!$(this).is(":checked")) {
                if (!currentBlacklist.includes(bookName)) {
                    currentBlacklist.push(bookName);
                }
            } else {
                currentSettings[SETTINGS_KEY].wiBlacklist =
                    currentBlacklist.filter((name) => name !== bookName);
            }
            SillyTavern.getContext().saveSettingsDebounced();
            console.log(
                "[Butter] 世界书黑名单已更新:",
                currentSettings[SETTINGS_KEY].wiBlacklist,
            );
        });
}

// ==========================================
// 7. 核心注册表单异步交互
// ==========================================

/**
 * 【最终版】整合UI输入，并执行抗风险的生理周期基准日计算
 * @returns {object} 返回一个只包含UI输入和计算结果的“半成品”formData
 */
function gatherFormData() {
    const safeVal = (selector) => $(selector).val() || "";
    const moment = SillyTavern.libs.moment;

    const VALID_YEAR_RANGE = { min: 1800, max: 2300 };
    let storyStartDate;
    const birthdayInput = safeVal("#bs-reg-birthday").trim();
    // 优先从生日中提取一个合理的年份作为时间锚点
    const yearMatch = birthdayInput.match(/(\d{4})/);

    if (yearMatch && yearMatch[1]) {
        const year = parseInt(yearMatch[1], 10);
        if (year >= VALID_YEAR_RANGE.min && year <= VALID_YEAR_RANGE.max) {
            // 尝试将生日输入解析为完整的日期，如果失败，则退回到只使用年份
            const parsedBirthday = moment(
                birthdayInput,
                ["YYYY年M月D日", "YYYY-M-D", "YYYY/M/D"],
                true,
            ); // 使用严格模式解析
            if (parsedBirthday.isValid()) {
                storyStartDate = parsedBirthday;
            } else {
                storyStartDate = moment(`${year}-01-01`, "YYYY-MM-DD");
            }
            console.log(
                `[Butter Register] 检测到有效生日，故事时间线已锚定于: ${storyStartDate.format("YYYY-MM-DD")}`,
            );
        }
    }

    if (!storyStartDate) {
        storyStartDate = moment();
        console.log(
            "[Butter Register] 未检测到有效生日，使用当前真实日期作为故事时间锚点。",
        );
    }

    const selectedDays = [];
    $("#b-reg-calendar-container .butter-calendar-day.selected").each(
        function () {
            selectedDays.push(parseInt($(this).text()));
        },
    );
    selectedDays.sort((a, b) => a - b);
    const menstrualStartDayOfMonth =
        selectedDays.length > 0 ? selectedDays[0] : 1;
    const menstrualDuration = selectedDays.length > 0 ? selectedDays.length : 5;
    const storyStartDayOfMonth = storyStartDate.date();

    let last_menstrual_start_date;
    if (storyStartDayOfMonth >= menstrualStartDayOfMonth) {
        last_menstrual_start_date = storyStartDate
            .clone()
            .date(menstrualStartDayOfMonth)
            .format("YYYY-MM-DD");
    } else {
        last_menstrual_start_date = storyStartDate
            .clone()
            .subtract(1, "months")
            .date(menstrualStartDayOfMonth)
            .format("YYYY-MM-DD");
    }

    const race = $("#b-reg-race").val();
    return {
        fixed: {
            name: safeVal("#b-reg-name").trim() || context.name2 || "user",
            gender: safeVal("#b-reg-gender"),
            race:
                race === "自设"
                    ? safeVal("#b-reg-custom-name").trim() || "新物种"
                    : race,
            birthday: birthdayInput,
            cycle_base: {
                last_menstrual_start_date: last_menstrual_start_date,
                average_cycle: parseInt(safeVal("#b-reg-avg-cycle")) || 28,
                menstrual_duration: menstrualDuration,
            },
        },
        semi_fixed: {
            reproduction_type: safeVal("#b-reg-repro") || "胎生",
            gestation_duration: parseInt(safeVal("#b-reg-gestation")) || 10,
            pronoun: safeVal("#b-reg-pronoun") || "她",
            custom_erogenous_zones: safeVal("#b-reg-custom-sens").trim(),
            obscene_content_enabled: $("#b-reg-obscene-toggle").is(":checked"),
            sensitivity_growth_mode: parseInt(safeVal("#b-reg-obs-sens")) || 1,
            lactation_setting: safeVal("#b-reg-obs-lac") || "孕后哺乳期产乳",
            pregnancy_setting: safeVal("#b-reg-obs-preg") || "正常孕期",
        },
        dynamic: {
            time_tracker: {
                story_date: storyStartDate.format("YYYY-MM-DD"),
            },
        },
    };
}

/**
 * 【最终版】处理注册表单的提交，流程清晰，逻辑完整
 */
async function handleRegistrationSubmit() {
    const avgCycle = parseInt($("#b-reg-avg-cycle").val());
    const selectedDaysCount = $(
        "#b-reg-calendar-container .butter-calendar-day.selected",
    ).length;
    if (selectedDaysCount > 0 && selectedDaysCount >= avgCycle) {
        return toastr.error(
            "生理期持续天数不能大于或等于平均周期总天数。",
            "设定错误",
        );
    }
    const checkRepro = $("#b-reg-repro").val();
    const checkGest = parseInt($("#b-reg-gestation").val());
    if (checkRepro === "胎生" && checkGest < 3) {
        return toastr.error("胎生孕期不允许少于3个月。", "残酷警告");
    }

    const submitBtn = $("#b-reg-submit-btn");
    submitBtn
        .prop("disabled", true)
        .html(
            '<i class="fa-solid fa-spinner fa-spin"></i> 正在构建灵魂档案...',
        );

    try {
        let formData = gatherFormData();
        const race = $("#b-reg-race").val();
        let generatedData = {};

        let basePromptTemplate = "";
        const { customRacePrompts } = await import("./prompts.js"); // 确保导入
        if (race === "魅魔") {
            basePromptTemplate = succubusPrompts.prompt;
        } else if (race === "自设") {
            basePromptTemplate = customRacePrompts.prompt;
        }

        const customExtra =
            $("#b-reg-custom-extra").val()?.trim() || "一个普通人";
        const obsceneSettings = $("#b-reg-obscene-toggle").is(":checked")
            ? $("#b-reg-obs-extra-text")?.val() || ""
            : "";

        const finalPrompt = buildSystemWrapper(
            formData.fixed.race,
            basePromptTemplate,
            customExtra,
            obsceneSettings,
        );

        updateDebugPanelIO(finalPrompt, "正在生成角色档案...");
        toastr.info("正在连接主源神经生成核心档案...", "系统运行", {
            timeOut: 20000,
        });

        const pluginSettings =
            SillyTavern.getContext().extensionSettings[SETTINGS_KEY] || {};
        const useExternalApi =
            pluginSettings.useExternalCustomFetch &&
            pluginSettings.apiKey &&
            pluginSettings.apiUrl;
        const generateWithSelectedApi = useExternalApi
            ? (prompt) => callExternalApi(prompt, pluginSettings)
            : (prompt) => context.generateRaw({ prompt });

        const rawResponse = await generateWithSelectedApi(finalPrompt);
        updateDebugPanelIO(finalPrompt, rawResponse);

        try {
            let responseText = String(rawResponse);
            let jsonString = null;
            const fencedMatch = responseText.match(
                /```(?:json)?\s*([\s\S]+?)\s*```/,
            );
            if (fencedMatch && fencedMatch[1]) jsonString = fencedMatch[1];
            else {
                const objectMatch = responseText.match(/\{[\s\S]*\}/);
                if (objectMatch && objectMatch[0]) jsonString = objectMatch[0];
            }
            if (!jsonString)
                throw new Error(
                    `AI返回的内容不是有效的JSON。收到的内容开头为: "${responseText.substring(0, 50)}..."`,
                );
            const parsedData = JSON.parse(jsonString);
            if (!parsedData || typeof parsedData !== "object")
                throw new Error("解析出的JSON格式不正确。");
            generatedData = parsedData;
        } catch (e) {
            throw new Error(`AI未能返回有效的JSON档案: ${e.message}`);
        }

        // 将AI生成的数据填充到formData中
        formData.semi_fixed.traits =
            generatedData.traits && Array.isArray(generatedData.traits)
                ? generatedData.traits
                : [];
        formData.semi_fixed.race_appearance =
            generatedData.race_appearance || "";
        formData.semi_fixed.race_body_state =
            generatedData.race_body_state || "";
        formData.semi_fixed.race_core_mechanic =
            generatedData.race_core_mechanic || "";
        formData.semi_fixed.aphrodisiac_mechanic =
            generatedData.aphrodisiac_mechanic || "";
        formData.semi_fixed.crest_system = generatedData.crest_system || "";

        const finalGeneratedPersona = [
            formData.semi_fixed.race_appearance
                ? `外貌特征: ${formData.semi_fixed.race_appearance}`
                : "",
            formData.semi_fixed.race_body_state
                ? `身体状态: ${formData.semi_fixed.race_body_state}`
                : "",
            formData.semi_fixed.race_core_mechanic
                ? `特异机制: ${formData.semi_fixed.race_core_mechanic}`
                : "",
            formData.semi_fixed.aphrodisiac_mechanic
                ? `催淫机制: ${formData.semi_fixed.aphrodisiac_mechanic}`
                : "",
            formData.semi_fixed.crest_system
                ? `淫纹系统: ${formData.semi_fixed.crest_system}`
                : "",
        ]
            .filter(Boolean)
            .join("\n");
        formData.semi_fixed.generated_persona = finalGeneratedPersona;

        // 【核心修正】将保存预设的逻辑移动到AI调用之后，确保traits被包含
        if ($("#b-reg-save-preset-check").is(":checked")) {
            // 此时的 formData 已包含AI生成的traits
            const pName =
                $("#b-reg-preset-name").val().trim() ||
                `${formData.fixed.name}_${formData.fixed.race}`;
            saveUserPreset(pName, formData);
            toastr.info(`预设 [${pName}] 已保存。`);
        }

        registerButterUser(formData);

        if (
            formData.semi_fixed.obscene_content_enabled &&
            formData.semi_fixed.sensitivity_growth_mode === 100
        ) {
            let state = getButterState();
            if (state) {
                Object.keys(state.dynamic.sensitivity).forEach(
                    (key) => (state.dynamic.sensitivity[key] = 100),
                );
                saveButterState(state);
            }
        }

        toastr.success(
            "肉体改造与注册完成！您的所有设定已被系统彻底锁定。",
            "烙印成功",
        );

        // 【核心修正】注册成功后，强制刷新UI
        onChatOrLoad();
    } catch (error) {
        console.error("[Butter Registration] 注册流程失败:", error);
        toastr.error(
            `注册流程失败: ${error.message}。请检查API连接或F12控制台。`,
            "系统异常",
        );
    } finally {
        // 无论成功与否，都重新启用按钮，防止卡死
        submitBtn.prop("disabled", false).html("确认烙印");
    }
}

/**
 * 初始化生理周期日历UI
 */
function initCalendar() {
    const container = $("#b-reg-calendar-container");
    container.empty();
    for (let i = 1; i <= 31; i++) {
        container.append(`<div class="butter-calendar-day">${i}</div>`);
    }
    container.on("click", ".butter-calendar-day", function () {
        $(this).toggleClass("selected");
    });
}

/**
 * 根据种族初始化特殊技能面板的显示/隐藏和内容
 * @param {string} race - 当前角色的种族
 * @param {object} semiFixedData - semi_fixed 状态数据
 */
function initSkillsPanel(race, semiFixedData) {
    const succubusSection = $("#bs-skills-succubus-section");
    const customSection = $("#bs-skills-custom-section");
    const noneSection = $("#bs-skills-none-section");

    succubusSection.hide();
    customSection.hide();
    noneSection.hide();

    if (race === "魅魔") {
        succubusSection.show();
        $("#bs-skill-race-appearance").val(semiFixedData.race_appearance || "");
        $("#bs-skill-race-body-state").val(semiFixedData.race_body_state || "");
        $("#bs-skill-race-core-mechanic").val(
            semiFixedData.race_core_mechanic || "",
        );
        $("#bs-skill-aphrodisiac-mechanic").val(
            semiFixedData.aphrodisiac_mechanic || "",
        );
        $("#bs-skill-crest-system").val(semiFixedData.crest_system || "");
    } else if (race === "自设") {
        customSection.show();
        $("#bs-skill-custom-race-appearance").val(
            semiFixedData.race_appearance || "",
        );
        $("#bs-skill-custom-race-body-state").val(
            semiFixedData.race_body_state || "",
        );
        $("#bs-skill-custom-race-core-mechanic").val(
            semiFixedData.race_core_mechanic || "",
        );
    } else {
        noneSection.show();
    }
}

// ==========================================
// 8. 最终启动入口
// ==========================================

// 使用一个可靠的、只执行一次的模式来启动插件
if (
    globalThis[APP_READY_HANDLER_KEY] &&
    typeof eventSource.off === "function"
) {
    eventSource.off(event_types.APP_READY, globalThis[APP_READY_HANDLER_KEY]);
}
globalThis[APP_READY_HANDLER_KEY] = bootstrap;
eventSource.on(event_types.APP_READY, globalThis[APP_READY_HANDLER_KEY]);
