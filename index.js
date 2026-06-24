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
    getButterState,
    getUserPresets,
    loadUserPresetIntoChat,
    registerButterUser,
    saveButterState,
    saveUserPreset,
} from "./butter_state.js";
import {
    buildSystemWrapper,
    callExternalApi,
    injectButterSystemPrompt,
    runButterTrackingEngine,
    updateDebugPanelIO, // 使用新的专用函数更新Debug IO
} from "./butter_tracker.js";
import { advanceDay } from "./menstrual_cycle_manager.js";
import { succubusPrompts } from "./prompts.js";

// 获取酒馆核心上下文
const context = SillyTavern.getContext();
const { eventSource, event_types, extensionSettings } = context;

// 定义常量
const PLUGIN_DIR = "scripts/extensions/third-party/butter-status-bar";
const SETTINGS_KEY = "butterPluginSettings";
const ROOT_CONTAINER_ID = "butter-root-container";
const BOOTSTRAP_RUNTIME_KEY = "__butter_bootstrap_runtime__";
const APP_READY_HANDLER_KEY = "__butter_app_ready_handler__";

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
// 2. 核心功能组件 (拖拽与响应式)
// (保留您原有的优秀设计)
// ==========================================
function makeDraggable(triggerEl, targetEl) {
    if (!triggerEl || !targetEl) return;

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
            targetEl.style.transform = "none";
        }

        if (isDragging) {
            const dx = e.clientX - pos.startX;
            const dy = e.clientY - pos.startY;
            let newLeft = pos.x + dx;
            let newTop = pos.y + dy;
            const rect = targetEl.getBoundingClientRect();
            newLeft = Math.max(
                0,
                Math.min(newLeft, window.innerWidth - rect.width),
            );
            newTop = Math.max(
                0,
                Math.min(newTop, window.innerHeight - rect.height),
            );
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
            const percentLeft = (rect.left / window.innerWidth) * 100;
            const percentTop = (rect.top / window.innerHeight) * 100;
            targetEl.style.left = `${percentLeft}%`;
            targetEl.style.top = `${percentTop}%`;
        }

        setTimeout(() => {
            isDragging = false;
        }, 50);
    }

    triggerEl.style.cursor = "grab";
    triggerEl.addEventListener("pointerdown", onPointerDown);
}

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
    if (!extensionSettings[SETTINGS_KEY]) {
        extensionSettings[SETTINGS_KEY] = {
            enablePlugin: true,
            useExternalCustomFetch: false,
            apiUrl: "",
            apiKey: "",
            apiModelName: "",
            apiStream: false,
            apiHistoryCount: 10,
            apiRegexFilter: "",
            injectPreset: "default",
            injectionDepth: 2,
            wiMode: "normal",
            wiBlacklist: [],
            wiWhitelist: [],
            user_presets: [],
        };
        // 【核心修正】使用官方提供的 saveSettingsDebounced 函数
        context.saveSettingsDebounced();
    }
}

/**
 * 确保UI模态框被加载并绑定所有内部事件
 */
