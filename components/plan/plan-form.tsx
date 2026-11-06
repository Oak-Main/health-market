"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Minus, Plus, Loader2 } from "lucide-react"
import { Field, Input, Select } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { PlanResults } from "@/components/plan/plan-results"
import {
  fetchEstimate,
  type EstimateResponse,
  type ProblemResponse,
  type ValidationProblem,
} from "@/lib/estimate"

const PLAN_YEARS = [2027, 2026] as const

interface FormState {
  zip: string
  householdSize: string
  income: string
  ages: string[]
  planYear: number
  countyFips?: string
}

function initialState(params: URLSearchParams): FormState {
  const agesParam = params.get("ages")
  const ages = agesParam ? agesParam.split(",").map((s) => s.trim()).filter(Boolean) : ["60", "58"]
  return {
    zip: params.get("zip") ?? "",
    householdSize: params.get("household") ?? String(Math.max(ages.length, 1)),
    income: params.get("income") ?? "",
    ages,
    planYear: params.get("planYear") === "2026" ? 2026 : 2027,
  }
}

export function PlanForm() {
  const params = useSearchParams()
  const [state, setState] = React.useState<FormState>(() => initialState(params))
  const [loading, setLoading] = React.useState(false)
  const [problems, setProblems] = React.useState<ValidationProblem[]>([])
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [response, setResponse] = React.useState<EstimateResponse | null>(null)
  const [submittedIncome, setSubmittedIncome] = React.useState(0)
  const abortRef = React.useRef<AbortController | null>(null)
  const resultsRef = React.useRef<HTMLDivElement | null>(null)

  const fieldError = (field: string) => problems.find((p) => p.field === field)?.message

  async function submit(countyFips?: string) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setProblems([])
    setServerError(null)

    const income = Number(state.income.replace(/[^0-9.]/g, ""))
    const input = {
      planYear: state.planYear,
      zip: state.zip.trim(),
      householdSize: Number(state.householdSize),
      income,
      ages: state.ages.map((a) => Number(a)).filter((n) => Number.isFinite(n)),
      includeCurve: true,
      ...(countyFips ? { countyFips } : {}),
    }

    try {
      const outcome = await fetchEstimate(input, controller.signal)
      if (outcome.status === 400 || outcome.status === 503 || outcome.status === 500) {
        const body = outcome.body as ProblemResponse
        if (body.problems) setProblems(body.problems)
        else setServerError(body.message ?? body.error ?? "Something went wrong.")
        setResponse(null)
      } else {
        setResponse(outcome.body as EstimateResponse)
        setSubmittedIncome(income)
        setState((s) => ({ ...s, countyFips }))
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setServerError("The estimate service could not be reached.")
      }
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    if (response && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [response])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    void submit()
  }

  function setAge(i: number, value: string) {
    setState((s) => {
      const ages = [...s.ages]
      ages[i] = value.replace(/[^0-9]/g, "")
      return { ...s, ages }
    })
  }

  function addPerson() {
    setState((s) => {
      const ages = [...s.ages, ""]
      const householdSize = String(Math.max(Number(s.householdSize) || 0, ages.length))
      return { ...s, ages, householdSize }
    })
  }

  function removePerson(i: number) {
    setState((s) => {
      if (s.ages.length <= 1) return s
      const ages = s.ages.filter((_, idx) => idx !== i)
      return { ...s, ages }
    })
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(320px,380px)_1fr] lg:gap-12">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-5 self-start rounded-lg border border-border bg-card p-6 md:p-7 lg:sticky lg:top-6"
        noValidate
      >
        <div>
          <h2 className="font-serif text-2xl">Your household</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Estimates only. Nothing is stored.
          </p>
        </div>

        <Field label="Plan year" htmlFor="planYear">
          <Select
            id="planYear"
            value={state.planYear}
            onChange={(e) => setState((s) => ({ ...s, planYear: Number(e.target.value) }))}
          >
            {PLAN_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="ZIP code" htmlFor="zip" error={fieldError("zip")} hint="Five digits.">
          <Input
            id="zip"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="77002"
            maxLength={5}
            value={state.zip}
            onChange={(e) =>
              setState((s) => ({ ...s, zip: e.target.value.replace(/[^0-9]/g, "") }))
            }
          />
        </Field>

        <Field
          label="Household size (for taxes)"
          htmlFor="household"
          error={fieldError("householdSize")}
          hint="Everyone on your tax return, not only those needing coverage."
        >
          <Input
            id="household"
            inputMode="numeric"
            placeholder="2"
            value={state.householdSize}
            onChange={(e) =>
              setState((s) => ({ ...s, householdSize: e.target.value.replace(/[^0-9]/g, "") }))
            }
          />
        </Field>

        <Field
          label="Annual income (MAGI)"
          htmlFor="income"
          error={fieldError("income")}
          hint="Modified adjusted gross income for the year."
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              id="income"
              inputMode="numeric"
              placeholder="80,000"
              className="pl-7"
              value={state.income}
              onChange={(e) =>
                setState((s) => ({ ...s, income: e.target.value.replace(/[^0-9.]/g, "") }))
              }
            />
          </div>
        </Field>

        <Field
          label="Ages seeking coverage"
          htmlFor="age-0"
          error={fieldError("ages")}
          hint="Age at the start of the plan year."
        >
          <div className="flex flex-col gap-2">
            {state.ages.map((age, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  id={`age-${i}`}
                  inputMode="numeric"
                  placeholder="Age"
                  className="flex-1"
                  maxLength={3}
                  value={age}
                  onChange={(e) => setAge(i, e.target.value)}
                />
                {state.ages.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removePerson(i)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted"
                    aria-label={`Remove person ${i + 1}`}
                  >
                    <Minus className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              onClick={addPerson}
              className="mt-1 inline-flex items-center gap-1.5 self-start text-sm text-accent hover:underline"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add a person
            </button>
          </div>
        </Field>

        <Button type="submit" variant="primary" size="lg" disabled={loading} className="mt-1">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Computing…
            </>
          ) : (
            "Find my cliff"
          )}
        </Button>

        {serverError ? <p className="text-sm text-over">{serverError}</p> : null}
      </form>

      <div ref={resultsRef} className="scroll-mt-6">
        {response ? (
          <PlanResults
            response={response}
            income={submittedIncome}
            onSelectCounty={(fips) => void submit(fips)}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
      <p className="max-w-sm text-pretty leading-relaxed text-muted-foreground">
        Enter your household on the left to see exactly where your subsidy ends — and what the
        dollar past the edge would cost.
      </p>
      <p className="mt-4 font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
        Try ZIP 77002 · household 2 · $80,000 · ages 60, 58
      </p>
    </div>
  )
}
