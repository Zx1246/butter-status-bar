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
    callExternalApi,
    injectButterSystemPrompt,
    runButterTrackingEngine,
    updateDebugPanelIO,
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

    triggerEl.style.touchAction = "none";

    let pos = { x: 0, y: 0, startX: 0, startY: 0 };
    let isDragging = false;
    const noDragTags = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"];

    function onPointerDown(e) {
        if (
            e.target.tagName === "SPAN" &&
            $(e.target).closest("#butter-top-bar").length > 0
        ) {
            e.preventDefault();
        }

        if (
            noDragTags.includes(e.target.tagName) ||
            $(e.target).closest(
                ".menu_button, .butter-nav-btn, .butter-tab, input, textarea, select, button",
            ).length > 0
        ) {
            return;
        }

        // 读取当前实际位置（处理 CSS transform 居中的情况）
        const rect = targetEl.getBoundingClientRect();
        pos.startX = e.clientX;
        pos.startY = e.clientY;
        pos.x = rect.left;
        pos.y = rect.top;

        document.addEventListener("pointermove", onPointerMove, {
            passive: false,
        });
        document.addEventListener("pointerup", onPointerUp);
        triggerEl.style.cursor = "grabbing";
        targetEl.style.userSelect = "none";

        if (e.cancelable) e.preventDefault();
    }

    function onPointerMove(e) {
        // 阻止 Chrome 将触摸拖动变成页面滚动
        if (e.cancelable) e.preventDefault();

        if (
            !isDragging &&
            (Math.abs(e.clientX - pos.startX) > 5 ||
                Math.abs(e.clientY - pos.startY) > 5)
        ) {
            isDragging = true;
            // 固定 left/top，清除 transform 居中，加标记类
            targetEl.style.setProperty("left", `${pos.x}px`, "important");
            targetEl.style.setProperty("top", `${pos.y}px`, "important");
            targetEl.style.setProperty("right", "auto", "important");
            targetEl.style.setProperty("bottom", "auto", "important");
            targetEl.style.setProperty("transform", "none", "important");
            targetEl.style.setProperty("margin", "0", "important");
            targetEl.classList.add("butter-dragged");
        }

        if (isDragging) {
            const dx = e.clientX - pos.startX;
            const dy = e.clientY - pos.startY;
            let newLeft = pos.x + dx;
            let newTop = pos.y + dy;

            const w = targetEl.offsetWidth;
            const h = targetEl.offsetHeight;
            const maxLeft = window.innerWidth - w;
            const maxTop = window.innerHeight - h;

            newLeft =
                maxLeft > 0
                    ? Math.max(0, Math.min(newLeft, maxLeft))
                    : Math.max(maxLeft, Math.min(newLeft, 0));

            newTop =
                maxTop > 0
                    ? Math.max(0, Math.min(newTop, maxTop))
                    : Math.max(maxTop, Math.min(newTop, 0));

            targetEl.style.setProperty("left", `${newLeft}px`, "important");
            targetEl.style.setProperty("top", `${newTop}px`, "important");
        }
    }

    function onPointerUp() {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        triggerEl.style.cursor = "grab";
        targetEl.style.userSelect = "";
        setTimeout(() => {
            isDragging = false;
        }, 50);
    }

    triggerEl.style.cursor = "grab";
    triggerEl.addEventListener("pointerdown", onPointerDown, {
        passive: false,
    });
}

// 【核心优化】规避移动端软键盘唤起、手机工具栏缩进导致的强制吸顶误杀
window.addEventListener("resize", () => {
    if (
        /Mobi|Android|iPhone/i.test(navigator.userAgent) &&
        (document.activeElement.tagName === "INPUT" ||
            document.activeElement.tagName === "TEXTAREA")
    ) {
        return;
    }

    const modal = document.getElementById("butter-status-modal");
    if (!modal || modal.style.display === "none") return;

    // 未拖动过：CSS 的 translate(-50%,-50%) 自动居中，无需干预
    if (!modal.classList.contains("butter-dragged")) return;

    const rect = modal.getBoundingClientRect();

    // 面板仍在视口内，不动
    if (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight
    ) {
        return;
    }

    // 越界则修正回视口内
    const newLeft = Math.max(
        0,
        Math.min(rect.left, window.innerWidth - rect.width),
    );
    const newTop = Math.max(
        0,
        Math.min(rect.top, window.innerHeight - rect.height),
    );

    modal.style.setProperty("left", `${newLeft}px`, "important");
    modal.style.setProperty("top", `${newTop}px`, "important");
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
            wiEntryWhitelist: [], // 条目 uid 白名单（reference 模式用）
            wiEntryBlacklist: [], // 条目 uid 黑名单（normal 模式排除特定条目）
            wiWhitelist: [],
            user_presets: [],
        };
        // 使用全局的 context 引用进行保存
        context.saveSettingsDebounced();
    }
}

