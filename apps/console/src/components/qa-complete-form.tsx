import { useState } from "react";
import {
  QaDefectCategorySchema,
  QaDefectSeveritySchema,
  type QaDefectCategory,
  type QaDefectSeverity,
} from "@support/shared-schemas";
import { useApiClient } from "../auth/session-context.js";
import { describeError } from "../lib/errors.js";

/** Scored 0–5 (schema bound). Keys are free-form; these mirror the eval rubric
 * (grounding, policy fidelity, tone, completeness) plus safety/privacy. */
const DIMENSIONS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
}> = [
  { key: "grounding", label: "Grounding / evidence" },
  { key: "policy_fidelity", label: "Policy fidelity" },
  { key: "tone", label: "Tone" },
  { key: "completeness", label: "Completeness" },
  { key: "safety", label: "Safety" },
  { key: "privacy", label: "Privacy" },
];

const DEFAULT_SCORE = 5;
const DEFECT_CATEGORIES = QaDefectCategorySchema.options;
const DEFECT_SEVERITIES = QaDefectSeveritySchema.options;

/**
 * The QA scorecard: a 0–5 score per dimension, zero or more defects drawn from
 * the closed taxonomy (each with a severity), and optional notes. Submitting
 * calls `POST /v1/qa-reviews/{id}/complete`. Rendered only for reviewers holding
 * `qa_reviews:write`.
 */
export function QaCompleteForm({
  qaReviewId,
  onCompleted,
}: {
  readonly qaReviewId: string;
  readonly onCompleted: () => void;
}) {
  const client = useApiClient();

  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(DIMENSIONS.map((d) => [d.key, DEFAULT_SCORE])),
  );
  const [defects, setDefects] = useState<
    Partial<Record<QaDefectCategory, QaDefectSeverity>>
  >({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDefect(category: QaDefectCategory, checked: boolean) {
    setDefects((current) => {
      const next = { ...current };
      if (checked) {
        next[category] = "medium";
      } else {
        delete next[category];
      }
      return next;
    });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);

    const trimmedNotes = notes.trim();
    const defectList = (
      Object.entries(defects) as Array<[QaDefectCategory, QaDefectSeverity]>
    ).map(([category, severity]) => ({ category, severity }));

    try {
      await client.completeQaReview(qaReviewId, {
        scores,
        defects: defectList,
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      });
      onCompleted();
    } catch (caught) {
      setError(describeError(caught));
      setSubmitting(false);
    }
  }

  return (
    <div className="card qa-form">
      <h2>Complete QA review</h2>
      {error ? <p className="error">{error}</p> : null}

      <fieldset className="qa-scores">
        <legend>Dimension scores (0–5)</legend>
        {DIMENSIONS.map((dimension) => (
          <label key={dimension.key}>
            {dimension.label}
            <select
              value={scores[dimension.key]}
              aria-label={dimension.label}
              onChange={(event) =>
                setScores((current) => ({
                  ...current,
                  [dimension.key]: Number(event.target.value),
                }))
              }
            >
              {[0, 1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      <fieldset className="qa-defects">
        <legend>Defects</legend>
        {DEFECT_CATEGORIES.map((category) => {
          const selected = category in defects;
          return (
            <div key={category} className="qa-defect">
              <label>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(event) =>
                    toggleDefect(category, event.target.checked)
                  }
                />
                {category}
              </label>
              {selected ? (
                <select
                  value={defects[category]}
                  aria-label={`${category} severity`}
                  onChange={(event) =>
                    setDefects((current) => ({
                      ...current,
                      [category]: event.target.value as QaDefectSeverity,
                    }))
                  }
                >
                  {DEFECT_SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <label className="qa-notes">
        Notes (optional)
        <textarea
          value={notes}
          rows={3}
          aria-label="QA notes"
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="primary"
        disabled={submitting}
        onClick={() => void submit()}
      >
        Submit QA review
      </button>
    </div>
  );
}
