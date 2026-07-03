"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ParsedQuestion = {
  questionOrder: number;
  sectionIndex: number;
  sectionTitle: string;
  questionText: string;
  questionDescription: string;
  entry: string;
  typeId: number | null;
  type: string;
  required: boolean;
  options: string[];
};

type ParsedSection = {
  sectionIndex: number;
  sectionTitle: string;
  sectionDescription: string;
  questions: ParsedQuestion[];
};

type ParsedGoogleForm = {
  formTitle: string;
  formDescription: string;
  pageHistory: string;
  sourceUrl: string;
  sections: ParsedSection[];
};

type ApiResponse =
  | {
      ok: true;
      data: ParsedGoogleForm;
    }
  | {
      ok: false;
      message: string;
    };

type SubmitResponse =
  | {
      ok: true;
      status: number;
      statusText: string;
    }
  | {
      ok: false;
      message?: string;
      status?: number;
      statusText?: string;
    };

type SubmissionLog = {
  index: number;
  ok: boolean;
  status: number | null;
  message: string;
  payload: Record<string, string>;
};

const DEMO_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfh2fFBszKCwNAwF2gh6RQBlYkcQFaJaCPwb8Hc9lJb7kQY3g/viewform";

const MAX_FORM_COUNT = 50;
const MIN_DELAY_SECONDS = 10;
const MAX_DELAY_SECONDS = 3600;
const QUESTIONS_PER_PAGE = 5;

