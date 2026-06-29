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
      "/getvar var_name=world_info.globalSelect",
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
      console.warn(`[Butter UI] 视图切换失败，未找到目标面板: #${targetId}`);
      root.find("#butter-tab-home").fadeIn(200);
      root
        .find('.butter-tab[data-target="butter-tab-home"]')
        .addClass("active");
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
    console.error("[Butter Status] Bootstrap failed catastrophically:", error);
    toastr.error("Butter Status 插件引导失败，请检查F12控制台。", "致命错误");
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
    toastr.info("当前角色尚未注册肉体档案，请先完成烙印。", "Butter Status");
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
    $("#bs-setting-repro").val(state.semi_fixed.reproduction_type || "胎生");
    $("#bs-setting-gestation").val(state.semi_fixed.gestation_duration || 10);
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
        helpString: "【Butter Status】手动推进时间。用法：/advday [天数]。",
      }),
    );
    context.SlashCommandParser.addCommandObject(
      context.SlashCommand.fromProps({
        name: "bset",
        callback: async (args, value) => {
          let state = getButterState();
          if (!state) {
            return toastr.error("【错误】未找到肉体档案，无法执行修改。");
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
              return toastr.error(`【类型错误】'${parts[1]}' 无法转换为数字。`);
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
      toastr.warning("【堕落指令已执行】所有感官已被改造至极限！", "系统警告");
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
    settings.apiHistoryCount = parseInt($("#bs-api-history-count").val()) || 10;
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
      if (!response.ok) throw new Error(`服务器返回状态: ${response.status}`);
      const data = await response.json();
      const modelList = $("#bs-api-model-list");
      modelList
        .empty()
        .append('<option value="">-- 请选择一个模型 --</option>');
      if (data && Array.isArray(data.data)) {
        data.data.forEach((model) => {
          modelList.append(`<option value="${model.id}">${model.id}</option>`);
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
async function initInjectPanel() {
  const root = $(`#${ROOT_CONTAINER_ID}`);

  // 使用 isInjectPanelInitialized 标志确保事件只被绑定一次，防止重复监听
  if (!uiManager.isInjectPanelInitialized) {
    const settings = extensionSettings[SETTINGS_KEY];

    // 1. 预设选择下拉菜单的事件绑定
    root.on("change", "#butter-inject-preset-select", function () {
      settings.injectPreset = $(this).val();
      context.saveSettingsDebounced();
      console.log(`[Butter] 注入预设已切换为: ${settings.injectPreset}`);
    });

    // 2. 世界书传输模式下拉菜单的事件绑定
    root.on("change", "#butter-inject-mode-select", function () {
      settings.wiMode = $(this).val();
      context.saveSettingsDebounced();
      console.log(`[Butter] 世界书传输模式已切换为: ${settings.wiMode}`);
    });

    // 3. 【核心恢复】角色/全局世界书标签页切换事件
    root.on("click", ".butter-wi-tab-btn", function () {
      // 如果已经是激活状态，则不执行任何操作，避免不必要的刷新
      if ($(this).hasClass("active")) return;

      // 移除所有标签的激活状态，并为当前点击的标签添加激活状态
      root.find(".butter-wi-tab-btn").removeClass("active");
      $(this).addClass("active");

      // 切换时，隐藏所有的列表容器
      $("#butter-inject-char-wb-list, #butter-inject-global-wb-list").hide();
      // 获取当前点击的标签页所对应的列表容器ID
      const targetListId = $(this).data("target");
      // 只显示目标列表容器
      $(`#${targetListId}`).show();

      // 重新加载并渲染对应列表的数据
      updateInjectPanelData();
    });

    // 4. 世界书搜索框的实时输入过滤事件
    root.on("input", "#butter-inject-search-input", function () {
      const keyword = $(this).val().toLowerCase();
      // 在当前可见的列表容器中进行搜索
      $(".butter-worldbook-container:visible .butter-worldbook-item").each(
        function () {
          const itemName = $(this)
            .find(".butter-worldbook-name")
            .text()
            .toLowerCase();
          $(this).toggle(itemName.includes(keyword));
        },
      );
    });

    // 标记为已初始化
    uiManager.isInjectPanelInitialized = true;
  }

  // 每次打开或调用此函数时，都强制刷新所有数据
  await updateInjectPanelData();
}

/**
 * 【新增】负责从可靠API获取预设和世界书数据并触发渲染
 */
async function updateInjectPanelData() {
  const root = $(`#${ROOT_CONTAINER_ID}`);

  // --- 1. 加载并填充预设下拉菜单 ---
  try {
    const presetManager = context.getPresetManager();
    if (presetManager) {
      const allPresets = presetManager.getAllPresets();
      const $presetSelect = $("#butter-inject-preset-select");
      const currentVal = $presetSelect.val(); // 保存当前选择
      $presetSelect
        .empty()
        .append('<option value="">跟随酒馆当前预设</option>');
      if (allPresets && allPresets.length > 0) {
        allPresets.forEach((preset) => {
          $presetSelect.append(
            `<option value="${preset.name}">${preset.name}</option>`,
          );
        });
      }
      $presetSelect.val(currentVal); // 恢复之前的选择
    }
  } catch (e) {
    console.error("[Butter] 更新预设列表失败:", e);
  }

  // --- 2. 【核心恢复】加载并填充世界书列表 ---
  const charListContainer = $("#butter-inject-char-wb-list");
  const globalListContainer = $("#butter-inject-global-wb-list");

  // 开始加载前，显示“正在扫描”提示
  charListContainer.html(
    '<div class="butter-no-item-msg">正在扫描角色世界书...</div>',
  );
  globalListContainer.html(
    '<div class="butter-no-item-msg">正在扫描全局世界书...</div>',
  );

  try {
    // 2a. 使用最可靠的方式获取角色绑定的世界书
    const characterId = context.characterId;
    const character = context.characters[characterId];
    const characterBooks =
      character && Array.isArray(character.world_books)
        ? character.world_books
        : [];

    // 渲染角色世界书列表
    renderWorldInfoList(characterBooks, charListContainer, "character");

    // 2b. 使用您之前确认有效的斜杠命令方式获取全局世界书
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
        // 返回的 pipe 是一个 JSON 字符串数组，需要解析
        const parsedPipe = JSON.parse(globalInfoResult.pipe);
        if (Array.isArray(parsedPipe)) {
          globalBooks = parsedPipe;
        }
      } catch (jsonError) {
        console.error("[Butter] 解析全局世界书列表JSON失败:", jsonError);
      }
    }

    // 渲染全局世界书列表
    renderWorldInfoList(globalBooks, globalListContainer, "global");
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
 * 【重构版】渲染世界书条目列表
 * @param {string[]} bookList - 从可靠API获取的书籍名称数组
 * @param {jQuery} listContainer - 要渲染到的jQuery容器对象
 */
function renderWorldInfoList(bookList = [], listContainer) {
  const settings = extensionSettings[SETTINGS_KEY];
  listContainer.empty();

  if (bookList.length === 0) {
    const message = listContainer.attr("id").includes("char")
      ? "未检测到角色链接的世界书。"
      : "未检测到启用的全局世界书。";
    return listContainer.html(
      `<div class="butter-no-item-msg">${message}</div>`,
    );
  }

  let blacklist = settings.wiBlacklist || [];

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
      if (!settings.wiBlacklist) settings.wiBlacklist = [];

      if (!$(this).is(":checked")) {
        if (!settings.wiBlacklist.includes(bookName)) {
          settings.wiBlacklist.push(bookName);
        }
      } else {
        settings.wiBlacklist = settings.wiBlacklist.filter(
          (name) => name !== bookName,
        );
      }
      context.saveSettingsDebounced();
      console.log("[Butter] 世界书黑名单已更新:", settings.wiBlacklist);
    });
}

// ==========================================
// 7. 核心注册表单异步交互
// ==========================================

/**
 * 【终极版】处理注册表单的提交，一次API调用完成所有任务。
 */
async function handleRegistrationSubmit() {
  // --- 1. 前置校验 ---
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
    .html('<i class="fa-solid fa-spinner fa-spin"></i> 正在构建灵魂档案...');

  try {
    // --- 2. 从UI收集数据并计算周期 (不含AI部分) ---
    let formData = gatherFormData();

    // --- 3. 构建AI指令并执行调用 ---
    const race = formData.fixed.race;
    let generatedData = {}; // 初始化AI数据容器

    // 所有种族都执行AI调用
    const basePrompt = buildPersonaGenerationPrompt(race, formData); // 传递formData以获取name等信息
    const customExtra = $("#b-reg-custom-extra").val()?.trim() || "一个普通人";
    const obsceneSettings = $("#b-reg-obscene-toggle").is(":checked")
      ? $("#b-reg-obs-extra-text")?.val() || ""
      : "";
    const finalPrompt = buildSystemWrapper(
      race,
      basePrompt,
      customExtra,
      obsceneSettings,
    );

    updateDebugPanelIO(finalPrompt, "...");
    toastr.info("正在连接主源神经生成核心档案...", "系统运行", {
      timeOut: 20000,
    });

    const pluginSettings = extensionSettings[SETTINGS_KEY] || {};
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
      const fencedMatch = responseText.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
      if (fencedMatch && fencedMatch[1]) jsonString = fencedMatch[1];
      else {
        const objectMatch = responseText.match(/\{[\s\S]*\}/);
        if (objectMatch && objectMatch[0]) jsonString = objectMatch[0];
      }
      if (!jsonString)
        throw new Error("在AI的回复中未找到任何有效的JSON结构。");
      const parsedData = JSON.parse(jsonString);
      if (!parsedData || typeof parsedData !== "object")
        throw new Error("解析出的JSON格式不正确。");
      generatedData = parsedData;
    } catch (e) {
      throw new Error(`AI未能返回有效的JSON档案: ${e.message}`);
    }

    // --- 4. 将AI返回的数据合并到 formData 中 ---
    formData.semi_fixed.traits =
      generatedData.traits && Array.isArray(generatedData.traits)
        ? generatedData.traits
        : [];
    formData.semi_fixed.race_appearance = generatedData.race_appearance || "";
    formData.semi_fixed.race_body_state = generatedData.race_body_state || "";
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

    // --- 5. 保存与收尾 ---
    if ($("#b-reg-save-preset-check").is(":checked")) {
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
  // 这个函数现在几乎不需要了，因为主要逻辑移到了 buildSystemWrapper 中
  // 但我们保留它以备将来扩展
  if (race === "魅魔") {
    // 可以返回一些魅魔特有的基础设定文本
    return "请详细描述一个魅魔的生理特征和能量系统。";
  } else if (race === "自设") {
    return "请根据用户提供的关键词，创造一个新种族的生理特征。";
  } else {
    // 人类
    return "请根据用户提供的人设，总结出其核心人格特质。";
  }
}
function buildSystemWrapper(race, basePrompt, extraSettings, obsceneSettings) {
  let jsonFormat;
  let instructions;

  if (race === "魅魔") {
    instructions =
      "你的任务是扮演一个生理数据生成器，详细描述一个魅魔的所有生理机能、外貌、淫纹和能量系统。同时，你必须从所有设定中归纳出3-5个最核心的'traits'标签。";
    jsonFormat = `{"race_appearance": "外貌特征描述", "race_body_state": "身体状态描述", "race_core_mechanic": "特异机制", "aphrodisiac_mechanic": "催淫机制", "crest_system": "淫纹系统", "traits": ["标签1", "标签2", "标签3"]}`;
  } else if (race === "自设") {
    instructions =
      "你的任务是扮演一个世界构建AI，根据用户提供的设定，创造一个新种族的完整生理机制，并归纳出3-5个核心'traits'标签。";
    jsonFormat = `{"race_appearance": "外貌特征描述", "race_body_state": "身体状态描述", "race_core_mechanic": "特异机制", "traits": ["标签1", "标签2", "标签3"]}`;
  } else {
    // 人类
    instructions =
      "你的任务是扮演一个精准的人格分析师。你只需要分析用户提供的补充人设，并从中提炼出3-5个最核心、最能概括其性格和命运的'traits'（特征）标签。不要添加任何生理或种族描述。";
    jsonFormat = `{"traits": ["标签1", "标签2", "标签3"]}`;
  }

  const wrapper = `[系统底层最高优先级绝对指令]
${instructions}
【绝对规则】:
- 你的回复【必须且只能】是一个合法的、纯净的JSON对象，不包含任何Markdown代码块(如 \`\`\`json)或解释性文字。
- JSON的结构必须严格遵循以下格式:
${jsonFormat}

【分析素材】:
- 核心人设: ${extraSettings || "一个普通人"}
- 深度生殖与恶俗设定 (如有): ${obsceneSettings || "无"}
- 基础指引: ${basePrompt}
`;
  return wrapper;
}

/**
 * 【最终版】整合UI输入，并执行抗风险的生理周期基准日计算
 * @returns {object} 返回一个只包含UI输入和计算结果的“半成品”formData
 */
function gatherFormData() {
  const safeVal = (selector) => $(selector).val() || "";
  const moment = SillyTavern.libs.moment;

  // --- 1. 定义有效年份范围，作为判断日期是否“离谱”的标尺 ---
  const VALID_YEAR_RANGE = { min: 1800, max: 2300 }; // 允许一个较宽的范围

  // --- 2. 决策一个绝对安全的剧情开始日期 (storyStartDate) ---
  let storyStartDate;
  const birthdayInput = safeVal("#bs-reg-birthday").trim();
  const yearMatch = birthdayInput.match(/(\d{4})/); // 从生日输入中尝试提取4位数的年份

  if (yearMatch && yearMatch[1]) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= VALID_YEAR_RANGE.min && year <= VALID_YEAR_RANGE.max) {
      // 如果生日年份有效，则使用该年份的1月1日作为故事的起始锚点
      storyStartDate = moment(`${year}-01-01`, "YYYY-MM-DD");
      console.log(
        `[Butter Register] 检测到有效生日年份 ${year}，故事时间线已锚定。`,
      );
    }
  }

  // 如果经过以上判断，storyStartDate 仍然未定义（生日未填或格式不符），则使用当前真实日期作为最终备用方案
  if (!storyStartDate) {
    storyStartDate = moment(); // 直接获取当前时间的 moment 对象
    console.log(
      "[Butter Register] 未检测到有效生日，使用当前真实日期作为故事时间锚点。",
    );
  }

  // --- 3. 基于安全的 storyStartDate，智能计算生理周期基准日 ---
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

  // --- 4. 组装并返回表单数据 ---
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
    // 预留一个空的 dynamic.time_tracker，用于后续填充 story_date
    dynamic: {
      time_tracker: {
        story_date: storyStartDate.format("YYYY-MM-DD"), // 将我们决策出的安全日期作为初始剧情日期
      },
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