async function ensureModalAndBindEvents() {
    if ($(`#${ROOT_CONTAINER_ID}`).length) return;

    const mainUiHtml = await $.get(`/${PLUGIN_DIR}/ui.html`);
    const masterName = context.name1 || "主人";
    let injectedHtml = mainUiHtml.replace(/\{\{user\}\}/g, masterName);
    $("body").append(injectedHtml);

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

    // --- 同步"注入深度" --- (如果保留该功能)
    const settings = extensionSettings[SETTINGS_KEY];
    // 我们将深度输入框改为显示当前注入位置，更有意义
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
    root.on("click", "#b-reg-load-preset-btn", async () => {
        const pName = $("#b-reg-preset-loader").val();
        if (!pName) return toastr.warning("请先选择一个预设。");
        // 使用 await 确保加载和保存完成
        if (await loadUserPresetIntoChat(pName)) {
            toastr.success(
                `肉体克隆成功！预设 [${pName}] 已覆盖当前角色。`,
                "深渊降临",
            );
            onChatOrLoad(); // 重新加载所有UI
        }
    });

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
    const settings = extensionSettings[SETTINGS_KEY];

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
        settings.apiRegexFilter = $(this).val();
        context.saveSettingsDebounced();
        toastr.info("API聊天记录裁剪规则已即时保存。");
    });

    root.on(
        "change",
        "#bs-api-enable-plugin, #bs-api-use-external, #bs-api-stream-toggle",
        function () {
            settings.enablePlugin = $("#bs-api-enable-plugin").is(":checked");
            settings.useExternalCustomFetch = $("#bs-api-use-external").is(
                ":checked",
            );
            settings.apiStream = $("#bs-api-stream-toggle").is(":checked");
            context.saveSettingsDebounced();
            toastr.info("API核心设定已即时保存。");
        },
    );

    root.on("click", "#bs-api-save-btn", function () {
        settings.apiUrl = $("#bs-api-url").val().trim();
        settings.apiKey = $("#bs-api-key").val().trim();
        settings.apiModelName = $("#bs-api-model-name").val().trim();
        settings.apiHistoryCount =
            parseInt($("#bs-api-history-count").val()) || 10;
        settings.apiRegexFilter = $("#bs-api-regex-filter").val();
        context.saveSettingsDebounced();
        toastr.success(
            "神枢控制台的 API 设定已强行覆写并永久保存。",
            "Butter Status",
        );
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
 * 【重构核心】初始化“属性注入”面板，现在它只负责UI事件和数据刷新
 */
function initInjectPanel() {
    const settings = extensionSettings[SETTINGS_KEY];
    const root = $(`#${ROOT_CONTAINER_ID}`);

    // 绑定一次性事件
    if (!uiManager.isInjectPanelInitialized) {
        root.on("change", "#bs-inject-preset", function () {
            settings.injectPreset = $(this).val();
            context.saveSettingsDebounced();
        });

        root.on("change", "#bs-inject-mode", function () {
            settings.wiMode = $(this).val();
            context.saveSettingsDebounced();
        });

        root.on("click", ".bs-wi-tab-btn", function () {
            root.find(".bs-wi-tab-btn").removeClass("active");
            $(this).addClass("active");
            const type = $(this).data("type");
            $("#bs-wi-list-title").text(
                type === "character" ? "角色世界书条目" : "全域世界书条目",
            );
            renderWorldInfoList(type);
        });

        root.on("input", "#bs-wi-search", function () {
            const keyword = $(this).val().toLowerCase();
            root.find(".bs-wi-item").each(function () {
                const itemName = $(this)
                    .find(".bs-wi-name")
                    .text()
                    .toLowerCase();
                $(this).toggle(itemName.includes(keyword));
            });
        });

        uiManager.isInjectPanelInitialized = true;
    }

    // 每次调用都强制刷新数据
    if (
        window.world_info &&
        Array.isArray(window.world_info) &&
        window.world_info.length > 0
    ) {
        renderWorldInfoList("character");
    } else {
        $("#bs-wi-list-container").html(
            '<div class="centered-message">等待世界书加载...</div>',
        );
    }
}

/**
 * 渲染世界书条目列表
 * @param {'character' | 'global'} type - 渲染类型
 */
function renderWorldInfoList(type = "character") {
    const listContainer = $("#bs-wi-list-container");
    const settings = extensionSettings[SETTINGS_KEY];
    listContainer.empty();

    if (!window.world_info || !Array.isArray(window.world_info)) {
        return listContainer.html(
            '<div class="centered-message">未检测到世界书档案。</div>',
        );
    }

    let charWiName = "";
    if (
        context.characterId !== undefined &&
        context.characters[context.characterId]
    ) {
        charWiName =
            context.characters[context.characterId].data?.character_book?.name;
    }

    const filteredWI = window.world_info.filter((entry) => {
        if (!entry) return false;
        const isCharSpecific = entry.book === charWiName && charWiName;
        return type === "character" ? isCharSpecific : !isCharSpecific;
    });

    if (filteredWI.length === 0) {
        return listContainer.html(
            '<div class="centered-message">该分类下无条目。</div>',
        );
    }

    let blacklist = settings.wiBlacklist || [];
    filteredWI.forEach((entry) => {
        if (!entry.uid) return;
        const isChecked = !blacklist.includes(entry.uid);
        const nameLabel =
            entry.name ||
            entry.comment ||
            (Array.isArray(entry.key) ? entry.key.join(",") : "") ||
            `无名档案(UID:${entry.uid.slice(0, 4)})`;

        const itemHtml = `
      <div class="bs-wi-item">
          <input type="checkbox" class="bs-wi-toggle" data-uid="${entry.uid}" ${isChecked ? "checked" : ""}>
          <span class="bs-wi-name" title="${entry.content || ""}">${nameLabel}</span>
      </div>`;
        listContainer.append(itemHtml);
    });

    // 使用事件委托，确保每次渲染后事件都有效
    listContainer
        .off("change.butter")
        .on("change.butter", ".bs-wi-toggle", function () {
            const uid = $(this).data("uid");
            if (!settings.wiBlacklist) settings.wiBlacklist = [];

            if (!$(this).is(":checked")) {
                if (!settings.wiBlacklist.includes(uid)) {
                    settings.wiBlacklist.push(uid);
                }
            } else {
                settings.wiBlacklist = settings.wiBlacklist.filter(
                    (id) => id !== uid,
                );
            }
            context.saveSettingsDebounced();
        });
}
// ==========================================
// 7. 核心注册表单异步交互
// ==========================================

/**
 * 【终极版】处理注册表单的提交，一次API调用完成所有任务。
 */
async function handleRegistrationSubmit() {
    // --- 1. 前置校验与UI准备 ---
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
        // --- 2. 收集所有用户输入，构建单一、完整的AI指令 ---
        const race = $("#b-reg-race").val();
        const name = $("#b-reg-name").val().trim() || context.name2 || "user";

        const basePrompt = buildPersonaGenerationPrompt(race, {
            fixed: { name },
        });
        const customExtra =
            $("#b-reg-custom-extra").val()?.trim() || "一个普通人";
        const obsceneSettings = $("#b-reg-obscene-toggle").is(":checked")
            ? $("#b-reg-obs-extra-text")?.val() || ""
            : "";

        const finalPrompt = buildSystemWrapper(
            race,
            basePrompt,
            customExtra,
            obsceneSettings,
        );

        updateDebugPanelIO(finalPrompt, "..."); // 立即更新输入
        toastr.info("单一指令已构建，正在连接主源神经，请稍候...", "系统运行", {
            timeOut: 20000,
        });

        // --- 3. 执行【唯一一次】API调用 ---
        const pluginSettings = extensionSettings[SETTINGS_KEY] || {};
        const useExternalApi =
            pluginSettings.useExternalCustomFetch &&
            pluginSettings.apiKey &&
            pluginSettings.apiUrl;

        // 【核心修正】移除 generateRaw 中无效的 quiet: true 参数
        const generateWithSelectedApi = useExternalApi
            ? (prompt) => callExternalApi(prompt, pluginSettings)
            : (prompt) => context.generateRaw({ prompt });

        const rawResponse = await generateWithSelectedApi(finalPrompt);

        updateDebugPanelIO(finalPrompt, rawResponse); // 更新完整IO

        // --- 4. 解析AI返回的完整数据 ---
        const match = String(rawResponse).match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error("AI未能返回有效的JSON格式档案，注册被迫中止。");
        }
        const personaData = JSON.parse(match[0]);

        // --- 5. 带着AI返回的数据，调用 gatherFormData ---
        let formData = gatherFormData(personaData);

        // --- 6. 保存与收尾 ---
        if ($("#b-reg-save-preset-check").is(":checked")) {
            const pName =
                $("#b-reg-preset-name").val().trim() ||
                `${formData.fixed.name}_${race}`;
            // 【核心修正】移除对同步函数的无效 await
            saveUserPreset(pName, formData);
            toastr.info(`预设 [${pName}] 已保存。`);
        }

        // 【核心修正】移除对同步函数的无效 await
        registerButterUser(formData);

        if (
            formData.semi_fixed.obscene_content_enabled &&
            formData.semi_fixed.sensitivity_growth_mode === 100
        ) {
            let state = getButterState();
            if (state) {
                // 安全检查
                Object.keys(state.dynamic.sensitivity).forEach(
                    (key) => (state.dynamic.sensitivity[key] = 100),
                );
                saveButterState(state); // 内部是异步防抖保存
            }
        }

        toastr.success(
            "肉体改造与注册完成！您的所有设定已被系统彻底锁定。",
            "烙印成功",
        );

        onChatOrLoad();
    } catch (error) {
        console.error("[Butter Registration] 注册流程失败:", error);
        toastr.error(
            `注册流程失败: ${error.message}。请检查API连接或F12控制台。`,
            "系统异常",
        );
    } finally {
        submitBtn.prop("disabled", false).html("确认烙印");
    }
}