function buildDefaultWeights(options: string[]): Record<string, number> {
  if (options.length === 0) return {};

  const baseWeight = Math.floor(100 / options.length);
  const remainder = 100 - baseWeight * options.length;

  return Object.fromEntries(
    options.map((option, index) => [option, baseWeight + (index === 0 ? remainder : 0)]),
  );
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function randomInt(min: number, max: number): number {
  const safeMin = Math.ceil(Math.min(min, max));
  const safeMax = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

export default function HomePage() {
  const [formUrl, setFormUrl] = useState(DEMO_URL);
  const [data, setData] = useState<ParsedGoogleForm | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [optionWeights, setOptionWeights] = useState<Record<string, Record<string, number>>>({});
  const [pageHistoryValue, setPageHistoryValue] = useState("0");
  const [formCount, setFormCount] = useState(10);
  const [delayMinSeconds, setDelayMinSeconds] = useState(90);
  const [delayMaxSeconds, setDelayMaxSeconds] = useState(150);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitLogs, setSubmitLogs] = useState<SubmissionLog[]>([]);
  const [delayRemaining, setDelayRemaining] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const cancelSubmissionRef = useRef(false);

  const totalQuestions = useMemo(() => {
    if (!data) return 0;
    return data.sections.reduce((sum, section) => sum + section.questions.length, 0);
  }, [data]);

  const optionQuestions = useMemo(() => {
    if (!data) return [];
    return data.sections.flatMap((section) => section.questions).filter((question) => question.options.length > 0);
  }, [data]);

  useEffect(() => {
    if (!data) {
      setOptionWeights({});
      setPageHistoryValue("0");
      setSubmitLogs([]);
      setSubmitError("");
      return;
    }

    const nextWeights: Record<string, Record<string, number>> = {};
    for (const section of data.sections) {
      for (const question of section.questions) {
        if (question.options.length > 0) {
          nextWeights[question.entry] = buildDefaultWeights(question.options);
        }
      }
    }

    setOptionWeights(nextWeights);
    setPageHistoryValue(data.pageHistory || "0");
    setSubmitLogs([]);
    setSubmitError("");
    setCurrentPage(1);
  }, [data]);

  const filteredSections = useMemo(() => {
    if (!data) return [];
    const key = keyword.trim().toLowerCase();
    if (!key) return data.sections;

    return data.sections
      .map((section) => ({
        ...section,
        questions: section.questions.filter((question) => {
          const haystack = [
            section.sectionTitle,
            question.questionText,
            question.questionDescription,
            question.entry,
            question.type,
            question.options.join(" "),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(key);
        }),
      }))
      .filter((section) => section.questions.length > 0);
  }, [data, keyword]);

  useEffect(() => {
    setCurrentPage(1);
  }, [keyword]);

  const filteredQuestions = useMemo(
    () => filteredSections.flatMap((section) => section.questions),
    [filteredSections],
  );

  const pageCount = Math.max(1, Math.ceil(filteredQuestions.length / QUESTIONS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const pageStart = filteredQuestions.length === 0 ? 0 : (safeCurrentPage - 1) * QUESTIONS_PER_PAGE + 1;
  const pageEnd = Math.min(safeCurrentPage * QUESTIONS_PER_PAGE, filteredQuestions.length);

  const paginatedSections = useMemo(() => {
    if (!data) return [];

    const sectionMap = new Map(data.sections.map((section) => [section.sectionIndex, section]));
    const questions = filteredQuestions.slice(
      (safeCurrentPage - 1) * QUESTIONS_PER_PAGE,
      safeCurrentPage * QUESTIONS_PER_PAGE,
    );
    const sections: ParsedSection[] = [];

    for (const question of questions) {
      let section = sections.find((item) => item.sectionIndex === question.sectionIndex);
      if (!section) {
        const sourceSection = sectionMap.get(question.sectionIndex);
        section = {
          sectionIndex: question.sectionIndex,
          sectionTitle: question.sectionTitle,
          sectionDescription: sourceSection?.sectionDescription ?? "",
          questions: [],
        };
        sections.push(section);
      }
      section.questions.push(question);
    }

    return sections;
  }, [data, filteredQuestions, safeCurrentPage]);

  function getQuestionWeightTotal(question: ParsedQuestion): number {
    const weights = optionWeights[question.entry] ?? {};
    return question.options.reduce((sum, option) => sum + (Number(weights[option]) || 0), 0);
  }

  const submitConfigError = useMemo(() => {
    if (!data) return "Chưa có dữ liệu form.";
    if (optionQuestions.length === 0) return "Form chưa có câu hỏi dạng options để tạo payload tự động.";
    if (formCount < 1 || formCount > MAX_FORM_COUNT) {
      return `Số lượng form phải từ 1 đến ${MAX_FORM_COUNT}.`;
    }
    if (delayMinSeconds < MIN_DELAY_SECONDS || delayMaxSeconds > MAX_DELAY_SECONDS) {
      return `Delay phải nằm trong khoảng ${MIN_DELAY_SECONDS}-${MAX_DELAY_SECONDS} giây.`;
    }
    if (delayMinSeconds > delayMaxSeconds) return "Delay bắt đầu không được lớn hơn delay kết thúc.";

    const invalidQuestion = optionQuestions.find(
      (question) =>
        question.options.reduce(
          (sum, option) => sum + (Number(optionWeights[question.entry]?.[option]) || 0),
          0,
        ) !== 100,
    );
    if (invalidQuestion) {
      return `Tổng tỉ lệ của "${invalidQuestion.questionText || invalidQuestion.entry}" phải bằng 100%.`;
    }

    if (!pageHistoryValue.trim()) return "pageHistory không được để trống.";
    return "";
  }, [data, delayMaxSeconds, delayMinSeconds, formCount, optionQuestions, optionWeights, pageHistoryValue]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setData(null);

    try {
      const response = await fetch("/api/parse-form", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: formUrl }),
      });

      const result = (await response.json()) as ApiResponse;
      if (!result.ok) {
        setError(result.message || "Không thể đọc form.");
        return;
      }

      setData(result.data);
    } catch {
      setError("Không gọi được API. Hãy kiểm tra server NextJS đang chạy.");
    } finally {
      setLoading(false);
    }
  }

  function updateOptionWeight(question: ParsedQuestion, option: string, nextWeight: number) {
    const safeWeight = clampNumber(Math.round(nextWeight), 0, 100);

    setOptionWeights((current) => ({
      ...current,
      [question.entry]: {
        ...current[question.entry],
        [option]: safeWeight,
      },
    }));
  }

  function chooseWeightedOption(question: ParsedQuestion): string | null {
    const weights = optionWeights[question.entry] ?? {};
    const weightedOptions = question.options
      .map((option) => ({
        option,
        weight: Number(weights[option]) || 0,
      }))
      .filter((item) => item.weight > 0);

    const totalWeight = weightedOptions.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) return null;

    let cursor = Math.random() * totalWeight;
    for (const item of weightedOptions) {
      cursor -= item.weight;
      if (cursor <= 0) return item.option;
    }

    return weightedOptions.at(-1)?.option ?? null;
  }

  function buildSubmissionPayload(): Record<string, string> {
    const payload: Record<string, string> = {};

    for (const question of optionQuestions) {
      const selectedOption = chooseWeightedOption(question);
      if (selectedOption) {
        payload[question.entry] = selectedOption;
      }
    }

    payload.pageHistory = pageHistoryValue.trim() || data?.pageHistory || "0";
    return payload;
  }

  async function waitSeconds(seconds: number): Promise<boolean> {
    for (let remaining = seconds; remaining > 0; remaining -= 1) {
      if (cancelSubmissionRef.current) return false;
      setDelayRemaining(remaining);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }

    setDelayRemaining(null);
    return !cancelSubmissionRef.current;
  }

  function stopSubmitting() {
    cancelSubmissionRef.current = true;
    setDelayRemaining(null);
  }

  async function submitGeneratedPayloads() {
    if (!data) return;

    if (submitConfigError) {
      setSubmitError(submitConfigError);
      return;
    }

    const count = Math.floor(clampNumber(formCount, 1, MAX_FORM_COUNT));
    const minDelay = Math.floor(clampNumber(delayMinSeconds, MIN_DELAY_SECONDS, MAX_DELAY_SECONDS));
    const maxDelay = Math.floor(clampNumber(delayMaxSeconds, MIN_DELAY_SECONDS, MAX_DELAY_SECONDS));

    setFormCount(count);
    setDelayMinSeconds(minDelay);
    setDelayMaxSeconds(maxDelay);
    setSubmitLogs([]);
    setSubmitError("");
    setSubmitting(true);
    setDelayRemaining(null);
    cancelSubmissionRef.current = false;

    try {
      for (let index = 1; index <= count; index += 1) {
        if (cancelSubmissionRef.current) break;

        const payload = buildSubmissionPayload();
        const response = await fetch("/api/submit-form", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceUrl: data.sourceUrl,
            payload,
          }),
        });
        const result = (await response.json()) as SubmitResponse;
        const status = result.status ?? response.status ?? null;
        const ok = response.ok && result.ok;
        const message = ok ? "Đã gửi" : !result.ok ? result.message || `HTTP ${status}` : `HTTP ${status}`;

        setSubmitLogs((current) =>
          [
            {
              index,
              ok,
              status,
              message,
              payload,
            },
            ...current,
          ].slice(0, 20),
        );

        if (!ok) {
          setSubmitError(message);
          break;
        }

        if (index < count) {
          const shouldContinue = await waitSeconds(randomInt(minDelay, maxDelay));
          if (!shouldContinue) break;
        }
      }
    } catch (submitErrorValue) {
      const message =
        submitErrorValue instanceof Error ? submitErrorValue.message : "Không gọi được API submit form.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
      setDelayRemaining(null);
      cancelSubmissionRef.current = false;
    }
  }

  function downloadJson() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "google-form-structure.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Google Form Parser</p>
          <h1>Cào cấu trúc Google Form</h1>
          <p className="subtitle">
            Nhập link Google Form, hệ thống sẽ đọc các Section, câu hỏi, mã entry và danh sách
            options rồi hiển thị thành giao diện dễ kiểm tra.
          </p>
        </div>

        <form className="form-box" onSubmit={handleSubmit}>
          <label htmlFor="formUrl">Link Google Form</label>
          <div className="input-row">
            <input
              id="formUrl"
              value={formUrl}
              onChange={(event) => setFormUrl(event.target.value)}
              placeholder="https://docs.google.com/forms/d/e/.../viewform"
            />
            <button type="submit" disabled={loading}>
              {loading ? "Đang đọc..." : "Lấy dữ liệu"}
            </button>
          </div>
          <p className="hint">
            Có thể dùng link dạng <code>viewform</code> hoặc <code>formResponse</code>.
          </p>
        </form>
      </section>

      {error ? <div className="alert-error">{error}</div> : null}

      {data ? (
        <section className="result-card">
          <div className="result-header">
            <div>
              <p className="eyebrow">Kết quả</p>
              <h2>{data.formTitle || "Google Form"}</h2>
              {data.formDescription ? <p className="description">{data.formDescription}</p> : null}
              <div className="meta-list">
                <p className="meta">
                  {data.sections.length} section · {totalQuestions} câu hỏi
                </p>
                <p className="meta">
                  pageHistory: <code>{data.pageHistory || "Không tìm thấy"}</code>
                </p>
              </div>
            </div>
            <button className="secondary-button" type="button" onClick={downloadJson}>
              Tải JSON
            </button>
          </div>

          <div className="submit-panel">
            <div className="submit-panel-header">
              <div>
                <p className="eyebrow">Payload</p>
                <h3>Cấu hình submit form</h3>
              </div>
              <div className="submit-actions">
                {submitting ? (
                  <button className="secondary-button" type="button" onClick={stopSubmitting}>
                    Dừng
                  </button>
                ) : null}
                <button type="button" disabled={submitting || Boolean(submitConfigError)} onClick={submitGeneratedPayloads}>
                  {submitting ? "Đang submit..." : "Submit form"}
                </button>
              </div>
            </div>

            <div className="submit-controls">
              <label>
                <span>pageHistory</span>
                <input value={pageHistoryValue} onChange={(event) => setPageHistoryValue(event.target.value)} />
              </label>
              <label>
                <span>Số lượng form</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_FORM_COUNT}
                  value={formCount}
                  onChange={(event) =>
                    setFormCount(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0)
                  }
                />
              </label>
              <label>
                <span>Delay từ (giây)</span>
                <input
                  type="number"
                  min={MIN_DELAY_SECONDS}
                  max={MAX_DELAY_SECONDS}
                  value={delayMinSeconds}
                  onChange={(event) =>
                    setDelayMinSeconds(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0)
                  }
                />
              </label>
              <label>
                <span>Delay đến (giây)</span>
                <input
                  type="number"
                  min={MIN_DELAY_SECONDS}
                  max={MAX_DELAY_SECONDS}
                  value={delayMaxSeconds}
                  onChange={(event) =>
                    setDelayMaxSeconds(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0)
                  }
                />
              </label>
            </div>

            {submitConfigError ? <p className="submit-warning">{submitConfigError}</p> : null}
            {submitError ? <p className="submit-warning">{submitError}</p> : null}
            {delayRemaining !== null ? <p className="submit-status">Đợi {delayRemaining} giây trước lượt tiếp theo.</p> : null}

            {submitLogs.length > 0 ? (
              <div className="submit-log-list">
                {submitLogs.map((log) => (
                  <div className="submit-log-row" key={`${log.index}-${log.status}-${log.message}`}>
                    <span>#{log.index}</span>
                    <strong>{log.ok ? "OK" : "Lỗi"}</strong>
                    <code>{log.status ?? "-"}</code>
                    <span>{log.message}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="toolbar">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Tìm câu hỏi, entry, option..."
            />
          </div>

          <div className="pagination-bar">
            <p>
              Hiển thị {pageStart}-{pageEnd} / {filteredQuestions.length} câu hỏi
            </p>
            <div className="pagination-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Trước
              </button>
              <span>
                Trang {safeCurrentPage} / {pageCount}
              </span>
              <button
                className="secondary-button"
                type="button"
                disabled={safeCurrentPage >= pageCount}
                onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
              >
                Sau
              </button>
            </div>
          </div>

          <div className="section-list">
            {paginatedSections.map((section) => (
              <article className="section-card" key={`${section.sectionIndex}-${section.sectionTitle}`}>
                <div className="section-title-row">
                  <span>Section {section.sectionIndex}</span>
                  <h3>{section.sectionTitle}</h3>
                </div>
                {section.sectionDescription ? (
                  <p className="section-description">{section.sectionDescription}</p>
                ) : null}

                <div className="question-list">
                  {section.questions.map((question) => (
                    <div className="question-card" key={`${question.questionOrder}-${question.entry}`}>
                      <div className="question-topline">
                        <span className="question-number">#{question.questionOrder}</span>
                        <span className="type-badge">{question.type}</span>
                        {question.required ? <span className="required-badge">Bắt buộc</span> : null}
                      </div>

                      <h4>{question.questionText || "Không có tiêu đề câu hỏi"}</h4>
                      {question.questionDescription ? (
                        <p className="question-description">{question.questionDescription}</p>
                      ) : null}

                      <div className="entry-line">
                        <span>Entry:</span>
                        <code>{question.entry}</code>
                      </div>

                      {question.options.length > 0 ? (
                        <div className="options-box">
                          <div className="options-header">
                            <p>Options</p>
                            <span>Tổng {getQuestionWeightTotal(question)}%</span>
                          </div>
                          <div className="option-weight-list">
                            {question.options.map((option) => (
                              <label className="option-weight-row" key={option}>
                                <span>{option}</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={optionWeights[question.entry]?.[option] ?? 0}
                                  onChange={(event) => updateOptionWeight(question, option, event.target.valueAsNumber)}
                                />
                                <strong>%</strong>
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="no-options">Câu hỏi dạng nhập liệu, không có options.</p>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
