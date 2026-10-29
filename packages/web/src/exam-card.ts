import { formatNumber } from "./format.ts";
import type { Lang, MessageKey } from "./i18n.ts";
import {
  EXAM_TIER_LABEL,
  EXAM_VERSION,
  examSubmitUrl,
  type ExamResult,
  type Submitted,
} from "./exam.ts";

type Options = {
  readonly result: ExamResult;
  readonly best: ExamResult | null;
  readonly submitted: Submitted | null;
  readonly open: boolean;
  readonly lang: Lang;
  readonly t: (key: MessageKey) => string;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const money = (value: number) => `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(2)}`;

/** Victory card: certificate, one-shot score submission, skippable and not time-pressured. */
export function showExamCard(options: Options): () => void {
  const { t } = options;
  const overlay = el("div", "exam-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t("exam.cert"));

  const cert = el("div", "exam-cert");
  cert.append(
    el("p", "exam-kicker", `Exam 50K · ${EXAM_VERSION}`),
    el(
      "h2",
      "exam-heading",
      options.result.tier === "distinction"
        ? `${t("exam.cert")} · ${t("exam.distinction")}`
        : t("exam.cert"),
    ),
    el("p", "exam-code", options.result.code),
  );

  const rows = el("dl", "exam-rows");
  const row = (label: string, value: string) => {
    const d = el("div", "exam-row");
    d.append(el("dt", undefined, label), el("dd", undefined, value));
    rows.append(d);
  };
  row(t("review.net"), money(options.result.net));
  row(t("review.maxDd"), `$${formatNumber(options.result.maxDrawdownUsd, options.lang)}`);
  row(t("review.trades"), String(options.result.trades));
  cert.append(rows, el("p", "exam-legal", t("exam.legal")));

  const note = el("p", "exam-note", t("exam.once"));
  const bestLine =
    options.best === null
      ? null
      : el(
          "p",
          "exam-best",
          `${t("exam.best")}: ${EXAM_TIER_LABEL[options.best.tier]} · ${money(options.best.net)}`,
        );

  const actions = el("div", "exam-actions");
  const submit = el("button", "submit submit-long", t("exam.submit"));
  submit.type = "button";
  const skip = el("button", "ghost", t("exam.skip"));
  skip.type = "button";

  let timer = 0;
  const enable = () => {
    submit.textContent = t("exam.submit");
    submit.classList.add("exam-ready");
    submit.disabled = false;
  };

  if (options.submitted !== null) {
    submit.textContent = t("exam.submitted");
    submit.disabled = true;
  } else if (!options.open) {
    submit.textContent = t("exam.ended");
    submit.disabled = true;
  } else {
    // Short beat before the submit button lights up; the card never navigates by itself.
    let left = 8;
    submit.disabled = true;
    submit.textContent = `${t("exam.submit")} · ${left}s`;
    timer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(timer);
        timer = 0;
        enable();
        submit.focus();
        return;
      }
      submit.textContent = `${t("exam.submit")} · ${left}s`;
    }, 1_000);
  }

  submit.addEventListener("click", () => {
    if (submit.disabled) return;
    submit.disabled = true;
    submit.textContent = t("exam.submitted");
    options.onSubmit();
    window.open(examSubmitUrl(options.result), "_blank", "noopener");
  });

  const close = () => {
    if (timer !== 0) window.clearInterval(timer);
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    options.onClose();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  skip.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  actions.append(submit, skip);
  overlay.append(cert, note);
  if (bestLine !== null) overlay.append(bestLine);
  overlay.append(actions, el("p", "exam-privacy", t("exam.privacy")));
  document.body.append(overlay);
  skip.focus();
  return close;
}