/**
 * 构建用于生成种族档案的基础Prompt内容
 * @param {string} race
 * @param {object} formData
 * @returns {string}
 */
function buildPersonaGenerationPrompt(race, formData) {
    let promptArr = [];
    try {
        if (race === "魅魔") {
            promptArr = [
                "【执行指令】\n" + ($("#b-reg-suc-prompt").val() || ""),
                "【世界观参考】\n" + ($("#b-reg-suc-world").val() || ""),
                "【摄食指南】\n" + ($("#b-reg-suc-diet").val() || ""),
                "【种族参考】\n" + ($("#b-reg-suc-race").val() || ""),
                "【淫纹设定参考】\n" + ($("#b-reg-suc-crest").val() || ""),
                "【催淫机制】\n" + ($("#b-reg-suc-mech").val() || ""),
                "【灵魂契约】\n" + ($("#b-reg-suc-soul").val() || ""),
            ];
            return promptArr
                .join("\n\n")
                .replace(/\{\{user\}\}/g, formData.fixed.name || context.name1);
        } else if (race === "自设") {
            promptArr = [
                "【基本世界观】\n" + ($("#b-reg-custom-world").val() || ""),
                "【多样性设定】\n" + ($("#b-reg-custom-diversity").val() || ""),
                "【种族技能/弱点】\n" + ($("#b-reg-custom-skills").val() || ""),
            ];
            return promptArr.join("\n\n");
        }
    } catch (e) {
        console.error("构建基础Prompt时发生错误", e);
    }
    return "";
}

