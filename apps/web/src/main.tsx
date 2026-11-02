import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FlaskConical,
  History,
  Leaf,
  LoaderCircle,
  Plus,
  ScanLine,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  access,
  clearHistory,
  json,
  loadSettings,
  normalizeBase,
  readHistory,
  remember,
  request,
  storeSettings,
  type Case,
  type Review,
  type Role,
  type Settings,
} from "./api";
import "./style.css";
import { diagnoseDirect, testDirectKeys } from "./direct";
import { sharedAvailable, sharedActive, checkSharedAnswer } from "./shared";

const slots: { role: Role; name: string; hint: string; number: string }[] = [
  {
    role: "leaf_front",
    name: "叶片正面",
    hint: "拍全叶形，呈现病斑分布",
    number: "01",
  },
  {
    role: "leaf_back",
    name: "叶片背面",
    hint: "观察霉层、锈斑与背面纹理",
    number: "02",
  },
  {
    role: "lesion_closeup",
    name: "病斑近照",
    hint: "对焦病健交界，保留细节",
    number: "03",
  },
  {
    role: "healthy_control",
    name: "健康对照",
    hint: "同树或同树种的健康叶片",
    number: "04",
  },
];
const stages = ["图片上传", "图像检查", "专业初筛", "模型复核", "分析完成"];
const stageIndex: Record<string, number> = {
  queued: 1,
  quality_checking: 1,
  identifying: 2,
  reviewing: 3,
  completed: 4,
};
type Selected = { file: File; url: string };
function App() {
  const [page, setPage] = useState(location.hash.slice(1) || "identify");
  const [settings, setSettings] = useState(loadSettings);
  const [images, setImages] = useState<Partial<Record<Role, Selected>>>({});
  const imageRef = useRef(images);
  imageRef.current = images;
  const [species, setSpecies] = useState("");
  const [notes, setNotes] = useState("");
  const [locationText, setLocationText] = useState("");
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<Case | null>(null);
  const [caseBase, setCaseBase] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeStage, setActiveStage] = useState(0);
  const [history, setHistory] = useState(readHistory);
  const [reviewFilter, setReviewFilter] = useState("all");
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const go = (next: string) => {
    location.hash = next;
    setError("");
    setNotice("");
  };
  useEffect(() => {
    const change = () => setPage(location.hash.slice(1) || "identify");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(
    () => () => {
      controller.current?.abort();
      Object.values(imageRef.current).forEach((i) =>
        URL.revokeObjectURL(i.url),
      );
    },
    [],
  );
  function updateSettings(next: Settings) {
    storeSettings(next);
    setSettings(next);
  }
  function select(role: Role, file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("请选择 JPG、PNG 或 WebP 图片。");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("单张图片请控制在 12 MB 以内。");
      return;
    }
    if (images[role]) URL.revokeObjectURL(images[role]!.url);
    setImages((old) => ({
      ...old,
      [role]: { file, url: URL.createObjectURL(file) },
    }));
    setError("");
  }
  function remove(role: Role) {
    if (images[role]) URL.revokeObjectURL(images[role]!.url);
    setImages((old) => {
      const next = { ...old };
      delete next[role];
      return next;
    });
  }
  async function poll(id: string, base: string, signal: AbortSignal) {
    const started = Date.now();
    while (!signal.aborted) {
      const record = await request<Case>(base, `/v1/cases/${id}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
      setCurrent(record);
      setActiveStage(stageIndex[record.status] || 1);
      if (record.status === "completed") return;
      if (
        record.status === "failed" ||
        record.status === "needs_more_information"
      )
        throw new Error(
          record.error_message || "本次分析未完成，请补充图片后重新提交。",
        );
      if (Date.now() - started > 240000)
        throw new Error(
          "等待时间较长，任务可能仍在后台处理。可点击“继续查询”查看结果，无需重复上传。",
        );
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, 1500);
        function done() {
          clearTimeout(t);
          signal.removeEventListener("abort", done);
          resolve();
        }
        signal.addEventListener("abort", done, { once: true });
      });
    }
  }
  async function submit() {
    if (running.current) return;
    if (!slots.slice(0, 3).some((slot) => images[slot.role])) {
      setError("请至少选择一张症状叶片图片：正面、背面或病斑近照。");
      return;
    }
    if (
      !(settings.mode === "direct"
        ? settings.kindwise || settings.deepseek || sharedActive(settings)
        : Object.values(access(settings)).some(Boolean))
    ) {
      go("settings");
      setNotice(
        settings.mode === "direct"
          ? "请先在接口设置中解锁公共体验通道，或填写自己的 API 密钥。"
          : "先填写自己的 API 密钥，或解锁开发者通道。",
      );
      return;
    }
    const base =
      settings.mode === "direct" ? "local:" : normalizeBase(settings.base);
    running.current = true;
    setBusy(true);
    setError("");
    setCurrent(null);
    setActiveStage(0);
    setCaseBase(base);
    setReviewFilter("all");
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (settings.mode === "direct") {
        const record = await diagnoseDirect(
          {
            images: slots
              .filter((slot) => images[slot.role])
              .map((slot) => ({
                role: slot.role,
                file: images[slot.role]!.file,
              })),
            species,
            notes,
            location: locationText,
          },
          settings,
          abort.signal,
          (record) => {
            setCurrent(record);
            setActiveStage(stageIndex[record.status] || 1);
          },
        );
        try {
          remember({
            id: record.case_id,
            species: record.species_input || "未填写树种",
            date: record.created_at,
            base: "local:",
            record,
          });
          setHistory(readHistory());
        } catch {
          setNotice(
            "识别已完成，但浏览器存储不可用，本次报告未保存。请导出报告。",
          );
        }
        return;
      }
      const uploaded = await Promise.all(
        slots
          .filter((slot) => images[slot.role])
          .map(async (slot) => {
            const form = new FormData();
            form.set("role", slot.role);
            form.set("file", images[slot.role]!.file);
            return request<{ object_key: string; role: Role }>(
              base,
              "/v1/uploads",
              {
                method: "POST",
                body: form,
                signal: AbortSignal.any([
                  abort.signal,
                  AbortSignal.timeout(60000),
                ]),
              },
            );
          }),
      );
      const record = await request<Case>(base, "/v1/cases", {
        ...json({
          species_input: species.trim() || null,
          location_text: locationText.trim() || null,
          notes: notes.trim() || null,
          images: uploaded.map(({ object_key, role }) => ({
            object_key,
            role,
          })),
          access: access(settings),
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
      });
      setCurrent(record);
      try {
        remember({
          id: record.case_id,
          species: record.species_input || "未填写树种",
          date: record.created_at,
          base,
        });
        setHistory(readHistory());
      } catch {
        setNotice("浏览器未允许保存本机记录，本次识别仍可继续。");
      }
      await poll(record.case_id, base, abort.signal);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "识别失败，请稍后重试。");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function openCase(id: string, base: string) {
    if (running.current) return;
    running.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setCurrent(null);
    setCaseBase(base);
    setReviewFilter("all");
    go("identify");
    try {
      if (base === "local:") {
        const record = readHistory().find(
          (item) => item.id === id && item.base === base,
        )?.record;
        if (!record) throw new Error("此本机报告不存在或已被清除。");
        setCurrent(record);
        setActiveStage(4);
        return;
      }
      await poll(id, base, abort.signal);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setBusy(false);
      running.current = false;
    }
  }
  const count = Object.keys(images).length;
  const ready =
    settings.mode === "direct"
      ? Boolean(
          settings.kindwise || settings.deepseek || sharedActive(settings),
        )
      : Object.values(access(settings)).some(Boolean);
  const result = current?.result;
  const stop = () => {
    controller.current?.abort();
    setNotice(
      settings.mode === "direct"
        ? "已中止浏览器请求。服务可能已经处理或计费，请勿立即重复提交。"
        : "已停止等待。已创建的任务仍可从识别记录中继续查询。",
    );
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#identify">
          <span className="brand-mark">
            <Leaf size={24} />
          </span>
          <span>
            林叶<span className="brand-sub">FOREST OBSERVATORY</span>
          </span>
        </a>
        <div className="sidebar-label">工作空间</div>
        <nav aria-label="主要导航">
          {[
            { id: "identify", label: "病害识别", Icon: ScanLine },
            { id: "history", label: "识别记录", Icon: History },
            { id: "settings", label: "接口设置", Icon: Settings2 },
            { id: "guide", label: "使用说明", Icon: CircleHelp },
          ].map(({ id, label, Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={page === id ? "nav-item active" : "nav-item"}
            >
              <Icon size={19} />
              {label}
              {page === id && <span className="nav-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="research-badge">
            <FlaskConical size={18} />
            <span>
              让每一次观察
              <br />
              都有据可循
            </span>
          </div>
          <small>
            林木叶片病害辅助识别
            <br />
            专业初筛 · 证据复核
          </small>
          <span className="version">WEB EDITION / 1.0</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            林木健康 /{" "}
            <b>
              {page === "settings"
                ? "接口设置"
                : page === "guide"
                  ? "使用说明"
                  : page === "history"
                    ? "识别记录"
                    : "病害识别"}
            </b>
          </span>
          <button className="connection" onClick={() => go("settings")}>
            <i className={ready ? "dot online" : "dot"} />
            {ready ? "识别通道已配置" : "待配置识别通道"}
            <ChevronRight size={14} />
          </button>
        </header>
        <main>
          <div role="alert">
            {error && (
              <div className="alert error">
                <CircleHelp size={18} />
                <span>{error}</span>
                <button aria-label="关闭错误" onClick={() => setError("")}>
                  <X size={16} />
                </button>
              </div>
            )}
          </div>
          {notice && (
            <div className="alert notice" role="status">
              {notice}
            </div>
          )}
          {page === "guide" ? (
            <GuidePage />
          ) : page === "settings" ? (
            <SettingsPage
              settings={settings}
              update={updateSettings}
              reportError={setError}
              notify={setNotice}
            />
          ) : page === "history" ? (
            <>
              <PageHeading
                eyebrow="OBSERVATION ARCHIVE"
                title="每一次观察，都有迹可循。"
                description="在此浏览这台设备上的识别记录，随时回看证据与复核建议。"
              />
              <section className="panel">
                <div className="section-top">
                  <h2>
                    本机识别记录 <span className="count">{history.length}</span>
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => {
                      clearHistory();
                      setHistory([]);
                    }}
                  >
                    <Trash2 size={16} />
                    清空本机记录
                  </button>
                </div>
                {history.length ? (
                  history.map((item) => (
                    <button
                      disabled={busy}
                      className="history-row"
                      key={item.id + item.base}
                      onClick={() => openCase(item.id, item.base)}
                    >
                      <span className="history-icon">
                        <Leaf size={22} />
                      </span>
                      <span>
                        <strong>{item.species}</strong>
                        <small>
                          {new Date(item.date).toLocaleString("zh-CN")}
                        </small>
                      </span>
                      <span className="history-id">{item.id.slice(0, 8)}</span>
                      <ArrowRight size={18} />
                    </button>
                  ))
                ) : (
                  <div className="empty">
                    <History size={32} />
                    <h3>还没有识别记录</h3>
                    <p>完成第一次叶片观察后，记录会显示在这里。</p>
                    <button className="primary" onClick={() => go("identify")}>
                      开始观察
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}
                <p className="muted fine">
                  纯网页模式将报告保存在本机，不保存密钥和照片。后端模式仅保存任务编号；清空记录不会删除服务器上的病例。
                </p>
              </section>
            </>
          ) : (
            <>
              <PageHeading
                eyebrow="LEAF HEALTH · FIELD NOTES"
                title="从一片叶子，读懂树的健康。"
                description="上传叶片照片，让专业识别与大模型复核，为你的观察提供依据。"
              />
              <div className="identify-layout">
                <div className="input-column">
                  <section className="panel">
                    <div className="section-top">
                      <div>
                        <h2>
                          <span className="step-num">01</span>采集叶片影像
                        </h2>
                        <p className="muted">
                          推荐四张，至少一张症状图即可开始。
                        </p>
                      </div>
                      <span className="pill">{count} / 4 已选择</span>
                    </div>
                    <div className="upload-grid">
                      {slots.map((slot) => (
                        <div className="upload-item" key={slot.role}>
                          <label
                            className={`upload-zone ${images[slot.role] ? "has-image" : ""}`}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (!busy)
                                select(slot.role, e.dataTransfer.files[0]);
                            }}
                          >
                            <input
                              aria-label={`选择${slot.name}`}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={busy}
                              onChange={(e) => {
                                select(slot.role, e.target.files?.[0]);
                                e.target.value = "";
                              }}
                            />
                            {images[slot.role] ? (
                              <>
                                <img
                                  src={images[slot.role]!.url}
                                  alt={slot.name}
                                />
                                <span className="replace-overlay">
                                  点击更换照片
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="upload-plus">
                                  <Plus size={22} strokeWidth={1.5} />
                                </span>
                                <strong>点击上传或拖入照片</strong>
                                <small>JPG / PNG / WebP · 最大 12 MB</small>
                              </>
                            )}
                          </label>
                          {images[slot.role] && (
                            <button
                              className="remove-image"
                              disabled={busy}
                              aria-label={`移除${slot.name}`}
                              onClick={() => remove(slot.role)}
                            >
                              <X size={14} />
                            </button>
                          )}
                          <div className="image-caption">
                            <span>{slot.number}</span>
                            <strong>{slot.name}</strong>
                          </div>
                          <p>{slot.hint}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="panel">
                    <div className="section-top">
                      <div>
                        <h2>
                          <span className="step-num">02</span>补充观察信息
                        </h2>
                        <p className="muted">
                          更多背景，帮助缩小病害候选范围。
                        </p>
                      </div>
                      <span className="optional">选填</span>
                    </div>
                    <div className="two-col">
                      <label>
                        树种名称
                        <input
                          disabled={busy}
                          maxLength={200}
                          placeholder="例如：紫荆、银杏、樟树"
                          value={species}
                          onChange={(e) => setSpecies(e.target.value)}
                        />
                      </label>
                      <label>
                        观察地点
                        <input
                          disabled={busy}
                          maxLength={300}
                          placeholder="例如：江西南昌 · 校园"
                          value={locationText}
                          onChange={(e) => setLocationText(e.target.value)}
                        />
                      </label>
                    </div>
                    <label>
                      症状与环境描述
                      <textarea
                        disabled={busy}
                        maxLength={2000}
                        rows={3}
                        placeholder="例如：下部叶片先发病，近期多雨，病斑逐渐扩大……"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </label>
                  </section>
                  <div className="submit-row">
                    <span>
                      <ShieldCheck size={17} />
                      {settings.mode === "direct"
                        ? "图片直连模型服务，不经过自建后端"
                        : "图片仅在提交后发送至识别服务"}
                    </span>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        void submit().catch((e) => setError(String(e.message)));
                      }}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={18} />
                      ) : (
                        <ScanLine size={18} />
                      )}{" "}
                      {busy ? "正在分析" : "开始识别"}{" "}
                      {!busy && <ArrowRight size={17} />}
                    </button>
                  </div>
                </div>
                <aside className="guide-column">
                  <section className="guide-card">
                    <span className="guide-icon">
                      <Leaf size={28} strokeWidth={1.4} />
                    </span>
                    <span className="eyebrow">A BETTER OBSERVATION</span>
                    <h3>
                      好照片，是可靠
                      <br />
                      判断的第一步。
                    </h3>
                    <p>
                      自然光下拍摄，让叶片占据画面主体。对焦病斑，保留叶缘和叶脉。
                    </p>
                    <div className="guide-divider" />
                    <div className="guide-tip">
                      <Check size={16} />
                      <span>拍清病斑与健康组织交界</span>
                    </div>
                    <div className="guide-tip">
                      <Check size={16} />
                      <span>叶片正反面尽量来自同一叶片</span>
                    </div>
                    <div className="guide-tip">
                      <Check size={16} />
                      <span>避免滤镜、强反光与手部遮挡</span>
                    </div>
                  </section>
                  <div className="process-note">
                    <FlaskConical size={19} />
                    <h4>两阶段判断</h4>
                    <p>
                      专业病害模型提出候选，再由大模型核对证据、指出不确定性并给出后续建议。
                    </p>
                  </div>
                </aside>
              </div>
              {(busy || current) && (
                <section className="panel analysis-panel" aria-live="polite">
                  <div className="section-top">
                    <h2>
                      <span className="step-num">03</span>
                      {result ? "观察结果" : "分析进度"}
                    </h2>
                    {busy ? (
                      <button className="text-button" onClick={stop}>
                        停止等待
                      </button>
                    ) : current && !result && caseBase !== "local:" ? (
                      <button
                        className="text-button"
                        onClick={() => openCase(current.case_id, caseBase)}
                      >
                        继续查询
                      </button>
                    ) : null}
                  </div>
                  <div className="stages">
                    {stages.map((stage, i) => (
                      <div
                        key={stage}
                        className={i <= activeStage ? "stage reached" : "stage"}
                      >
                        <span>
                          {i < activeStage || activeStage === 4 ? (
                            <Check size={14} />
                          ) : i === activeStage && busy ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            i + 1
                          )}
                        </span>
                        {stage}
                      </div>
                    ))}
                  </div>
                  {result && (
                    <>
                      <div className="result-title">
                        <div>
                          <span className="eyebrow">OBSERVATION RESULT</span>
                          <h2>
                            {result.candidates[0]?.display_name ||
                              result.llm_review.reviews[0]?.primary_diagnosis ||
                              "暂无明确病害候选"}
                          </h2>
                          <p className="muted">
                            {current?.species_input || "树种未提供"} ·{" "}
                            {current?.case_id.slice(0, 8)}
                          </p>
                        </div>
                        <div className="strength">
                          <strong>{result.strength}</strong>
                          <span>结论强度</span>
                        </div>
                      </div>
                      {result.candidates.some((c) =>
                        c.candidate_id.startsWith("mock"),
                      ) && (
                        <div className="alert error">
                          专业初筛未取得真实结果。以下模拟候选不能作为病害判断，请检查
                          Kindwise 密钥或服务状态。
                        </div>
                      )}
                      <div className="completeness">
                        <span>
                          信息完整度 <b>{result.information.score}%</b>
                        </span>
                        <div className="meter">
                          <i
                            style={{ width: `${result.information.score}%` }}
                          />
                        </div>
                      </div>
                      <div className="tags">
                        {result.information.provided.map((s) => (
                          <span key={s}>
                            <Check size={13} />
                            {s}
                          </span>
                        ))}
                        {result.information.missing.map((s) => (
                          <span className="missing" key={s}>
                            待补充 · {s}
                          </span>
                        ))}
                      </div>
                      <div className="candidate-list">
                        {result.candidates.map((c, i) => (
                          <article className="candidate" key={c.candidate_id}>
                            <div className="section-top">
                              <h3>
                                <span className="candidate-number">
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                {c.display_name}
                              </h3>
                              <span className="pill">
                                证据等级 · {c.evidence_level}
                              </span>
                            </div>
                            <Evidence
                              title="支持证据"
                              items={c.supporting_evidence}
                            />
                            <Evidence
                              title="冲突与限制"
                              items={c.conflicting_evidence}
                            />
                          </article>
                        ))}
                      </div>
                      <div className="review-header">
                        <div>
                          <span className="eyebrow">SECOND OPINION</span>
                          <h2>大模型证据复核</h2>
                        </div>
                        <span className="pill">
                          {result.llm_review.agreement}
                        </span>
                      </div>
                      <p className="muted">{result.llm_review.summary}</p>
                      {result.llm_review.reviews.length > 1 && (
                        <div className="review-tabs">
                          {[
                            "all",
                            ...result.llm_review.reviews.map((r) => r.provider),
                          ].map((p) => (
                            <button
                              key={p}
                              className={reviewFilter === p ? "selected" : ""}
                              onClick={() => setReviewFilter(p)}
                            >
                              {p === "all" ? "同时查看" : p}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="reviews-grid">
                        {result.llm_review.reviews
                          .filter(
                            (r) =>
                              reviewFilter === "all" ||
                              r.provider === reviewFilter,
                          )
                          .map((r) => (
                            <ReviewCard key={r.provider} review={r} />
                          ))}
                      </div>
                      {!result.llm_review.reviews.length && (
                        <div className="soft-box">
                          <p>本次没有可用的大模型复核。</p>
                          <Evidence
                            title="建议补充"
                            items={result.llm_review.requested_evidence}
                          />
                        </div>
                      )}
                      <div className="next-actions">
                        <h3>下一步观察建议</h3>
                        <Evidence items={result.next_actions} />
                      </div>
                      <p className="safety-note">
                        <ShieldCheck size={17} />
                        {result.safety_note}
                      </p>
                      <div className="result-footer">
                        <details>
                          <summary>查看各环节耗时</summary>
                          {Object.entries(current?.timings || {}).map(
                            ([key, value]) => (
                              <p key={key}>
                                {(
                                  {
                                    image_prepare_ms: "本机图片处理",
                                    quality_check_ms: "图像检查",
                                    kindwise_ms: "专业初筛",
                                    llm_review_ms: "模型复核",
                                    total_processing_ms:
                                      caseBase === "local:"
                                        ? "识别合计"
                                        : "后端合计",
                                  } as Record<string, string>
                                )[key] || key}
                                ：
                                {value === null
                                  ? "—"
                                  : `${(value / 1000).toFixed(1)} 秒`}
                              </p>
                            ),
                          )}
                        </details>
                        <button
                          className="text-button"
                          onClick={() => {
                            const blob = new Blob(
                              [JSON.stringify(current, null, 2)],
                              { type: "application/json" },
                            );
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `林叶-${current?.case_id.slice(0, 8)}.json`;
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          }}
                        >
                          <Download size={16} />
                          导出识别报告
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}
          <footer className="footer">
            <span>林叶 · 用证据理解每一片叶子</span>
            <span>辅助初筛，不能替代实验室检测与专家现场诊断。</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function GuidePage() {
  return (
    <>
      <PageHeading
        eyebrow="FIELD GUIDE"
        title="拍清楚，看证据，再判断。"
        description="给林业观察者的一份简短说明。"
      />
      <section className="panel">
        <h2>四步开始</h2>
        <div className="evidence">
          <ol>
            <li>进入接口设置：填写个人密钥，或回答班级问题启用公共体验。</li>
            <li>
              推荐上传叶片正面、背面、病斑近照和健康对照；至少一张症状图即可提交。
            </li>
            <li>尽量填写树种，点击开始识别。</li>
            <li>
              查看候选、支持与缺失证据，再按建议补拍或送检；记录可回看、报告可导出。
            </li>
          </ol>
        </div>
        <p className="muted fine">
          自然光下拍摄，对焦病斑与健康组织交界，避免反光和遮挡。
        </p>
        <a className="secondary" href="./快速使用说明.md" download>
          <Download size={16} />
          下载极简使用说明
        </a>
      </section>
      <section className="panel">
        <h2>识别原理：先筛查，再复核</h2>
        <div className="evidence">
          <p>
            专业植物健康模型根据叶片外观提出候选；DeepSeek
            再结合照片、树种和候选，检查证据是否充分，给出不确定项与后续建议。两次模型判断都不能替代病原检测。
          </p>
          <p>
            四张照片提供互补线索。缺少树种或部分照片仍可分析，但依据减少。模型分数、信息完整度和可信度都不能直接当成实际准确率。
          </p>
        </div>
        <a className="secondary" href="./技术报告_林业版.md" download>
          <Download size={16} />
          下载简要技术报告
        </a>
      </section>
    </>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function Evidence({ title, items }: { title?: string; items: string[] }) {
  return items.length ? (
    <div className="evidence">
      {title && <h4>{title}</h4>}
      <ul>
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  ) : null;
}
function ReviewCard({ review: r }: { review: Review }) {
  return (
    <article className="review-card">
      <div className="section-top">
        <span className="review-provider">
          <FlaskConical size={18} />
          {r.provider}
        </span>
        <span className="pill">
          {r.status === "completed"
            ? `${r.confidence_level}可信度`
            : "复核未完成"}
        </span>
      </div>
      <small className="muted">{r.model}</small>
      <h3>{r.primary_diagnosis || "本次未获得复核结论"}</h3>
      <p>{r.conclusion}</p>
      <div className="soft-box">
        <b>初筛态度：{r.supports_initial_candidate}</b>
        <p>{r.confidence_basis}</p>
      </div>
      <Evidence title="已有事实" items={r.confirmed_evidence} />
      <Evidence title="关键支持证据" items={r.supporting_evidence} />
      <Evidence title="不确定与缺失证据" items={r.uncertainties} />
      <Evidence title="需要鉴别" items={r.differential_diagnoses} />
      <Evidence title="后续建议" items={r.next_actions} />
      {r.warning && <p className="muted fine">{r.warning}</p>}
    </article>
  );
}
function SettingsPage({
  settings,
  update,
  reportError,
  notify,
}: {
  settings: Settings;
  update: (s: Settings) => void;
  reportError: (s: string) => void;
  notify: (s: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [question, setQuestion] = useState("");
  const [available, setAvailable] = useState(false);
  const [answer, setAnswer] = useState("");
  const [working, setWorking] = useState(false);
  const [connected, setConnected] = useState(false);
  async function check() {
    setWorking(true);
    reportError("");
    setConnected(false);
    try {
      if (draft.mode === "direct") {
        const checks = await testDirectKeys(draft);
        notify(`连接检查（不进行识别）：${checks.join("；")}`);
        return;
      }
      const base = normalizeBase(draft.base);
      const config = await request<{
        question: string;
        developer_access_available: boolean;
      }>(base, "/v1/access/configuration");
      setQuestion(config.question);
      setAvailable(config.developer_access_available);
      setConnected(true);
      notify("后端连接成功，可以保存接口配置。");
    } catch (e) {
      reportError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  function save() {
    try {
      const base =
        draft.mode === "direct" ? draft.base : normalizeBase(draft.base);
      const next = {
        ...draft,
        base,
        kindwise: draft.kindwise.trim(),
        deepseek: draft.deepseek.trim(),
      };
      if (base !== settings.base) {
        next.token = "";
        next.expires = "";
        next.providers = [];
      }
      update(next);
      setDraft(next);
      reportError("");
      notify("设置已保存，仅保留在当前浏览器会话中。");
    } catch (e) {
      reportError((e as Error).message);
    }
  }
  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    reportError("");
    try {
      const base = normalizeBase(draft.base);
      const result = await request<{
        access_token: string;
        expires_at: string;
        enabled_providers: string[];
      }>(base, "/v1/access/developer/unlock", json({ answer: answer.trim() }));
      const next = {
        ...draft,
        base,
        kindwise: draft.kindwise.trim(),
        deepseek: draft.deepseek.trim(),
        token: result.access_token,
        expires: result.expires_at,
        providers: result.enabled_providers,
      };
      update(next);
      setDraft(next);
      setAnswer("");
      notify("开发者通道已解锁。");
    } catch (e) {
      reportError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="PREFERENCES & CONNECTIONS"
        title="配置你的识别工作台。"
        description="默认由浏览器直连模型服务，也可切换原有后端通道。"
      />
      <div className="settings-layout">
        <div>
          <section className="panel">
            <h2>选择运行方式</h2>
            <div className="review-tabs" aria-label="运行方式">
              <button
                className={draft.mode === "direct" ? "selected" : ""}
                onClick={() => {
                  setDraft({ ...draft, mode: "direct" });
                  setConnected(false);
                }}
              >
                纯网页直连
              </button>
              <button
                className={draft.mode === "backend" ? "selected" : ""}
                onClick={() => {
                  setDraft({ ...draft, mode: "backend" });
                  setConnected(false);
                }}
              >
                使用后端
              </button>
            </div>
            <p className="muted">
              {draft.mode === "direct"
                ? "无需服务器，图片在本机处理后直接发送至模型服务。可填写个人密钥或解锁公共体验通道。切换后请保存设置。"
                : "复用原有识别后端，可使用开发者授权通道。切换后请点击保存设置。"}
            </p>
          </section>
          {draft.mode === "backend" && (
            <>
              <section className="panel">
                <h2>
                  <span className="step-num">01</span>后端连接
                </h2>
                <p className="muted">
                  填写识别服务根地址。同站部署或本机开发时可留空。
                </p>
                <label>
                  识别服务地址
                  <input
                    type="url"
                    placeholder="https://api.example.com"
                    value={draft.base}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        base: e.target.value,
                        token: "",
                        expires: "",
                        providers: [],
                      });
                      setConnected(false);
                      setAvailable(false);
                    }}
                  />
                </label>
                <button
                  disabled={working}
                  className="secondary"
                  onClick={check}
                >
                  {working ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ScanLine size={16} />
                  )}
                  测试连接
                </button>
              </section>
            </>
          )}
          <section className="panel">
            <h2>
              <span className="step-num">02</span>个人 API 密钥
            </h2>
            <p className="muted">
              Kindwise 用于专业初筛，DeepSeek 用于图片与证据复核，可分别配置。
            </p>
            {draft.mode === "direct" && (
              <p className="muted fine">
                推荐两项都填写。仅填 DeepSeek
                时只有图片观察，无专业模型初筛。复核使用支持图片的
                deepseek-flash。
              </p>
            )}
            <label>
              Kindwise API Key
              <input
                autoComplete="off"
                type="password"
                value={draft.kindwise}
                placeholder="填写你的植物病害识别密钥"
                onChange={(e) =>
                  setDraft({ ...draft, kindwise: e.target.value })
                }
              />
            </label>
            <label>
              DeepSeek API Key
              <input
                autoComplete="off"
                type="password"
                value={draft.deepseek}
                placeholder="填写你的大模型复核密钥"
                onChange={(e) =>
                  setDraft({ ...draft, deepseek: e.target.value })
                }
              />
            </label>
            <div className="section-top">
              {draft.mode === "direct" && (
                <button
                  disabled={working}
                  className="secondary"
                  onClick={check}
                >
                  {working ? "检查中…" : "检查密钥连接"}
                </button>
              )}
              <button className="primary" disabled={working} onClick={save}>
                保存设置
                <Check size={16} />
              </button>
              <button
                className="text-button"
                onClick={() => {
                  const next = { ...settings, kindwise: "", deepseek: "" };
                  update(next);
                  setDraft(next);
                  notify("个人密钥已清除。");
                }}
              >
                <Trash2 size={16} />
                清除个人密钥
              </button>
            </div>
          </section>
          {draft.mode === "direct" && (
            <section className="panel">
              <h2>公共体验通道</h2>
              <p className="muted">
                供小组体验使用。个人填写的密钥优先于公共密钥。
              </p>
              {sharedActive(settings) ? (
                <>
                  <p className="muted">
                    公共体验通道已启用，本次会话最长有效 7 天。
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      const next = { ...settings, sharedExpires: 0 };
                      update(next);
                      setDraft({ ...draft, sharedExpires: 0 });
                      notify("已退出公共体验通道。");
                    }}
                  >
                    退出公共体验通道
                  </button>
                </>
              ) : sharedAvailable ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setWorking(true);
                    reportError("");
                    try {
                      if (!(await checkSharedAnswer(answer)))
                        throw new Error("答案不正确");
                      const next = {
                        ...draft,
                        mode: "direct" as const,
                        sharedExpires: Date.now() + 7 * 24 * 60 * 60 * 1000,
                      };
                      update(next);
                      setDraft(next);
                      setAnswer("");
                      notify("公共体验通道已解锁，可返回病害识别使用。");
                    } catch (e) {
                      reportError((e as Error).message);
                    } finally {
                      setWorking(false);
                    }
                  }}
                >
                  <label>
                    开发者所在班级是？
                    <input
                      required
                      autoComplete="off"
                      maxLength={100}
                      placeholder="请输入答案"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                    />
                  </label>
                  <button className="secondary" disabled={working}>
                    验证并启用公共通道
                    <ArrowRight size={16} />
                  </button>
                </form>
              ) : (
                <p className="muted">
                  此版本尚未配置公共体验额度，请使用个人密钥。
                </p>
              )}
              <p className="muted fine">
                纯网页公共密钥可被访客提取；问答仅用于体验入口，不是安全权限控制。公共额度耗尽时请使用个人密钥。
              </p>
            </section>
          )}
          {draft.mode === "backend" && (
            <section className="panel">
              <h2>
                <span className="step-num">03</span>开发者通道
              </h2>
              {settings.token && Date.parse(settings.expires) > Date.now() ? (
                <>
                  <p className="muted">
                    已启用：{settings.providers.join("、")}
                    <br />
                    有效期至{" "}
                    {new Date(settings.expires).toLocaleString("zh-CN")}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      const next = {
                        ...settings,
                        token: "",
                        expires: "",
                        providers: [],
                      };
                      update(next);
                      setDraft(next);
                    }}
                  >
                    退出开发者通道
                  </button>
                </>
              ) : (
                <>
                  <p className="muted">
                    先测试后端连接，获取开发者问题。答案由后端验证。
                  </p>
                  {connected && !available && (
                    <div className="soft-box">
                      这个后端尚未开放开发者通道，可使用个人 API 密钥。
                    </div>
                  )}
                  {connected && available && (
                    <form onSubmit={unlock}>
                      <label>
                        {question}
                        <input
                          autoComplete="off"
                          required
                          maxLength={100}
                          placeholder="请输入答案"
                          value={answer}
                          onChange={(e) => setAnswer(e.target.value)}
                        />
                      </label>
                      <button className="secondary" disabled={working}>
                        验证并解锁
                        <ArrowRight size={16} />
                      </button>
                    </form>
                  )}
                </>
              )}
            </section>
          )}
        </div>
        <aside className="guide-card">
          <ShieldCheck size={28} />
          <h3>密钥由你掌握。</h3>
          <p>
            密钥默认保存在当前浏览器会话，关闭标签页后通常失效；浏览器恢复会话时可能保留。
          </p>
          <p>
            {draft.mode === "direct"
              ? "直连模式下，密钥仅发送给对应的官方 API，不写入公开源码；本机记录不包含密钥和照片。"
              : "后端模式下，密钥会发送至你配置的后端。请连接自己或团队信任的服务。"}
          </p>
          <p>公共体验通道需回答问题启用；图片与请求由模型供应商处理。</p>
        </aside>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