/**
 * 【方案A】把根容器强制"搬家"到 <body> 直下。
 *
 * 为什么必须这样做：
 * CSS 规范规定，只要 position:fixed 元素的任意祖先带有 transform / filter /
 * perspective / contain / will-change 属性，该元素的定位基准就会从"视口"
 * 变成"那个祖先"，`top/left` 与 `translate(-50%,-50%)` 的语义全部失效 ——
 * 表现为模态框吸附在容器左上/顶部、怎么拖都对不上，且纯 CSS 无法解除，
 * 只能靠 DOM 层面把它挪到没有"包含块"污染的 <body> 直下。
 *
 * 本函数是幂等的：已经在 body 直下时什么都不做，可安全重复调用。
 */
function ensureRootAttachedToBody() {
    const root = document.getElementById(ROOT_CONTAINER_ID);
    if (root && root.parentElement !== document.body) {
        console.log(
            "[Butter Status] 根容器不在 <body> 直下，已强制迁移（修复定位基准被祖先 transform 污染）",
        );
        document.body.appendChild(root);
    }
    return root;
}

/**
 * 确保UI模态框被加载并绑定所有内部事件
 */
async function ensureModalAndBindEvents() {
    // 若根容器已存在（扩展热重载/二次引导），仍需先纠正其挂载位置再返回
    if ($(`#${ROOT_CONTAINER_ID}`).length) {
        ensureRootAttachedToBody();
        return;
    }

    const mainUiHtml = await $.get(`${PLUGIN_DIR}/ui.html`);
    $("body").append(mainUiHtml);

    // 【方案A】注入后立刻校正确认，必须在 bindMasterUIEvents() 之前执行：
    // makeDraggable() 会立即读取 getBoundingClientRect()，位置错了会写坏首帧坐标。
    ensureRootAttachedToBody();

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

    // 打开模态框
    eye.on("click", function (e) {
        e.stopPropagation();
        modal.fadeIn(200);
        modal.addClass("show"); // 新增：添加show类
        eye.fadeOut(200);
        $("body").addClass("butter-modal-open"); // 新增：阻止背景滚动
        updateStatusPanels();
    });

    // 点击外部关闭模态框
    $(document).on("click", function (e) {
        if (
            modal.is(":visible") &&
            !modal.is(e.target) &&
            modal.has(e.target).length === 0 &&
            !eye.is(e.target)
        ) {
            modal.fadeOut(200);
            modal.removeClass("show butter-dragged");
            // 清除拖动留下的内联定位，让下次打开回到居中
            modal[0].style.removeProperty("left");
            modal[0].style.removeProperty("top");
            modal[0].style.removeProperty("transform");
            eye.fadeIn(200);
            $("body").removeClass("butter-modal-open");
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
// ==========================================
// 【新增】大发情期时段列表 UI 构建器
// ==========================================

const HEAT_MONTH_OPTIONS = [
    { value: 1, label: "1月" },
    { value: 2, label: "2月" },
    { value: 3, label: "3月（春季）" },
    { value: 4, label: "4月" },
    { value: 5, label: "5月" },
    { value: 6, label: "6月" },
    { value: 7, label: "7月" },
    { value: 8, label: "8月" },
    { value: 9, label: "9月（秋季）" },
    { value: 10, label: "10月" },
    { value: 11, label: "11月" },
    { value: 12, label: "12月" },
];

/**
 * 构建单个发情期时段行
 * @param {number} startMonth - 开始月份 1-12
 * @param {number} duration - 持续月数 1-12
 * @returns {string} HTML 字符串
 */
function buildHeatEventRow(startMonth = 3, duration = 1) {
    const optionsHtml = HEAT_MONTH_OPTIONS.map(
        (m) =>
            `<option value="${m.value}" ${m.value === startMonth ? "selected" : ""}>${m.label}</option>`,
    ).join("");

    return `
        <div class="heat-event-row" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <select class="text_pole heat-event-month" style="flex:1 1 auto; min-width:140px;">
                ${optionsHtml}
            </select>
            <label style="margin:0; white-space:nowrap;">持续</label>
            <input type="number" class="text_pole heat-event-duration" value="${duration}" min="1" max="12" style="flex:0 0 auto; width:60px !important;">
            <span style="white-space:nowrap;">个月</span>
            <div class="menu_button heat-event-remove" title="删除此时段" style="padding:6px 10px; flex:0 0 auto;">
                <i class="fa-solid fa-trash"></i>
            </div>
        </div>`;
}

/**
 * 渲染整个时段列表
 * @param {Array<{start_month:number, duration_months:number}>} events
 */
function renderHeatEvents(events = []) {
    const container = $("#b-reg-heat-events-container");
    const emptyHint = $("#b-reg-heat-events-empty");
    container.empty();

    if (!Array.isArray(events) || events.length === 0) {
        emptyHint.show();
        return;
    }
    emptyHint.hide();

    events.forEach((ev) => {
        container.append(
            buildHeatEventRow(ev.start_month || 3, ev.duration_months || 1),
        );
    });
}

/**
 * 收集当前 UI 中的时段列表
 * @returns {Array<{start_month:number, duration_months:number}>}
 */
function collectHeatEvents() {
    const events = [];
    $("#b-reg-heat-events-container .heat-event-row").each(function () {
        const month = parseInt($(this).find(".heat-event-month").val()) || 0;
        const duration =
            parseInt($(this).find(".heat-event-duration").val()) || 0;
        if (month > 0 && duration > 0) {
            events.push({ start_month: month, duration_months: duration });
        }
    });
    return events;
}

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
        const beastSection = $("#b-reg-beast-section"); // 新增
        const reproSection = $("#b-reg-nonhuman-repro-section");
        const skillsBeastSection = $("#bs-skills-beast-section");

        succubusSection.hide();
        customSection.hide();
        beastSection.hide(); // 新增
        skillsBeastSection.hide();

        if (race === "魅魔") succubusSection.slideDown(200);
        else if (race === "自设") customSection.slideDown(200);
        else if (race === "兽人") {
            beastSection.slideDown(200);
            skillsBeastSection.show();
            const state = getButterState();
            if (state) {
                $("#bs-beast-skill-subrace").val(
                    state.semi_fixed.beast_subrace || "",
                );
                $("#bs-beast-skill-features").val(
                    state.semi_fixed.beast_features || "",
                );
            }
        }

        if (race === "人类") {
            reproSection.slideUp(200);
        } else {
            reproSection.slideDown(200);
        }
    });

    // 兽人大类切换：联动繁衍默认值 + 随机时隐藏细分输入框
    root.on("change", "#b-reg-beast-category", async function () {
        const category = $(this).val();
        const subraceContainer = $("#b-reg-beast-subrace-container");

        if (category === "随机") {
            subraceContainer.slideUp(200);
        } else {
            subraceContainer.slideDown(200);
        }

        // 联动繁衍默认值
        if (category !== "随机") {
            const { beastRacePrompts } = await import("./prompts.js");
            const defaults = beastRacePrompts.categoryDefaults[category];
            if (defaults) {
                $("#b-reg-repro").val(defaults.reproduction);
                $("#b-reg-gestation").val(defaults.gestation);

                // 【改造】渲染发情期时段列表（支持一年多次）
                renderHeatEvents(defaults.heat_events || []);

                // 同步显示繁衍设置区
                if (defaults.reproduction !== "胎生") {
                    $("#b-reg-nonhuman-repro-section").slideDown(200);
                }
            }
        }

        // 【新增】添加一个发情期时段
        root.on("click", "#b-reg-add-heat-event", function () {
            $("#b-reg-heat-events-empty").hide();
            $("#b-reg-heat-events-container").append(buildHeatEventRow(3, 1));
        });

        // 【新增】删除一个发情期时段（事件委托，适配动态元素）
        root.on("click", ".heat-event-remove", function () {
            $(this).closest(".heat-event-row").remove();
            if (
                $("#b-reg-heat-events-container .heat-event-row").length === 0
            ) {
                $("#b-reg-heat-events-empty").show();
            }
        });
    });

    // 【新增】第二性别类型切换
    root.on("change", "#b-reg-secondary-type", function () {
        const secType = $(this).val();
        $("#b-reg-secondary-abo-section").hide();
        $("#b-reg-secondary-tiangan-section").hide();
        $("#b-reg-secondary-sentinel-section").hide();

        if (secType === "ABO") $("#b-reg-secondary-abo-section").slideDown(200);
        else if (secType === "天乾地坤")
            $("#b-reg-secondary-tiangan-section").slideDown(200);
        else if (secType === "哨向")
            $("#b-reg-secondary-sentinel-section").slideDown(200);
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

    // 兽人技能页保存
    root.on("click", "#bs-beast-save-btn", async function () {
        let state = getButterState();
        if (!state) return;
        state.semi_fixed.beast_subrace = $("#bs-beast-skill-subrace")
            .val()
            .trim();
        state.semi_fixed.beast_features = $("#bs-beast-skill-features")
            .val()
            .trim();
        await saveButterState(state);
        await injectButterSystemPrompt(state);
        toastr.success("兽人种族档案已保存并更新注入。");
    });

    // 哨向技能页保存
    root.on("click", "#bs-sentinel-save-btn", async function () {
        let state = getButterState();
        if (!state) return;
        if (!state.semi_fixed.sentinel_guide_config) {
            state.semi_fixed.sentinel_guide_config = {};
        }
        state.semi_fixed.sentinel_guide_config.spirit_animal = $(
            "#bs-sentinel-skill-spirit-animal",
        )
            .val()
            .trim();
        // 把描述和性格合并存在 spirit_animal_desc + spirit_animal_personality 两个字段
        // 这里把描述框内容写回 spirit_animal_desc，性格框写回 spirit_animal_personality
        const combined = $("#bs-sentinel-skill-personality").val().trim();
        state.semi_fixed.sentinel_guide_config.spirit_animal_desc = combined;
        state.semi_fixed.sentinel_guide_config.spiritual_sea_desc = $(
            "#bs-sentinel-skill-spiritual-sea",
        )
            .val()
            .trim();
        await saveButterState(state);
        await injectButterSystemPrompt(state);
        toastr.success("精神体档案已保存并更新注入。");
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
            // 如果是，则立即将所有敏感度数值强制设为500
            Object.keys(state.dynamic.sensitivity).forEach((key) => {
                state.dynamic.sensitivity[key] = 500;
            });
            toastr.warning(
                "【堕落指令已执行】所有感官已被改造至极度敏感状态！",
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
    // ====================【核心新增】====================
    // 为“立刻重新分析”按钮绑定点击事件
    root.on("click", "#bs-force-re-track-btn", async function () {
        const btn = $(this);
        // 防止重复点击
        if (btn.prop("disabled")) return;

        // 禁用按钮并显示加载状态
        btn.prop("disabled", true).html(
            '<i class="fa-solid fa-spinner fa-spin"></i> 正在分析中...',
        );

        try {
            // 直接调用核心追踪引擎！
            // 函数内部已经有了开始和结束的toastr提示，所以这里无需额外提示。
            await runButterTrackingEngine();
        } catch (error) {
            // 如果调用过程中出现意外错误（虽然引擎内部已经处理了），这里也提供一个反馈
            console.error("[Butter] 手动触发追踪失败:", error);
            toastr.error("手动触发分析时遇到未知错误。", "强制操作失败");
        } finally {
            // 无论成功与否，都在操作结束后恢复按钮状态
            btn.prop("disabled", false).html(
                '<i class="fa-solid fa-magnifying-glass-chart"></i> 立刻重新分析',
            );
        }
    });
    // =======================================================
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

            // 兽人种族数据收集
            beast_category:
                race === "兽人"
                    ? safeVal("#b-reg-beast-category") || "随机"
                    : "无",
            beast_subrace:
                race === "兽人" ? safeVal("#b-reg-beast-subrace").trim() : "",
            beast_race:
                race === "兽人"
                    ? safeVal("#b-reg-beast-category") || "随机"
                    : "无",

            beast_heat_calendar:
                race === "兽人"
                    ? { heat_events: collectHeatEvents() }
                    : { heat_events: [] },

            // 【新增】第二性别数据收集
            secondary_gender_type: safeVal("#b-reg-secondary-type") || "无",
            secondary_gender: (function () {
                const secType = safeVal("#b-reg-secondary-type");
                if (secType === "ABO")
                    return safeVal("#b-reg-abo-gender") || "Omega";
                if (secType === "天乾地坤")
                    return safeVal("#b-reg-tiangan-gender") || "坤";
                if (secType === "哨向")
                    return safeVal("#b-reg-sentinel-gender") || "向导";
                return "";
            })(),

            // 【新增】ABO/天乾地坤 信息素配置（收集用户输入）
            abo_config: (function () {
                const secType = safeVal("#b-reg-secondary-type");
                if (secType === "ABO") {
                    return {
                        pheromone_scent: safeVal("#b-reg-abo-scent").trim(), // 用户输入的信息素气味
                        compatibility_rate: 0,
                        fertility_modifier: 1.0,
                    };
                } else if (secType === "天乾地坤") {
                    return {
                        pheromone_scent: safeVal("#b-reg-tiangan-scent").trim(), // 用户输入的体香
                        compatibility_rate: 0,
                        fertility_modifier: 1.0,
                    };
                }
                return {
                    pheromone_scent: "",
                    compatibility_rate: 0,
                    fertility_modifier: 1.0,
                };
            })(),

            // 哨向专属配置
            sentinel_guide_config: (function () {
                const secType = safeVal("#b-reg-secondary-type");
                if (secType === "哨向") {
                    return {
                        ability_level: safeVal("#b-reg-sentinel-level") || "C",
                        spirit_animal:
                            safeVal("#b-reg-spirit-animal").trim() || "",
                        spirit_animal_desc: "",
                        spirit_animal_personality: "",
                        spiritual_sea_desc: "",
                    };
                }
                return {
                    ability_level: "C",
                    spirit_animal: "",
                    spirit_animal_desc: "",
                    spirit_animal_personality: "",
                    spiritual_sea_desc: "",
                };
            })(),
        },
        dynamic: {
            time_tracker: {
                story_date: storyStartDate.format("YYYY-MM-DD"),
            },
        },
    };
}

/**
 * 【修正版】处理注册表单的提交，修复了 try-catch 语法闭合错误及遗留重复代码
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
    if (checkRepro === "胎生" && checkGest < 2) {
        return toastr.error("胎生孕期不允许少于2个月。", "残酷警告");
    }

    const submitBtn = $("#b-reg-submit-btn");
    submitBtn
        .prop("disabled", true)
        .html(
            '<i class="fa-solid fa-spinner fa-spin"></i> 正在构建灵魂档案...',
        );

    // 关闭所有滞留的旧提示框
    toastr.clear();

    try {
        let formData = gatherFormData();
        const race = $("#b-reg-race").val();

        // ====== 统一获取 API 调用函数 ======
        const pluginSettings =
            SillyTavern.getContext().extensionSettings[SETTINGS_KEY] || {};
        const useExternalApi =
            pluginSettings.useExternalCustomFetch &&
            pluginSettings.apiKey &&
            pluginSettings.apiUrl;
        const callApi = useExternalApi
            ? (prompt) => callExternalApi(prompt, pluginSettings)
            : (prompt) => context.generateRaw({ prompt });

        // ====== 辅助：解析 AI 返回的 JSON ======
        function parseApiJson(raw) {
            let text = String(raw);
            const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
            if (fenced?.[1]) text = fenced[1];
            else {
                const obj = text.match(/\{[\s\S]*\}/);
                if (obj?.[0]) text = obj[0];
            }
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== "object")
                throw new Error("返回格式不正确");
            return parsed;
        }

        context.showLoader();
        toastr.info("正在生成角色档案，只需一次调用...", "系统运行", {
            timeOut: 3000,
        });

        // ====== 构建统一提示词 ======
        const userPersona = $("#b-reg-custom-extra").val()?.trim() || "普通人";
        const obsceneExtra = $("#b-reg-obscene-toggle").is(":checked")
            ? $("#b-reg-obs-extra-text")?.val()?.trim() || ""
            : "";
        const secType = formData.semi_fixed.secondary_gender_type || "无";
        const secGender = formData.semi_fixed.secondary_gender || "";

        let combinedPrompt = `你是一个角色数据生成专家。请根据以下用户信息，一次性生成完整的种族与第二性别特征数据。\n\n`;
        combinedPrompt += `【用户基础信息】\n`;
        combinedPrompt += `姓名：${formData.fixed.name || "用户"}\n`;
        combinedPrompt += `性别：${formData.fixed.gender || "女"}\n`;
        combinedPrompt += `种族：${race}\n`;
        combinedPrompt += `性格与气质：${userPersona}\n`;
        if (obsceneExtra) combinedPrompt += `深度设定：${obsceneExtra}\n`;
        combinedPrompt += `\n`;

        // 定义最终 JSON 结构
        let jsonShape = {};

        // ---- 种族分支 ----
        if (race === "兽人") {
            const { beastRacePrompts } = await import("./prompts.js");
            const beastCat = formData.semi_fixed.beast_category || "随机";
            const beastSub = formData.semi_fixed.beast_subrace || "";
            const isRandom = beastCat === "随机";

            if (isRandom) {
                const charName = formData.fixed.name || "{{user}}";
                combinedPrompt += beastRacePrompts.prompt.replace(
                    /\{\{user\}\}/g,
                    charName,
                );
            } else {
                combinedPrompt += beastRacePrompts.promptByCategory(
                    beastCat,
                    beastSub,
                );
            }

            jsonShape.beast_category = "string（大类，如：猫）";
            jsonShape.beast_subrace =
                "string（细分种族，尽量稀有独特，如：帕拉斯猫）";
            jsonShape.beast_features =
                "string（雌性种族习性与特征描述，不超过200字，用分号分隔）";
            jsonShape.traits = [
                "性格标签1（仅来自user的性格气质，与种族无关）",
                "生活标签2",
                "生活标签3（仅来自user的生活习惯，与种族无关）",
            ];
        } else if (race === "魅魔") {
            const { succubusPrompts: sp } = await import("./prompts.js");
            combinedPrompt += sp.prompt + "\n\n";
            combinedPrompt += `【参考资料】\n世界观：${sp.world}\n摄食机制：${sp.diet}\n种族信息：${sp.race}\n淫纹规则：${sp.crest}\n特异机制：${sp.mechanism}\n`;

            jsonShape.race_appearance = "string（外貌特征，不超过150字）";
            jsonShape.race_body_state = "string（身体状态，不超过100字）";
            jsonShape.race_core_mechanic =
                "string（核心特异机制，不超过150字）";
            jsonShape.aphrodisiac_mechanic = "string（催淫机制，不超过100字）";
            jsonShape.crest_system = "string（淫纹系统，不超过100字）";
            jsonShape.traits = [
                "性格标签1（仅来自user的性格气质，与种族无关）",
                "生活标签2",
                "生活标签3（仅来自user的生活习惯，与种族无关）",
            ];
        } else if (race === "自设") {
            const { customRacePrompts: crp } = await import("./prompts.js");
            combinedPrompt += crp.prompt;

            jsonShape.race_appearance = "string（外貌特征，不超过150字）";
            jsonShape.race_body_state = "string（身体状态，不超过100字）";
            jsonShape.race_core_mechanic = "string（核心机制，不超过150字）";
            jsonShape.traits = [
                "性格标签1（仅来自user的性格气质，与种族无关）",
                "生活标签2",
                "生活标签3（仅来自user的生活习惯，与种族无关）",
            ];
        } else {
            // 人类
            jsonShape.traits = [
                "性格标签1（仅来自user的性格气质，与种族无关）",
                "生活标签2",
                "生活标签3（仅来自user的生活习惯，与种族无关）",
            ];
        }

        // ---- 第二性别分支（合并进同一提示词）----
        if (secType !== "无") {
            const { secondaryGenderPrompts: sgp } =
                await import("./prompts.js");

            combinedPrompt += `\n\n【第二性别系统设定要求】\n`;
            combinedPrompt += `类型：${secType}\n`;
            if (secGender) combinedPrompt += `具体性别：${secGender}\n`;

            let secPromptData = null;
            if (secType === "ABO") secPromptData = sgp.abo;
            else if (secType === "天乾地坤") secPromptData = sgp.tiangan;
            else if (secType === "哨向") secPromptData = sgp.sentinel;

            if (secPromptData) {
                const genderRef =
                    secPromptData.genders?.[secGender] ||
                    "[请根据该性别基本特征自由发挥]";
                const worldRef = secPromptData.world || "";

                // 哨向：精神体参考输入
                const spiritAnimalInput =
                    $("#b-reg-spirit-animal").val()?.trim() || "";
                const abilityLevel =
                    formData.semi_fixed.sentinel_guide_config?.ability_level ||
                    "C";
                const sentinelExtra =
                    secType === "哨向"
                        ? `\n【能力等级】${abilityLevel}\n【精神体参考（用户指定，可自由发挥）】${spiritAnimalInput || "由AI决定"}`
                        : "";

                const secPromptText = secPromptData.prompt
                    .replace(/\{\{user\}\}/g, formData.fixed.name || "{{user}}")
                    .replace(/\{\{secondary_gender\}\}/g, secGender);

                combinedPrompt += `${secPromptText}\n\n${worldRef}\n${genderRef}${sentinelExtra}\n`;

                // 注入 JSON 字段要求
                jsonShape.secondary_gender_features =
                    "string（第二性别特征描述，不超过200字，用分号分隔，只写该user的个性化特征，不写通用世界观科普）";

                if (secType === "ABO" || secType === "天乾地坤") {
                    const scentWord =
                        secType === "天乾地坤" ? "体香" : "信息素气味";
                    jsonShape.pheromone_scent = `string（${scentWord}描述，20-40字，独特新颖，每次不同，避免雪松/玫瑰等滥用词汇）`;
                }

                if (secType === "哨向") {
                    const roleType = secGender === "哨兵" ? "哨兵" : "向导";
                    const roleHint =
                        roleType === "向导"
                            ? "治愈性强、共情能力出色、不喜战斗、擅长安抚"
                            : "攻击性强、保护欲强烈、警戒心高、感官敏锐";
                    jsonShape.spirit_animal =
                        "string（精神体动物种类名，如：帕拉斯猫/藏狐/军舰鸟）";
                    jsonShape.spirit_animal_desc =
                        "string（精神体外形描述，30-60字，描述外观与特征）";
                    jsonShape.spirit_animal_personality = `string（精神体独立性格，60-100字，禁止超过120字。必须体现：①该动物真实习性的拟人化行为；②与宿主性格【${userPersona}】的共鸣或互补，宿主什么性格精神体就往那个方向靠拢；③${roleHint}；④用具体行为举例，如"会主动推开靠近宿主的陌生人"；用逗号分隔。禁止使用"高傲""智慧""纯净"等空洞形容词；只写行为，不写抽象性格标签）`;
                    jsonShape.spiritual_sea_desc =
                        "string（精神海景观描述，30-50字，呈现独特意象和氛围）";
                }
            }
        }

        // ---- 输出格式要求 ----
        combinedPrompt += `\n\n【输出要求】\n`;
        combinedPrompt += `必须返回纯JSON格式（不要加Markdown代码块），结构严格如下：\n`;
        combinedPrompt += JSON.stringify(jsonShape, null, 2);
        combinedPrompt += `\n\n注意事项：\n`;
        combinedPrompt += `1. 细分种族要独特稀有，尽量每次生成都不同\n`;
        combinedPrompt += `2. 精神体性格用具体行为描述，不要空洞词汇\n`;
        combinedPrompt += `3. 信息素/体香描述要独特，每次生成都不同\n`;
        combinedPrompt += `4. 所有描述只写该user的个性化内容，不写世界观通识\n`;
        combinedPrompt += `5. traits 标签【严格只反映 user 的性格与生活习惯】，与种族、第二性别、精神体完全无关。例如user设定是"容易害羞、喜欢吃东西、讨厌水"，traits 就是["容易害羞","喜欢吃东西","讨厌水"]，绝对不出现任何种族特征词汇\n`;

        updateDebugPanelIO(combinedPrompt, "正在生成...");

        // ====== 单次 API 调用 ======
        const rawResponse = await callApi(combinedPrompt);
        updateDebugPanelIO(combinedPrompt, rawResponse);

        let allData;
        try {
            allData = parseApiJson(rawResponse);
        } catch (parseErr) {
            throw new Error(
                `AI未能返回有效JSON：${parseErr.message}。内容开头：${String(rawResponse).substring(0, 80)}`,
            );
        }

        // ====== 写入 formData ======

        // traits（全种族通用）
        formData.semi_fixed.traits = Array.isArray(allData.traits)
            ? allData.traits
            : [];

        if (race === "兽人") {
            const validCategories = [
                "犬",
                "狼",
                "猫",
                "马",
                "牛",
                "狐",
                "鸟",
                "蛇",
                "豹",
                "虎",
                "鲛人",
                "兔",
                "羊",
            ];
            const isRandom = formData.semi_fixed.beast_category === "随机";

            if (isRandom) {
                const { beastRacePrompts } = await import("./prompts.js");
                const returnedCat = allData.beast_category || "";
                formData.semi_fixed.beast_category = validCategories.includes(
                    returnedCat,
                )
                    ? returnedCat
                    : "犬";
                formData.semi_fixed.beast_race =
                    formData.semi_fixed.beast_category;

                // 补充发情期日历默认值
                const defaults =
                    beastRacePrompts.categoryDefaults[
                        formData.semi_fixed.beast_category
                    ];
                if (defaults) {
                    formData.semi_fixed.reproduction_type =
                        defaults.reproduction;
                    formData.semi_fixed.gestation_duration = defaults.gestation;
                    formData.semi_fixed.beast_heat_calendar = {
                        heat_events: defaults.heat_events || [],
                    };
                }
            }

            if (allData.beast_subrace) {
                formData.semi_fixed.beast_subrace = allData.beast_subrace;
            }
            formData.semi_fixed.beast_features = allData.beast_features || "";
        }

        if (race === "魅魔" || race === "自设") {
            formData.semi_fixed.race_appearance = allData.race_appearance || "";
            formData.semi_fixed.race_body_state = allData.race_body_state || "";
            formData.semi_fixed.race_core_mechanic =
                allData.race_core_mechanic || "";
            formData.semi_fixed.aphrodisiac_mechanic =
                allData.aphrodisiac_mechanic || "";
            formData.semi_fixed.crest_system = allData.crest_system || "";

            const personaParts = [
                allData.race_appearance
                    ? `外貌特征: ${allData.race_appearance}`
                    : "",
                allData.race_body_state
                    ? `身体状态: ${allData.race_body_state}`
                    : "",
                allData.race_core_mechanic
                    ? `特异机制: ${allData.race_core_mechanic}`
                    : "",
                allData.aphrodisiac_mechanic
                    ? `催淫机制: ${allData.aphrodisiac_mechanic}`
                    : "",
                allData.crest_system ? `淫纹系统: ${allData.crest_system}` : "",
            ].filter(Boolean);
            formData.semi_fixed.generated_persona = personaParts.join("\n");
        }

        if (secType !== "无" && allData.secondary_gender_features) {
            formData.semi_fixed.secondary_gender_features =
                allData.secondary_gender_features;

            if (secType === "ABO" || secType === "天乾地坤") {
                // 用户有手动输入时保留用户输入，否则用 AI 生成的
                if (!formData.semi_fixed.abo_config.pheromone_scent) {
                    formData.semi_fixed.abo_config.pheromone_scent =
                        allData.pheromone_scent || "";
                }
            }

            if (secType === "哨向") {
                formData.semi_fixed.sentinel_guide_config.spirit_animal =
                    allData.spirit_animal || "";
                formData.semi_fixed.sentinel_guide_config.spirit_animal_desc =
                    allData.spirit_animal_desc || "";
                formData.semi_fixed.sentinel_guide_config.spirit_animal_personality =
                    allData.spirit_animal_personality || "";
                formData.semi_fixed.sentinel_guide_config.spiritual_sea_desc =
                    allData.spiritual_sea_desc || "";
            }
        }

        // ====== 保存预设（可选）======
        if ($("#b-reg-save-preset-check").is(":checked")) {
            const pName =
                $("#b-reg-preset-name").val().trim() ||
                (race === "兽人"
                    ? `${formData.fixed.name}_${formData.semi_fixed.beast_category}${formData.semi_fixed.beast_subrace ? "_" + formData.semi_fixed.beast_subrace : ""}`
                    : `${formData.fixed.name}_${race}`);
            saveUserPreset(pName, formData);
            toastr.info(`预设 [${pName}] 已保存。`);
        }

        // ====== 注册并完成 ======
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

        context.hideLoader();

        const successMsg =
            race === "兽人"
                ? `${formData.semi_fixed.beast_category}族·${formData.semi_fixed.beast_subrace || ""}特征已生成并注册完成！`
                : "肉体改造与注册完成！所有设定已被系统彻底锁定。";
        toastr.success(successMsg, "烙印成功");

        onChatOrLoad();
    } catch (error) {
        console.error("[Butter Registration] 注册流程失败:", error);
        context.hideLoader();
        toastr.error(
            `注册流程失败: ${error.message}。请检查API连接或F12控制台。`,
            "系统异常",
        );
    } finally {
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
    const skillsBeastSection = $("#bs-skills-beast-section"); // 新增

    succubusSection.hide();
    customSection.hide();
    noneSection.hide();
    skillsBeastSection.hide(); // 新增

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
    } else if (race === "兽人") {
        skillsBeastSection.show();
        $("#bs-beast-skill-subrace").val(semiFixedData.beast_subrace || "");
        $("#bs-beast-skill-features").val(semiFixedData.beast_features || "");
    } else {
        noneSection.show();
    }

    // 【新增】哨向专属区块（不依赖种族，依赖第二性别类型）
    const secTypeCurrent = semiFixedData.secondary_gender_type || "无";
    if (secTypeCurrent === "哨向") {
        const cfg = semiFixedData.sentinel_guide_config || {};
        $("#bs-sentinel-skill-spirit-animal").val(cfg.spirit_animal || "");
        const descAndPersonality = [
            cfg.spirit_animal_desc || "",
            cfg.spirit_animal_personality || "",
        ]
            .filter(Boolean)
            .join("\n\n");
        $("#bs-sentinel-skill-personality").val(descAndPersonality);
        $("#bs-sentinel-skill-spiritual-sea").val(cfg.spiritual_sea_desc || "");
        $("#bs-skills-sentinel-section").show();
    } else {
        $("#bs-skills-sentinel-section").hide();
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