/**
 * 从UI和AI返回的数据中收集并格式化最终的档案
 * @param {object} generatedData - AI生成的机能档案和特征
 * @returns {object} - 完整的肉体状态对象
 */
function gatherFormData(generatedData = {}) {
    const race = $("#b-reg-race").val();
    const selectedDays = [];
    $("#b-reg-calendar-container .butter-calendar-day.selected").each(
        function () {
            selectedDays.push(parseInt($(this).text()));
        },
    );

    const safeVal = (selector) => $(selector).val() || "";

    const traitsArray =
        generatedData.traits && Array.isArray(generatedData.traits)
            ? generatedData.traits
            : [];

    let personaTexts = [];
    if (race === "魅魔") {
        personaTexts = [
            generatedData.race_appearance
                ? `外貌特征: ${generatedData.race_appearance}`
                : "",
            generatedData.race_body_state
                ? `身体状态: ${generatedData.race_body_state}`
                : "",
            generatedData.race_core_mechanic
                ? `特异机制: ${generatedData.race_core_mechanic}`
                : "",
            generatedData.aphrodisiac_mechanic
                ? `催淫机制: ${generatedData.aphrodisiac_mechanic}`
                : "",
            generatedData.crest_system
                ? `淫纹系统: ${generatedData.crest_system}`
                : "",
        ];
    } else if (race === "自设") {
        personaTexts = [
            generatedData.race_appearance
                ? `外貌特征: ${generatedData.race_appearance}`
                : "",
            generatedData.race_body_state
                ? `身体状态: ${generatedData.race_body_state}`
                : "",
            generatedData.race_core_mechanic
                ? `特异机制: ${generatedData.race_core_mechanic}`
                : "",
        ];
    }
    const finalGeneratedPersona = personaTexts.filter(Boolean).join("\n");

    return {
        fixed: {
            name: safeVal("#b-reg-name").trim() || context.name2 || "user",
            gender: safeVal("#b-reg-gender"),
            race:
                race === "自设"
                    ? safeVal("#b-reg-custom-name").trim() || "新物种"
                    : race,
            birthday: safeVal("#bs-reg-birthday").trim(),
            cycle_base: {
                menstrual_dates:
                    selectedDays.length > 0
                        ? selectedDays.sort((a, b) => a - b)
                        : [1, 2, 3, 4, 5],
                average_cycle: parseInt(safeVal("#b-reg-avg-cycle")) || 28,
            },
        },
        semi_fixed: {
            reproduction_type: safeVal("#b-reg-repro") || "胎生",
            gestation_duration: parseInt(safeVal("#b-reg-gestation")) || 10,
            race_appearance: generatedData.race_appearance || "",
            race_body_state: generatedData.race_body_state || "",
            race_core_mechanic: generatedData.race_core_mechanic || "",
            aphrodisiac_mechanic: generatedData.aphrodisiac_mechanic || "",
            crest_system: generatedData.crest_system || "",
            custom_erogenous_zones: safeVal("#b-reg-custom-sens").trim(),
            pronoun: safeVal("#b-reg-pronoun") || "她",
            obscene_content_enabled: $("#b-reg-obscene-toggle").is(":checked"),
            sensitivity_growth_mode: parseInt(safeVal("#b-reg-obs-sens")) || 1,
            lactation_setting: safeVal("#b-reg-obs-lac") || "孕后哺乳期产乳",
            pregnancy_setting: safeVal("#b-reg-obs-preg") || "正常孕期",
            generated_persona: finalGeneratedPersona,
            traits: traitsArray,
        },
    };
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
